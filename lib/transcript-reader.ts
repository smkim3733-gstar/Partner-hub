import {
  MAX_TRANSCRIPT_CHARS,
  transcriptFileProblem,
  transcriptProblem,
} from './transcript-policy';

const MAX_XML_BYTES = 2 * 1024 * 1024;
const wordNamespaces = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);

function decode(bytes: Uint8Array) {
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : 'utf-8';
  try {
    return new TextDecoder(encoding, { fatal: true })
      .decode(bytes)
      .replace(/^\ufeff/, '')
      .replace(/\r\n?/g, '\n');
  } catch {
    throw new Error(
      '문자 인코딩을 읽지 못했습니다. UTF-8 TXT 또는 DOCX로 다시 저장해 주세요.',
    );
  }
}

/** Browser-local extraction only: no fetch, uploads, HTML rendering, macros, or external relationships. */
export async function readTranscriptFile(file: File): Promise<string> {
  const problem = transcriptFileProblem(file);
  if (problem) throw new Error(problem);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  if (/\.txt$/i.test(file.name)) {
    text = decode(bytes);
  } else {
    const { unzipSync } = await import('fflate');
    let xml: Uint8Array | undefined;
    try {
      let matches = 0;
      const files = unzipSync(bytes, {
        filter: (entry) => {
          if (/^word\/vbaProject(?:Signature)?\.bin$/i.test(entry.name))
            throw new Error('매크로 문서는 지원하지 않습니다.');
          if (entry.name !== 'word/document.xml') return false;
          if (++matches !== 1 || entry.originalSize > MAX_XML_BYTES)
            throw new Error('DOCX 본문 크기 또는 구조를 확인해 주세요.');
          return true;
        },
      });
      xml = files['word/document.xml'];
    } catch {
      throw new Error(
        'DOCX를 읽지 못했습니다. 손상·암호·본문 크기를 확인하고 Word에서 새 DOCX로 저장해 주세요.',
      );
    }
    if (!xml?.length || xml.length > MAX_XML_BYTES)
      throw new Error(
        'DOCX 본문이 없거나 너무 큽니다. Word에서 본문을 복사해 붙여넣어 주세요.',
      );
    text = await readWordXml(decode(xml));
  }
  text = text.trim();
  const invalid = transcriptProblem(text);
  if (invalid) throw new Error(invalid);
  return text;
}

export async function readWordXml(xml: string): Promise<string> {
  if (xml.length > MAX_XML_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error(
      '이 DOCX의 문서 구조는 지원하지 않습니다. 본문을 TXT로 저장해 주세요.',
    );
  const { SaxesParser } = await import('saxes');
  const parser = new SaxesParser({ xmlns: true });
  const parts: string[] = [];
  let count = 0;
  let body = false;
  let inText = false;
  let depth = 0;
  const append = (value: string) => {
    count += value.length;
    // Allow a bounded amount of paragraph/table separators before trimming.
    if (count > MAX_TRANSCRIPT_CHARS + 2000)
      throw new Error(
        '전사문은 60,000자까지 처리합니다. 내용을 자르지 않았습니다. 상담을 나누어 등록해 주세요.',
      );
    parts.push(value);
  };
  parser.on('opentag', (node) => {
    if (++depth > 100)
      throw new Error(
        'DOCX 구조가 너무 복잡합니다. 본문을 TXT로 저장해 주세요.',
      );
    if (!wordNamespaces.has(node.uri)) return;
    if (node.local === 'body') body = true;
    if (!body) return;
    if (['del', 'ins', 'moveFrom', 'moveTo', 'altChunk'].includes(node.local))
      throw new Error(
        '변경 내용 추적 또는 외부 삽입 본문이 있습니다. Word에서 내용을 확정한 뒤 새 DOCX로 저장해 주세요.',
      );
    // Hidden content can disagree with the visible document; do not silently ingest it.
    if (node.local === 'vanish')
      throw new Error(
        '숨김 텍스트가 있는 문서입니다. 확인한 본문을 복사해 붙여넣어 주세요.',
      );
    if (node.local === 't') inText = true;
    if (node.local === 'tab') append('\t');
    if (node.local === 'br' || node.local === 'cr') append('\n');
  });
  parser.on('text', (value) => {
    if (body && inText) append(value);
  });
  parser.on('cdata', (value) => {
    if (body && inText) append(value);
  });
  parser.on('closetag', (node) => {
    if (wordNamespaces.has(node.uri)) {
      if (body && node.local === 'p') append('\n');
      if (body && node.local === 'tc') append('\t');
      if (body && node.local === 'tr') append('\n');
      if (node.local === 't') inText = false;
      if (node.local === 'body') body = false;
    }
    depth--;
  });
  parser.on('error', () => {
    throw new Error(
      'DOCX 본문 구조를 읽지 못했습니다. Word에서 새 DOCX로 저장해 주세요.',
    );
  });
  parser.write(xml).close();
  return parts.join('').trim();
}
