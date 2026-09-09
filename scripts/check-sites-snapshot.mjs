import {
  inspectSitesSnapshot,
  compareSitesSnapshots,
  SnapshotError,
} from './sites-snapshot.mjs';

const [command, ...paths] = process.argv.slice(2);
try {
  if (command === '--help' && paths.length === 0) {
    console.log(
      'Read-only SQLite preflight (Node 24). No import, export, cleanup, or deployment.\nnode scripts/check-sites-snapshot.mjs inspect <frozen.sqlite>\nnode scripts/check-sites-snapshot.mjs compare <source.sqlite> <restored.sqlite>\nUse complete standalone SQLite snapshots, not SQL/JSON dumps or live WAL files.\nKeep snapshots and redirected reports in private, Git-ignored storage.\nExit 0: inspected/matching local snapshot only; 2: review or mismatch; 1: input/read failure.',
    );
  } else if (command === 'inspect' && paths.length === 1) {
    const report = await inspectSitesSnapshot(paths[0]);
    console.log(JSON.stringify(report, null, 2));
    if (
      !report.complete ||
      Object.keys(report.issues).length ||
      report.tables.some((table) => Object.keys(table.issues).length)
    )
      process.exitCode = 2;
  } else if (command === 'compare' && paths.length === 2) {
    const report = await compareSitesSnapshots(paths[0], paths[1]);
    console.log(JSON.stringify(report, null, 2));
    if (!report.sqliteLogicalMatch) process.exitCode = 2;
  } else
    throw new SnapshotError(
      'usage: inspect <snapshot> | compare <source> <restored> | --help',
    );
} catch (error) {
  console.error(
    JSON.stringify({
      error:
        error instanceof SnapshotError ? error.code : 'snapshot-read-failed',
      migrationReady: false,
    }),
  );
  process.exitCode = 1;
}
