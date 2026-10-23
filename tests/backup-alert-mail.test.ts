import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import nodemailer from 'nodemailer';
import { protectPrivateDirectory } from '../scripts/supabase-backup-runtime.mjs';
import {
  MAIL_TEST_APPROVAL,
  naverTransportOptions,
  sendApprovedMailTest,
  testMailMessage,
} from '../scripts/backup-alert-mail.mjs';

const recipient = 'smkim3733@naver.com';
const password = 'synthetic-credential-only';
const now = () => new Date('2026-10-21T01:30:00.000Z');

async function fixture(run: (directory: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'partner-mail-test-'));
  try {
    await run(path.join(root, 'notifications'));
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('partner-mail-test-'));
    await rm(root, { recursive: true, force: true });
  }
}

const accepted = () => ({
  sendMail: async () => ({ accepted: [recipient], rejected: [] }),
  close() {},
});
const dependencies = () => ({
  now,
  protect: async () => {},
  readPassword: async () => password,
  createTransport: accepted,
});

for (const scenario of [
  {
    name: 'server authentication rejection',
    code: 'EAUTH',
    command: 'AUTH PLAIN',
    responseCode: 535,
  },
  {
    name: 'unexpected authentication challenge',
    code: 'EAUTH',
    command: 'AUTH LOGIN',
    responseCode: 334,
  },
  {
    name: 'client authentication setup failure',
    code: 'EAUTH',
    command: 'API',
    responseCode: undefined,
  },
  {
    name: 'envelope rejection',
    code: 'EENVELOPE',
    command: 'RCPT TO',
    responseCode: 550,
  },
  {
    name: 'connection timeout',
    code: 'ETIMEDOUT',
    command: 'CONN',
    responseCode: undefined,
  },
]) {
  void test(`safe diagnostic distinguishes ${scenario.name} without retaining server text`, async () => {
    await fixture(async (directory) => {
      const failure = Object.assign(
        new Error(`server-echo-${password}`),
        scenario,
      );
      Object.defineProperty(failure, 'response', {
        get() {
          throw new Error('raw-response-must-not-be-read');
        },
      });
      const result = await sendApprovedMailTest(
        { approval: MAIL_TEST_APPROVAL, directory },
        {
          ...dependencies(),
          createTransport: () => ({
            sendMail: async () => {
              throw failure;
            },
            close() {},
          }),
        },
      );
      const expected = {
        transportCode: scenario.code,
        command: scenario.command,
        ...(scenario.responseCode === undefined
          ? {}
          : { responseCode: scenario.responseCode }),
      };
      assert.deepEqual(
        'smtpDiagnostic' in result ? result.smtpDiagnostic : undefined,
        expected,
      );
      assert.equal(
        result.status,
        scenario.code === 'ETIMEDOUT' ? 'outcome-unknown' : 'smtp-rejected',
      );
      assert.equal(result.receiptVerified, false);
      assert.equal(result.automaticRetry, false);
      const raw = await readFile(
        path.join(directory, 'naver-o2-test-v1.json'),
        'utf8',
      );
      assert.deepEqual(JSON.parse(raw).smtpDiagnostic, expected);
      assert.ok(!raw.includes(password));
      assert.ok(!JSON.stringify(result).includes(password));
      const blocked = await sendApprovedMailTest(
        { approval: MAIL_TEST_APPROVAL, directory },
        {
          ...dependencies(),
          readPassword: async () => {
            throw new Error('must-not-read-again');
          },
        },
      );
      assert.equal(blocked.status, 'prior-attempt-review-required');
      assert.equal(
        await readFile(path.join(directory, 'naver-o2-test-v1.json'), 'utf8'),
        raw,
      );
    });
  });
}

