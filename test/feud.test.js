'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FeudGame, matchAnswer, FAST_QUESTIONS } = require('../src/games/feud');
const { RoomManager } = require('../src/rooms');

const question = (id, n = 6) => ({
  id,
  q: `سؤال ${id}`,
  answers: Array.from({ length: n }, (_, i) => ({ a: `جواب ${id}-${i}`, points: 40 - i * 5, alt: [`بديل ${id}-${i}`] })),
});
const QUESTIONS = Array.from({ length: 12 }, (_, i) => question(`q${i}`));

/** A game with red: a, c and blue: b, d. */
function newGame(options = {}) {
  let now = 1_000_000;
  const game = new FeudGame({ categories: QUESTIONS, random: () => 0.3, now: () => now });
  game.tick = (ms) => { now += ms; };
  ['a', 'b', 'c', 'd'].forEach((id) => game.addPlayer(id));
  game.updateSettings({ rounds: 3, fastMoney: false, ...options });
  return game;
}

/** Face-off won by `team` with the top answer, then that team plays. */
function controlTo(game, team) {
  const f = game.round.faceoff;
  game.buzz(f.players[team]);
  game.reveal(0);
  assert.equal(game.phase, 'choose');
  game.choose(true);
}

test('matching typed answers: spelling, «ال», alternatives, and longer phrases', () => {
  const answers = [{ a: 'شاي', alt: ['شاهي'] }, { a: 'قهوة', alt: [] }, { a: 'كبسة', alt: [] }];
  assert.equal(matchAnswer('الشاي', answers), 0);
  assert.equal(matchAnswer('شاهي', answers), 0);
  assert.equal(matchAnswer('قهوه', answers), 1, 'ه / ة');
  assert.equal(matchAnswer('كبسة دجاج', answers), 2);
  assert.equal(matchAnswer('ماء', answers), null);
  assert.equal(matchAnswer('', answers), null);
});

test('face-off: the top answer wins control at once; the buzzer is only for the two facing off', () => {
  const game = newGame();
  game.start();
  assert.equal(game.phase, 'faceoff');
  const { players } = game.round.faceoff;
  assert.equal(game.teams.get(players.red), 'red');
  assert.equal(game.teams.get(players.blue), 'blue');
  const outsider = ['a', 'c'].find((id) => id !== players.red);
  assert.throws(() => game.buzz(outsider), /المواجهة/);
  assert.throws(() => game.reveal(0), /البازر/);
  game.buzz(players.blue);
  assert.throws(() => game.buzz(players.red), /سبقك/);
  game.reveal(0);
  assert.equal(game.round.control, 'blue');
  assert.equal(game.phase, 'choose');
});

test('face-off: otherwise the other side answers and the better answer wins; two misses buzz again', () => {
  const game = newGame();
  game.start();
  game.hostBuzz('red');
  game.reveal(3);
  assert.equal(game.round.faceoff.turn, 'blue', 'not the top answer: blue answers');
  game.reveal(1);
  assert.equal(game.round.control, 'blue', 'slot 1 beats slot 3');
  game.undo();
  game.miss();
  assert.equal(game.round.control, 'red', 'blue missed: red keeps it');

  const g2 = newGame();
  g2.start();
  g2.hostBuzz('blue');
  g2.miss();
  g2.miss();
  assert.equal(g2.phase, 'faceoff');
  assert.equal(g2.round.faceoff.buzz, null, 'both missed: buzz again');
});

