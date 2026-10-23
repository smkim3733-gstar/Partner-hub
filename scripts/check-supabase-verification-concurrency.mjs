import './register-local.mjs';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, open } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';
import { readVerificationFile } from './supabase-verification.mjs';
import { verificationError } from './supabase-verification-policy.mjs';

// Exercise the real application's transaction adapter and draft CAS against
// two overlapping Supavisor transactions. Keep the synthetic row as evidence.
async function main(args) {
  if (args.length !== 2 || args[0] !== '--config')
    throw verificationError('ARGUMENTS');
  const settings = await readVerificationFile(args[1]);
  const workflow = JSON.parse(
    await readFile(path.join(settings.directory, 'status.json'), 'utf8'),
  );
  if (workflow.status !== 'passed' || !workflow.httpWorkflowVerified)
    throw verificationError('HTTP_WORKFLOW_REQUIRED');
  const resultFile = path.join(settings.directory, 'concurrency-status.json');
  const claim = await open(resultFile, 'wx', 0o600);
  await claim.close();
  const { createSupabasePostgresDatabase, SupabaseTransactionConflict } =
    await import('../lib/supabase-postgres-database.ts');
  const { supabasePostgresClientOptions } =
    await import('../lib/supabase-postgres-client.ts');
  const { emptyApplicationDetails } =
    await import('../lib/application-details.ts');
  const clients = Array.from({ length: 3 }, () =>
    postgres(settings.config.databaseUrl, supabasePostgresClientOptions),
  );
  const [observer, first, second] = clients;
  const runId = randomUUID();
  const owner = `verification:${runId}`;
  const draftId = `verification-${runId}`;
  const save = (value) =>
    writeFile(resultFile, JSON.stringify({ runId, ...value }) + '\n', {
      mode: 0o600,
    });
  let gateTimer;
  try {
    await save({ status: 'running', syntheticOnly: true });
    const marker = await observer.unsafe(
      'SELECT project_ref,purpose FROM partner_hub.verification_environment',
    );
    if (
      marker.length !== 1 ||
      marker[0].project_ref !== settings.target.projectRef ||
      marker[0].purpose !== settings.target.purpose
    )
      throw verificationError('PROJECT_MARKER_MISMATCH');
    const payload = (name) =>
      JSON.stringify({
        companyName: `합성 독립 세션 검증 ${name}`,
        applicantName: '합성 검증 담당',
        applicantType: '한기평 컨설턴트',
        partnerMemberId: '',
        selectedServices: ['정책자금'],
        details: emptyApplicationDetails(),
        step: 2,
        hasLocalAttachments: false,
      });
    await observer.unsafe(
      'INSERT INTO partner_hub.application_drafts(owner_key,revision,draft_id,payload,updated_at) VALUES ($1,1,$2,$3,$4)',
      [owner, draftId, payload('원본'), new Date().toISOString()],
    );
    const pids = new Set();
    let releaseGate, failGate;
    const gate = new Promise((resolve, reject) => {
      releaseGate = resolve;
      failGate = reject;
      gateTimer = setTimeout(
        () => reject(verificationError('SESSION_BARRIER_TIMEOUT')),
        15000,
      );
    });
    // Attach a rejection observer even if a connection fails before the barrier.
    gate.catch(() => {});
    let synchronize = true;
    const adapter = (client) =>
      createSupabasePostgresDatabase({
        unsafe: (query, params = []) => client.unsafe(query, params),
        begin: (callback) =>
          client.begin(async (tx) => {
            try {
              return await callback({
                async unsafe(query, params = []) {
                  const rows = await tx.unsafe(query, params);
                  if (
                    synchronize &&
                    query === 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE'
                  ) {
                    // Establish both serializable snapshots before either CAS.
                    const seen = await tx.unsafe(
                      'SELECT pg_backend_pid() AS pid,revision::integer FROM partner_hub.application_drafts WHERE owner_key=$1',
                      [owner],
                    );
                    if (seen.length !== 1 || seen[0].revision !== 1)
                      throw verificationError('UNEXPECTED_DRAFT_SNAPSHOT');
                    pids.add(seen[0].pid);
                    if (pids.size === 2) releaseGate();
                    await gate;
                  }
                  return rows;
                },
              });
            } catch (error) {
              failGate(error);
              throw error;
            }
          }),
      });
    const a = adapter(first);
    const b = adapter(second);
    const update = (db, revision, name) =>
      db
        .prepare(
          'UPDATE application_drafts SET revision=?1,payload=?2,updated_at=?3 WHERE owner_key=?4 AND revision=?5 AND draft_id=?6 AND payload IS NOT NULL',
        )
        .bind(
          revision + 1,
          payload(name),
          new Date().toISOString(),
          owner,
          revision,
          draftId,
        )
        .run();
    const writers = await Promise.allSettled([
      update(a, 1, '첫째'),
      update(b, 1, '둘째'),
    ]);
    synchronize = false;
    clearTimeout(gateTimer);
    const winners = writers.filter((r) => r.status === 'fulfilled');
    const losers = writers.filter((r) => r.status === 'rejected');
    if (
      pids.size !== 2 ||
      winners.length !== 1 ||
      winners[0].value.meta.changes !== 1 ||
      losers.length !== 1 ||
      !(losers[0].reason instanceof SupabaseTransactionConflict)
    )
      throw verificationError('INDEPENDENT_DRAFT_CAS_FAILED');
    const committed = await observer.unsafe(
      'SELECT revision::integer,payload FROM partner_hub.application_drafts WHERE owner_key=$1',
      [owner],
    );
    if (
      committed[0].revision !== 2 ||
      ![payload('첫째'), payload('둘째')].includes(committed[0].payload)
    )
      throw verificationError('DRAFT_WINNER_NOT_PRESERVED');
    if ((await update(a, 1, '오래된 입력')).meta.changes !== 0)
      throw verificationError('STALE_DRAFT_OVERWROTE_WINNER');
    if ((await update(b, 2, '최신 읽기 후 저장')).meta.changes !== 1)
      throw verificationError('FRESH_DRAFT_SAVE_FAILED');
    const result = {
      status: 'passed',
      independentDbSessions: 2,
      overlappingSnapshots: true,
      confirmedSerializationAbort: true,
      staleWriteBlocked: true,
      freshRevisionAccepted: true,
      syntheticOnly: true,
      fixtureOwner: owner,
      scope: 'live Supabase draft storage CAS; not multi-server HTTP',
    };
    await save(result);
    console.log(JSON.stringify(result));
  } catch (error) {
    const code =
      error.verificationCode ?? 'OPERATION_FAILED_OR_OUTCOME_UNKNOWN';
    await save({ status: 'failed', code, fixtureOwner: owner });
    throw verificationError(code);
  } finally {
    clearTimeout(gateTimer);
    await Promise.all(clients.map((client) => client.end({ timeout: 5 })));
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(
    `Concurrency verification stopped: ${error.verificationCode ?? 'PREVIOUS_RUN_OR_OPERATION_FAILED'}`,
  );
  process.exitCode = 1;
});
