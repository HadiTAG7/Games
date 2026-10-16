'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TimeGame } = require('../src/games/time');
const { GameError } = require('../src/errors');
const { RoomManager } = require('../src/rooms');

const cards = (prefix, n) => Array.from({ length: n }, (_, i) => ({ type: 'text', text: `${prefix} ${i + 1}`, answer: `${prefix}-${i + 1}` }));
const CATEGORIES = [
  { id: 'cars', name: 'سيارات', emoji: '🚗', cards: cards('سيارة', 30) },
  { id: 'food', name: 'أكلات', emoji: '🍔', cards: cards('أكلة', 30) },
  { id: 'flags', name: 'أعلام', emoji: '🏳️', cards: [{ type: 'hidden-flag', code: 'sa', answer: 'السعودية' }, { type: 'hidden-flag', code: 'fr', answer: 'فرنسا' }] },
  { id: 'empty', name: 'فاضية', emoji: '❔', cards: [] },
];

/** A game with a controllable clock: game.tick(ms) moves time forward. */
function newGame({ players = ['a', 'b', 'c', 'd'], seconds = 30 } = {}) {
  let now = 1_000_000;
  const game = new TimeGame({ categories: CATEGORIES, now: () => now, random: Math.random });
  game.tick = (ms) => { now += ms; };
  players.forEach((id) => game.addPlayer(id));
  game.updateSettings({ seconds });
  return game;
}

function playing(options) {
  const game = newGame(options);
  game.start();
  game.spin();
  game.go();
  return game;
}

test('players are split evenly into two teams and can be moved', () => {
  const game = newGame({ players: ['a', 'b', 'c', 'd', 'e'] });
  assert.deepEqual([...game.teams.values()], ['red', 'blue', 'red', 'blue', 'red']);
  game.setTeam('e', 'blue');
  assert.equal(game.teamSize('blue'), 3);
  assert.throws(() => game.setTeam('e', 'green'), GameError);
  assert.throws(() => game.setTeam('zzz', 'red'), GameError);
  game.shuffleTeams();
  assert.ok(Math.abs(game.teamSize('red') - game.teamSize('blue')) <= 1);
  game.removePlayer('a');
  assert.equal(game.teams.has('a'), false);
});

test('a game needs a player on each team and a category', () => {
  const solo = newGame({ players: ['a'] });
  assert.throws(() => solo.start(), /كل فريق/);
  const none = newGame();
  none.updateSettings({ categories: [] });
  assert.throws(() => none.start(), /فئة/);
});

test('empty categories are dropped and settings are validated', () => {
  const game = newGame();
  assert.deepEqual(game.settings.categories, ['cars', 'food', 'flags']);
  game.updateSettings({ seconds: 7, roundsToWin: 9, skipPenalty: 4, categories: ['food', 'nope'] });
  assert.equal(game.settings.seconds, 30);
  assert.equal(game.settings.roundsToWin, 3);
  assert.equal(game.settings.skipPenalty, 0);
  assert.deepEqual(game.settings.categories, ['food']);
  game.updateSettings({ seconds: 60, roundsToWin: 2, skipPenalty: 5 });
  assert.deepEqual([game.settings.seconds, game.settings.roundsToWin, game.settings.skipPenalty], [60, 2, 5]);
});

test('the wheel picks an enabled category and shows it among others', () => {
  const game = newGame();
  game.updateSettings({ categories: ['cars', 'food'] });
  game.start();
  game.spin();
  assert.equal(game.phase, 'ready');
  assert.ok(['cars', 'food'].includes(game.round.category));
  assert.ok(game.round.wheel.includes(game.round.category));
  assert.equal(game.roundNumber, 1);
  const first = game.round.category;
  game.spin(); // re-spin before starting
  assert.notEqual(game.round.category, first, 'a re-spin lands somewhere new');
  assert.equal(game.roundNumber, 1, 'a re-spin is the same round');
});

test('categories do not repeat until every enabled one has been played', () => {
  const game = newGame();
  game.updateSettings({ roundsToWin: 5, categories: ['cars', 'food', 'flags'] });
  game.start();
  const seen = [];
  for (let i = 0; i < 3; i++) {
    game.spin();
    seen.push(game.round.category);
    game.go();
    game.tick(30_000);
    game.correct(); // the clock already ran out
    game.next();
  }
  assert.deepEqual([...seen].sort(), ['cars', 'flags', 'food']);
});

