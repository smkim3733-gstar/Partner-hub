import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LayoutDashboard } from 'lucide-react';
import { PortalNavigationButton } from '../components/portal-navigation';

void test('portal navigation identifies only the current view for assistive technology', () => {
  const active = renderToStaticMarkup(createElement(PortalNavigationButton, {
    active: true,
    icon: LayoutDashboard,
    label: '대표 대시보드',
    onSelect() {},
  }));
  const inactive = renderToStaticMarkup(createElement(PortalNavigationButton, {
    active: false,
    icon: LayoutDashboard,
    label: '전체 진행현황',
    onSelect() {},
  }));

  assert.match(active, /aria-current="page"/);
  assert.match(active, /대표 대시보드/);
  assert.doesNotMatch(inactive, /aria-current/);
});
