'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WhoGame, whoCategories, POINT } = require('../src/games/who');
const views = require('../src/games/who-views');
const { GroupHistory } = require('../src/groups');
const { normalizeAnswer } = require('../src/normalize');
const { RoomManager } = require('../src/rooms');

const questions = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}؟`);
const CATEGORIES = [
  { id: 'w1', name: 'عادات', questions: questions('مين أكثر واحد ينام', 10) },
  { id: 'w2', name: 'أكل', questions: questions('مين أكثر واحد ياكل', 10) },
];

function newGame(ids = ['a', 'b', 'c', 'd'], options = {}) {
  const game = new WhoGame({ categories: CATEGORIES, ...options });
  ids.forEach((id) => game.addPlayer(id));
  return game;
}

/** A room stand-in for the views: names are the ids in capitals. */
const fakeRoom = (game) => ({
  game,
  nameOf: (id) => (id && game.players.has(id) ? id.toUpperCase() : null),
  playerList: () => [...game.players.keys()].map((id) => ({ id, name: id.toUpperCase(), connected: true })),
});

test('the file\'s questions become categories in order', () => {
  const cats = whoCategories([
    { id: 'w001', q: 'س1', category: 'عادات' },
    { id: 'w002', q: 'س2', category: 'أكل' },
    { id: 'w003', q: 'س3', category: 'عادات' },
  ]);
  assert.deepEqual(cats, [
    { id: 'w1', name: 'عادات', questions: ['س1', 'س3'] },
    { id: 'w2', name: 'أكل', questions: ['س2'] },
  ]);
});

test('it needs three players, and asks as many questions as the host picked, none twice', () => {
  const game = newGame(['a', 'b']);
  assert.throws(() => game.start(), /3 لاعبين/);
  game.addPlayer('c');
  game.updateSettings({ rounds: 10 });
  game.start();
  assert.equal(game.phase, 'question');
  assert.equal(game.questions.length, 10);
  assert.equal(new Set(game.questions.map((q) => q.text)).size, 10);
  // Both categories get a turn.
  assert.deepEqual(new Set(game.questions.map((q) => q.categoryId)), new Set(['w1', 'w2']));
});

test('a vote can change until the reveal; the majority scores, and only counts are shown', () => {
  const game = newGame();
  game.start();
  game.vote('a', 'b');
  game.vote('a', 'c'); // changed their mind
  game.vote('b', 'c');
  game.vote('c', 'c'); // yourself is fine
  game.vote('d', 'a');
  game.reveal();
  assert.equal(game.phase, 'reveal');
  const { result } = game.round;
  assert.deepEqual(result.top, ['c']);
  assert.equal(result.most, 3);
  assert.deepEqual(new Set(result.guessed), new Set(['a', 'b', 'c']));
  assert.equal(game.players.get('a').score, POINT);
  assert.equal(game.players.get('d').score, 0);
  assert.throws(() => game.vote('d', 'c'), /انتهى/);

  const room = fakeRoom(game);
  const host = views.hostView(room);
  assert.deepEqual(host.round.result.tally.map((t) => [t.name, t.votes]).slice(0, 2), [['C', 3], ['A', 1]]);
  assert.deepEqual(host.round.result.top, ['C']);
  // Nothing anywhere says who voted for whom.
  const text = JSON.stringify(host);
  assert.ok(!/"voter"|"guessed"|"vote"/.test(text), text);
  const phoneA = views.playerView(room, 'a');
  assert.equal(phoneA.me.voteName, 'C');
  assert.equal(phoneA.me.guessed, true);
  assert.equal(views.playerView(room, 'd').me.guessed, false);
  assert.ok(!JSON.stringify(phoneA).includes('"guessed":["'), 'a phone sees only its own result');
});

test('a tie at the top scores everyone who voted for either; one vote each is no majority', () => {
  const game = newGame();
  game.start();
  game.vote('a', 'b');
  game.vote('c', 'b');
  game.vote('b', 'd');
  game.vote('d', 'd');
  game.reveal();
  assert.deepEqual(new Set(game.round.result.top), new Set(['b', 'd']));
  assert.equal([...game.players.values()].filter((p) => p.score === POINT).length, 4);

  game.next();
  game.vote('a', 'b');
  game.vote('b', 'c');
  game.vote('c', 'd');
  game.vote('d', 'a');
  game.reveal();
  assert.deepEqual(game.round.result.top, []);
  assert.equal(game.round.result.guessed.length, 0);
});

test('the screen shows how many voted, and everyone connected voting is what the room waits for', () => {
  const game = newGame();
  game.start();
  assert.equal(game.allVoted(['a', 'b', 'c', 'd']), false, 'nobody yet');
  game.vote('a', 'b');
  game.vote('b', 'a');
  assert.equal(views.hostView(fakeRoom(game)).round.votedCount, 2);
  assert.equal(views.hostView(fakeRoom(game)).round.voterCount, 4);
  assert.equal(game.allVoted(['a', 'b', 'c', 'd']), false);
  assert.equal(game.allVoted(['a', 'b']), true, 'c and d are offline');
});

test('a player who leaves takes their vote and the votes for them with them', () => {
  const game = newGame();
  game.start();
  game.vote('a', 'd');
  game.vote('b', 'd');
  game.vote('d', 'a');
  game.removePlayer('d');
  assert.deepEqual([...game.round.votes], []);
  assert.throws(() => game.vote('a', 'd'), /اختر واحد/);
});

test('the timer reveals by itself', async () => {
  let now = 1000;
  let timeouts = 0;
  const game = newGame(['a', 'b', 'c'], { now: () => now, onTimeout: () => { timeouts += 1; } });
  game.updateSettings({ timer: 20 });
  game.start();
  assert.equal(game.round.endsAt, 21000);
  game.clearTimer();
  // Run the clock out by hand: the scheduled reveal is what the timer would call.
  now = 21000;
  game.round.endsAt = now - 1000;
  game.scheduleTimeout();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(game.phase, 'reveal');
  assert.equal(timeouts, 1);
});

test('the end crowns each question\'s top name, and the night gets ranked points', () => {
  const game = newGame();
  game.updateSettings({ rounds: 5 });
  game.start();
  for (let i = 0; i < 5; i++) {
    game.vote('a', 'b');
    game.vote('b', 'b');
    game.vote('c', 'b');
    game.vote('d', 'a');
    game.reveal();
    game.next();
  }
  assert.equal(game.phase, 'final');
  const final = views.hostView(fakeRoom(game));
  assert.equal(final.titles.length, 5);
  assert.deepEqual(final.titles[0].names, ['B']);
  assert.equal(final.titles[0].votes, 3);
  assert.deepEqual(game.nightPoints(), { a: 3, b: 3, c: 3 });
  game.restart();
  assert.equal(game.phase, 'lobby');
  assert.equal(game.titles.length, 0);
});

test('the host\'s own questions: alone or mixed in, and never remembered for the group', () => {
  const history = new GroupHistory();
  const game = newGame(['a', 'b', 'c'], { groupHistory: history });
  game.updateSettings({ source: 'custom', customQuestions: 'مين أطول واحد؟\n\nمين أطول واحد؟\nمين أكثر واحد يضحك؟' });
  assert.deepEqual(game.settings.customQuestions, ['مين أطول واحد؟', 'مين أكثر واحد يضحك؟']);
  game.start();
  assert.equal(game.questions.length, 2);
  game.reveal();
  game.next();
  game.reveal();
  game.next();
  assert.equal(history.size, 0);

  game.restart();
  game.updateSettings({ source: 'mix', rounds: 5 });
  game.start();
  assert.equal(game.questions.filter((q) => q.custom).length, 2);
  assert.equal(game.questions.length, 5);
  assert.equal(history.size, game.questions[0].custom ? 0 : 1, 'only a bank question shown so far is remembered');
});

test('a group gets questions it has not had, recorded as they show', () => {
  const had = CATEGORIES.flatMap((c) => c.questions).slice(0, 15).map((q) => [normalizeAnswer(q), 1]);
  const history = new GroupHistory(had);
  const game = newGame(['a', 'b', 'c'], { groupHistory: history });
  game.updateSettings({ rounds: 5 });
  game.start();
  const fresh = new Set(CATEGORIES.flatMap((c) => c.questions).slice(15));
  assert.ok(game.questions.every((q) => fresh.has(q.text)), 'only the five it has not had');
  assert.equal(history.size, 16);
  assert.equal(game.unitCount(), 20);
});

test('settings only take the offered values, and not while playing', () => {
  const game = newGame();
  game.updateSettings({ rounds: 7, timer: 45, source: 'x', categories: ['w2', 'nope'] });
  assert.equal(game.settings.rounds, 8);
  assert.equal(game.settings.timer, 0);
  assert.equal(game.settings.source, 'bank');
  assert.deepEqual(game.settings.categories, ['w2']);
  game.updateSettings({ categories: [] });
  assert.throws(() => game.start(), /فئة/);
  game.updateSettings({ categories: ['w1'] });
  game.start();
  assert.ok(game.questions.every((q) => q.categoryId === 'w1'));
  assert.throws(() => game.updateSettings({ rounds: 5 }), /أثناء اللعب/);
});

test('in a room: everyone connected voting reveals, a phone leaving can too, and the group remembers the questions', () => {
  const plays = [];
  const manager = new RoomManager({ whoCategories: CATEGORIES });
  manager.onGroupPlay = (id, game, keys) => plays.push([id, game, keys]);
  const room = manager.create();
  assert.ok(room.games().some((g) => g.id === 'who' && g.name === 'مين فينا؟'));
  room.setGameType('who');
  const [a, b, c, d] = ['أحمد', 'سارة', 'فهد', 'نورة'].map((name, i) => {
    const p = room.join({ name });
    room.connect(p.id, `s${i}`);
    return p;
  });
  room.setGroup({ id: 5, name: 'ولاد خالتي', plays: {} });
  assert.equal(room.groupView().current.total, 20);
  room.game.start();
  assert.deepEqual(plays.map(([id, game, keys]) => [id, game, keys.length]), [[5, 'who', 1]], 'the first question, as it shows');
  room.whoVote(a.id, b.id);
  room.whoVote(b.id, b.id);
  room.whoVote(c.id, a.id);
  assert.equal(room.game.phase, 'question', 'Noura has not voted');
  assert.equal(room.hostView().round.votedCount, 3);
  room.disconnect(d.id, 's3');
  assert.equal(room.game.phase, 'reveal', 'everyone still here has voted');
  assert.deepEqual(room.hostView().round.result.top, ['سارة']);
  assert.equal(room.playerView(a.id).me.guessed, true);
  assert.equal(room.playerView(c.id).me.guessed, false);
  // Next question: a kick that leaves only voters behind reveals too.
  room.connect(d.id, 's4');
  room.game.next();
  room.whoVote(a.id, c.id);
  room.whoVote(b.id, c.id);
  room.whoVote(c.id, c.id);
  room.kick(d.id);
  assert.equal(room.game.phase, 'reveal');
  assert.equal(room.game.titles.length, 2);
  assert.throws(() => room.gameOf('herd'), /مو لهذي اللعبة/);
  room.dispose();
});
