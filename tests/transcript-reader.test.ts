import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { readTranscriptFile } from '../lib/transcript-reader';
import {
  transcriptProblem,
  MAX_TRANSCRIPT_CHARS,
} from '../lib/transcript-policy';

const paragraph =
  '화자 A [00:10] 자본금과 상담 내용을 확인하고 필요한 자료를 요청합니다.';
const wrap = (body: string) =>
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
const docx = (body: string, extras: Record<string, Uint8Array> = {}) =>
  new File(
    [
      zipSync({
        'word/document.xml': strToU8(wrap(body)),
        ...extras,
      }) as Uint8Array<ArrayBuffer>,
    ],
    '가상_전사문.docx',
  );

void test('TXT: Korean, timestamps, amounts, BOM and UTF-16 preserved without guessing', async () => {
  const content = `${paragraph}\r\n화자 B: 현재 2,000만원, 증가 예정 2억원. 최종 수치는 확인 필요.`;
  assert.equal(
    await readTranscriptFile(new File(['\ufeff' + content], 'test.TXT')),
    content.replace(/\r\n/g, '\n'),
  );
  const utf16 = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(paragraph, 'utf16le'),
  ]);
  assert.equal(
    await readTranscriptFile(new File([utf16], 'utf16.txt')),
    paragraph,
  );
});
void test('DOCX: body and tables only; names, numbers, entities and line breaks retained', async () => {
  const result = await readTranscriptFile(
    docx(
      `<w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>2,000만원 &amp; 2억원</w:t><w:tab/><w:t>확인 필요</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
      {
        'word/header1.xml': strToU8('PRIVATE_HEADER_NOT_USED'),
        '../do-not-extract.txt': strToU8('PATH_NOT_USED'),
      },
    ),
  );
  assert.ok(result.includes(paragraph));
  assert.ok(result.includes('2,000만원 & 2억원\t확인 필요'));
  assert.ok(!result.includes('PRIVATE_HEADER_NOT_USED'));
  assert.ok(!result.includes('PATH_NOT_USED'));
});
void test('DOCX input markup remains plain text; not evaluated', async () => {
  const result = await readTranscriptFile(
    docx(
      `<w:p><w:r><w:t>&lt;script&gt;do_not_run()&lt;/script&gt; ${paragraph}</w:t></w:r></w:p>`,
    ),
  );
  assert.match(result, /^<script>do_not_run\(\)<\/script>/);
});
void test('unsupported, corrupt, empty, non-text and oversized files fail with useful errors', async () => {
  await assert.rejects(
    readTranscriptFile(new File([paragraph], 'scan.pdf')),
    /Word/,
  );
  await assert.rejects(readTranscriptFile(new File([], 'empty.txt')), /비어/);
  await assert.rejects(
    readTranscriptFile(new File(['not-a-zip'], 'broken.docx')),
    /DOCX/,
  );
  await assert.rejects(
    readTranscriptFile(
      new File([new Uint8Array([0xff, 0xff, 0xfe])], 'bad.txt'),
    ),
    /인코딩/,
  );
  await assert.rejects(
    readTranscriptFile(new File([paragraph + '\0'], 'binary.txt')),
    /읽을 수 없는/,
  );
  await assert.rejects(
    readTranscriptFile(
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.txt'),
    ),
    /5MB/,
  );
  await assert.rejects(
    readTranscriptFile(
      new File(['가'.repeat(MAX_TRANSCRIPT_CHARS + 1)], 'long.txt'),
    ),
    /60,000/,
  );
  await assert.rejects(
    readTranscriptFile(
      docx(
        `<w:p><w:r><w:t>${'가'.repeat(MAX_TRANSCRIPT_CHARS + 1)}</w:t></w:r></w:p>`,
      ),
    ),
    /60,000/,
  );
  assert.match(transcriptProblem('짧은 본문'), /20자/);
});
void test('unsafe/ambiguous XML and oversized compressed content cannot silently enter analysis', async () => {
  const raw = (xml: string) =>
    new File(
      [
        zipSync({
          'word/document.xml': strToU8(xml),
        }) as Uint8Array<ArrayBuffer>,
      ],
      'unsafe.docx',
    );
  await assert.rejects(
    readTranscriptFile(
      raw(
        `<!DOCTYPE w:document [<!ENTITY test "bad">]>${wrap(`<w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p>`)}`,
      ),
    ),
    /구조/,
  );
  await assert.rejects(
    readTranscriptFile(
      docx(`<w:ins><w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p></w:ins>`),
    ),
    /변경 내용/,
  );
  await assert.rejects(
    readTranscriptFile(
      docx(
        `<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>${paragraph}</w:t></w:r></w:p>`,
      ),
    ),
    /숨김/,
  );
  await assert.rejects(readTranscriptFile(raw('<w:document><broken>')), /구조/);
  await assert.rejects(
    readTranscriptFile(
      docx(`<w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p>`, {
        'word/vbaProject.bin': strToU8('macro-not-executed'),
      }),
    ),
    /DOCX/,
  );
  await assert.rejects(
    readTranscriptFile(docx(' '.repeat(2 * 1024 * 1024 + 1))),
    /DOCX/,
  );
  await assert.rejects(
    readTranscriptFile(docx('<w:p><w:r><w:drawing/></w:r></w:p>')),
    /20자/,
  );
});
