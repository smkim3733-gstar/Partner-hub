// Operator-only, one-shot synthetic test. Never called by backup scheduling.
import nodemailer from 'nodemailer';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BACKUP_ALERT_MAIL,
  buildBackupAlert,
} from './supabase-backup-alert.mjs';
import {
  isWithin,
  protectPrivateDirectory,
} from './supabase-backup-runtime.mjs';

export const MAIL_TEST_APPROVAL =
  'send-one-synthetic-test-to-smkim3733@naver.com';
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const receiptName = 'naver-o2-test-v1.json';
const reviewedRetryReceiptName = 'naver-o2-test-v2.json';
const smtpEnabledRetryReceiptName = 'naver-o2-test-v3.json';
const iso = (now) => now().toISOString();
const diagnosticCodes = new Set([
  'EAUTH',
  'EENVELOPE',
  'ETIMEDOUT',
  'ECONNECTION',
  'ESOCKET',
  'ETLS',
  'EDNS',
  'EMESSAGE',
]);
const diagnosticCommands = new Set([
  'API',
  'CONN',
  'EHLO',
  'HELO',
  'STARTTLS',
  'AUTH PLAIN',
  'AUTH LOGIN',
  'AUTH CRAM-MD5',
  'AUTH XOAUTH2',
  'MAIL FROM',
  'RCPT TO',
  'DATA',
]);

function safeMailDiagnostic(error) {
  // Copy only exact protocol labels and a numeric reply code. Never inspect
  // response/message/stack, parse raw SMTP text, or preserve command arguments.
  const code = error?.code;
  const command = error?.command;
  const responseCode = error?.responseCode;
  return {
    ...(diagnosticCodes.has(code) ? { transportCode: code } : {}),
    ...(diagnosticCommands.has(command) ? { command } : {}),
    ...(Number.isInteger(responseCode) &&
    responseCode >= 200 &&
    responseCode <= 599
      ? { responseCode }
      : {}),
  };
}

const defaultTransport = (options) => {
  const mailer = nodemailer.createTransport(options);
  return {
    async sendMail(message) {
      const result = await mailer.sendMail(message);
      return { accepted: result.accepted, rejected: result.rejected };
    },
    close: () => mailer.close(),
  };
};

export function testMailMessage(checkedAt = new Date().toISOString()) {
  const alert = buildBackupAlert(
    {
      health: 'last-run-failed',
      checkedAt,
      lastAttempt: { startedAt: checkedAt },
      lastSuccess: null,
    },
    { synthetic: true },
  );
  return {
    from: { name: BACKUP_ALERT_MAIL.fromName, address: BACKUP_ALERT_MAIL.from },
    to: BACKUP_ALERT_MAIL.to,
    envelope: { from: BACKUP_ALERT_MAIL.from, to: [BACKUP_ALERT_MAIL.to] },
    subject: alert.message.subject,
    text: alert.message.text,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

export function naverTransportOptions(password) {
  if (
    typeof password !== 'string' ||
    password.length < 8 ||
    password.length > 128 ||
    /[\s\p{Cc}]/u.test(password)
  )
    throw new Error('MAIL_TEST_CREDENTIAL_INVALID');
  return {
    host: 'smtp.naver.com',
    port: 465,
    secure: true,
    tls: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
      servername: 'smtp.naver.com',
    },
    auth: { user: BACKUP_ALERT_MAIL.from, pass: password },
    name: 'partner-hub.local',
    pool: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
    maxRecipients: 1,
  };
}

async function privateReceiptDirectory(directory, protect) {
  if (!path.isAbsolute(directory)) throw new Error('MAIL_TEST_PATH_INVALID');
  const requested = path.resolve(directory);
  const blocked = [
    projectRoot,
    process.env.OneDrive,
    process.env.OneDriveCommercial,
    process.env.OneDriveConsumer,
  ].filter(Boolean);
  const safe = (candidate) =>
    !blocked.some((root) => isWithin(path.resolve(root), candidate)) &&
    !candidate.split(/[\\/]/).some((part) => /^OneDrive(?:\b|$)/i.test(part));
  if (!safe(requested)) throw new Error('MAIL_TEST_PATH_INVALID');
  // Reject existing symlink/junction ancestors before creating any directory.
  for (let parent = requested; ; parent = path.dirname(parent)) {
    const info = await lstat(parent).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info && (!info.isDirectory() || info.isSymbolicLink()))
      throw new Error('MAIL_TEST_PATH_INVALID');
    if (path.dirname(parent) === parent) break;
  }
  await mkdir(requested, { recursive: true, mode: 0o700 });
  const resolved = await realpath(requested);
  if (!safe(resolved)) throw new Error('MAIL_TEST_PATH_INVALID');
  await protect(resolved);
  return resolved;
}

