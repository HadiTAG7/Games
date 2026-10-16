'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OutsiderGame, POINTS } = require('../src/games/outsider');
const { RoomManager } = require('../src/rooms');

const words = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);
const CATEGORIES = [
  { id: 'places', name: 'أماكن', emoji: '🏙️', words: words('مكان', 10) },
  { id: 'food', name: 'أكلات', emoji: '🍔', words: words('أكلة', 10) },
];

function newGame(ids = ['a', 'b', 'c', 'd', 'e']) {
  const game = new OutsiderGame({ categories: CATEGORIES });
  ids.forEach((id) => game.addPlayer(id));
  return game;
}

/** Plays the round up to the vote. */
function toVote(game) {
  game.begin();
  game.openVote();
}

const insiders = (game) => game.round.players.filter((id) => !game.round.outsiders.includes(id));

test('a round picks a word, one outsider, and a circle of questions', () => {
  const game = newGame();
  game.start();
  assert.equal(game.phase, 'roles');
  const { round } = game;
  assert.equal(round.outsiders.length, 1);
  assert.equal(round.players.length, 5);
  assert.ok(game.category(round.categoryId).words.includes(round.word));
  // Everyone asks once and is asked once.
  assert.deepEqual(new Set(round.pairs.map((p) => p.asker)).size, 5);
  assert.deepEqual(new Set(round.pairs.map((p) => p.target)).size, 5);
  assert.ok(round.pairs.every((p) => p.asker !== p.target));
  assert.equal(round.choices.length, 8);
  assert.ok(round.choices.includes(round.word));
});

test('nobody is the outsider two rounds running, and words do not repeat', () => {
  const game = newGame();
  game.start();
  const seen = new Set([game.round.word]);
  for (let i = 0; i < 4; i++) {
    const before = game.round.outsiders[0];
    toVote(game);
    game.closeVote();
    game.skipGuess();
    game.next();
    assert.notEqual(game.round.outsiders[0], before);
    assert.ok(!seen.has(game.round.word), 'a fresh word');
    seen.add(game.round.word);
  }
});

test('the asking goes round the circle, then free questions, then the vote', () => {
  const game = newGame(['a', 'b', 'c']);
  game.updateSettings({ freeSeconds: 60 });
  game.start();
  game.begin();
  assert.equal(game.phase, 'asking');
  game.nextAsker();
  game.nextAsker();
  assert.equal(game.round.askIndex, 2);
  game.nextAsker();
  assert.equal(game.phase, 'free');
  assert.ok(game.round.endsAt > Date.now());
  game.openVote();
  assert.equal(game.phase, 'vote');
  game.dispose();
});

test('catching the outsider: right voters score, the outsider can still guess the word', () => {
  const game = newGame();
  game.start();
  const [outsider] = game.round.outsiders;
  const [i1, i2, i3, i4] = insiders(game);
  toVote(game);
  assert.throws(() => game.vote(i1, i1), /لنفسك/);
  game.vote(i1, outsider);
  game.vote(i2, outsider);
  game.vote(i3, outsider);
  game.vote(i4, i1);
  game.vote(outsider, i2);
  game.closeVote();
  assert.equal(game.phase, 'guess');
  assert.deepEqual(game.round.result.caught, [outsider]);
  assert.throws(() => game.guess(i1, game.round.word), /برا السالفة بس/);
  game.guess(outsider, game.round.word);
  assert.equal(game.phase, 'roundOver');
  assert.deepEqual(game.round.result.gains, { [i1]: 1, [i2]: 1, [i3]: 1, [outsider]: POINTS.guess });
});

test('a tie at the top lets the outsider escape', () => {
  const game = newGame(['a', 'b', 'c', 'd']);
  game.start();
  const [outsider] = game.round.outsiders;
  const [i1, i2, i3] = insiders(game);
  toVote(game);
  game.vote(i1, outsider);
  game.vote(i2, i3);
  game.vote(i3, i2);
  game.vote(outsider, i1);
  game.closeVote();
  assert.deepEqual(game.round.result.caught, [], 'one vote each is no catch');
  const wrong = game.round.choices.find((w) => w !== game.round.word);
  game.guess(outsider, wrong);
  assert.deepEqual(game.round.result.gains, { [i1]: 1, [outsider]: POINTS.escape });
});

test('two outsiders only with seven players or more', () => {
  const small = newGame(['a', 'b', 'c', 'd', 'e', 'f']);
  small.updateSettings({ outsiders: 2 });
  small.start();
  assert.equal(small.round.outsiders.length, 1);
  const big = newGame(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  big.updateSettings({ outsiders: 2 });
  big.start();
  assert.equal(big.round.outsiders.length, 2);
  toVote(big);
  big.closeVote();
  big.guess(big.round.outsiders[0], big.round.word);
  assert.equal(big.phase, 'guess', 'waits for both guesses');
  big.guess(big.round.outsiders[1], big.round.word);
  assert.equal(big.phase, 'roundOver');
});

test('the last round leads to the final standings; double taps are ignored', () => {
  const game = newGame(['a', 'b', 'c']);
  game.updateSettings({ rounds: 3 });
  game.start();
  for (let r = 1; r <= 3; r++) {
    const { step } = game;
    game.begin(step);
    game.begin(step);
    assert.equal(game.phase, 'asking');
    game.openVote();
    game.closeVote();
    game.skipGuess();
    game.next();
  }
  assert.equal(game.phase, 'final');
  assert.equal(game.roundNumber, 3);
});

test('if the outsider leaves, the round is called off', () => {
  const game = newGame(['a', 'b', 'c', 'd']);
  game.start();
  game.removePlayer(game.round.outsiders[0]);
  assert.equal(game.phase, 'roundOver');
  assert.equal(game.round.result.aborted, true);
  game.next();
  assert.equal(game.phase, 'roles');
  assert.equal(game.round.players.length, 3);
});

test('phones see only their own card; the big screen sees neither word nor outsider', () => {
  const manager = new RoomManager({ categories: [], outsiderCategories: CATEGORIES });
  const room = manager.create();
  const players = ['أحمد', 'سارة', 'فهد', 'نورة'].map((name, i) => {
    const p = room.join({ name });
    room.connect(p.id, `s${i}`);
    return p;
  });
  room.setGameType('outsider');
  room.game.start();
  const { word, outsiders } = room.game.round;
  const host = JSON.stringify(room.hostView());
  assert.ok(!host.includes(word), 'no word on the big screen');
  assert.equal(room.hostView().round.outsiders, null);
  for (const p of players) {
    const view = room.playerView(p.id);
    const out = outsiders.includes(p.id);
    assert.equal(view.me.outsider, out);
    assert.equal(view.me.word, out ? null : word);
    if (out) assert.ok(!JSON.stringify(view).includes(word), 'the outsider never gets the word');
  }
  // Everyone connected votes: the vote closes by itself.
  room.game.begin();
  room.game.openVote();
  for (const p of players) {
    const target = players.find((q) => q.id !== p.id && outsiders.includes(q.id)) ?? players.find((q) => q.id !== p.id);
    room.outsiderVote(p.id, target.id);
  }
  assert.equal(room.game.phase, 'guess');
  assert.equal(room.hostView().round.outsiders[0].id, outsiders[0]);
  assert.ok(room.playerView(outsiders[0]).me.choices.includes(word));
});

test('«بطل السهرة» ranks the outsider game like the herd game', () => {
  const game = newGame(['a', 'b', 'c']);
  game.start();
  game.players.get('a').score = 5;
  game.players.get('b').score = 2;
  assert.deepEqual(game.nightPoints(), { a: 3, b: 2 });
});
