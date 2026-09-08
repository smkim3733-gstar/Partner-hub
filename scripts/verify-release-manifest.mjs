import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const root = process.cwd();
const releasesDirectory = resolve(root, 'releases');
const requestedManifest = process.argv[2];
const manifestPaths = requestedManifest
  ? [resolve(root, requestedManifest)]
  : readdirSync(releasesDirectory)
      .filter((name) => /^v\d+\.json$/.test(name))
      .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))
      .map((name) => resolve(releasesDirectory, name));
const shaPattern = /^[0-9a-f]{40}$/;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function git(...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

function verifyManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const label = basename(manifestPath);
  requireValue(manifest.schemaVersion === 1, `${label}: unsupported schema.`);
  requireValue(/^v\d+$/.test(manifest.release?.tag), `${label}: invalid release tag.`);
  requireValue(
    label === `${manifest.release.tag}.json`,
    `${label}: filename and release tag differ.`,
  );
  requireValue(
    shaPattern.test(manifest.release?.sourceCommit),
    `${label}: invalid release source commit.`,
  );
  requireValue(
    manifest.sites?.sourceCommit === manifest.release.sourceCommit,
    `${label}: Sites and release source commits differ.`,
  );
  requireValue(
    Number.isSafeInteger(manifest.sites?.versionNumber) &&
      manifest.sites.versionNumber > 0,
    `${label}: invalid Sites version number.`,
  );
  requireValue(
    /^sha256:[0-9a-f]{64}$/.test(manifest.sites?.archive?.contentHash),
    `${label}: invalid Sites archive hash.`,
  );

  requireValue(
    git('cat-file', '-t', manifest.release.tag) === 'tag',
    `${label}: release tag must be annotated.`,
  );
  const tagCommit = git('rev-parse', `${manifest.release.tag}^{commit}`);
  requireValue(
    tagCommit === manifest.release.sourceCommit,
    `${label}: tag points to ${tagCommit}, not release source.`,
  );
  execFileSync(
    'git',
    ['cat-file', '-e', `${manifest.release.sourceCommit}^{commit}`],
    { cwd: root, stdio: 'ignore' },
  );

  const releasedMigrations = git(
    'ls-tree',
    '-r',
    '--name-only',
    manifest.release.sourceCommit,
    '--',
    'drizzle',
  )
    .split('\n')
    .filter((name) => /^drizzle\/\d+.*\.sql$/.test(name)).length;
  requireValue(
    releasedMigrations === manifest.validation?.migrations,
    `${label}: release commit has ${releasedMigrations} migrations, expected ${manifest.validation?.migrations}.`,
  );

  const candidatePath = resolve(root, manifest.localCandidate.path);
  let candidate = 'not present; clean-clone verification skipped';
  if (existsSync(candidatePath)) {
    const bytes = readFileSync(candidatePath);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const size = statSync(candidatePath).size;
    requireValue(hash === manifest.localCandidate.sha256, `${label}: local candidate hash differs.`);
    requireValue(size === manifest.localCandidate.sizeBytes, `${label}: local candidate size differs.`);
    candidate = 'hash and size verified';
  }

  return {
    release: manifest.release.tag,
    sourceCommit: manifest.release.sourceCommit,
    sitesVersion: manifest.sites.versionNumber,
    migrations: releasedMigrations,
    localCandidate: candidate,
  };
}

requireValue(manifestPaths.length > 0, 'No release manifests found.');
console.log(JSON.stringify(manifestPaths.map(verifyManifest)));
