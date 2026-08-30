import { env } from 'cloudflare:workers';

import {
  parseStepZeroResult,
  readLatestStepZeroRun,
  saveStepZeroRun,
  type SavedStepZeroRun,
} from '@/lib/ai-diagnosis';
import {
  CLAUDE_FLOW_INSTRUCTION_VERSION,
  CLAUDE_FLOW_PROJECT_INSTRUCTION,
} from '@/lib/claude-flow';
import { PortalAccessError, requirePortalUser } from '@/lib/portal-auth';
import { readPortalState } from '@/lib/portal-state';

export const dynamic = 'force-dynamic';

type AiRuntimeEnvironment = {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
};

type StepZeroRequest = {
  caseId?: unknown;
  company?: unknown;
  pilotContext?: unknown;
  pilotMode?: unknown;
  consentConfirmed?: unknown;
};

type AnthropicMessageResponse = {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
  request_id?: string;
};

function accessErrorResponse(error: unknown) {
  if (error instanceof PortalAccessError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return null;
}

function asText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function assessmentForCase(rawState: unknown, caseId: string, company: string) {
  if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) return null;
  const assessments = (rawState as { diagnosisAssessments?: unknown }).diagnosisAssessments;
  if (!Array.isArray(assessments)) return null;
  return assessments.find((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>;
    return record.caseId === caseId && record.company === company;
  }) as Record<string, unknown> | undefined;
}

function hasPotentialRealIdentifier(value: string) {
  return /\b\d{6}-?\d{7}\b/.test(value)
    || /\b\d{3}-?\d{2}-?\d{5}\b/.test(value)
    || /\b01[016789]-?\d{3,4}-?\d{4}\b/.test(value)
    || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value);
}

function stepZeroPrompt(company: string, pilotContext: string) {
  return `
[실행 단계]
Step 0 사전가설만 작성한다. 1차 정밀진단보고서·견적서·계약서는 생성하지 않는다.

[대상]
기업명: ${company}
자료구분: 외부 고객자료가 아닌 테스트용 가상 입력

[가상 입력]
${pilotContext}

[출력 규칙]
설명이나 마크다운 없이 아래 키를 가진 JSON 객체 하나만 출력한다.
{
  "companyOverview": "확인된 내용과 확인 필요사항을 구분한 기업 현황 요약",
  "confirmedStrengths": ["근거가 있는 강점"],
  "mainRisks": ["위험 또는 불확실성"],
  "solutionCandidates": [
    { "solution": "솔루션 후보", "basis": "제시 근거", "condition": "추가 확인 또는 진행 조건" }
  ],
  "verificationQuestions": ["대표 상담에서 확인할 질문"],
  "missingDocuments": ["보완이 필요한 자료"],
  "complianceNotes": ["승인 보장 금지·전문가 확인 등 주의사항"],
  "nextAction": "김성민 대표가 다음에 수행할 한 가지 행동"
}
제공되지 않은 수치·성과·정책자금 승인 가능성을 만들지 말고 '확인 필요'라고 쓴다.
모든 내용은 AI 생성 내부 초안이며 김성민 대표 검토 전이라는 전제로 작성한다.
`;
}

export async function GET(request: Request) {
  try {
    const state = await readPortalState();
    const currentUser = requirePortalUser(request, state);
    if (currentUser.role !== 'admin') {
      return Response.json({ error: 'Step 0 결과는 대표 관리자만 확인할 수 있습니다.' }, { status: 403 });
    }
    const caseId = asText(new URL(request.url).searchParams.get('caseId'), 120);
    if (!caseId) return Response.json({ error: '진행 식별값이 필요합니다.' }, { status: 400 });
    return Response.json({ run: await readLatestStepZeroRun(caseId) });
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    console.error('Failed to read Step 0 run', error);
    return Response.json({ error: 'Step 0 결과를 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) {
      return Response.json({ error: '허용되지 않은 생성 요청입니다.' }, { status: 403 });
    }
    const state = await readPortalState();
    const currentUser = requirePortalUser(request, state);
    if (currentUser.role !== 'admin') {
      return Response.json({ error: 'Step 0 생성은 김성민 대표만 실행할 수 있습니다.' }, { status: 403 });
    }

    const body = await request.json() as StepZeroRequest;
    const caseId = asText(body.caseId, 120);
    const company = asText(body.company, 100);
    const pilotContext = asText(body.pilotContext, 8_000);
    if (body.pilotMode !== true || !company.includes('(가상)')) {
      return Response.json({ error: '현재 단계에서는 가상기업 시험만 실행할 수 있습니다.' }, { status: 403 });
    }
    if (body.consentConfirmed !== true) {
      return Response.json({ error: '가상자료 확인과 외부 AI 시험 동의가 필요합니다.' }, { status: 400 });
    }
    if (!caseId || pilotContext.length < 20) {
      return Response.json({ error: '가상기업 설명을 20자 이상 입력해 주세요.' }, { status: 400 });
    }
    if (hasPotentialRealIdentifier(pilotContext)) {
      return Response.json({ error: '전화번호·이메일·사업자번호·주민번호 형태의 정보는 가상 시험에 입력할 수 없습니다.' }, { status: 400 });
    }

    const assessment = assessmentForCase(state, caseId, company);
    const eligible = assessment?.level === 'A'
      && assessment.identityStatus === '일치'
      && assessment.privacyMasked === true
      && assessment.personalDataConsent === true
      && assessment.thirdPartyAiConsent === true;
    if (!eligible) {
      return Response.json({ error: 'A 판정과 마스킹·개인정보·제3자 AI 동의가 모두 확인된 건만 실행할 수 있습니다.' }, { status: 403 });
    }

    const runtime = env as unknown as AiRuntimeEnvironment;
    const apiKey = runtime.ANTHROPIC_API_KEY?.trim();
    const model = runtime.ANTHROPIC_MODEL?.trim();
    if (!apiKey || !model) {
      return Response.json({ error: 'Anthropic API 키와 사용 모델 연결이 필요합니다.' }, { status: 503 });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        model,
        max_tokens: 4_000,
        system: CLAUDE_FLOW_PROJECT_INSTRUCTION,
        messages: [{ role: 'user', content: stepZeroPrompt(company, pilotContext) }],
      }),
    });
    const payload = await response.json() as AnthropicMessageResponse;
    if (!response.ok) {
      console.error('Anthropic Step 0 request failed', {
        status: response.status,
        requestId: payload.request_id,
      });
      return Response.json({ error: payload.error?.message || 'Claude Step 0 생성 요청이 실패했습니다.' }, { status: 502 });
    }

    const rawText = payload.content?.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n').trim() ?? '';
    const result = parseStepZeroResult(rawText);
    const run: SavedStepZeroRun = {
      id: crypto.randomUUID(),
      caseId,
      company,
      stage: 'Step 0',
      status: '대표 검토 대기',
      instructionVersion: CLAUDE_FLOW_INSTRUCTION_VERSION,
      model,
      result,
      usage: {
        inputTokens: payload.usage?.input_tokens ?? 0,
        outputTokens: payload.usage?.output_tokens ?? 0,
      },
      createdAt: new Date().toISOString(),
    };
    await saveStepZeroRun(run, currentUser.id);
    return Response.json({ run }, { status: 201 });
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    console.error('Failed to create Step 0 run', error);
    return Response.json({ error: 'Step 0 결과를 생성하거나 저장하지 못했습니다.' }, { status: 500 });
  }
}