test('play: answers fill the pot; three strikes and the other team steals, or not', () => {
  const game = newGame();
  game.start();
  controlTo(game, 'red');
  game.reveal(1);
  assert.equal(game.pot(), 40 + 35);
  game.miss();
  game.miss();
  assert.equal(game.phase, 'play');
  game.miss();
  assert.equal(game.phase, 'steal');
  game.reveal(2); // blue gets it
  assert.equal(game.phase, 'roundOver');
  assert.deepEqual(game.round.result, { winner: 'blue', points: 40 + 35 + 30, reason: 'steal' });
  assert.deepEqual(game.score, { red: 0, blue: 105 });

  game.next();
  controlTo(game, 'blue');
  game.miss();
  game.miss();
  game.miss();
  game.miss(); // red's steal misses
  assert.deepEqual(game.round.result, { winner: 'blue', points: 40, reason: 'held' });
});

test('passing gives the board to the other team; clearing it wins the pot; the last round counts double', () => {
  const game = newGame({ rounds: 3 });
  game.start();
  const f = game.round.faceoff;
  game.buzz(f.players.red);
  game.reveal(0);
  game.choose(false);
  assert.equal(game.round.playing, 'blue');
  for (let i = 1; i < 6; i++) game.reveal(i);
  assert.equal(game.round.result.reason, 'cleared');
  assert.equal(game.score.blue, 40 + 35 + 30 + 25 + 20 + 15);
  game.next();
  assert.equal(game.multiplier(), 1);
  controlTo(game, 'red');
  game.miss(); game.miss(); game.miss(); game.miss();
  game.next();
  assert.equal(game.roundNumber, 3);
  assert.equal(game.multiplier(), 2);
  controlTo(game, 'red');
  assert.equal(game.pot(), 80, 'the top answer, doubled');
});

test('the game ends after the last round; a tie has no winner; no repeats of questions in the room', () => {
  const game = newGame({ rounds: 3 });
  game.start();
  const asked = new Set();
  for (let r = 0; r < 3; r++) {
    asked.add(game.round.question.id);
    controlTo(game, 'red');
    game.miss(); game.miss(); game.miss(); game.miss();
    game.next();
  }
  assert.equal(asked.size, 3);
  assert.equal(game.phase, 'final');
  assert.equal(game.matchWinner, 'red');
  assert.deepEqual(Object.keys(game.nightPoints()).sort(), ['a', 'c']);
  game.restart();
  game.start();
  assert.ok(!asked.has(game.round.question.id), 'a new game asks new questions');
});

test('no phones: no players needed; the host says who buzzed', () => {
  const game = new FeudGame({ categories: QUESTIONS });
  assert.throws(() => game.start(), /كل فريق/);
  game.updateSettings({ phones: false, teamNames: { red: ' الشباب ', blue: 'البنات' } });
  assert.deepEqual(game.settings.teamNames, { red: 'الشباب', blue: 'البنات' });
  game.start();
  assert.deepEqual(game.round.faceoff.players, { red: null, blue: null });
  game.hostBuzz('blue');
  game.reveal(0);
  assert.equal(game.round.control, 'blue');
  assert.throws(() => game.updateSettings({ rounds: 5 }), /أثناء اللعب/);
});

/** Plays three rounds that red wins, with «المال السريع» on. */
function toFastMoney() {
  const game = newGame({ fastMoney: true, rounds: 3 });
  game.start();
  for (let r = 0; r < 3; r++) {
    controlTo(game, 'red');
    game.miss(); game.miss(); game.miss(); game.miss();
    game.next();
  }
  return game;
}

