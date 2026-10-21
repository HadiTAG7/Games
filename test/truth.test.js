'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TruthGame, truthCategories, parseCustom, POINTS } = require('../src/games/truth');
const views = require('../src/games/truth-views');
const { GroupHistory } = require('../src/groups');
const { RoomManager } = require('../src/rooms');

const statements = (prefix, n, start = 0) => Array.from({ length: n }, (_, i) => ({
  id: `${prefix}${start + i}`, s: `عبارة ${prefix} رقم ${i + 1}`, a: i % 2 === 0, why: i % 2 === 0 ? 'نعم، لأن…' : 'لا، لأن…',
}));
const CATEGORIES = [
  { id: 't1', name: 'علوم', statements: statements('s', 12) },
  { id: 't2', name: 'جغرافيا', statements: statements('g', 12) },
];

/** A game on a hand-turned clock. */
function newGame(ids = ['a', 'b', 'c'], options = {}) {
  const clock = { now: 1_000_000 };
  const game = new TruthGame({ categories: CATEGORIES, now: () => clock.now, ...options });
  ids.forEach((id) => game.addPlayer(id));
  return { game, clock };
}

const fakeRoom = (game) => ({
  game,
  nameOf: (id) => (id && game.players.has(id) ? id.toUpperCase() : null),
  playerList: () => [...game.players.keys()].map((id) => ({ id, name: id.toUpperCase(), connected: true })),
});

test('the file\'s statements become categories in order', () => {
  const cats = truthCategories([
    { id: 't001', s: 'أ', a: true, why: 'نعم', category: 'السعودية' },
    { id: 't002', s: 'ب', a: false, why: 'لا', category: 'فضاء' },
    { id: 't003', s: 'ج', a: true, why: 'نعم', category: 'السعودية' },
  ]);
  assert.deepEqual(cats.map((c) => [c.id, c.name, c.statements.map((s) => s.id)]), [['t1', 'السعودية', ['t001', 't003']], ['t2', 'فضاء', ['t002']]]);
});

test('a right answer scores 500 plus up to 500 for speed; wrong or none scores nothing', () => {
  const { game, clock } = newGame(['a', 'b', 'c', 'd']);
  game.updateSettings({ seconds: 10 });
  game.start();
  game.clearTimer();
  const right = game.round.statement.a;
  game.answer('a', right); // straight away: 1000
  clock.now += 4000;
  game.answer('b', right); // 6 s left of 10: 500 + 300
  clock.now += 6000;
  game.answer('c', !right); // wrong
  game.reveal();
  assert.deepEqual(game.round.result.gains, { a: POINTS.right + POINTS.speed, b: 800 });
  assert.deepEqual([...game.players].map(([id, p]) => [id, p.score]), [['a', 1000], ['b', 800], ['c', 0], ['d', 0]]);
  const view = views.hostView(fakeRoom(game));
  assert.equal(view.round.result.answer, right);
  assert.equal(view.round.result.none, 1);
  assert.equal(view.round.result.rightCount, 2);
  assert.deepEqual(view.round.result.best.map((r) => [r.name, r.points]), [['A', 1000], ['B', 800]]);
  assert.deepEqual(view.standings.map((r) => [r.name, r.gained]), [['A', 1000], ['B', 800], ['C', 0], ['D', 0]]);
  const phone = views.playerView(fakeRoom(game), 'c');
  assert.equal(phone.me.right, false);
  assert.equal(phone.me.gained, 0);
});

test('the first tap is the answer, and none after the clock runs out', () => {
  const { game, clock } = newGame();
  game.start();
  game.clearTimer();
  game.answer('a', true);
  assert.throws(() => game.answer('a', false), /جاوبت خلاص/);
  assert.throws(() => game.answer('b', 'yes'), /صح أو خطأ/);
  clock.now += 10_400; // inside the grace: the base points only
  game.answer('b', game.round.statement.a);
  clock.now += 1000;
  assert.throws(() => game.answer('c', true), /خلص/);
  game.reveal();
  assert.equal(game.round.result.gains.b, POINTS.right);
});

test('nobody sees the answer before the reveal', () => {
  const { game } = newGame();
  game.start();
  game.clearTimer();
  game.answer('a', true);
  const room = fakeRoom(game);
  const host = views.hostView(room);
  assert.equal(host.round.result, null);
  assert.equal(host.round.answeredCount, 1);
  const { why } = game.round.statement;
  assert.ok(!JSON.stringify(host).includes(why), 'no why on the TV');
  const phone = views.playerView(room, 'a');
  assert.equal(phone.me.answer, true);
  assert.equal(phone.me.right, null);
  assert.ok(!JSON.stringify(phone).includes(why));
  assert.ok(!/"answer":(true|false),"why"/.test(JSON.stringify(phone)));
});

