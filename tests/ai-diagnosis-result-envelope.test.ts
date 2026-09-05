import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStepZeroResult,
  serializeStepZeroPendingEnvelope,
} from '../lib/ai-diagnosis';

function validResult() {
  return {
    companyOverview: ' 가상 기업 현황 ',
    confirmedStrengths: [' 강점 '],
    mainRisks: [' 위험 '],
    solutionCandidates: [
      { solution: ' 방안 ', basis: ' 근거 ', condition: ' 조건 ' },
    ],
    verificationQuestions: [' 질문 '],
    missingDocuments: [' 서류 '],
    complianceNotes: [' 준수사항 '],
    nextAction: ' 대표 검토 ',
  };
}

void test('Step 0 pending serializer keeps one exact request fingerprint', () => {
  const fingerprint = 'a'.repeat(64);
  assert.equal(
    serializeStepZeroPendingEnvelope(fingerprint),
    JSON.stringify({ _requestFingerprint: fingerprint }),
  );
  assert.throws(
    () => serializeStepZeroPendingEnvelope('A'.repeat(64)),
    /요청 지문 형식이 올바르지 않습니다/,
  );
  assert.throws(
    () => serializeStepZeroPendingEnvelope('a'.repeat(63)),
    /요청 지문 형식이 올바르지 않습니다/,
  );
});

void test('Step 0 parser preserves one strict normalized result envelope', () => {
  const input = { ...validResult(), ignoredProviderField: 'discarded' };
  assert.deepEqual(parseStepZeroResult(JSON.stringify(input)), {
    companyOverview: '가상 기업 현황',
    confirmedStrengths: ['강점'],
    mainRisks: ['위험'],
    solutionCandidates: [
      { solution: '방안', basis: '근거', condition: '조건' },
    ],
    verificationQuestions: ['질문'],
    missingDocuments: ['서류'],
    complianceNotes: ['준수사항'],
    nextAction: '대표 검토',
  });
});

void test('Step 0 parser rejects missing, malformed and over-limit fields', () => {
  const invalidValues = [
    { ...validResult(), mainRisks: undefined },
    { ...validResult(), mainRisks: [3] },
    { ...validResult(), mainRisks: [' '] },
    { ...validResult(), mainRisks: Array(21).fill('위험') },
    {
      ...validResult(),
      solutionCandidates: [
        { solution: '방안', basis: '근거', condition: '', unexpected: true },
      ],
    },
    {
      ...validResult(),
      solutionCandidates: [{ solution: '방안', basis: '근거', condition: 3 }],
    },
    { ...validResult(), companyOverview: '가'.repeat(12_001) },
    { ...validResult(), confirmedStrengths: ['가'.repeat(4_001)] },
  ];

  for (const value of invalidValues)
    assert.throws(
      () => parseStepZeroResult(JSON.stringify(value)),
      /응답 형식이 올바르지 않습니다/,
    );
});

void test('Step 0 parser rejects results beyond stored UTF-8 capacity', () => {
  const largeItem = '가'.repeat(4_000);
  const result = validResult();
  for (const key of [
    'confirmedStrengths',
    'mainRisks',
    'verificationQuestions',
    'missingDocuments',
    'complianceNotes',
  ] as const)
    result[key] = Array(20).fill(largeItem);

  assert.throws(
    () => parseStepZeroResult(JSON.stringify(result)),
    /허용 용량을 초과했습니다/,
  );
});