async function verifyReviewedRejection(
  directory,
  expectedHash,
  name = receiptName,
) {
  if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedHash))
    throw new Error('MAIL_TEST_PRIOR_REVIEW_INVALID');
  const priorPath = path.join(directory, name);
  const info = await lstat(priorPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8192)
    throw new Error('MAIL_TEST_PRIOR_REVIEW_INVALID');
  const bytes = await readFile(priorPath);
  if (
    createHash('sha256').update(bytes).digest('hex') !==
    expectedHash.toLowerCase()
  )
    throw new Error('MAIL_TEST_PRIOR_REVIEW_INVALID');
  const prior = JSON.parse(bytes.toString('utf8'));
  if (
    prior.version !== 1 ||
    prior.status !== 'smtp-rejected' ||
    prior.error !== 'MAIL_TEST_REJECTED' ||
    prior.synthetic !== true ||
    prior.recipient !== BACKUP_ALERT_MAIL.to ||
    prior.networkAttempted !== true ||
    prior.smtpAccepted !== false ||
    prior.receiptVerified !== false ||
    prior.automaticRetry !== false ||
    typeof prior.completedAt !== 'string' ||
    !Number.isFinite(Date.parse(prior.completedAt))
  )
    throw new Error('MAIL_TEST_PRIOR_REVIEW_INVALID');
  return prior;
}

// No transport.verify(): credentials are used once in the single send attempt.
// Human-reviewed v1/v2 rejections plus SMTP enablement may use v3 once.
// There is no automatic or unbounded retry, and no prior receipt is removed.
/** @param {{ approval: string, directory?: string, reviewedRejectedSha256?: string, reviewedSecondRejectedSha256?: string }} options */
export async function sendApprovedMailTest(
  {
    approval,
    directory = path.join(os.homedir(), 'PartnerHubNotifications'),
    reviewedRejectedSha256,
    reviewedSecondRejectedSha256,
  },
  {
    readPassword,
    createTransport = defaultTransport,
    protect = protectPrivateDirectory,
    now = () => new Date(),
  },
) {
  const base = {
    synthetic: true,
    recipient: BACKUP_ALERT_MAIL.to,
    receiptVerified: false,
    automaticRetry: false,
  };
  if (approval !== MAIL_TEST_APPROVAL)
    return { ...base, status: 'approval-required', networkAttempted: false };
  const reviewedRetry = reviewedRejectedSha256 !== undefined;
  const smtpEnabledRetry = reviewedSecondRejectedSha256 !== undefined;
  let receipt;
  let transport;
  let networkAttempted = false;
  let result;
  const messageId = `<partner-hub-o2-${randomUUID()}@naver.com>`;
  const record = async (value) => {
    const bytes = Buffer.from(
      JSON.stringify({ version: 1, messageId, ...base, ...value }, null, 2) +
        '\n',
    );
    await receipt.truncate(0);
    await receipt.write(bytes, 0, bytes.length, 0);
    await receipt.sync();
  };
  try {
    if (smtpEnabledRetry && !reviewedRetry)
      throw new Error('MAIL_TEST_PRIOR_REVIEW_INVALID');
    const target = await privateReceiptDirectory(directory, protect);
    if (reviewedRetry) {
      await verifyReviewedRejection(target, reviewedRejectedSha256);
      base.reviewedRejectedSha256 = reviewedRejectedSha256.toLowerCase();
    }
    if (smtpEnabledRetry) {
      const second = await verifyReviewedRejection(
        target,
        reviewedSecondRejectedSha256,
        reviewedRetryReceiptName,
      );
      if (second.reviewedRejectedSha256 !== base.reviewedRejectedSha256)
        throw new Error('MAIL_TEST_PRIOR_REVIEW_INVALID');
      base.reviewedSecondRejectedSha256 =
        reviewedSecondRejectedSha256.toLowerCase();
      base.smtpEnabledReportedByUser = true;
    }
    try {
      receipt = await open(
        path.join(
          target,
          smtpEnabledRetry
            ? smtpEnabledRetryReceiptName
            : reviewedRetry
              ? reviewedRetryReceiptName
              : receiptName,
        ),
        'wx',
        0o600,
      );
    } catch (error) {
      if (error.code === 'EEXIST')
        return {
          ...base,
          status: 'prior-attempt-review-required',
          networkAttempted: false,
        };
      throw error;
    }
    await record({
      status: 'reserved',
      startedAt: iso(now),
      networkAttempted: false,
    });
    let password = await readPassword();
    const options = naverTransportOptions(password);
    password = undefined;
    const message = { ...testMailMessage(iso(now)), messageId };
    await record({
      status: 'sending',
      startedAt: iso(now),
      networkAttempted: true,
    });
    transport = createTransport(options);
    networkAttempted = true;
    const response = await transport.sendMail(message);
    const accepted =
      Array.isArray(response.accepted) &&
      response.accepted.length === 1 &&
      response.accepted[0] === BACKUP_ALERT_MAIL.to &&
      Array.isArray(response.rejected) &&
      response.rejected.length === 0;
    result = {
      ...base,
      messageId,
      status: accepted ? 'smtp-accepted' : 'outcome-unknown',
      smtpAccepted: accepted ? true : null,
      networkAttempted,
    };
  } catch (error) {
    const rejected =
      networkAttempted && ['EAUTH', 'EENVELOPE'].includes(error?.code);
    result = {
      ...base,
      messageId,
      status: networkAttempted
        ? rejected
          ? 'smtp-rejected'
          : 'outcome-unknown'
        : 'preparation-failed',
      smtpAccepted: networkAttempted && !rejected ? null : false,
      networkAttempted,
      error: rejected
        ? 'MAIL_TEST_REJECTED'
        : networkAttempted
          ? 'MAIL_TEST_RESULT_UNKNOWN'
          : 'MAIL_TEST_PREPARATION_FAILED',
      ...(networkAttempted
        ? { smtpDiagnostic: safeMailDiagnostic(error) }
        : {}),
      ...(rejected
        ? {
            rejectionStage:
              error.code === 'EAUTH' ? 'authentication' : 'envelope',
          }
        : {}),
    };
  } finally {
    try {
      transport?.close();
    } catch {
      /* Never print a transport error. */
    }
  }
  if (receipt) {
    try {
      await record({ ...result, completedAt: iso(now) });
    } catch {
      result = {
        ...result,
        status: 'result-record-failed',
        error: 'MAIL_TEST_RECORD_FAILED',
      };
    } finally {
      await receipt.close();
    }
  }
  return result;
}

