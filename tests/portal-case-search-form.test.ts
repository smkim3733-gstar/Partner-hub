import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PortalCaseSearchForm } from '../components/portal-case-search-form';

const items = [
  { id: 'case-2026-00000001', company: '세림테크', service: '정책자금' },
  { id: 'case-2026-00000002', company: '한빛솔루션', service: '기업인증' },
];

function renderSearch(inputId: string) {
  return renderToStaticMarkup(createElement(PortalCaseSearchForm, {
    inputId,
    items,
    value: '',
    onChange() {},
    onSubmit(event) { event.preventDefault(); },
  }));
}

void test('portal case search form provides labeled keyboard submission and authorized suggestions', () => {
  const html = renderSearch('desktop-case-search');
  assert.match(html, /^<search/u);
  assert.match(html, /<button type="submit"[^>]*aria-label="기업 진행 검색"/u);
  assert.match(html, /aria-label="기업명 또는 신청번호 검색"/u);
  assert.match(html, /list="desktop-case-search-options"/u);
  assert.match(html, /value="case-2026-00000001"/u);
  assert.match(html, /세림테크 · 정책자금/u);
});

void test('desktop and mobile search forms use distinct input and datalist IDs', () => {
  const desktop = renderSearch('desktop-case-search');
  const mobile = renderSearch('mobile-case-search');
  assert.match(desktop, /id="desktop-case-search-options"/u);
  assert.doesNotMatch(desktop, /mobile-case-search-options/u);
  assert.match(mobile, /id="mobile-case-search-options"/u);
  assert.doesNotMatch(mobile, /desktop-case-search-options/u);
});