test('the timer reveals by itself', async () => {
  const { game } = newGame(['a', 'b'], { now: Date.now, onTimeout: () => { game.timedOut = true; } });
  game.start();
  game.round.endsAt = Date.now() - 1000; // run the clock out
  game.scheduleTimeout();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(game.phase, 'reveal');
  assert.equal(game.timedOut, true);
});

test('statements come from the chosen categories, none twice, as many as picked', () => {
  const { game } = newGame();
  game.updateSettings({ rounds: 20, categories: ['t1', 't2'] });
  game.start();
  assert.equal(game.statements.length, 20);
  assert.equal(new Set(game.statements.map((s) => s.id)).size, 20);
  assert.deepEqual(new Set(game.statements.map((s) => s.categoryId)), new Set(['t1', 't2']));
  game.finish();
  game.restart();
  game.updateSettings({ rounds: 10, categories: ['t2'] });
  game.start();
  assert.ok(game.statements.every((s) => s.categoryId === 't2'));
  assert.throws(() => game.updateSettings({ rounds: 15 }), /أثناء اللعب/);
});

test('the host\'s own statements: «العبارة | صح» or «| خطأ», alone or mixed in', () => {
  assert.deepEqual(parseCustom('1. الشمس نجم | صح\n- القمر كوكب | خطأ\nبدون جواب\nالرياض عاصمة | يمكن\nالشمس نجم | صح'), {
    items: [{ s: 'الشمس نجم', a: true }, { s: 'القمر كوكب', a: false }],
    bad: 2,
  });
  const history = new GroupHistory();
  const { game } = newGame(['a', 'b'], { groupHistory: history });
  game.updateSettings({ source: 'custom', custom: 'الشمس نجم | صح\nالقمر كوكب | غلط' });
  game.start();
  assert.equal(game.statements.length, 2);
  assert.ok(game.statements.every((s) => s.custom && s.why === null));
  assert.equal(history.size, 0, 'the host\'s own are not remembered');
  game.finish();
  game.restart();
  game.updateSettings({ source: 'mix', rounds: 10 });
  game.start();
  assert.equal(game.statements.filter((s) => s.custom).length, 2);
  assert.equal(game.statements.length, 10);
  game.finish();
  game.restart();
  game.updateSettings({ source: 'custom', custom: '' });
  assert.throws(() => game.start(), /عبارة وحدة/);
});

test('a group gets statements it has not had, recorded as they show', () => {
  const had = [...CATEGORIES[0].statements, ...CATEGORIES[1].statements].slice(0, 14).map((s) => [s.id, 1]);
  const history = new GroupHistory(had);
  const { game } = newGame(['a', 'b'], { groupHistory: history });
  game.updateSettings({ rounds: 10 });
  game.start();
  game.clearTimer();
  const fresh = new Set([...CATEGORIES[0].statements, ...CATEGORIES[1].statements].slice(14).map((s) => s.id));
  assert.ok(game.statements.every((s) => fresh.has(s.id)), 'only the ten it has not had');
  assert.equal(history.size, 15);
  assert.equal(game.unitCount(), 24);
});

test('in a room: everyone connected answering reveals, the end ranks the night', () => {
  const manager = new RoomManager({ truthCategories: CATEGORIES });
  const room = manager.create();
  assert.ok(room.games().some((g) => g.id === 'truth' && g.name === 'صح ولا خطأ'));
  room.setGameType('truth');
  const [a, b, c] = ['أحمد', 'سارة', 'فهد'].map((name, i) => {
    const p = room.join({ name });
    room.connect(p.id, `s${i}`);
    return p;
  });
  room.game.updateSettings({ rounds: 10 });
  room.game.start();
  const right = room.game.round.statement.a;
  room.truthAnswer(a.id, right);
  room.truthAnswer(b.id, !right);
  assert.equal(room.game.phase, 'statement');
  room.disconnect(c.id, 's2');
  assert.equal(room.game.phase, 'reveal', 'everyone still here has answered');
  assert.ok(room.playerView(a.id).me.gained >= POINTS.right);
  assert.equal(room.playerView(b.id).me.right, false);
  room.game.finish();
  assert.deepEqual(room.game.nightPoints(), { [a.id]: 3 });
  room.dispose();
});