async function passwordFromStdin() {
  // The PowerShell launcher sends the masked input over a private stdin pipe.
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 4096) throw new Error('MAIL_TEST_INPUT_INVALID');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  try {
    return JSON.parse(bytes.toString('utf8')).password;
  } finally {
    bytes.fill(0);
    for (const chunk of chunks) chunk.fill(0);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === '--preview')) {
    console.log(
      JSON.stringify(
        {
          status: 'preview-only',
          networkAttempted: false,
          receiptVerified: false,
          message: testMailMessage(),
        },
        null,
        2,
      ),
    );
    return;
  }
  const initialTest = args.length === 1 && args[0] === '--send-approved-test';
  const reviewedRetry =
    args.length === 2 &&
    args[0] === '--retry-reviewed-test' &&
    /^[a-f0-9]{64}$/i.test(args[1]);
  const smtpEnabledRetry =
    args.length === 3 &&
    args[0] === '--retry-after-smtp-enabled' &&
    args.slice(1).every((hash) => /^[a-f0-9]{64}$/i.test(hash));
  if (!initialTest && !reviewedRetry && !smtpEnabledRetry)
    throw new Error('MAIL_TEST_USAGE_INVALID');
  const result = await sendApprovedMailTest(
    {
      approval: MAIL_TEST_APPROVAL,
      reviewedRejectedSha256:
        reviewedRetry || smtpEnabledRetry ? args[1] : undefined,
      reviewedSecondRejectedSha256: smtpEnabledRetry ? args[2] : undefined,
    },
    { readPassword: passwordFromStdin },
  );
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'smtp-accepted') process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main();
  } catch {
    console.error(
      JSON.stringify({
        status: 'failed',
        error: 'MAIL_TEST_FAILED_REDACTED',
        receiptVerified: false,
      }),
    );
    process.exitCode = 1;
  }
}
