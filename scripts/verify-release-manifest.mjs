import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const manifestPath = resolve(root, process.argv[2] || 'releases/v343.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const shaPattern = /^[0-9a-f]{40}$/;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

requireValue(manifest.schemaVersion === 1, 'Unsupported release manifest schema.');
requireValue(manifest.release?.tag === 'v343', 'Release tag must be v343.');
requireValue(
  shaPattern.test(manifest.release?.sourceCommit),
  'Release source commit is invalid.',
);
requireValue(
  manifest.sites?.sourceCommit === manifest.release.sourceCommit,
  'Sites and release source commits differ.',
);
requireValue(
  manifest.sites?.versionNumber === 310,
  'Sites version number is not v343 release version 310.',
);
requireValue(
  /^sha256:[0-9a-f]{64}$/.test(manifest.sites?.archive?.contentHash),
  'Sites archive hash is invalid.',
);

const tagCommit = execFileSync(
  'git',
  ['rev-parse', `${manifest.release.tag}^{commit}`],
  { cwd: root, encoding: 'utf8' },
).trim();
requireValue(
  tagCommit === manifest.release.sourceCommit,
  `Tag ${manifest.release.tag} points to ${tagCommit}, not release source.`,
);

execFileSync('git', ['cat-file', '-e', `${manifest.release.sourceCommit}^{commit}`], {
  cwd: root,
  stdio: 'ignore',
});

const migrationCount = readdirSync(resolve(root, 'drizzle')).filter((name) =>
  /^\d+.*\.sql$/.test(name),
).length;
requireValue(
  migrationCount === manifest.validation?.migrations,
  `Migration count is ${migrationCount}, expected ${manifest.validation?.migrations}.`,
);

const candidatePath = resolve(root, manifest.localCandidate.path);
let candidate = 'not present; clean-clone verification skipped';
if (existsSync(candidatePath)) {
  const bytes = readFileSync(candidatePath);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const size = statSync(candidatePath).size;
  requireValue(hash === manifest.localCandidate.sha256, 'Local candidate hash differs.');
  requireValue(size === manifest.localCandidate.sizeBytes, 'Local candidate size differs.');
  candidate = 'hash and size verified';
}

console.log(
  JSON.stringify({
    release: manifest.release.tag,
    sourceCommit: manifest.release.sourceCommit,
    sitesVersion: manifest.sites.versionNumber,
    migrations: migrationCount,
    localCandidate: candidate,
  }),
);