void test('safe diagnostic drops unrecognized commands, string codes and arbitrary error properties', async () => {
  for (const responseCode of ['535', 535.5, 99, 600, NaN, Infinity]) {
    await fixture(async (directory) => {
      const result = await sendApprovedMailTest(
        { approval: MAIL_TEST_APPROVAL, directory },
        {
          ...dependencies(),
          createTransport: () => ({
            sendMail: async () => {
              throw Object.assign(new Error(password), {
                code: `EAUTH ${password}`,
                command: `AUTH PLAIN ${password}`,
                responseCode,
                response: password,
                stack: password,
                auth: { pass: password },
              });
            },
            close() {},
          }),
        },
      );
      assert.deepEqual(
        'smtpDiagnostic' in result ? result.smtpDiagnostic : undefined,
        {},
      );
      assert.equal(result.status, 'outcome-unknown');
      const raw = await readFile(
        path.join(directory, 'naver-o2-test-v1.json'),
        'utf8',
      );
      assert.deepEqual(JSON.parse(raw).smtpDiagnostic, {});
      assert.ok(!raw.includes(password));
      assert.ok(!JSON.stringify(result).includes(password));
    });
  }
});

void test(
  'Windows reviewed retry works with actual directory protection and a simulated transport',
  {
    skip: process.platform !== 'win32',
  },
  async () => {
    await fixture(async (directory) => {
      const first = await sendApprovedMailTest(
        { approval: MAIL_TEST_APPROVAL, directory },
        {
          ...dependencies(),
          protect: protectPrivateDirectory,
          createTransport: () => ({
            sendMail: async () => {
              throw Object.assign(new Error('synthetic rejection'), {
                code: 'EAUTH',
              });
            },
            close() {},
          }),
        },
      );
      assert.equal(first.status, 'smtp-rejected');
      const prior = await readFile(
        path.join(directory, 'naver-o2-test-v1.json'),
      );
      const second = await sendApprovedMailTest(
        {
          approval: MAIL_TEST_APPROVAL,
          directory,
          reviewedRejectedSha256: createHash('sha256')
            .update(prior)
            .digest('hex'),
        },
        { ...dependencies(), protect: protectPrivateDirectory },
      );
      assert.equal(second.status, 'smtp-accepted');
      assert.equal(second.receiptVerified, false);
      assert.deepEqual(
        await readFile(path.join(directory, 'naver-o2-test-v1.json')),
        prior,
      );
      const retry = await readFile(
        path.join(directory, 'naver-o2-test-v2.json'),
        'utf8',
      );
      assert.ok(!retry.includes(password));
    });
  },
);

void test('unapproved call does not read credentials, create a directory, or initialize transport', async () => {
  await fixture(async (directory) => {
    const forbidden = () => {
      throw new Error('must-not-run');
    };
    const result = await sendApprovedMailTest(
      { approval: '', directory },
      {
        readPassword: async () => forbidden(),
        createTransport: forbidden,
        protect: forbidden,
      },
    );
    assert.equal(result.status, 'approval-required');
    assert.equal(result.networkAttempted, false);
    assert.deepEqual(await readdir(path.dirname(directory)), []);
  });
});

void test('SMTP transport pins NAVER, TLS certificate checks, a single recipient and no debug/file/URL access', () => {
  const options = naverTransportOptions(password);
  assert.equal(options.host, 'smtp.naver.com');
  assert.equal(options.port, 465);
  assert.equal(options.secure, true);
  assert.equal(options.tls.rejectUnauthorized, true);
  assert.equal(options.tls.minVersion, 'TLSv1.2');
  assert.equal(options.tls.servername, 'smtp.naver.com');
  assert.deepEqual(options.auth, { user: recipient, pass: password });
  assert.equal(options.pool, false);
  assert.equal(options.debug, false);
  assert.equal(options.logger, false);
  assert.equal(options.disableFileAccess, true);
  assert.equal(options.disableUrlAccess, true);
  assert.equal(options.maxRecipients, 1);
  for (const value of ['', 'short', 'bad\r\ncredential', 'x'.repeat(129)])
    assert.throws(
      () => naverTransportOptions(value),
      /^Error: MAIL_TEST_CREDENTIAL_INVALID$/,
    );
});

void test('real mail composer creates Korean synthetic mail with a single envelope and no attachments, without SMTP', async () => {
  const message = testMailMessage(now().toISOString());
  assert.deepEqual(message.envelope, { from: recipient, to: [recipient] });
  assert.equal(message.from.name, '주식회사 한국기업가치평가원');
  assert.match(message.subject, /^\[시험\]/);
  assert.match(message.text, /실제 장애가 아닙니다/);
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const composed = await transport.sendMail(message);
  assert.deepEqual(composed.envelope.to, [recipient]);
  const bytes: unknown = composed.message;
  if (!(bytes instanceof Uint8Array)) throw new Error('expected MIME bytes');
  const mime = new TextDecoder().decode(bytes);
  assert.match(mime, /Content-Type: text\/plain; charset=utf-8/);
  assert.doesNotMatch(mime, /Content-Disposition: attachment|multipart\/mixed/);
  assert.ok(!mime.includes(password));
});

