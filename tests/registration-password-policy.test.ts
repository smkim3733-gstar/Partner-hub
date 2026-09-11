import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  passwordProblem,
  signupPasswordProblem,
} from '../lib/password-policy';

void test('signup accepts 6 through 128 characters and rejects values outside that range', () => {
  assert.match(signupPasswordProblem('Map7!'), /6~128/);
  assert.equal(signupPasswordProblem('Map7!x'), '');
  assert.equal(signupPasswordProblem('Ab'.repeat(64)), '');
  assert.match(signupPasswordProblem(`${'Ab'.repeat(64)}c`), /6~128/);
  assert.match(signupPasswordProblem('가나다라마'), /6~128/);
  assert.equal(signupPasswordProblem('가나다라마바'), '');
});

void test('signup retains invalid-value and weak-password rejection', () => {
  for (const invalid of [undefined, null, 123456, {}, [], '']) {
    assert.match(signupPasswordProblem(invalid), /6~128/);
  }
  for (const weak of [
    'a'.repeat(6),
    '가'.repeat(6),
    '123456789012345',
    '1234567890123456',
    'passwordpassword',
    'QWERTYUIOPASDFGH',
  ]) {
    assert.match(signupPasswordProblem(weak), /반복 문자/);
  }
});

void test('administrator and password setup policy retains a 15-character minimum', () => {
  const fourteenCharacters = 'Ab9!cdAb9!cdXy';
  assert.equal(Array.from(fourteenCharacters).length, 14);
  assert.match(passwordProblem('Map7!x'), /15~128/);
  assert.match(passwordProblem(fourteenCharacters), /15~128/);
  assert.equal(passwordProblem(`${fourteenCharacters}!`), '');
  assert.equal(passwordProblem('Ab'.repeat(64)), '');
  assert.match(passwordProblem(`${'Ab'.repeat(64)}c`), /15~128/);
  assert.match(passwordProblem('a'.repeat(15)), /반복 문자/);
  assert.match(passwordProblem('passwordpassword'), /반복 문자/);
});
