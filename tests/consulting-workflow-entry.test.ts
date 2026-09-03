import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ExplicitChoice,
  MeetingBookingChoices,
} from '../components/consulting-workflow';

void test('workflow consequence choices render with a required unselected option', () => {
  const html = renderToStaticMarkup(
    createElement(
      ExplicitChoice,
      { name: 'approved', placeholder: '검토 결과 선택' },
      createElement('option', { value: 'yes' }, '검토 완료'),
      createElement('option', { value: 'no' }, '보완 필요'),
    ),
  );
  assert.match(html, /<select[^>]*name="approved"[^>]*required/);
  assert.match(html, /<option value="" selected="">검토 결과 선택<\/option>/);
  assert.equal((html.match(/<option/g) ?? []).length, 3);
});

void test('first meeting choices expose fixed business rules without selectable defaults', () => {
  const html = renderToStaticMarkup(
    createElement(MeetingBookingChoices, {
      firstMeetingRequired: true,
      contractEnabled: false,
    }),
  );
  assert.match(html, /name="kind" value="first"/);
  assert.match(html, /name="attendance" value="both"/);
  assert.match(html, /초회상담 \(공동분석 후\)/);
  assert.match(html, /파트너 \+ 김성민 대표/);
  assert.doesNotMatch(html, /<select/);
});

void test('later meeting choices require explicit kind and attendance', () => {
  const html = renderToStaticMarkup(
    createElement(MeetingBookingChoices, {
      firstMeetingRequired: false,
      contractEnabled: false,
    }),
  );
  assert.match(html, /<select[^>]*name="kind"[^>]*required/);
  assert.match(html, /<select[^>]*name="attendance"[^>]*required/);
  assert.equal((html.match(/<option value="" selected="">/g) ?? []).length, 2);
  assert.match(html, /<option value="contract" disabled="">/);
});
