import { env } from 'cloudflare:workers';

import {
  claimStepZeroRequest,
  completeStepZeroRequest,
  failStepZeroRequest,
  parseStepZeroResult,
  readLatestStepZeroRun,
  type SavedStepZeroRun,
} from '@/lib/ai-diagnosis';
import {
  CLAUDE_FLOW_INSTRUCTION_VERSION,
  CLAUDE_FLOW_PROJECT_INSTRUCTION,
} from '@/lib/claude-flow';
import { PortalAccessError, requirePortalUser } from '@/lib/portal-auth';
import { readPortalState } from '@/lib/portal-state';
import { CompanyFileError } from '@/lib/company-files';
import { stepZeroPreflight } from '@/lib/step-zero-preflight';
import { prepareStepZeroPilotInput } from '@/lib/step-zero-pilot-input';
import {
  AnthropicMessageResponseError,
  readAnthropicMessageResponse,
} from '@/lib/anthropic-message-response';
import { JsonRequestError, readBoundedJsonObject } from '@/lib/request-json';
import { isCrossSiteRequest } from '@/lib/request-origin';
import { QueryRequestError, readSingleQueryParam } from '@/lib/request-query';
import { privateJsonResponse } from '@/lib/private-response';
import {
  AI_DIAGNOSIS_RUN_FIELD_LIMITS,
  STEP_ZERO_MAX_OUTPUT_TOKENS,
} from '@/lib/storage-limits';
import { isSafeStoredText } from '@/lib/unicode-text';

export const dynamic = 'force-dynamic';

type AiRuntimeEnvironment = {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
};

type StepZeroRequest = {
  requestId?: unknown;
  caseId?: unknown;
  company?: unknown;
  pilotContext?: unknown;
  pilotMode?: unknown;
  consentConfirmed?: unknown;
};

function accessErrorResponse(error: unknown) {
  if (
    error instanceof PortalAccessError ||
    error instanceof CompanyFileError ||
    error instanceof QueryRequestError
  ) {
    return privateJsonResponse(
      { error: error.message },
      { status: error.status },
    );
  }
  return null;
}

function asText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text.length <= maxLength ? text : '';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