test('«المال السريع»: two players, typed answers matched, the second can\'t repeat, 200 wins', async () => {
  const game = toFastMoney();
  assert.equal(game.phase, 'fastSetup');
  assert.equal(game.fast.team, 'red');
  assert.equal(game.fast.questions.length, FAST_QUESTIONS);
  assert.equal(new Set(game.fast.questions.map((q) => q.id)).size, FAST_QUESTIONS, 'five different questions');
  assert.throws(() => game.setFastPlayer(0, 'b'), /الفريق الفايز/);
  game.setFastPlayer(0, 'a');
  game.setFastPlayer(1, 'c');
  game.startFast();
  assert.equal(game.phase, 'fast');
  assert.throws(() => game.fastUpdate('c', []), /مو دورك/);
  const q = game.fast.questions;
  game.fastUpdate('a', [q[0].answers[0].a, `ال${q[1].answers[1].a}`, q[2].answers[0].alt[0], 'ولا شي', '']);
  game.fastDone('a');
  assert.equal(game.phase, 'fastReview');
  assert.deepEqual(game.fast.matches[0], [0, 1, 0, null, null]);
  game.fastMark(0, 3, 4); // the host says «ولا شي» counts as slot 4
  assert.equal(game.fastPoints(0, 3), 20);
  assert.throws(() => game.startFast(), /اكشف/);
  for (let i = 0; i < FAST_QUESTIONS; i++) game.next();
  game.startFast();
  assert.equal(game.fast.stage, 1);
  const out = game.fastUpdate('c', [q[0].answers[0].a, q[1].answers[0].a, q[2].answers[1].a, q[3].answers[0].a, q[4].answers[0].a]);
  assert.deepEqual(out.duplicates, [0], 'the same first answer: try another');
  assert.equal(game.fast.answers[1][0], '');
  // The clock runs out instead of «خلصت».
  game.tick(25_000 + 1_000);
  game.endFastStage();
  assert.equal(game.phase, 'fastReview');
  for (let i = 0; i < FAST_QUESTIONS; i++) game.next();
  game.next();
  assert.equal(game.phase, 'final');
  const expected = (40 + 35 + 40 + 20) + (0 + 40 + 35 + 40 + 40);
  assert.equal(game.fast.total, expected);
  assert.equal(game.fast.won, true);
  game.dispose();
});

test('screens: the TV/host get every answer; phones only open ones; the first fast answers stay hidden', () => {
  const room = new RoomManager({ feudQuestions: QUESTIONS }).create();
  const players = ['أحمد', 'سارة', 'فهد', 'نورة'].map((name) => room.join({ name }));
  room.setGameType('feud');
  room.game.updateSettings({ rounds: 3 });
  room.game.start();
  const host = room.hostView();
  const phone = room.playerView(players[0].id);
  assert.ok(host.round.slots.every((s) => s.a));
  assert.ok(phone.round.slots.every((s) => s.a === null && s.points === null));
  room.game.hostBuzz('red');
  room.game.reveal(2);
  const after = room.playerView(players[1].id).round.slots;
  assert.deepEqual(after.filter((s) => s.a).map((s) => s.index), [2]);
  room.game.miss();
  room.game.choose(true);
  room.game.miss(); room.game.miss(); room.game.miss(); room.game.miss();
  assert.ok(room.playerView(players[1].id).round.slots.every((s) => s.a), 'the whole board shows when the round ends');
  room.dispose();
});

test('the question bank: 5–8 answers, best first, at most 100 points, and every typed answer means one thing', () => {
  const { questions } = require('../data/feud.json');
  assert.ok(questions.length >= 140);
  assert.equal(new Set(questions.map((q) => q.id)).size, questions.length);
  assert.ok(questions.filter((q) => q.answers.length >= FAST_QUESTIONS).length >= FAST_QUESTIONS, 'enough for «المال السريع»');
  for (const q of questions) {
    assert.ok(q.q && q.answers.length >= 5 && q.answers.length <= 8, q.id);
    const points = q.answers.map((a) => a.points);
    assert.ok(points.every((p, i) => Number.isInteger(p) && p > 0 && (i === 0 || p < points[i - 1])), `${q.id} best first`);
    assert.ok(points.reduce((a, b) => a + b) <= 100, `${q.id} total`);
    q.answers.forEach((ans, i) => {
      assert.equal(matchAnswer(ans.a, q.answers), i, `${q.id}: «${ans.a}»`);
      for (const alt of ans.alt) assert.equal(matchAnswer(alt, q.answers), i, `${q.id}: «${alt}» for «${ans.a}»`);
    });
  }
});
