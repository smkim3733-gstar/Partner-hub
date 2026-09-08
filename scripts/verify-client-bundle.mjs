import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const chunkDirectory = join(
  process.cwd(),
  'dist',
  'client',
  '_next',
  'static',
  'chunks',
);
const maximumPageBytes = 450 * 1024;
const pageChunks = (await readdir(chunkDirectory)).filter((name) =>
  /^page-[\w-]+\.js$/.test(name),
);

if (pageChunks.length !== 1) {
  throw new Error(`Expected one page client chunk, found ${pageChunks.length}.`);
}

const pageChunk = pageChunks[0];
const { size } = await stat(join(chunkDirectory, pageChunk));
if (size > maximumPageBytes) {
  throw new Error(
    `${pageChunk} is ${size} bytes; limit is ${maximumPageBytes} bytes. Split deferred portal screens before release.`,
  );
}

console.log(
  `Client page bundle verified: ${pageChunk} ${size} bytes / ${maximumPageBytes} bytes.`,
);
