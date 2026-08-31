export type ConsultationPayload = {
  followUps: string[];
  addToSchedule: boolean;
  title: string;
  startsAt: string;
  method: string;
  status: string;
  shareMode: 'all_with_assignee' | 'all_busy' | 'private';
};

/** These are Korean wall-clock values. UTC arithmetic avoids the browser's time zone. */
function consultationTime(startsAt: string) {
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(startsAt) || startsAt.startsWith('0000-')) return null;
  const start = Date.parse(`${startsAt}:00Z`);
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 16) !== startsAt) return null;
  const end = new Date(start + 60 * 60 * 1000).toISOString();
  if (end.length !== 24) return null;
  return {
    isoDate: startsAt.slice(0, 10),
    endIsoDate: end.slice(0, 10),
    date: startsAt.slice(5, 10).replace('-', '.'),
    weekday: ['일', '월', '화', '수', '목', '금', '토'][new Date(start).getUTCDay()],
    time: startsAt.slice(11, 16),
    end: end.slice(11, 16),
  };
}

export function prepareConsultation(input: ConsultationPayload) {
  const title = input.title.trim();
  if (!title) return { ok: false as const, field: 'title' as const, error: '상담 제목·목적을 입력해 주세요.' };
  const time = consultationTime(input.startsAt);
  if (!time) return { ok: false as const, field: 'startsAt' as const, error: '올바른 상담 일시를 한국시간으로 입력해 주세요.' };
  const followUps = input.status === '상담 완료' ? [...new Set(input.followUps)] : [];
  const payload = { ...input, title, followUps };
  const schedule = input.addToSchedule && input.status === '일정 확정' ? time : null;
  const sharing = { all_with_assignee: '담당 파트너 상세 · 다른 파트너 시간 공개', all_busy: '파트너 시간만 공개', private: '내부만 공개' }[input.shareMode];
  const detail = `${title} / ${time.isoDate} ${time.time} (한국시간) / ${input.method} / ${input.status} / 후속조치: ${followUps.length ? followUps.join(' · ') : '없음'}${schedule ? ` / 허브 일정 등록 · ${sharing}` : ''}`;
  return { ok: true as const, payload, schedule, detail };
}
