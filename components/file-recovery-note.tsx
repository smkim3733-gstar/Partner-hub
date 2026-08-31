export function FileRecoveryNote({ recovery }: { recovery?: unknown }) {
  if (!recovery || typeof recovery !== 'object') return null;
  const proof = recovery as Record<string, unknown>;
  if (typeof proof.reason !== 'string' || typeof proof.at !== 'string')
    return null;
  const date = new Date(proof.at);
  return (
    <aside
      className="mt-4 space-y-1 rounded-xl border border-sky-100 bg-sky-50 p-3 text-xs leading-5"
      aria-label="대표 원본 회수 확인 기록"
    >
      <p className="font-semibold text-sky-900">대표 확인으로 회수한 원본</p>
      <p className="whitespace-pre-wrap break-words text-slate-700">
        {proof.reason}
      </p>
      {Number.isFinite(date.getTime()) && (
        <p className="text-slate-600">
          <time dateTime={proof.at}>
            {date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
          </time>{' '}
          (한국시간)
        </p>
      )}
      <p className="text-slate-500">
        확인 기록은 상태 변경과 별도로 보존합니다. 자료의 검토 완료를 의미하지
        않습니다.
      </p>
    </aside>
  );
}
