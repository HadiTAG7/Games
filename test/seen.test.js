'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SeenGame } = require('../src/games/seen');
const { GameError } = require('../src/errors');
const { RoomManager } = require('../src/rooms');

const questions = (prefix, n = 3) => Object.fromEntries([200, 400, 600].map((v) => [v,
  Array.from({ length: n }, (_, i) => ({ q: `${prefix} ${v} سؤال ${i + 1}`, a: `${prefix}-${v}-${i + 1}` }))]));
const CATEGORIES = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => ({ id, name: `فئة ${id}`, emoji: '❓', questions: questions(id) }));
CATEGORIES.push({ id: 'short', name: 'ناقصة', emoji: '🚫', questions: { 200: [], 400: [], 600: [] } });

/** A game with a controllable clock: game.tick(ms) moves time forward. */
function newGame({ players = ['p1', 'p2', 'p3', 'p4'] } = {}) {
  let now = 1_000_000;
  const game = new SeenGame({ categories: CATEGORIES, now: () => now });
  game.tick = (ms) => { now += ms; };
  game.clock = () => now;
  players.forEach((id) => game.addPlayer(id));
  game.updateSettings({ categories: ['a', 'b', 'c', 'd', 'e', 'f'] });
  return game;
}

function started() {
  const game = newGame();
  game.start();
  return game;
}

/** Picks the first unplayed tile worth `value` and shows its question. */
function ask(game, value = 200, before = []) {
  const tile = game.board.flatMap((c) => c.tiles).find((t) => !t.wonBy && t.value === value);
  game.pick(tile.id);
  for (const name of before) game.lifeline(name);
  game.showQuestion();
  return tile;
}

test('categories without enough questions are left out; the host picks six', () => {
  const game = newGame();
  assert.ok(!game.categories.some((c) => c.id === 'short'));
  assert.equal(new SeenGame({ categories: CATEGORIES }).settings.categories.length, 6);
  game.updateSettings({ categories: ['a', 'a', 'b', 'nope'] });
  assert.deepEqual(game.settings.categories, ['a', 'b']);
  assert.throws(() => game.start(), /اختر 6 فئات/);
  game.updateSettings({ randomCategories: true });
  assert.equal(new Set(game.settings.categories).size, 6);
  game.updateSettings({ turnSeconds: 45, stealSeconds: 20 });
  assert.deepEqual([game.settings.turnSeconds, game.settings.stealSeconds], [45, 20]);
  game.updateSettings({ turnSeconds: 7 });
  assert.equal(game.settings.turnSeconds, 45);
});

test('a game needs a player on each team', () => {
  const game = newGame({ players: ['p1'] });
  assert.throws(() => game.start(), /كل فريق/);
  game.addPlayer('p2');
  game.start();
  assert.equal(game.phase, 'board');
});

test('the board has six categories with two questions of each value', () => {
  const game = started();
  assert.equal(game.board.length, 6);
  for (const column of game.board) {
    assert.deepEqual(column.tiles.map((t) => t.value), [200, 200, 400, 400, 600, 600]);
    const indexes = column.tiles.filter((t) => t.value === 200).map((t) => t.index);
    assert.notEqual(indexes[0], indexes[1]);
  }
  assert.equal(game.tilesLeft(), 36);
});

test('a correct answer scores the question and the turn passes', () => {
  const game = started();
  assert.equal(game.turn, 'red');
  const tile = ask(game, 400);
  assert.equal(game.phase, 'question');
  assert.equal(game.current.endsAt, game.clock() + 60_000);
  game.judge(true);
  assert.equal(game.phase, 'reveal');
  assert.deepEqual(game.score, { red: 400, blue: 0 });
  assert.equal(tile.wonBy, 'red');
  game.next();
  assert.equal(game.phase, 'board');
  assert.equal(game.turn, 'blue');
  assert.throws(() => game.pick(tile.id), /انلعب/);
});

test('a miss gives the other team a shorter turn to steal the plain points', () => {
  const game = started();
  const tile = ask(game, 600, ['double']);
  game.judge(false);
  assert.equal(game.phase, 'steal');
  assert.equal(game.current.endsAt, game.clock() + 30_000);
  game.judge(true);
  assert.deepEqual(game.score, { red: 0, blue: 600 }, 'a steal is never doubled');
  assert.equal(tile.wonBy, 'blue');
  game.next();
  assert.equal(game.turn, 'blue', 'the turn passes from the team that picked');
});

test('nobody scores when both teams miss', () => {
  const game = started();
  const tile = ask(game);
  game.judge(false);
  game.judge(false);
  assert.deepEqual(game.score, { red: 0, blue: 0 });
  assert.equal(tile.wonBy, 'none');
  assert.deepEqual(game.current.result, { winner: null, gain: 0, pit: 0 });
});

test('الحفرة takes the points from the other team, دبل doubles them, both once', () => {
  const game = started();
  ask(game, 200, ['pit', 'double']);
  game.judge(true);
  assert.deepEqual(game.score, { red: 400, blue: -400 });
  assert.deepEqual(game.current.result, { winner: 'red', gain: 400, pit: 400 });
  game.next();
  ask(game); // blue
  game.judge(false);
  game.judge(false);
  game.next();
  const tile = game.board.flatMap((c) => c.tiles).find((t) => !t.wonBy);
  game.pick(tile.id);
  assert.throws(() => game.lifeline('pit'), /استخدم/);
  assert.deepEqual([...game.lifelines.red].sort(), ['call', 'two']);
});