void test('concurrent approved synthetic calls reserve one attempt and never equate SMTP acceptance with receipt', async () => {
  await fixture(async (directory) => {
    await mkdir(directory, { recursive: true });
    let reads = 0;
    let sends = 0;
    let closes = 0;
    const deps = {
      ...dependencies(),
      readPassword: async () => {
        reads++;
        return password;
      },
      createTransport: (options: ReturnType<typeof naverTransportOptions>) => {
        assert.equal(options.auth.pass, password);
        return {
          sendMail: async (message: ReturnType<typeof testMailMessage>) => {
            sends++;
            assert.deepEqual(message.envelope.to, [recipient]);
            return { accepted: [recipient], rejected: [] };
          },
          close: () => {
            closes++;
          },
        };
      },
    };
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        sendApprovedMailTest({ approval: MAIL_TEST_APPROVAL, directory }, deps),
      ),
    );
    assert.equal(results.filter((r) => r.status === 'smtp-accepted').length, 1);
    assert.equal(
      results.filter((r) => r.status === 'prior-attempt-review-required')
        .length,
      3,
    );
    assert.equal(reads, 1);
    assert.equal(sends, 1);
    assert.equal(closes, 1);
    assert.ok(
      results.every(
        (r) => r.receiptVerified === false && r.automaticRetry === false,
      ),
    );
    const raw = await readFile(
      path.join(directory, 'naver-o2-test-v1.json'),
      'utf8',
    );
    assert.equal(JSON.parse(raw).status, 'smtp-accepted');
    assert.ok(!raw.includes(password));
  });
});

for (const [code, expected] of [
  ['EAUTH', 'smtp-rejected'],
  ['EENVELOPE', 'smtp-rejected'],
  ['ETIMEDOUT', 'outcome-unknown'],
  ['ESOCKET', 'outcome-unknown'],
]) {
  void test(`${code}: redacted result is retained and credential reuse/retry is blocked`, async () => {
    await fixture(async (directory) => {
      let sends = 0;
      const result = await sendApprovedMailTest(
        { approval: MAIL_TEST_APPROVAL, directory },
        {
          ...dependencies(),
          createTransport: () => ({
            sendMail: async () => {
              sends++;
              throw Object.assign(new Error(`server-echo-${password}`), {
                code,
                response: password,
              });
            },
            close() {},
          }),
        },
      );
      assert.equal(result.status, expected);
      assert.equal(
        'rejectionStage' in result ? result.rejectionStage : undefined,
        code === 'EAUTH'
          ? 'authentication'
          : code === 'EENVELOPE'
            ? 'envelope'
            : undefined,
      );
      assert.equal(result.receiptVerified, false);
      assert.equal(sends, 1);
      const raw = await readFile(
        path.join(directory, 'naver-o2-test-v1.json'),
        'utf8',
      );
      assert.ok(!raw.includes(password));
      assert.ok(!JSON.stringify(result).includes(password));
      const retry = await sendApprovedMailTest(
        { approval: MAIL_TEST_APPROVAL, directory },
        {
          ...dependencies(),
          readPassword: async () => {
            throw new Error('must-not-read-again');
          },
        },
      );
      assert.equal(retry.status, 'prior-attempt-review-required');
    });
  });
}

void test('missing credential records preparation failure without creating a transport', async () => {
  await fixture(async (directory) => {
    let transports = 0;
    const result = await sendApprovedMailTest(
      { approval: MAIL_TEST_APPROVAL, directory },
      {
        ...dependencies(),
        readPassword: async () => '',
        createTransport: () => {
          transports++;
          return accepted();
        },
      },
    );
    assert.equal(result.status, 'preparation-failed');
    assert.equal(result.networkAttempted, false);
    assert.equal(transports, 0);
  });
});

