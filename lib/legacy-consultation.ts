export const consultationTitleMaxLength = 150;
export const consultationMethods = ['전화', '방문', '화상', '기타'] as const;
export const consultationStatuses = [
  '상담 완료',
  '일정 요청',
  '일정 확정',
  '고객 회신 대기',
  '취소',
] as const;
export const consultationFollowUpOptions = [
  '다음 상담 등록',
  '서류요청',
  '견적서 작성',
  '계약서 작성',
  '내부업무 등록',
] as const;
const consultationShareModes = [
  'all_with_assignee',
  'all_busy',
  'private',
] as const;

export type ConsultationPayload = {
  followUps: string[];
  addToSchedule: boolean;
  title: string;
  startsAt: string;
  method: string;
  status: string;
  shareMode: 'all_with_assignee' | 'all_busy' | 'private';
};

export function emptyConsultationSelections() {
  return {
    followUps: [] as string[],
    addToSchedule: false,
    method: '',
    status: '',
    shareMode: 'all_with_assignee' as const,
  };
}

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
  if (title.length > consultationTitleMaxLength)
    return { ok: false as const, field: 'title' as const, error: `상담 제목·목적은 ${consultationTitleMaxLength}자 이하로 입력해 주세요.` };
  const time = consultationTime(input.startsAt);
  if (!time) return { ok: false as const, field: 'startsAt' as const, error: '올바른 상담 일시를 한국시간으로 입력해 주세요.' };
  const method = consultationMethods.find((value) => value === input.method);
  if (!method)
    return { ok: false as const, field: 'method' as const, error: '상담방식을 선택해 주세요.' };
  const status = consultationStatuses.find((value) => value === input.status);
  if (!status)
    return { ok: false as const, field: 'status' as const, error: '상담상태를 선택해 주세요.' };
  const shareMode = consultationShareModes.find(
    (value) => value === input.shareMode,
  );
  if (!shareMode)
    return { ok: false as const, field: 'shareMode' as const, error: '일정 공개범위를 선택해 주세요.' };
  const followUps = status === '상담 완료' ? [...new Set(input.followUps)] : [];
  if (
    followUps.some(
      (followUp) => !consultationFollowUpOptions.includes(
        followUp as (typeof consultationFollowUpOptions)[number],
      ),
    )
  )
    return { ok: false as const, field: 'followUps' as const, error: '상담 후속조치를 목록에서 선택해 주세요.' };
  const payload = { ...input, title, method, status, shareMode, followUps };
  const schedule = input.addToSchedule && status === '일정 확정' ? time : null;
  const sharing = { all_with_assignee: '담당 파트너 상세 · 다른 파트너 시간 공개', all_busy: '파트너 시간만 공개', private: '내부만 공개' }[shareMode];
  const detail = `${title} / ${time.isoDate} ${time.time} (한국시간) / ${method} / ${status} / 후속조치: ${followUps.length ? followUps.join(' · ') : '없음'}${schedule ? ` / 허브 일정 등록 · ${sharing}` : ''}`;
  return { ok: true as const, payload, schedule, detail };
}
