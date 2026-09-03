import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExplicitChoice } from '../components/consulting-workflow';

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
