'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { GAMES } = require('../src/rooms');

const page = (name) => fs.readFileSync(path.join(__dirname, '..', 'public', `${name}.html`), 'utf8');

// How much content each game page says it has.
const COUNTS = {
  herd: () => require('../data/questions.json').categories
    .flatMap((c) => c.subcategories).reduce((n, s) => n + s.same.length + s.different.length, 0),
  time: () => require('../data/time-challenge.json').categories.reduce((n, c) => n + c.cards.length, 0),
  seen: () => require('../data/seen-jeem.json').categories
    .reduce((n, c) => n + Object.values(c.questions).reduce((m, list) => m + list.length, 0), 0),
  letters: () => require('../data/letters.json').letters.reduce((n, l) => n + l.questions.length, 0),
  outsider: () => require('../data/outsider.json').categories.reduce((n, c) => n + c.words.length, 0),
  feud: () => require('../data/feud.json').questions.length,
  who: () => require('../data/who.json').questions.length,
};

test('every game has its own themed page with a create-room button', () => {
  const home = page('index');
  for (const id of Object.keys(GAMES)) {
    const html = page(id);
    assert.match(html, new RegExp(`<body data-theme="${id}">`), id);
    assert.ok(html.includes(`href="/host?new=1&amp;game=${id}"`), `${id} page creates a room`);
    assert.ok(home.includes(`href="/${id}"`), `the home page links to /${id}`);
  }
});

test('the counts on the pages match the question files', () => {
  const home = page('index');
  for (const id of Object.keys(GAMES)) {
    if (!COUNTS[id]) continue; // «مافيا» has no question file
    const count = COUNTS[id]();
    const shown = page(id).match(new RegExp(`data-count="${id}">(\\d+)<`));
    assert.ok(shown, `${id} page shows its count`);
    assert.equal(Number(shown[1]), count, `${id} page says ${shown[1]}, the data has ${count}`);
    assert.ok(home.includes(`data-theme="${id}"`) && home.includes(`>${count} `), `home tile for ${id} says ${count}`);
  }
});

test('the interface uses line icons, not emoji (scripts/check_emoji.js)', () => {
  const { leftovers } = require('../scripts/check_emoji');
  assert.deepEqual(leftovers(), []);
});

test('every icon the pages and scripts ask for is in icons.svg', () => {
  const fs = require('fs');
  const path = require('path');
  const pub = path.join(__dirname, '..', 'public');
  const sprite = fs.readFileSync(path.join(pub, 'icons.svg'), 'utf8');
  const have = new Set([...sprite.matchAll(/<symbol id="i-([\w-]+)"/g)].map((m) => m[1]));
  const wanted = new Set();
  for (const dir of ['', 'js']) {
    for (const file of fs.readdirSync(path.join(pub, dir)).filter((f) => /\.(html|js)$/.test(f))) {
      const text = fs.readFileSync(path.join(pub, dir, file), 'utf8');
      for (const m of text.matchAll(/icons\.svg#i-([\w-]+)|\bicon\('([\w-]+)'/g)) wanted.add(m[1] ?? m[2]);
      for (const m of text.matchAll(/\bicon: '([\w-]+)'|: '([\w-]+)' \/\/ icon/g)) wanted.add(m[1] ?? m[2]);
    }
  }
  const missing = [...wanted].filter((name) => !have.has(name));
  assert.deepEqual(missing, [], `add them to scripts/build_icons.py: ${missing.join(' ')}`);
});
