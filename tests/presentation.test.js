import test from 'node:test';
import assert from 'node:assert/strict';
import { wrap, textWidth } from '../src/renderer/presentation.js';

test('labels wrap at word boundaries and retain explicit paragraph breaks', () => {
  assert.deepEqual(wrap('Shared memory controller', textWidth('Shared memory')), ['Shared memory', 'controller']);
  assert.deepEqual(wrap('first\n\nsecond', 200), ['first', '', 'second']);
  assert.deepEqual(wrap('', 200), ['']);
});

test('long identifiers and Unicode tokens stay within the measured line width without losing characters', () => {
  for (const token of ['a_very_long_architectural_identifier', '메모리컨트롤러', '🚀🚀🚀🚀🚀']) {
    const lines = wrap(token, 48);
    assert.equal(lines.join(''), token);
    assert.ok(lines.every(line => textWidth(line) <= 48));
  }
});
