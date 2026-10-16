'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { categories } = require('../data/questions.json');
const { MODES } = require('../src/games/herd');

test('every category is well formed and has prompts for both modes', () => {
  const ids = new Set();
  for (const c of categories) {
    assert.match(c.id, /^[a-z]+$/);
    assert.ok(!ids.has(c.id), `duplicate id ${c.id}`);
    ids.add(c.id);
    assert.ok(c.name && c.emoji, c.id);
    for (const mode of MODES) {
      assert.ok(Array.isArray(c[mode]) && c[mode].length >= 5, `${c.id} needs prompts for ${mode}`);
      for (const q of c[mode]) assert.ok(typeof q === 'string' && q.trim() === q && q.length > 0, `${c.id}: "${q}"`);
    }
  }
});

test('no prompt is listed twice within a mode', () => {
  for (const mode of MODES) {
    const seen = new Map();
    for (const c of categories) {
      for (const q of c[mode]) {
        assert.ok(!seen.has(q), `"${q}" is in both ${seen.get(q)} and ${c.id} (${mode})`);
        seen.set(q, c.id);
      }
    }
  }
});