void test('receipt directories inside OneDrive are rejected before credentials or files', async () => {
  await fixture(async (directory) => {
    const result = await sendApprovedMailTest(
      {
        approval: MAIL_TEST_APPROVAL,
        directory: path.join(directory, 'OneDrive', 'mail'),
      },
      {
        ...dependencies(),
        readPassword: async () => {
          throw new Error('must-not-read');
        },
      },
    );
    assert.equal(result.status, 'preparation-failed');
    assert.equal(result.networkAttempted, false);
    assert.deepEqual(await readdir(path.dirname(directory)), []);
  });
});

void test('unconfirmed or partial acceptance is never counted as successful delivery', async () => {
  await fixture(async (directory) => {
    const result = await sendApprovedMailTest(
      { approval: MAIL_TEST_APPROVAL, directory },
      {
        ...dependencies(),
        createTransport: () => ({
          sendMail: async () => ({ accepted: [], rejected: [recipient] }),
          close() {},
        }),
      },
    );
    assert.equal(result.status, 'outcome-unknown');
    assert.equal(result.receiptVerified, false);
  });
});

async function priorAttempt(directory: string, code = 'EAUTH') {
  await sendApprovedMailTest(
    { approval: MAIL_TEST_APPROVAL, directory },
    {
      ...dependencies(),
      createTransport: () => ({
        sendMail: async () => {
          if (code === 'ACCEPTED')
            return { accepted: [recipient], rejected: [] };
          throw Object.assign(new Error(password), { code });
        },
        close() {},
      }),
    },
  );
  const bytes = await readFile(path.join(directory, 'naver-o2-test-v1.json'));
  return { bytes, hash: createHash('sha256').update(bytes).digest('hex') };
}

void test('reviewed retry preserves the rejected original and concurrent calls send exactly once using v2', async () => {
  await fixture(async (directory) => {
    const prior = await priorAttempt(directory);
    let reads = 0;
    let sends = 0;
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        sendApprovedMailTest(
          {
            approval: MAIL_TEST_APPROVAL,
            directory,
            reviewedRejectedSha256: prior.hash,
          },
          {
            ...dependencies(),
            readPassword: async () => {
              reads++;
              return password;
            },
            createTransport: () => ({
              sendMail: async () => {
                sends++;
                return { accepted: [recipient], rejected: [] };
              },
              close() {},
            }),
          },
        ),
      ),
    );
    assert.equal(reads, 1);
    assert.equal(sends, 1);
    assert.equal(results.filter((r) => r.status === 'smtp-accepted').length, 1);
    assert.equal(
      results.filter((r) => r.status === 'prior-attempt-review-required')
        .length,
      3,
    );
    assert.deepEqual(
      await readFile(path.join(directory, 'naver-o2-test-v1.json')),
      prior.bytes,
    );
    const raw = await readFile(
      path.join(directory, 'naver-o2-test-v2.json'),
      'utf8',
    );
    const result = JSON.parse(raw);
    assert.equal(result.reviewedRejectedSha256, prior.hash);
    assert.equal(result.receiptVerified, false);
    assert.equal(result.automaticRetry, false);
    assert.ok(!raw.includes(password));
  });
});

for (const situation of [
  'wrong-hash',
  'malformed-hash',
  'missing',
  'ETIMEDOUT',
  'ACCEPTED',
]) {
  void test(`reviewed retry blocks ${situation} before credential access and v2 creation`, async () => {
    await fixture(async (directory) => {
      const prior =
        situation === 'missing'
          ? null
          : await priorAttempt(
              directory,
              ['ETIMEDOUT', 'ACCEPTED'].includes(situation)
                ? situation
                : 'EAUTH',
            );
      const hash =
        situation === 'wrong-hash' || !prior
          ? '0'.repeat(64)
          : situation === 'malformed-hash'
            ? '../invalid'
            : prior.hash;
      let reads = 0;
      let transports = 0;
      const result = await sendApprovedMailTest(
        {
          approval: MAIL_TEST_APPROVAL,
          directory,
          reviewedRejectedSha256: hash,
        },
        {
          ...dependencies(),
          readPassword: async () => {
            reads++;
            return password;
          },
          createTransport: () => {
            transports++;
            return accepted();
          },
        },
      );
      assert.equal(result.status, 'preparation-failed');
      assert.equal(result.networkAttempted, false);
      assert.equal(reads, 0);
      assert.equal(transports, 0);
      assert.ok(!(await readdir(directory)).includes('naver-o2-test-v2.json'));
      if (prior)
        assert.deepEqual(
          await readFile(path.join(directory, 'naver-o2-test-v1.json')),
          prior.bytes,
        );
    });
  });
}

