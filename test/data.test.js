'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { categories } = require('../data/questions.json');
const { MODES } = require('../src/games/herd');

test('every category and subcategory is well formed with prompts for both modes', () => {
  const ids = new Set();
  for (const c of categories) {
    assert.match(c.id, /^[a-z]+$/);
    assert.ok(c.name && c.emoji, c.id);
    assert.ok(!ids.has(c.id), `duplicate id ${c.id}`);
    ids.add(c.id);
    assert.ok(c.subcategories.length >= 2, `${c.id} needs subcategories`);
    for (const sub of c.subcategories) {
      assert.match(sub.id, new RegExp(`^${c.id}-[a-z]+$`));
      assert.ok(!ids.has(sub.id), `duplicate id ${sub.id}`);
      ids.add(sub.id);
      assert.ok(sub.name, sub.id);
      assert.ok(sub.same.length >= 12, `${sub.id} needs 12+ prompts for same`);
      assert.ok(sub.different.length >= 6, `${sub.id} needs 6+ prompts for different`);
      for (const mode of MODES) {
        for (const q of sub[mode]) assert.ok(typeof q === 'string' && q.trim() === q && q.length > 0, `${sub.id}: "${q}"`);
      }
    }
  }
});

test('no prompt is listed twice within a mode', () => {
  for (const mode of MODES) {
    const seen = new Map();
    for (const c of categories) {
      for (const sub of c.subcategories) {
        for (const q of sub[mode]) {
          assert.ok(!seen.has(q), `"${q}" is in both ${seen.get(q)} and ${sub.id} (${mode})`);
          seen.set(q, sub.id);
        }
      }
    }
  }
});
