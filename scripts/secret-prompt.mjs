import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

export function readSecret(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('대화형 터미널에서 직접 입력해 주세요.');
  return new Promise((resolve, reject) => {
    const muted = new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    });
    const reader = createInterface({
      input: process.stdin,
      output: muted,
      terminal: true,
      historySize: 0,
    });
    let answered = false;
    process.stdout.write(prompt);
    reader.once('SIGINT', () => reader.close());
    reader.once('close', () => {
      process.stdout.write('\n');
      if (!answered) reject(new Error('설정을 취소했습니다.'));
    });
    reader.question('', (value) => {
      answered = true;
      reader.close();
      resolve(value);
    });
  });
}
