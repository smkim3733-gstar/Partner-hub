import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type ComponentProps, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ChartContainer,
  ChartLegendContent,
  ChartTooltipContent,
  type ChartConfig,
} from '../components/ui/chart';

function renderChart(children: ReactElement, config: ChartConfig) {
  const props: ComponentProps<typeof ChartContainer> = { config, children };
  return renderToStaticMarkup(createElement(ChartContainer, props));
}

function renderTooltip(
  props: Parameters<typeof ChartTooltipContent>[0],
  config: ChartConfig,
) {
  return renderChart(createElement(ChartTooltipContent, props), config);
}

void test('chart tooltip uses the series name when dataKey is an accessor without calling or exposing it', () => {
  const accessor = () => {
    throw new Error('Do not execute the accessor while resolving a config key');
  };
  const html = renderTooltip(
    {
      active: true,
      payload: [
        {
          graphicalItemId: 'revenue',
          dataKey: accessor,
          name: 'revenue',
          value: 0,
        },
      ],
    },
    { revenue: { label: '매출액' } },
  );
  assert.equal((html.match(/매출액/g) ?? []).length, 2);
  assert.match(html, />0<\/span>/);
  assert.doesNotMatch(html, /Do not execute/);
});

void test('chart key resolution preserves numeric zero and explicit label/name keys', () => {
  const html = renderTooltip(
    {
      active: true,
      payload: [
        { graphicalItemId: 'revenue', dataKey: 0, name: 'revenue', value: 12 },
      ],
    },
    { '0': { label: '0번 지표' }, revenue: { label: '매출액' } },
  );
  assert.match(html, /0번 지표/);
  assert.match(html, /매출액/);
  const overridden = renderTooltip(
    {
      active: true,
      labelKey: 'title',
      nameKey: 'series',
      payload: [
        {
          graphicalItemId: 'revenue',
          dataKey: () => 10,
          name: 'revenue',
          value: 12,
        },
      ],
    },
    { title: { label: '지정 제목' }, series: { label: '지정 계열' } },
  );
  assert.match(overridden, /지정 제목/);
  assert.match(overridden, /지정 계열/);
});

void test('chart legend falls back for accessor keys and respects a supplied nameKey', () => {
  const accessor = () => {
    throw new Error('Unexpected accessor call');
  };
  function renderLegend(nameKey?: string) {
    return renderChart(
      createElement(ChartLegendContent, {
        nameKey,
        payload: [{ dataKey: accessor, value: 'Revenue', type: 'square' }],
      }),
      { value: { label: '기본 지표' }, revenue: { label: '매출액' } },
    );
  }
  assert.match(renderLegend(), /기본 지표/);
  assert.match(renderLegend('revenue'), /매출액/);
});

void test('chart tooltip still delegates values to a custom formatter', () => {
  const html = renderTooltip(
    {
      active: true,
      payload: [
        {
          graphicalItemId: 'revenue',
          dataKey: () => 25,
          name: 'revenue',
          value: 25,
        },
      ],
      formatter: (value, name) => `${String(name)}: ${String(value)}원`,
    },
    { revenue: { label: '매출액' } },
  );
  assert.match(html, /revenue: 25원/);
});
