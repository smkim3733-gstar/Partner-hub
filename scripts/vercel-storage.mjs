import { openNextOperatorStorage } from './next-operator-storage.mjs';
import {
  checkVercelMigrations,
  applyVercelMigrations,
} from './vercel-migrations.mjs';
import { readSecret } from './secret-prompt.mjs';
import { get, del } from '@vercel/blob';

async function main() {
  const command = process.argv[2];
  if (
    process.argv.length !== 3 ||
    !['check', 'init', 'cleanup-check', 'cleanup'].includes(command)
  )
    throw new Error('Use check, init, cleanup-check or cleanup.');
  const { config, client } = await openNextOperatorStorage();
  if (!client) throw new Error('Select vercel-storage-v1 for this command.');
  process.env.VERCEL_BLOB_RETRIES = '0';
  try {
    console.log(`대상 서비스: ${config.appOrigin}`);
    if (command === 'init' || command === 'cleanup') {
      if (!process.stdin.isTTY || !process.stdout.isTTY)
        throw new Error('변경 작업은 대화형 터미널에서 실행하세요.');
      const answer = await readSecret(
        '변경할 서비스 주소를 정확히 입력하세요(표시되지 않음): ',
      );
      if (answer !== config.appOrigin)
        throw new Error('대상이 일치하지 않습니다. 변경하지 않았습니다.');
    }
    const state =
      command === 'init'
        ? await applyVercelMigrations(client)
        : await checkVercelMigrations(client);
    console.log(
      `스키마 적용 ${state.applied}/${state.total}; 남음 ${state.remaining}. 운영 데이터 이관과는 별개입니다.`,
    );
    if (command === 'check') {
      const probe = await get('partner-hub/connection-check', {
        access: 'private',
        useCache: false,
        token: config.blobToken,
        abortSignal: AbortSignal.timeout(30_000),
      });
      await probe?.stream?.cancel();
      console.log('비공개 Blob 읽기 연결 확인. 파일 생성·수정 없음.');
    }
    if (command.startsWith('cleanup')) {
      if (state.remaining) throw new Error('먼저 스키마 적용을 완료하세요.');
      // Token lifetime plus 15 minutes of grace. Never enumerate or remove
      // final originals; only exact expired staging paths recorded by this app.
      const cutoff = Date.now() - 900_000;
      const rows = (
        await client.execute({
          sql: 'SELECT id FROM vercel_blob_transfers WHERE expires_at < ? ORDER BY expires_at LIMIT 100',
          args: [cutoff],
        })
      ).rows;
      console.log(`정리 대상 만료 전송: ${rows.length}건(회당 최대 100건).`);
      if (command === 'cleanup') {
        for (const row of rows) {
          if (typeof row.id !== 'string' || !/^[a-f0-9-]{36}$/.test(row.id))
            throw new Error('Invalid staging identifier.');
          for (const slot of ['file', 'audio'])
            await del(`partner-hub/staging/${row.id}/${slot}`, {
              token: config.blobToken,
              abortSignal: AbortSignal.timeout(30_000),
            });
          await client.execute({
            sql: 'DELETE FROM vercel_blob_transfers WHERE id = ? AND expires_at < ?',
            args: [row.id, cutoff],
          });
        }
        console.log(
          '만료 임시파일만 정리했습니다. 확정 원본은 변경하지 않았습니다. 임시파일 삭제는 복구할 수 없습니다.',
        );
      }
    }
  } finally {
    client.close();
  }
}
main().catch(() => {
  console.error(
    'Vercel 저장소 작업을 확인하지 못했습니다. 연결·대상·스키마 기록을 확인하세요. 비밀값과 SQL 상세는 출력하지 않습니다.',
  );
  process.exitCode = 1;
});
