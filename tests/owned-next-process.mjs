// Test-only child management; closes only the process and loopback port we own.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createServer, createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
const require = createRequire(import.meta.url);

export async function unusedLoopbackPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
export function ownedNextProcess(args, environment, port) {
  const child = spawn(
    process.execPath,
    [require.resolve('next/dist/bin/next'), ...args],
    {
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let logs = '';
  const exited = new Promise((resolve) => {
    child.once('exit', resolve);
    child.once('error', resolve);
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      logs = (logs + chunk.toString()).slice(-24_000);
    });
  return {
    async ready() {
      for (let i = 0; i < 240; i++) {
        if (child.exitCode !== null)
          throw new Error(`Next startup failed: ${logs}`);
        if (logs.includes('Ready in')) return;
        await delay(250);
      }
      throw new Error(`Next startup timeout: ${logs}`);
    },
    logs: () => logs,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32') {
          const killer = spawn(
            'taskkill',
            ['/PID', String(child.pid), '/T', '/F'],
            {
              windowsHide: true,
              stdio: 'ignore',
            },
          );
          await Promise.race([
            once(killer, 'exit'),
            delay(10_000, null, { ref: false }),
          ]);
        } else child.kill('SIGTERM');
        if (
          (await Promise.race([
            exited,
            delay(10_000, 'timeout', { ref: false }),
          ])) === 'timeout'
        )
          throw new Error(`Owned Next PID ${child.pid} failed to exit.`);
      }
      await delay(500);
      const open = await new Promise((resolve) => {
        const socket = createConnection({ host: '127.0.0.1', port });
        const finish = (open) => {
          socket.destroy();
          resolve(open);
        };
        socket.once('connect', () => finish(true));
        socket.once('error', (error) => finish(error.code !== 'ECONNREFUSED'));
        socket.setTimeout(2000, () => finish(true));
      });
      if (open) throw new Error(`Owned Next port ${port} remains open.`);
    },
  };
}
