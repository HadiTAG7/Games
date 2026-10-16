'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LettersGame, neighbours, winningPath, SIZE } = require('../src/games/letters');
const { RoomManager } = require('../src/rooms');

const ALPHABET = 'أ ب ت ث ج ح خ د ذ ر ز س ش ص ض ط ظ ع غ ف ق ك ل م ن هـ و ي'.split(' ');
const LETTERS = ALPHABET.map((letter) => ({
  letter,
  questions: [1, 2, 3].map((n) => ({ q: `سؤال ${n} لحرف ${letter}`, a: `${letter}-${n}` })),
}));

function newGame({ players = ['r1', 'b1', 'r2', 'b2'] } = {}) {
  let now = 1_000_000;
  const game = new LettersGame({ categories: LETTERS, now: () => now });
  game.tick = (ms) => { now += ms; };
  players.forEach((id) => game.addPlayer(id));
  return game;
}

function started() {
  const game = newGame();
  game.start();
  return game;
}

/** Plays one cell for a team: pick it, buzz, judge right. */
function take(game, cell, team) {
  game.pick(cell);
  game.hostBuzz(team);
  game.judge(true);
}

test('neighbours follow the offset hex rows', () => {
  assert.deepEqual(neighbours(0).sort((a, b) => a - b), [1, 5]);
  // Row 1 is shifted right: cell 6 touches 1, 2 above and 11, 12 below.
  assert.deepEqual(neighbours(6).sort((a, b) => a - b), [1, 2, 5, 7, 11, 12]);
  // Row 2 (even): cell 12 touches 6, 7 above and 16, 17 below.
  assert.deepEqual(neighbours(12).sort((a, b) => a - b), [6, 7, 11, 13, 16, 17]);
});

test('red links left to right, blue links top to bottom', () => {
  const owners = Array(SIZE * SIZE).fill(null);
  [10, 11, 12, 13, 14].forEach((c) => { owners[c] = 'red'; });
  assert.deepEqual(winningPath(owners, 'red'), [10, 11, 12, 13, 14]);
  assert.equal(winningPath(owners, 'blue'), null);
  const zig = Array(SIZE * SIZE).fill(null);
  // A zigzag down the offset rows: 2 → 6 → 12 → 16 → 22.
  [2, 6, 12, 16, 22].forEach((c) => { zig[c] = 'blue'; });
  assert.deepEqual(winningPath(zig, 'blue'), [2, 6, 12, 16, 22]);
  zig[12] = 'red';
  assert.equal(winningPath(zig, 'blue'), null);
});

test('a board has 25 different letters and red picks first', () => {
  const game = started();
  assert.equal(game.board.length, 25);
  assert.equal(new Set(game.board.map((c) => c.letter)).size, 25);
  assert.equal(game.phase, 'pick');
  assert.equal(game.picker, 'red');
});

test('the first buzz takes the turn; a right answer takes the cell and the next pick', () => {
  const game = started();
  game.pick(7);
  assert.equal(game.phase, 'question');
  assert.equal(game.buzz('b1'), true);
  assert.equal(game.buzz('r1'), false, 'too late');
  assert.equal(game.current.buzz.team, 'blue');
  game.judge(true);
  assert.equal(game.board[7].owner, 'blue');
  assert.equal(game.picker, 'blue');
  assert.equal(game.phase, 'pick');
  assert.throws(() => game.pick(7), /انأخذ/);
});

test('a wrong answer locks that team out and opens the buzzer for the other', () => {
  const game = started();
  game.pick(3);
  game.buzz('r1');
  game.judge(false);
  assert.equal(game.phase, 'question');
  assert.equal(game.buzz('r2'), false, 'red already missed');
  assert.equal(game.buzz('b2'), true);
  game.judge(false);
  assert.equal(game.phase, 'missed');
  const first = game.current.question;
  game.newQuestion();
  assert.equal(game.phase, 'question');
  assert.notEqual(game.current.question, first);
  assert.equal(game.buzz('r1'), true, 'a new question opens it for both');
  game.judge(false);
  game.release();
  assert.equal(game.phase, 'pick');
  assert.equal(game.picker, 'red', 'the same team picks again');
  assert.equal(game.board[3].owner, null);
});

test('linking your sides wins the round; first to the set number of rounds wins', () => {
  const game = started();
  [10, 11, 12, 13].forEach((c) => take(game, c, 'red'));
  assert.equal(game.phase, 'pick');
  take(game, 14, 'red');
  assert.equal(game.phase, 'roundOver');
  assert.deepEqual(game.result, { winner: 'red', path: [10, 11, 12, 13, 14] });
  assert.deepEqual(game.score, { red: 1, blue: 0 });
  game.next();
  assert.equal(game.roundNumber, 2);
  assert.equal(game.picker, 'blue', 'the other team starts the next round');
  assert.ok(game.board.every((c) => !c.owner));
  [2, 6, 12, 16, 22].forEach((c) => take(game, c, 'blue'));
  game.next();
  [0, 1, 2, 3, 4].forEach((c) => take(game, c, 'red'));
  assert.equal(game.matchWinner, 'red');
  game.next();
  assert.equal(game.phase, 'final');
});

test('undo takes back the last call, even the one that won the round', () => {
  const game = started();
  [10, 11, 12, 13].forEach((c) => take(game, c, 'red'));
  game.pick(14);
  game.buzz('r1');
  game.tick(8_000);
  game.judge(true);
  assert.equal(game.phase, 'roundOver');
  game.undo();
  assert.equal(game.phase, 'answer');
  assert.equal(game.board[14].owner, null);
  assert.deepEqual(game.score, { red: 0, blue: 0 });
  assert.equal(game.result, null);
  assert.ok(game.current.buzz.endsAt > 1_008_000, 'the answer clock starts over');
  game.judge(false);
  assert.equal(game.phase, 'question');
  game.undo();
  assert.equal(game.current.buzz.team, 'red');
});

test('a double tap on an old screen is ignored', () => {
  const game = started();
  game.pick(0, game.step);
  game.buzz('r1');
  const { step } = game;
  game.judge(false, step);
  game.judge(false, step);
  assert.equal(game.phase, 'question', 'the second ❌ did not count');
});

test('players without a team cannot buzz, and the host can give the turn', () => {
  const game = started();
  game.pick(0);
  assert.equal(game.buzz('stranger'), false);
  game.hostBuzz('blue');
  assert.equal(game.current.buzz.playerId, null);
  game.judge(false);
  assert.throws(() => game.hostBuzz('blue'), /غلط/);
});

test('a game without questions is hidden from the picker', () => {
  const room = new RoomManager({ categories: require('../data/questions.json').categories }).create();
  // «مافيا» needs no questions, so it is always there.
  assert.deepEqual(room.games().map((g) => g.id), ['herd', 'mafia']);
  assert.throws(() => room.setGameType('letters'), /غير معروفة/);
});

test('phones see the question but not the answer', () => {
  const room = new RoomManager({ letters: LETTERS }).create();
  const [a, b] = ['أحمد', 'فهد'].map((name) => room.join({ name }));
  room.setGameType('letters');
  room.game.start();
  room.game.pick(4);
  room.game.buzz(b.id);
  const host = room.hostView();
  const phone = room.playerView(a.id);
  assert.ok(host.current.answer);
  assert.equal(phone.current.answer, null);
  assert.equal(phone.current.question, host.current.question);
  assert.equal(phone.current.buzz.name, 'فهد');
  assert.equal(phone.current.buzz.team, 'blue');
});
