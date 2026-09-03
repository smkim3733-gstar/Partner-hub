import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emptyStepZeroPilotContext,
  prepareStepZeroPilotInput,
  stepZeroPilotContextMaxLength,
} from '../lib/step-zero-pilot-input';

void test('new Step 0 pilot starts without invented company context', () => {
  assert.equal(emptyStepZeroPilotContext(), '');
});

void test('Step 0 pilot input trims an explicitly confirmed synthetic description', () => {
  assert.deepEqual(
    prepareStepZeroPilotInput(
      '  업종은 가상 제조업이며 모든 수치와 현황은 확인이 필요합니다.  ',
      true,
    ),
    {
      ok: true,
      pilotContext: '업종은 가상 제조업이며 모든 수치와 현황은 확인이 필요합니다.',
    },
  );
});

void test('Step 0 pilot input rejects missing, short or oversized content without truncation', () => {
  assert.equal(prepareStepZeroPilotInput(undefined, true).ok, false);
  assert.equal(prepareStepZeroPilotInput('짧은 설명', true).ok, false);
  assert.equal(
    prepareStepZeroPilotInput('가'.repeat(stepZeroPilotContextMaxLength + 1), true).ok,
    false,
  );
});

void test('Step 0 pilot input rejects identifier patterns and requires current consent', () => {
  for (const identifier of [
    'test@example.com',
    '010-1234-5678',
    '123-45-67890',
    '900101-1234567',
  ]) {
    assert.equal(
      prepareStepZeroPilotInput(`가상기업 설명에 ${identifier} 식별정보가 포함됐습니다.`, true).ok,
      false,
      identifier,
    );
  }
  assert.deepEqual(
    prepareStepZeroPilotInput(
      '업종은 가상 제조업이며 모든 수치와 현황은 확인이 필요합니다.',
      false,
    ),
    {
      ok: false,
      field: 'consent',
      error: '가상자료 확인과 외부 AI 시험 동의가 필요합니다.',
    },
  );
});