async function requestFingerprint(
  currentUserId: string,
  caseId: string,
  company: string,
  pilotContext: string,
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ currentUserId, caseId, company, pilotContext }),
  );
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function GET(request: Request) {
  try {
    const state = await readPortalState();
    const currentUser = await requirePortalUser(request, state);
    if (currentUser.role !== 'admin') {
      return privateJsonResponse(
        { error: 'Step 0 결과는 대표 관리자만 확인할 수 있습니다.' },
        { status: 403 },
      );
    }
    const caseId = asText(
      readSingleQueryParam(new URL(request.url), 'caseId', 120),
      120,
    );
    if (!caseId)
      return privateJsonResponse(
        { error: '진행 식별값이 필요합니다.' },
        { status: 400 },
      );
    return privateJsonResponse({
      run: await readLatestStepZeroRun(caseId),
    });
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    console.error(
      'Failed to read Step 0 run',
      error instanceof Error ? error.name : 'unknown',
    );
    return privateJsonResponse(
      { error: 'Step 0 결과를 불러오지 못했습니다.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    if (isCrossSiteRequest(request)) {
      return privateJsonResponse(
        { error: '허용되지 않은 생성 요청입니다.' },
        { status: 403 },
      );
    }
    const state = await readPortalState();
    const currentUser = await requirePortalUser(request, state);
    if (currentUser.role !== 'admin') {
      return privateJsonResponse(
        { error: 'Step 0 생성은 김성민 대표만 실행할 수 있습니다.' },
        { status: 403 },
      );
    }

    const rawBody: unknown = await readBoundedJsonObject(request, 40_000);
    if (!isObject(rawBody)) {
      return privateJsonResponse(
        { error: '생성 요청 형식이 올바르지 않습니다.' },
        { status: 400 },
      );
    }
    const body: StepZeroRequest = rawBody;
    const requestId = asText(body.requestId, 100);
    const caseId = asText(body.caseId, 120);
    const company = asText(body.company, 100);
    if (body.pilotMode !== true || !company.includes('(가상)')) {
      return privateJsonResponse(
        { error: '현재 단계에서는 가상기업 시험만 실행할 수 있습니다.' },
        { status: 403 },
      );
    }
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) {
      return privateJsonResponse(
        { error: '안전한 생성 요청 식별값이 필요합니다.' },
        { status: 400 },
      );
    }
    if (!caseId)
      return privateJsonResponse(
        { error: '진행 식별값이 필요합니다.' },
        { status: 400 },
      );
    const preparedInput = prepareStepZeroPilotInput(
      body.pilotContext,
      body.consentConfirmed,
    );
    if (!preparedInput.ok)
      return privateJsonResponse(
        { error: preparedInput.error },
        { status: 400 },
      );
    const { pilotContext } = preparedInput;

    // Consent or evidence can change while this screen is open. Read it again and
    // verify D1 metadata plus the R2 object before any external request.
    const preflight = await stepZeroPreflight(
      await readPortalState(),
      caseId,
      company,
    );
    if (!preflight.eligible) {
      return privateJsonResponse({ error: preflight.reason }, { status: 403 });
    }

    const runtime = env as unknown as AiRuntimeEnvironment;
    const apiKey = runtime.ANTHROPIC_API_KEY?.trim();
    const model = runtime.ANTHROPIC_MODEL?.trim();
    if (
      !apiKey ||
      !model ||
      !isSafeStoredText(model) ||
      Array.from(model).length > AI_DIAGNOSIS_RUN_FIELD_LIMITS.model
    ) {
      return privateJsonResponse(
        { error: 'Anthropic API 키와 사용 모델 연결이 필요합니다.' },
        { status: 503 },
      );
    }

    const fingerprint = await requestFingerprint(
      currentUser.id,
      caseId,
      company,
      pilotContext,
    );
    const claim = await claimStepZeroRequest({
      requestId,
      requestFingerprint: fingerprint,
      caseId,
      company,
      instructionVersion: CLAUDE_FLOW_INSTRUCTION_VERSION,
      model,
      createdByUserId: currentUser.id,
      createdAt: new Date().toISOString(),
    });
    if (claim.state === 'completed') {
      return privateJsonResponse({ run: claim.run, reused: true });
    }
    if (claim.state === 'conflict') {
      return privateJsonResponse(
        { error: '같은 요청 식별값의 내용이 달라 생성할 수 없습니다.' },
        { status: 409 },
      );
    }
    if (claim.state === 'pending') {
      return privateJsonResponse(
        { error: '이 진행의 Step 0 생성이 이미 처리 중입니다.' },
        { status: 409 },
      );
    }
    if (claim.state === 'failed') {
      return privateJsonResponse(
        {
          error:
            '이 생성 요청은 완료되지 않았습니다. 입력을 다시 확인해 새 요청으로 실행해 주세요.',
        },
        { status: 409 },
      );
    }

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          model,
          max_tokens: STEP_ZERO_MAX_OUTPUT_TOKENS,
          system: CLAUDE_FLOW_PROJECT_INSTRUCTION,
          messages: [
            { role: 'user', content: stepZeroPrompt(company, pilotContext) },
          ],
        }),
      });
      const payload = await readAnthropicMessageResponse(response);
      if (!response.ok) {
        console.error('Anthropic Step 0 request failed', {
          status: response.status,
          requestId: payload.requestId,
        });
        await failStepZeroRequest(requestId, currentUser.id, fingerprint);
        return privateJsonResponse(
          {
            error:
              response.status === 429
                ? 'Claude API 사용 한도에 도달했습니다. 자동 재시도하지 않습니다.'
                : response.status === 401
                  ? 'Claude API 인증 설정을 확인해 주세요.'
                  : 'Claude Step 0 생성 요청이 실패했습니다. 처리·과금 상태를 확인해 주세요.',
          },
          { status: 502 },
        );
      }

      if (payload.stopReason !== 'end_turn')
        throw new AnthropicMessageResponseError(
          'Claude Step 0 응답이 완결되지 않았습니다.',
        );
      let result: ReturnType<typeof parseStepZeroResult>;
      try {
        result = parseStepZeroResult(payload.text.trim());
      } catch {
        throw new AnthropicMessageResponseError(
          'Claude Step 0 결과 형식이 올바르지 않습니다.',
        );
      }
      const latestState = await readPortalState();
      const latestUser = await requirePortalUser(request, latestState);
      const finalPreflight = await stepZeroPreflight(
        latestState,
        caseId,
        company,
      );
      if (
        latestUser.role !== 'admin' ||
        latestUser.id !== currentUser.id ||
        !finalPreflight.eligible
      ) {
        await failStepZeroRequest(requestId, currentUser.id, fingerprint);
        return privateJsonResponse(
          {
            error:
              finalPreflight.reason ??
              '생성 중 권한 또는 동의 상태가 변경되어 결과를 저장하지 않았습니다.',
          },
          { status: 409 },
        );
      }
      const run: SavedStepZeroRun = {
        id: requestId,
        caseId,
        company,
        stage: 'Step 0',
        status: '대표 검토 대기',
        instructionVersion: CLAUDE_FLOW_INSTRUCTION_VERSION,
        model,
        result,
        usage: payload.usage,
        createdAt: new Date().toISOString(),
      };
      if (!(await completeStepZeroRequest(run, currentUser.id, fingerprint))) {
        throw new Error('Step 0 생성 결과의 실행 잠금을 확인하지 못했습니다.');
      }
      return privateJsonResponse({ run }, { status: 201 });
    } catch (error) {
      await failStepZeroRequest(requestId, currentUser.id, fingerprint);
      throw error;
    }
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    if (error instanceof JsonRequestError)
      return privateJsonResponse(
        { error: error.message },
        { status: error.status },
      );
    if (error instanceof AnthropicMessageResponseError) {
      console.error('Invalid Anthropic Step 0 response', error.name);
      return privateJsonResponse(
        {
          error:
            'Claude 응답을 완전한 결과로 확인하지 못했습니다. 처리·과금 상태를 확인한 뒤 새 요청으로 실행해 주세요.',
        },
        { status: 502 },
      );
    }
    console.error(
      'Failed to create Step 0 run',
      error instanceof Error ? error.name : 'unknown',
    );
    return privateJsonResponse(
      { error: 'Step 0 결과를 생성하거나 저장하지 못했습니다.' },
      { status: 500 },
    );
  }
}
