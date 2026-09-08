import assert from 'node:assert/strict';
import test from 'node:test';

import { isAnthropicExternalProcessingEnabled } from '../lib/anthropic-runtime-policy';

void test('external processing is fail-closed and accepts only exact true', () => {
  for (const value of [undefined, '', 'false', 'TRUE', ' true ', '1'])
    assert.equal(
      isAnthropicExternalProcessingEnabled({
        ANTHROPIC_EXTERNAL_PROCESSING_ENABLED: value,
      }),
      false,
    );
  assert.equal(
    isAnthropicExternalProcessingEnabled({
      ANTHROPIC_EXTERNAL_PROCESSING_ENABLED: 'true',
    }),
    true,
  );
});
