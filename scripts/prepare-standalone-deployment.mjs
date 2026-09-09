// Offline package preparation. Deliberately has no deploy or resource-create mode.
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DeploymentTargetError,
  validateDeploymentTarget,
  assertDeploymentIsolation,
  deploymentArtifacts,
} from './deployment-target.mjs';
import { standaloneWorkerBundle } from './standalone-worker-bundle.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
async function readTarget(file) {
  if ((await stat(file)).size > 32_768)
    throw new DeploymentTargetError('file.size');
  const bytes = await readFile(file);
  if (bytes.length > 32_768) throw new DeploymentTargetError('file.size');
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new DeploymentTargetError('file.json');
  }
  return validateDeploymentTarget(value);
}
async function main() {
  const args = process.argv.slice(2);
  let targetPath;
  let otherPath;
  let check = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--target' && !targetPath) {
      targetPath = args[++index];
      if (!targetPath || targetPath.startsWith('--'))
        throw new DeploymentTargetError('arguments');
    } else if (args[index] === '--compare-target' && !otherPath) {
      otherPath = args[++index];
      if (!otherPath || otherPath.startsWith('--'))
        throw new DeploymentTargetError('arguments');
    } else if (args[index] === '--check' && !check) check = true;
    else throw new DeploymentTargetError('arguments');
  }
  if (
    !targetPath ||
    targetPath.startsWith('--') ||
    (otherPath && otherPath.startsWith('--'))
  )
    throw new DeploymentTargetError('arguments');
  const target = await readTarget(targetPath);
  if (otherPath) assertDeploymentIsolation(target, await readTarget(otherPath));
  if (check) {
    console.log(
      json({
        targetSyntax: 'valid',
        comparedEnvironment: Boolean(otherPath),
        providerAccessVerified: false,
        dataMigrationVerified: false,
        writes: 0,
        deployments: 0,
      }),
    );
    return;
  }
  const artifacts = deploymentArtifacts(target);
  const content = new Map();
  for (const role of ['d1', 'r2', 'files']) {
    content.set(`${role}/worker.mjs`, await standaloneWorkerBundle(role));
    content.set(`${role}/wrangler.json`, json(artifacts.configs[role]));
  }
  content.set('target.json', json(target));
  content.set('next-environment.json', json(artifacts.nextEnvironment));
  content.set(
    'required-secret-names.json',
    json({
      next: artifacts.requiredNextSecrets,
      workers: Object.fromEntries(
        Object.entries(artifacts.configs).map(([role, config]) => [
          role,
          config.secrets.required,
        ]),
      ),
    }),
  );
  // Schema provenance only. Nothing executes these SQL statements.
  for (const directory of ['drizzle', 'infra/standalone/migrations']) {
    for (const file of (await readdir(path.join(root, directory)))
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort())
      content.set(
        `schema/${directory === 'drizzle' ? 'original' : 'standalone'}/${file}`,
        await readFile(path.join(root, directory, file)),
      );
  }
  content.set(
    'READ-ME-FIRST.txt',
    [
      'OFFLINE PACKAGE ONLY — NOT DEPLOYED OR MIGRATED.',
      'All Worker and Next activation flags are disabled. No secret values are included.',
      'Verify provider account/resource ownership and preview/production isolation before upload.',
      'Do not point this package at the existing Sites database or bucket.',
      'schema/ contains source SQL for review/provenance, not an automatic restore procedure.',
      'Never replay schema blindly over an imported production SQL dump.',
      'No deploy, secret-registration, DNS, D1 migration or resource creation command has run.',
      'See docs/STANDALONE_DEPLOYMENT.md in the source checkout for remaining deployment gates.',
      '',
    ].join('\n'),
  );
  const manifest = {
    version: 1,
    status: 'prepared-disabled',
    createdAt: new Date().toISOString(),
    targetSha256: sha256(json(target)),
    comparedEnvironment: Boolean(otherPath),
    providerAccessVerified: false,
    dataMigrationVerified: false,
    deployed: false,
    files: [...content].map(([name, bytes]) => ({
      path: name,
      size: Buffer.byteLength(bytes),
      sha256: sha256(bytes),
    })),
  };
  content.set('manifest.json', json(manifest));
  const work = path.join(root, 'work');
  await mkdir(work, { recursive: true });
  if (path.relative(await realpath(root), await realpath(work)) !== 'work')
    throw new DeploymentTargetError('output.directory');
  const destination = await mkdtemp(path.join(work, 'standalone-'));
  // A fresh exclusive directory prevents overwriting an earlier package.
  for (const [name, bytes] of content) {
    const file = path.join(destination, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes, { flag: 'wx' });
  }
  console.log(
    json({
      status: 'prepared-disabled',
      directory: destination,
      files: content.size,
      providerAccessVerified: false,
      dataMigrationVerified: false,
      deployments: 0,
    }),
  );
}
main().catch((error) => {
  // Do not echo malformed input, secrets, SQL, source or filesystem error details.
  console.error(
    error instanceof DeploymentTargetError
      ? error.message
      : 'DEPLOYMENT_PREPARATION_FAILED: 대상 파일·로컬 빌드·출력 경로를 확인하세요. 배포는 실행하지 않았습니다.',
  );
  process.exitCode = 1;
});