void test('failed reviewed retry remains latched and neither mode can send again', async () => {
  await fixture(async (directory) => {
    const prior = await priorAttempt(directory);
    const retryOptions = {
      approval: MAIL_TEST_APPROVAL,
      directory,
      reviewedRejectedSha256: prior.hash,
    };
    const result = await sendApprovedMailTest(retryOptions, {
      ...dependencies(),
      createTransport: () => ({
        sendMail: async () => {
          throw Object.assign(new Error(password), { code: 'EAUTH' });
        },
        close() {},
      }),
    });
    assert.equal(result.status, 'smtp-rejected');
    const v2 = await readFile(path.join(directory, 'naver-o2-test-v2.json'));
    for (const options of [
      retryOptions,
      { approval: MAIL_TEST_APPROVAL, directory },
    ]) {
      const blocked = await sendApprovedMailTest(options, {
        ...dependencies(),
        readPassword: async () => {
          throw new Error('must-not-read');
        },
      });
      assert.equal(blocked.status, 'prior-attempt-review-required');
    }
    assert.deepEqual(
      await readFile(path.join(directory, 'naver-o2-test-v1.json')),
      prior.bytes,
    );
    assert.deepEqual(
      await readFile(path.join(directory, 'naver-o2-test-v2.json')),
      v2,
    );
    assert.ok(!new TextDecoder().decode(v2).includes(password));
  });
});

async function secondAttempt(directory: string, code = 'EAUTH') {
  const first = await priorAttempt(directory);
  await sendApprovedMailTest(
    {
      approval: MAIL_TEST_APPROVAL,
      directory,
      reviewedRejectedSha256: first.hash,
    },
    {
      ...dependencies(),
      createTransport: () => ({
        sendMail: async () => {
          if (code === 'ACCEPTED')
            return { accepted: [recipient], rejected: [] };
          throw Object.assign(new Error(password), { code });
        },
        close() {},
      }),
    },
  );
  const bytes = await readFile(path.join(directory, 'naver-o2-test-v2.json'));
  return {
    first,
    bytes,
    hash: createHash('sha256').update(bytes).digest('hex'),
  };
}

void test('SMTP-enabled retry preserves both prior records and reserves one v3 across concurrent callers', async () => {
  await fixture(async (directory) => {
    const second = await secondAttempt(directory);
    const options = {
      approval: MAIL_TEST_APPROVAL,
      directory,
      reviewedRejectedSha256: second.first.hash,
      reviewedSecondRejectedSha256: second.hash,
    };
    let reads = 0;
    let sends = 0;
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        sendApprovedMailTest(options, {
          ...dependencies(),
          readPassword: async () => {
            reads++;
            return password;
          },
          createTransport: () => ({
            sendMail: async () => {
              sends++;
              return { accepted: [recipient], rejected: [] };
            },
            close() {},
          }),
        }),
      ),
    );
    assert.equal(reads, 1);
    assert.equal(sends, 1);
    assert.equal(results.filter((r) => r.status === 'smtp-accepted').length, 1);
    assert.equal(
      results.filter((r) => r.status === 'prior-attempt-review-required')
        .length,
      3,
    );
    const third = await readFile(
      path.join(directory, 'naver-o2-test-v3.json'),
      'utf8',
    );
    const receipt = JSON.parse(third);
    assert.equal(receipt.reviewedRejectedSha256, second.first.hash);
    assert.equal(receipt.reviewedSecondRejectedSha256, second.hash);
    assert.equal(receipt.smtpEnabledReportedByUser, true);
    assert.equal(receipt.receiptVerified, false);
    assert.equal(receipt.automaticRetry, false);
    assert.ok(!third.includes(password));
    for (const blockedOptions of [
      options,
      { approval: MAIL_TEST_APPROVAL, directory },
      {
        approval: MAIL_TEST_APPROVAL,
        directory,
        reviewedRejectedSha256: second.first.hash,
      },
    ]) {
      const blocked = await sendApprovedMailTest(blockedOptions, {
        ...dependencies(),
        readPassword: async () => {
          throw new Error('must-not-read');
        },
      });
      assert.equal(blocked.status, 'prior-attempt-review-required');
    }
    assert.deepEqual(
      await readFile(path.join(directory, 'naver-o2-test-v1.json')),
      second.first.bytes,
    );
    assert.deepEqual(
      await readFile(path.join(directory, 'naver-o2-test-v2.json')),
      second.bytes,
    );
    assert.equal(
      await readFile(path.join(directory, 'naver-o2-test-v3.json'), 'utf8'),
      third,
    );
  });
});

