type ScheduleDate = {
  isoDate?: string;
  endIsoDate?: string;
  date: string;
  time: string;
  end: string;
};

function validDate(value?: string): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
}

/** Group only the already-authorized, filtered records; never infer a missing year. */
export function scheduleDateGroups<T extends ScheduleDate>(items: T[]) {
  const groups = new Map<string, { key: string; label: string; dated: boolean; items: T[] }>();
  for (const item of items) {
    const dated = validDate(item.isoDate);
    const raw = item.isoDate || item.date || '날짜 없음';
    const key = dated ? item.isoDate! : `unresolved:${raw}`;
    const weekday = dated ? ['일', '월', '화', '수', '목', '금', '토'][new Date(`${item.isoDate}T00:00:00Z`).getUTCDay()] : '';
    const label = dated
      ? `${item.isoDate!.replaceAll('-', '.')} (${weekday})`
      : `${raw} · ${item.isoDate ? '날짜' : '연도'} 확인 필요`;
    if (!groups.has(key)) groups.set(key, { key, label, dated, items: [] });
    groups.get(key)!.items.push(item);
  }
  return [...groups.values()]
    .sort((a, b) => Number(b.dated) - Number(a.dated) || a.key.localeCompare(b.key))
    .map((group) => ({ ...group, items: [...group.items].sort((a, b) => a.time.localeCompare(b.time)) }));
}

/** An optional Google draft link, not a calendar connection or a saved event. */
export function googleCalendarDraftUrl(item: ScheduleDate & { company: string; service: string; method: string }) {
  const endDate = item.endIsoDate ?? item.isoDate;
  const validTime = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  if (!validDate(item.isoDate) || !validDate(endDate) || !validTime(item.time) || !validTime(item.end)) return null;
  const start = `${item.isoDate.replaceAll('-', '')}T${item.time.replace(':', '')}00`;
  const end = `${endDate.replaceAll('-', '')}T${item.end.replace(':', '')}00`;
  if (end <= start) return null;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `[한기평 상담] ${item.company} - ${item.service}`,
    dates: `${start}/${end}`,
    details: `한기평 파트너 허브 상담일정\n상담방식: ${item.method}`,
    ctz: 'Asia/Seoul',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
