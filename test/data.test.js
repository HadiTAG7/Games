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

/* ---------- «تحدي الوقت» cards ---------- */

const timeChallenge = require('../data/time-challenge.json');
const fs = require('node:fs');
const path = require('node:path');

test('«تحدي الوقت» has 50 well-formed categories with enough cards', () => {
  const ids = new Set();
  assert.equal(timeChallenge.categories.length, 50);
  for (const c of timeChallenge.categories) {
    assert.match(c.id, /^[a-z-]+$/);
    assert.ok(!ids.has(c.id), `duplicate id ${c.id}`);
    ids.add(c.id);
    assert.ok(c.name && c.emoji, c.id);
    assert.ok(c.cards.length >= 15, `${c.id} needs 15+ cards`);
    for (const card of c.cards) {
      assert.ok(typeof card.answer === 'string' && card.answer.trim(), `${c.id}: card without answer`);
      const local = card.src?.startsWith('/tc/');
      if (local) assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', card.src)), card.src);
      if (card.type === 'image') {
        // Remote pictures ask for a standard thumbnail size, so Commons hands out a resized copy.
        if (!local) assert.match(card.src, /^https:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\/[^?]+\?width=(500|330|250)$/);
      } else if (card.type === 'map') assert.ok(local, card.src);
      else if (card.type === 'flag' || card.type === 'hidden-flag') {
        assert.ok(fs.existsSync(path.join(__dirname, '..', 'node_modules', 'flag-icons', 'flags', '4x3', `${card.code}.svg`)), card.code);
      } else if (card.type === 'emoji') assert.ok(card.emoji);
      else if (card.type === 'text') assert.ok(card.text);
      else assert.fail(`${c.id}: unknown card type ${card.type}`);
    }
  }
});