for (const situation of [
  'missing-first-review',
  'wrong-second-hash',
  'missing-second',
  'ACCEPTED',
  'ETIMEDOUT',
  'broken-chain',
]) {
  void test(`SMTP-enabled retry blocks ${situation} before credentials or v3 reservation`, async () => {
    await fixture(async (directory) => {
      const second = await secondAttempt(
        directory,
        ['ACCEPTED', 'ETIMEDOUT'].includes(situation) ? situation : 'EAUTH',
      );
      let secondHash =
        situation === 'wrong-second-hash' ? '0'.repeat(64) : second.hash;
      if (situation === 'missing-second')
        await rm(path.join(directory, 'naver-o2-test-v2.json'));
      if (situation === 'broken-chain') {
        const edited = JSON.parse(new TextDecoder().decode(second.bytes));
        edited.reviewedRejectedSha256 = 'f'.repeat(64);
        const bytes = Buffer.from(JSON.stringify(edited));
        await writeFile(path.join(directory, 'naver-o2-test-v2.json'), bytes);
        secondHash = createHash('sha256').update(bytes).digest('hex');
      }
      let reads = 0;
      let transports = 0;
      const result = await sendApprovedMailTest(
        {
          approval: MAIL_TEST_APPROVAL,
          directory,
          reviewedRejectedSha256:
            situation === 'missing-first-review'
              ? undefined
              : second.first.hash,
          reviewedSecondRejectedSha256: secondHash,
        },
        {
          ...dependencies(),
          readPassword: async () => {
            reads++;
            return password;
          },
          createTransport: () => {
            transports++;
            return accepted();
          },
        },
      );
      assert.equal(result.status, 'preparation-failed');
      assert.equal(result.networkAttempted, false);
      assert.equal(reads, 0);
      assert.equal(transports, 0);
      assert.ok(!(await readdir(directory)).includes('naver-o2-test-v3.json'));
      assert.deepEqual(
        await readFile(path.join(directory, 'naver-o2-test-v1.json')),
        second.first.bytes,
      );
    });
  });
}

for (const code of ['EAUTH', 'ETIMEDOUT']) {
  void test(`SMTP-enabled retry retains ${code} outcome and blocks any further attempt`, async () => {
    await fixture(async (directory) => {
      const second = await secondAttempt(directory);
      const options = {
        approval: MAIL_TEST_APPROVAL,
        directory,
        reviewedRejectedSha256: second.first.hash,
        reviewedSecondRejectedSha256: second.hash,
      };
      const result = await sendApprovedMailTest(options, {
        ...dependencies(),
        createTransport: () => ({
          sendMail: async () => {
            throw Object.assign(new Error(password), { code });
          },
          close() {},
        }),
      });
      assert.equal(
        result.status,
        code === 'EAUTH' ? 'smtp-rejected' : 'outcome-unknown',
      );
      const third = await readFile(
        path.join(directory, 'naver-o2-test-v3.json'),
      );
      const blocked = await sendApprovedMailTest(options, {
        ...dependencies(),
        readPassword: async () => {
          throw new Error('must-not-read');
        },
      });
      assert.equal(blocked.status, 'prior-attempt-review-required');
      assert.deepEqual(
        await readFile(path.join(directory, 'naver-o2-test-v1.json')),
        second.first.bytes,
      );
      assert.deepEqual(
        await readFile(path.join(directory, 'naver-o2-test-v2.json')),
        second.bytes,
      );
      assert.deepEqual(
        await readFile(path.join(directory, 'naver-o2-test-v3.json')),
        third,
      );
      assert.ok(!new TextDecoder().decode(third).includes(password));
    });
  });
}