test('helps picked before the question can be dropped until it shows', () => {
  const game = started();
  const tile = game.board[0].tiles[0];
  game.pick(tile.id);
  game.lifeline('pit');
  game.lifeline('pit');
  assert.equal(game.current.before.size, 0);
  game.lifeline('double');
  game.cancelPick();
  assert.equal(game.phase, 'board');
  assert.ok(game.lifelines.red.has('double'), 'nothing used until the question shows');
  assert.throws(() => game.lifeline('two'), GameError);
});

test('جاوب جوابين and اتصال بصديق are used once the question is up; the call gets 30 seconds', () => {
  const game = started();
  const tile = game.board[0].tiles[0];
  game.pick(tile.id);
  assert.throws(() => game.lifeline('call'), /بعد ما يطلع السؤال/);
  game.showQuestion();
  assert.throws(() => game.lifeline('pit'), /قبل ما يطلع السؤال/);
  game.tick(50_000);
  game.lifeline('call');
  assert.equal(game.current.endsAt, game.clock() + 30_000);
  game.lifeline('two');
  assert.deepEqual([...game.current.during], ['call', 'two']);
  assert.equal(game.lifelines.red.size, 2);
  game.judge(false);
  assert.throws(() => game.lifeline('two'), GameError, 'not while the other team steals');
});

test('undo takes back the last call and restarts that clock', () => {
  const game = started();
  const tile = ask(game, 400, ['pit']);
  game.judge(false);
  game.tick(10_000);
  game.judge(true);
  assert.deepEqual(game.score, { red: 0, blue: 400 });
  game.undo();
  assert.equal(game.phase, 'steal');
  assert.deepEqual(game.score, { red: 0, blue: 0 });
  assert.equal(tile.wonBy, null);
  assert.equal(game.current.endsAt, game.clock() + 30_000);
  game.undo();
  assert.equal(game.phase, 'question');
  game.judge(true);
  assert.deepEqual(game.score, { red: 400, blue: -400 });
  assert.equal(game.lifelines.red.has('pit'), false, 'the help stays used');
  game.next();
  assert.throws(() => game.undo(), /ما فيه حكم/);
});

test('a double tap on an old screen is ignored', () => {
  const game = started();
  const tile = game.board[0].tiles[0];
  game.pick(tile.id, game.step);
  game.showQuestion(game.step);
  const { step } = game;
  game.judge(false, step);
  game.judge(false, step); // the second ❌ must not also fail the steal
  assert.equal(game.phase, 'steal');
});

test('the game ends after the last question; the leader wins and the next game flips the start', () => {
  const game = started();
  let first = true;
  while (game.phase !== 'final') {
    ask(game, game.board.flatMap((c) => c.tiles).find((t) => !t.wonBy).value);
    game.judge(first);
    if (game.phase === 'steal') game.judge(false);
    first = false;
    game.next();
  }
  assert.equal(game.tilesLeft(), 0);
  assert.equal(game.winner(), 'red');
  game.restart();
  assert.equal(game.phase, 'lobby');
  assert.equal(game.turn, 'blue');
  assert.equal(game.teams.size, 4);
});

test('new games in the same room get questions not asked before', () => {
  const game = started();
  const asked = new Set();
  const playOne = () => {
    const tile = ask(game, 200);
    const { category, question } = game.lookup(tile.id);
    asked.add(`${category.id}:${question.a}`);
    game.judge(true);
    game.next();
  };
  playOne();
  game.finish();
  game.restart();
  game.start();
  const column = game.board.find((c) => [...asked][0].startsWith(`${c.category}:`));
  const answers = column.tiles.filter((t) => t.value === 200).map((t) => `${column.category}:${game.category(column.category).questions[200][t.index].a}`);
  assert.ok(answers.every((a) => !asked.has(a)));
});

test('phones see the question but never the answer until the reveal', () => {
  const content = { seenCategories: CATEGORIES };
  const room = new RoomManager(content).create();
  const [p1, p2] = ['أحمد', 'فهد'].map((name) => room.join({ name }));
  room.setGameType('seen');
  room.game.updateSettings({ categories: ['a', 'b', 'c', 'd', 'e', 'f'] });
  room.game.start();
  const tile = room.game.board[0].tiles[0];
  room.game.pick(tile.id);
  assert.equal(room.playerView(p1.id).current.question, null, 'hidden until shown');
  room.game.showQuestion();
  const host = room.hostView();
  const phone = room.playerView(p2.id);
  assert.ok(host.current.answer);
  assert.equal(phone.current.answer, null);
  assert.equal(phone.current.question.q, host.current.question.q);
  assert.equal(phone.me.team, 'blue');
  room.game.judge(true);
  assert.equal(room.playerView(p2.id).current.answer, host.current.answer);
  assert.equal(room.hostView().board[0].tiles[0].wonBy, 'red');
});
