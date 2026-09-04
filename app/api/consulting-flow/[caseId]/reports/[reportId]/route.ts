import { FlowError } from '@/lib/consulting-flow';
import { escapeHtml } from '@/lib/consulting-flow-http';
import { flowErrorResponse, loadFlowAccess } from '@/lib/consulting-flow-store';
import { readExactQueryFlag } from '@/lib/request-query';
import { readRouteParam } from '@/lib/request-path';
import { privateResponseHeaders } from '@/lib/private-response';
import { attachmentContentDisposition } from '@/lib/content-disposition';
export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  context: { params: Promise<{ caseId: string; reportId: string }> },
) {
  try {
    const { caseId, reportId: rawReportId } = await context.params;
    const { flow } = await loadFlowAccess(request, caseId);
    const reportId = readRouteParam(
      rawReportId,
      120,
      '보고서 식별값을 확인해 주세요.',
    );
    const report = flow.reports.find((r) => r.id === reportId);
    if (!report || !report.body)
      throw new FlowError(
        '본문이 없는 문서는 첨부파일을 내려받아 출력해 주세요.',
        404,
      );
    const title = `${flow.company} · ${report.title} V${report.version}`;
    if (readExactQueryFlag(new URL(request.url), 'download'))
      return new Response(`${title}\n${report.body}`, {
        headers: privateResponseHeaders({
          'content-type': 'text/markdown; charset=utf-8',
          'content-disposition': attachmentContentDisposition(
            `${report.createdAt.slice(0, 10).replaceAll('-', '_')}_${report.title}.md`,
          ),
        }),
      });
    const nonce = crypto.randomUUID();
    return new Response(
      `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style nonce="${nonce}">body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:24px;color:#15375b}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;color:#202936;line-height:1.7}button{padding:12px 20px;cursor:pointer}small{color:#586778}@media print{button{display:none}body{margin:0;max-width:none;padding:0}pre{font-size:11pt}h1{font-size:20pt}}@page{size:A4;margin:20mm}</style></head><body><button id="print">인쇄 / PDF 저장</button><h1>${escapeHtml(title)}</h1><small>주식회사 한국기업가치평가원 · 작성·검토: 김성민 대표<br>${escapeHtml(report.createdAt)} · ${report.origin === 'ai' ? 'AI 생성 내부 초안 / 기업대표 전달 전 대표 검토 필요' : '등록된 문서 / 실제 적용 전 내용 확인'}</small><pre>${escapeHtml(report.body)}</pre><script nonce="${nonce}">document.getElementById('print').addEventListener('click',()=>window.print());</script></body></html>`,
      {
        headers: privateResponseHeaders({
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
        }),
      },
    );
  } catch (error) {
    return flowErrorResponse(error);
  }
}
