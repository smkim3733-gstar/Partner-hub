export const stepZeroPilotContextMinLength = 20;
export const stepZeroPilotContextMaxLength = 8_000;

export function emptyStepZeroPilotContext() {
  return '';
}

function hasPotentialRealIdentifier(value: string) {
  return /\b\d{6}-?\d{7}\b/.test(value)
    || /\b\d{3}-?\d{2}-?\d{5}\b/.test(value)
    || /\b01[016789]-?\d{3,4}-?\d{4}\b/.test(value)
    || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value);
}

export function prepareStepZeroPilotInput(
  pilotContextInput: unknown,
  consentConfirmed: unknown,
) {
  if (typeof pilotContextInput !== 'string')
    return { ok: false as const, field: 'pilotContext' as const, error: '가상기업 설명을 입력해 주세요.' };
  const pilotContext = pilotContextInput.trim();
  if (pilotContext.length < stepZeroPilotContextMinLength)
    return { ok: false as const, field: 'pilotContext' as const, error: `가상기업 설명을 ${stepZeroPilotContextMinLength}자 이상 입력해 주세요.` };
  if (pilotContext.length > stepZeroPilotContextMaxLength)
    return { ok: false as const, field: 'pilotContext' as const, error: `가상기업 설명은 ${stepZeroPilotContextMaxLength.toLocaleString('ko-KR')}자 이하로 입력해 주세요.` };
  if (hasPotentialRealIdentifier(pilotContext))
    return { ok: false as const, field: 'pilotContext' as const, error: '전화번호·이메일·사업자번호·주민번호 형태의 정보는 가상 시험에 입력할 수 없습니다.' };
  if (consentConfirmed !== true)
    return { ok: false as const, field: 'consent' as const, error: '가상자료 확인과 외부 AI 시험 동의가 필요합니다.' };
  return { ok: true as const, pilotContext };
}
