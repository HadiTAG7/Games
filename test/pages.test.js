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
    const count = COUNTS[id]();
    const shown = page(id).match(new RegExp(`data-count="${id}">(\\d+)<`));
    assert.ok(shown, `${id} page shows its count`);
    assert.equal(Number(shown[1]), count, `${id} page says ${shown[1]}, the data has ${count}`);
    assert.ok(home.includes(`data-theme="${id}"`) && home.includes(`>${count} `), `home tile for ${id} says ${count}`);
  }
});
