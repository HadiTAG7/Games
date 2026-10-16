'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAnswer } = require('../src/normalize');

test('hamza, tashkeel, tatweel and the article do not split answers', () => {
  const key = normalizeAnswer('احمر');
  for (const variant of ['الأحمر', 'أحمر', 'أحمرْ', ' أحمـــر! ', 'إحمر']) {
    assert.equal(normalizeAnswer(variant), key, variant);
  }
});

test('taa marbuta and alef maqsura match their common spellings', () => {
  assert.equal(normalizeAnswer('مكة'), normalizeAnswer('مكه'));
  assert.equal(normalizeAnswer('مستشفى'), normalizeAnswer('مستشفي'));
});

test('Arabic digits and latin case are unified', () => {
  assert.equal(normalizeAnswer('١٢'), '12');
  assert.equal(normalizeAnswer('RED '), normalizeAnswer('red'));
});

test('different answers stay different', () => {
  assert.notEqual(normalizeAnswer('أحمر'), normalizeAnswer('أزرق'));
});

test('emoji-only answers still produce a key', () => {
  assert.equal(normalizeAnswer('🍎'), '🍎');
  assert.equal(normalizeAnswer(undefined), '');
});