test('a correct answer charges the team, stops its clock and starts the other', () => {
  const game = playing();
  assert.equal(game.round.active, 'red');
  game.tick(4_000);
  game.correct();
  assert.equal(game.round.active, 'blue');
  assert.equal(game.round.remaining.red, 26_000);
  assert.equal(game.round.remaining.blue, 30_000);
  assert.equal(game.round.position, 1);
  game.tick(10_000);
  game.correct();
  assert.equal(game.round.remaining.blue, 20_000);
  assert.equal(game.round.active, 'red');
  assert.deepEqual(game.round.log.map((e) => [e.team, e.result]), [['red', 'correct'], ['blue', 'correct']]);
});

test('skipping keeps the same team on the clock, with an optional penalty', () => {
  const game = newGame();
  game.updateSettings({ skipPenalty: 3 });
  game.start();
  game.spin();
  game.go();
  game.tick(2_000);
  game.skip();
  assert.equal(game.round.active, 'red');
  assert.equal(game.round.remaining.red, 25_000);
  assert.equal(game.round.position, 1);
  assert.equal(game.round.log[0].result, 'skip');
});

test('running out of time loses the round; the timer fires on its own', async () => {
  let now = 0;
  const game = new TimeGame({ categories: CATEGORIES, now: () => now });
  ['a', 'b'].forEach((id) => game.addPlayer(id));
  game.updateSettings({ seconds: 30 });
  let notified = false;
  game.onTimeout = () => { notified = true; };
  game.start();
  game.spin();
  game.go();
  now = 30_000;
  game.scheduleTimeout(); // re-arm with the advanced clock so the test needn't wait 30s
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(notified);
  assert.equal(game.phase, 'roundOver');
  assert.deepEqual(game.round.result, { winner: 'blue', loser: 'red', reason: 'time', stuck: game.round.deck[0].index });
  assert.deepEqual(game.score, { red: 0, blue: 1 });
});

test('a skip penalty can end the round', () => {
  const game = newGame();
  game.updateSettings({ skipPenalty: 5 });
  game.start();
  game.spin();
  game.go();
  game.tick(26_000);
  game.skip();
  assert.equal(game.phase, 'roundOver');
  assert.equal(game.round.result.winner, 'blue');
});

test('pausing stops the clock and actions wait for resume', () => {
  const game = playing();
  game.tick(5_000);
  game.pause();
  game.tick(60_000);
  assert.throws(() => game.correct(), /موقّف/);
  game.resume();
  game.tick(1_000);
  game.correct();
  assert.equal(game.round.remaining.red, 24_000);
  assert.throws(() => game.resume(), GameError);
});

test('undo restores the clocks, the turn and the picture', () => {
  const game = playing();
  game.tick(3_000);
  game.correct();
  game.tick(2_000);
  game.undo();
  assert.equal(game.round.active, 'red');
  assert.equal(game.round.remaining.red, 27_000);
  assert.equal(game.round.position, 0);
  assert.equal(game.round.log.length, 0);
  assert.throws(() => game.undo(), /ما فيه شي/);
});

test('a repeated tap on an old screen is ignored', () => {
  const game = newGame();
  game.updateSettings({ categories: ['cars'] });
  game.start();
  game.spin();
  game.go();
  const { step } = game.round;
  game.correct(step);
  game.correct(step); // double tap on «صح»
  assert.equal(game.round.position, 1);
  assert.equal(game.round.active, 'blue');
  game.pause(game.round.step);
  game.pause(game.round.step - 1);
  game.resume(game.round.step);
  game.resume(game.round.step - 1);
  assert.equal(game.round.paused, false);
  game.skip(game.round.step);
  const before = game.round.step;
  game.undo(before);
  game.undo(before); // the second undo must not take back the «صح» too
  assert.equal(game.round.position, 1);
  assert.equal(game.round.log.length, 1);
});

test('when the pictures run out, the team with more time left wins', () => {
  const game = newGame();
  game.updateSettings({ categories: ['flags'] });
  game.start();
  game.spin();
  game.go();
  game.tick(10_000);
  game.correct(); // red 20s left
  game.tick(1_000);
  game.correct(); // blue 29s left, deck empty
  assert.equal(game.phase, 'roundOver');
  assert.deepEqual([game.round.result.winner, game.round.result.reason], ['blue', 'deck']);
});

test('hidden flags get a shared random patch', () => {
  const game = newGame();
  game.updateSettings({ categories: ['flags'] });
  game.start();
  game.spin();
  game.go();
  const card = game.currentCard();
  assert.equal(card.type, 'hidden-flag');
  assert.ok(card.focus.x >= 0 && card.focus.x <= 100);
});

