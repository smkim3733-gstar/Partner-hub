import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAnthropicMessageResponse,
  readAnthropicMessageResponse,
} from '../lib/anthropic-message-response';

void test('Anthropic response parser returns only validated text, completion, usage and request identity', () => {
  assert.deepEqual(
    parseAnthropicMessageResponse({
      stop_reason: 'end_turn',
      request_id: 'request-synthetic-1',
      content: [
        { type: 'text', text: '첫 블록' },
        { type: 'tool_use', id: 'ignored-private-field' },
        { type: 'text', text: '둘째 블록' },
      ],
      usage: { input_tokens: 10, output_tokens: 20, cache_creation: 30 },
      unknown: 'not returned',
    }),
    {
      stopReason: 'end_turn',
      text: '첫 블록\n둘째 블록',
      usage: { inputTokens: 10, outputTokens: 20 },
      requestId: 'request-synthetic-1',
    },
  );
});

void test('Anthropic response parser rejects malformed blocks, token counts and oversized text', () => {
  for (const value of [
    null,
    { content: {} },
    { content: [null] },
    { content: [{ type: 'text' }] },
    { content: [{ type: 'text', text: 'ok' }] },
    { content: [{ type: 'text', text: 'ok' }], usage: {} },
    {
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 0, output_tokens: 1 },
    },
    {
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 0 },
    },
    { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: -1 } },
    { content: [{ type: 'text', text: 'ok' }], usage: { output_tokens: 1.5 } },
    { content: [{ type: 'text', text: '가'.repeat(100_001) }] },
  ])
    assert.throws(
      () => parseAnthropicMessageResponse(value),
      /Claude .+ 형식|허용 길이/,
    );
});

void test('unreadable Anthropic response hides provider payload details', async () => {
  await assert.rejects(
    readAnthropicMessageResponse(new Response('<html>provider secret</html>')),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /JSON으로 읽지 못했습니다/);
      assert.doesNotMatch(error.message, /provider secret|SyntaxError/);
      return true;
    },
  );
  assert.deepEqual(
    await readAnthropicMessageResponse(
      Response.json({ request_id: 'failed-request' }, { status: 429 }),
    ),
    {
      stopReason: null,
      text: '',
      usage: { inputTokens: 0, outputTokens: 0 },
      requestId: 'failed-request',
    },
  );
});
