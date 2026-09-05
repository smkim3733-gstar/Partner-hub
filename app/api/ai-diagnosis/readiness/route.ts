import { env } from 'cloudflare:workers';

import {
  CLAUDE_FLOW_INSTRUCTION_VERSION,
  CLAUDE_FLOW_MIGRATION_SUMMARY,
} from '@/lib/claude-flow';
import { PortalAccessError, requirePortalUser } from '@/lib/portal-auth';
import { readPortalState } from '@/lib/portal-state';
import { privateJsonResponse } from '@/lib/private-response';
import { AI_DIAGNOSIS_RUN_FIELD_LIMITS } from '@/lib/storage-limits';
import { isSafeStoredText } from '@/lib/unicode-text';

export const dynamic = 'force-dynamic';

type AiRuntimeEnvironment = {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  AI_SOURCE_FILES?: R2Bucket;
};

function accessErrorResponse(error: unknown) {
  if (error instanceof PortalAccessError) {
    return privateJsonResponse(
      { error: error.message },
      { status: error.status },
    );
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const state = await readPortalState();
    const currentUser = await requirePortalUser(request, state);
    if (currentUser.role !== 'admin') {
      return privateJsonResponse(
        { error: 'AI 연동 설정은 대표 관리자만 확인할 수 있습니다.' },
        { status: 403 },
      );
    }

    const runtime = env as unknown as AiRuntimeEnvironment;
    const apiKeyConfigured = Boolean(runtime.ANTHROPIC_API_KEY?.trim());
    const model = runtime.ANTHROPIC_MODEL?.trim();
    const modelConfigured = Boolean(
      model &&
      isSafeStoredText(model) &&
      Array.from(model).length <= AI_DIAGNOSIS_RUN_FIELD_LIMITS.model,
    );
    const sourceStorageConfigured = Boolean(runtime.AI_SOURCE_FILES);
    const generationEnabled =
      apiKeyConfigured && modelConfigured && sourceStorageConfigured;

    return privateJsonResponse({
      provider: 'Anthropic Claude API',
      directProjectConnection: false,
      instructionImported: true,
      instructionVersion: CLAUDE_FLOW_INSTRUCTION_VERSION,
      migration: CLAUDE_FLOW_MIGRATION_SUMMARY,
      apiKeyConfigured,
      modelConfigured,
      model: modelConfigured ? model : null,
      sourceStorageConfigured,
      generationEnabled,
      nextAction: !apiKeyConfigured
        ? 'Anthropic API 키 연결 필요'
        : !modelConfigured
          ? '사용 모델 지정 필요'
          : !sourceStorageConfigured
            ? '기업 원본파일 저장소 연결 필요'
            : '가상 1건으로 Step 0 생성 시험 가능',
    });
  } catch (error) {
    const accessResponse = accessErrorResponse(error);
    if (accessResponse) return accessResponse;
    console.error(
      'Failed to read AI diagnosis readiness',
      error instanceof Error ? error.name : 'unknown',
    );
    return privateJsonResponse(
      { error: 'AI 연동 준비상태를 확인하지 못했습니다.' },
      { status: 500 },
    );
  }
}