test('the first team to win the set number of rounds wins the game; start alternates', () => {
  const game = newGame();
  game.updateSettings({ roundsToWin: 2 });
  game.start();
  const starts = [];
  for (let i = 0; i < 2; i++) {
    game.spin();
    starts.push(game.round.startTeam);
    game.go();
    game.tick(30_000);
    game.skip(); // the starting team runs out
    if (i < 1) game.next();
  }
  assert.deepEqual(starts, ['red', 'blue']);
  assert.deepEqual(game.score, { red: 1, blue: 1 });
  assert.equal(game.matchWinner, null);
  game.next();
  game.spin();
  game.go();
  game.correct(); // red answers instantly
  game.tick(30_000);
  game.correct(); // blue is out of time
  assert.equal(game.matchWinner, 'red');
  game.next();
  assert.equal(game.phase, 'final');
});

test('ending early declares the leader; restart keeps the teams', () => {
  const game = playing();
  game.tick(30_000);
  game.skip();
  game.finish();
  assert.equal(game.phase, 'final');
  assert.equal(game.matchWinner, 'blue');
  game.restart();
  assert.equal(game.phase, 'lobby');
  assert.deepEqual(game.score, { red: 0, blue: 0 });
  assert.equal(game.teams.size, 4);
});

test('cards seen this game come back only when a category runs low', () => {
  const game = newGame();
  game.updateSettings({ categories: ['cars'], roundsToWin: 5 });
  game.start();
  game.spin();
  game.go();
  for (let i = 0; i < 5; i++) game.correct();
  const shown = game.round.deck.slice(0, 5).map((c) => c.index);
  game.tick(30_000);
  game.correct();
  game.next();
  game.spin();
  const fresh = new Set(game.round.deck.map((c) => c.index));
  assert.ok(shown.every((i) => !fresh.has(i)), 'seen cards are left out while there are enough fresh ones');
});

/* ---------- In a room ---------- */

function roomWithTime() {
  const manager = new RoomManager({ categories: [], timeCategories: CATEGORIES });
  const room = manager.create();
  const players = ['أحمد', 'سارة', 'فهد', 'نورة'].map((name, i) => {
    const p = room.join({ name });
    room.connect(p.id, `s${i}`);
    return p;
  });
  return { room, players };
}

test('switching games keeps everyone and only happens between games', () => {
  const { room, players } = roomWithTime();
  assert.equal(room.gameType, 'herd');
  room.setGameType('time');
  assert.equal(room.gameType, 'time');
  assert.equal(room.game.teams.size, 4);
  assert.throws(() => room.setGameType('chess'), GameError);
  assert.throws(() => room.setGameType('toString'), GameError);
  room.game.start();
  assert.throws(() => room.setGameType('herd'), /خلّص/);
  assert.throws(() => room.submitAnswer(players[0].id, { text: 'x', value: 1 }), /مو لهذي اللعبة/);
  room.game.finish();
  room.setGameType('herd');
  assert.equal(room.game.players.size, 4);
});

test('only the host sees the answer while a round runs; everyone sees the recap', () => {
  const { room, players } = roomWithTime();
  room.setGameType('time');
  room.game.updateSettings({ categories: ['cars'] });
  room.game.start();
  room.game.spin();
  assert.equal(room.hostView().phase, 'ready');
  assert.ok(Array.isArray(room.playerView(players[0].id).round.preload));
  room.game.go();
  const host = room.hostView();
  const player = room.playerView(players[0].id);
  assert.equal(host.gameType, 'time');
  assert.ok(host.round.card.answer.startsWith('سيارة-'));
  assert.equal(player.round.card.answer, undefined);
  assert.equal(player.round.card.text, host.round.card.text);
  assert.equal(player.me.team, 'red');
  assert.deepEqual(host.teams.red.map((p) => p.name), ['أحمد', 'فهد']);
  room.game.correct();
  room.game.skip();
  room.game.finish();
  room.game.phase = 'roundOver'; // look at the recap the way the end of a round shows it
  room.game.round.result = { winner: 'red', loser: 'blue', reason: 'time', stuck: null };
  const recap = room.playerView(players[1].id).round.recap;
  assert.deepEqual(recap.map((r) => r.result), ['correct', 'skip']);
  assert.ok(recap.every((r) => r.answer));
});
