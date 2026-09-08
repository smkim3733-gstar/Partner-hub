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
const maximumTotalChunkBytes = 1_280 * 1024;
const chunkNames = await readdir(chunkDirectory);
const pageChunks = chunkNames.filter((name) =>
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

const javaScriptChunks = chunkNames.filter((name) => name.endsWith('.js'));
const totalChunkBytes = (
  await Promise.all(
    javaScriptChunks.map(async (name) => (await stat(join(chunkDirectory, name))).size),
  )
).reduce((total, chunkBytes) => total + chunkBytes, 0);
if (totalChunkBytes > maximumTotalChunkBytes) {
  throw new Error(
    `Client chunks total ${totalChunkBytes} bytes; limit is ${maximumTotalChunkBytes} bytes.`,
  );
}

console.log(
  `Client bundles verified: ${pageChunk} ${size}/${maximumPageBytes} bytes; total ${totalChunkBytes}/${maximumTotalChunkBytes} bytes.`,
);
