import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosisDocumentsForCase } from '../lib/diagnosis-preflight';

const member = { id: 'member-a', name: '가상 담당자', status: '활성' };
const peer = { id: 'member-b', name: '가상 다른담당', status: '활성' };
const cases = [
  { id: 'case-a', company: '같은 가상기업', trainee: member.name, partnerMemberId: member.id },
  { id: 'case-b', company: '같은 가상기업', trainee: member.name, partnerMemberId: member.id },
  { id: 'case-peer', company: '같은 가상기업', trainee: peer.name, partnerMemberId: peer.id },
];
const document = (id: string, data: Record<string, unknown> = {}) => ({ id, company: '같은 가상기업', assignedTrainee: member.name, partnerMemberId: member.id, status: '검토완료', category: '재무제표', ...data });

void test('diagnosis evidence stays within the exact repeated application and assigned account', () => {
  const documents = [
    document('own', { caseId: 'case-a' }),
    document('other-repeat', { caseId: 'case-b' }),
    document('other-owner', { caseId: 'case-a', partnerMemberId: peer.id, assignedTrainee: peer.name }),
    document('ambiguous-legacy'),
  ];
  assert.deepEqual(diagnosisDocumentsForCase('case-a', documents, cases, [member, peer]).map(item => item.id), ['own']);
  assert.deepEqual(diagnosisDocumentsForCase('missing', documents, cases, [member, peer]), []);
});

void test('a unique same-account legacy document remains usable while pending files are excluded', () => {
  const onlyCase = [cases[0]];
  const documents = [
    document('legacy'),
    document('pending', { caseId: 'case-a', status: '요청중' }),
    document('needs-fix', { caseId: 'case-a', status: '보완필요' }),
  ];
  assert.deepEqual(diagnosisDocumentsForCase('case-a', documents, onlyCase, [member, peer]).map(item => item.id), ['legacy']);
  assert.deepEqual(documents.map(item => item.id), ['legacy', 'pending', 'needs-fix']);
});
