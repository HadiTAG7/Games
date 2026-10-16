'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HerdGame, GameError, groupAnswers, mergeGroups, winningGroupIds, loneAnswerer, parseCustomQuestions,
} = require('../src/games/herd');

const BANK = Array.from({ length: 30 }, (_, i) => `سؤال ${i + 1}`);

function newGame(players = ['a', 'b', 'c', 'd']) {
  const game = new HerdGame({ questionBank: BANK, random: () => 0.5 });
  players.forEach((id) => game.addPlayer(id));
  return game;
}

function play(game, answers) {
  for (const [id, text, value] of answers) game.submitAnswer(id, { text, value });
  game.reveal();
}

const sizes = (groups) => groups.map((g) => g.members.length);

test('groupAnswers groups spelling variants and sorts biggest first', () => {
  const groups = groupAnswers([
    { playerId: 'a', text: 'أزرق', value: 1 },
    { playerId: 'b', text: 'الأحمر', value: 2 },
    { playerId: 'c', text: 'احمر', value: 3 },
    { playerId: 'd', text: 'أحمر', value: 4 },
  ]);
  assert.deepEqual(sizes(groups), [3, 1]);
  assert.equal(groups[1].text, 'أزرق');
});

test('the biggest group wins', () => {
  const groups = groupAnswers([
    { playerId: 'a', text: 'أحمر', value: 1 },
    { playerId: 'b', text: 'أحمر', value: 1 },
    { playerId: 'c', text: 'أزرق', value: 1 },
  ]);
  const winners = winningGroupIds(groups);
  assert.equal(winners.size, 1);
  assert.ok(winners.has(groups[0].id));
});

test('tied biggest groups all win', () => {
  const groups = groupAnswers([
    { playerId: 'a', text: 'أحمر', value: 1 },
    { playerId: 'b', text: 'أحمر', value: 1 },
    { playerId: 'c', text: 'أزرق', value: 1 },
    { playerId: 'd', text: 'أزرق', value: 1 },
    { playerId: 'e', text: 'أخضر', value: 1 },
  ]);
  assert.equal(winningGroupIds(groups).size, 2);
});

test('nobody wins when every answer is different', () => {
  const groups = groupAnswers([
    { playerId: 'a', text: 'أحمر', value: 1 },
    { playerId: 'b', text: 'أزرق', value: 1 },
  ]);
  assert.equal(winningGroupIds(groups).size, 0);
  assert.equal(winningGroupIds([]).size, 0);
});

test('mergeGroups combines two groups and rejects bad ids', () => {
  const groups = groupAnswers([
    { playerId: 'a', text: 'بحر', value: 1 },
    { playerId: 'b', text: 'شاطئ', value: 1 },
    { playerId: 'c', text: 'شاطئ', value: 1 },
  ]);
  const merged = mergeGroups(groups, groups[1].id, groups[0].id);
  assert.deepEqual(sizes(merged), [3]);
  assert.equal(merged[0].text, 'شاطئ');
  assert.throws(() => mergeGroups(groups, groups[0].id, groups[0].id), GameError);
  assert.throws(() => mergeGroups(groups, 'nope', groups[0].id), GameError);
});

test('a full round: winners gain their bet, every bet is burned', () => {
  const game = newGame();
  game.start();
  assert.equal(game.phase, 'question');
  play(game, [['a', 'أحمر', 5], ['b', 'الأحمر', 3], ['c', 'أزرق', 15]]);
  game.confirm();
  const p = (id) => game.players.get(id);
  assert.equal(p('a').score, 5);
  assert.equal(p('b').score, 3);
  assert.equal(p('c').score, 0);
  assert.equal(p('d').score, 0);
  assert.deepEqual([...p('a').used], [5]);
  assert.deepEqual([...p('c').used], [15], 'losing burns the bet too');
  assert.deepEqual([...p('d').used], [1], 'no answer burns the lowest number');
  assert.deepEqual(p('c').last, { answered: true, won: false, value: 15, gained: 0, text: 'أزرق', pinkCow: true });
  assert.deepEqual(p('d').last, { answered: false, won: false, value: 1, gained: 0 });
  assert.deepEqual(game.round.missed, [{ playerId: 'd', value: 1 }]);
});

test('a bet cannot be used twice in the same game', () => {
  const game = newGame();
  game.start();
  play(game, [['a', 'x', 7], ['b', 'x', 7]]);
  game.confirm();
  game.next();
  assert.throws(() => game.submitAnswer('a', { text: 'y', value: 7 }), /استخدمته/);
  game.submitAnswer('a', { text: 'y', value: 8 });
});

test('answers are validated', () => {
  const game = newGame();
  game.start();
  assert.throws(() => game.submitAnswer('a', { text: 'x', value: 0 }), GameError);
  assert.throws(() => game.submitAnswer('a', { text: 'x', value: 16 }), GameError);
  assert.throws(() => game.submitAnswer('a', { text: 'x', value: 2.5 }), GameError);
  assert.throws(() => game.submitAnswer('a', { text: '   ', value: 3 }), GameError);
  assert.throws(() => game.submitAnswer('a', { text: 'x'.repeat(41), value: 3 }), GameError);
  assert.throws(() => game.submitAnswer('zzz', { text: 'x', value: 3 }), GameError);
});

test('a player can change their answer until the reveal', () => {
  const game = newGame();
  game.start();
  game.submitAnswer('a', { text: 'أحمر', value: 2 });
  game.submitAnswer('a', { text: 'أزرق', value: 9 });
  game.submitAnswer('b', { text: 'أزرق', value: 4 });
  game.reveal();
  assert.throws(() => game.submitAnswer('c', { text: 'أزرق', value: 1 }), GameError);
  game.confirm();
  assert.equal(game.players.get('a').score, 9);
});

test('merging changes the winners and can be undone', () => {
  const game = newGame();
  game.start();
  play(game, [['a', 'بحر', 4], ['b', 'شاطئ', 6], ['c', 'رمل', 1], ['d', 'رمل', 2]]);
  const sea = game.round.groups.find((g) => g.text === 'بحر');
  const beach = game.round.groups.find((g) => g.text === 'شاطئ');
  game.merge(sea.id, beach.id);
  assert.equal(game.winners().size, 2, 'بحر+شاطئ ties رمل');
  game.undoMerge();
  assert.equal(game.round.groups.length, 3);
  assert.throws(() => game.undoMerge(), GameError);
  game.merge(sea.id, beach.id);
  game.confirm();
  assert.deepEqual(['a', 'b', 'c', 'd'].map((id) => game.players.get(id).score), [4, 6, 1, 2]);
});

test('the game ends after the configured number of rounds', () => {
  const game = newGame(['a', 'b']);
  game.updateSettings({ rounds: 2 });
  game.start();
  assert.equal(game.questions.length, 2);
  assert.equal(new Set(game.questions).size, 2);
  for (let round = 0; round < 2; round++) {
    play(game, [['a', 'x', round + 1], ['b', 'x', round + 3]]);
    game.confirm();
    game.next();
  }
  assert.equal(game.phase, 'final');
  assert.deepEqual(game.standings().map((r) => [r.id, r.score, r.rank]), [['b', 7, 1], ['a', 3, 2]]);
});

test('equal scores share a rank', () => {
  const game = newGame(['a', 'b', 'c']);
  game.start();
  play(game, [['a', 'x', 5], ['b', 'x', 5], ['c', 'y', 1]]);
  game.confirm();
  assert.deepEqual(game.standings().map((r) => r.rank), [1, 1, 3]);
});

test('restart resets scores and burned bets', () => {
  const game = newGame(['a', 'b']);
  game.start();
  play(game, [['a', 'x', 5], ['b', 'x', 5]]);
  game.confirm();
  game.finish();
  game.restart();
  assert.equal(game.phase, 'lobby');
  assert.equal(game.players.get('a').score, 0);
  assert.equal(game.players.get('a').used.size, 0);
});

test('starting needs two players and settings are locked mid-game', () => {
  const solo = newGame(['a']);
  assert.throws(() => solo.start(), /اثنين/);
  const game = newGame();
  game.start();
  assert.throws(() => game.updateSettings({ rounds: 3 }), GameError);
});

test('custom questions are used in order, mixed with the bank, or required', () => {
  const custom = newGame();
  custom.updateSettings({ source: 'custom', customQuestions: 'سؤالي الأول\n\n  سؤالي الثاني  \n' });
  custom.start();
  assert.deepEqual(custom.questions, ['سؤالي الأول', 'سؤالي الثاني']);

  const mix = newGame();
  mix.updateSettings({ source: 'mix', rounds: 5, customQuestions: ['خاص'] });
  mix.start();
  assert.equal(mix.questions.length, 5);
  assert.ok(mix.questions.includes('خاص'));

  const empty = newGame();
  empty.updateSettings({ source: 'custom', customQuestions: '' });
  assert.throws(() => empty.start(), GameError);
  assert.deepEqual(parseCustomQuestions(' a \n\n b'), ['a', 'b']);
});

test('settings are clamped and invalid values ignored', () => {
  const game = newGame();
  game.updateSettings({ rounds: 99, timer: 7, source: 'other' });
  assert.equal(game.settings.rounds, 15);
  assert.equal(game.settings.timer, 0);
  assert.equal(game.settings.source, 'bank');
});

test('bank questions do not repeat across games in the same room', () => {
  const game = newGame(['a', 'b']);
  game.updateSettings({ rounds: 15 });
  game.start();
  const first = new Set(game.questions);
  game.restart();
  game.start();
  assert.ok(game.questions.every((q) => !first.has(q)));
});

test('removing a player mid-reveal drops them from the groups', () => {
  const game = newGame();
  game.start();
  play(game, [['a', 'أحمر', 1], ['b', 'أحمر', 2], ['c', 'أزرق', 3]]);
  game.removePlayer('b');
  assert.deepEqual(sizes(game.round.groups), [1, 1]);
  assert.equal(game.winners().size, 0);
});

test('the timer reveals automatically', async () => {
  let now = 1_000;
  const game = new HerdGame({ questionBank: BANK, now: () => now });
  ['a', 'b'].forEach((id) => game.addPlayer(id));
  let notified = false;
  game.onTimeout = () => { notified = true; };
  game.updateSettings({ timer: 20 });
  game.start();
  assert.equal(game.round.endsAt, 21_000);
  now = 21_000 + 1_000; // past the deadline and the grace period
  game.scheduleTimeout();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(game.phase, 'reveal');
  assert.ok(notified);
});

test('the pink cow goes only to a single odd one out', () => {
  const lone = groupAnswers([
    { playerId: 'a', text: 'أحمر', value: 1 },
    { playerId: 'b', text: 'أحمر', value: 1 },
    { playerId: 'c', text: 'أزرق', value: 1 },
  ]);
  assert.equal(loneAnswerer(lone), 'c');
  const twoLoners = groupAnswers([
    { playerId: 'a', text: 'أحمر', value: 1 },
    { playerId: 'b', text: 'أحمر', value: 1 },
    { playerId: 'c', text: 'أزرق', value: 1 },
    { playerId: 'd', text: 'أخضر', value: 1 },
  ]);
  assert.equal(loneAnswerer(twoLoners), null);
  assert.equal(loneAnswerer(groupAnswers([{ playerId: 'a', text: 'x', value: 1 }])), null, 'a lone answer in an empty round');
});

test('the pink cow moves to the next lone answerer and blocks the win', () => {
  const game = newGame(['a', 'b', 'c']);
  game.updateSettings({ rounds: 2 });
  game.start();
  play(game, [['a', 'x', 15], ['b', 'x', 14], ['c', 'y', 1]]);
  game.confirm();
  assert.equal(game.pinkCowHolder, 'c');
  assert.equal(game.round.pinkCowTaker, 'c');
  game.next();
  play(game, [['a', 'z', 1], ['b', 'w', 2], ['c', 'w', 3]]);
  game.confirm();
  assert.equal(game.pinkCowHolder, 'a', 'a was the only one alone this time');
  game.next();
  assert.equal(game.phase, 'final');
  // a has the most points (15+0) but holds the cow, so b (14+2) wins.
  assert.deepEqual(game.gameWinners(), ['b']);
  const final = game.standings({ cowLast: true });
  assert.deepEqual(final.map((r) => r.id), ['b', 'c', 'a']);
  assert.equal(final[2].pinkCow, true);
});

test('a round without a single loner keeps the pink cow where it is', () => {
  const game = newGame(['a', 'b', 'c', 'd']);
  game.start();
  play(game, [['a', 'x', 1], ['b', 'x', 1], ['c', 'x', 1], ['d', 'y', 1]]);
  game.confirm();
  game.next();
  play(game, [['a', 'x', 2], ['b', 'x', 2], ['c', 'y', 2], ['d', 'y', 2]]);
  game.confirm();
  assert.equal(game.pinkCowHolder, 'd');
  assert.equal(game.round.pinkCowTaker, null);
});

test('the pink cow can be switched off, and leaves with its holder', () => {
  const off = newGame(['a', 'b', 'c']);
  off.updateSettings({ pinkCow: false });
  off.start();
  play(off, [['a', 'x', 1], ['b', 'x', 1], ['c', 'y', 1]]);
  off.confirm();
  assert.equal(off.pinkCowHolder, null);

  const game = newGame(['a', 'b', 'c']);
  game.start();
  play(game, [['a', 'x', 1], ['b', 'x', 1], ['c', 'y', 1]]);
  game.confirm();
  game.removePlayer('c');
  assert.equal(game.pinkCowHolder, null);
  game.restart();
  assert.equal(game.pinkCowHolder, null);
});

test('skipping a question burns the lowest number still unused', () => {
  const game = newGame(['a', 'b', 'c']);
  game.start();
  play(game, [['a', 'x', 2], ['b', 'x', 3], ['c', 'y', 1]]);
  game.confirm();
  game.next();
  play(game, [['a', 'x', 4], ['b', 'x', 5]]);
  game.confirm();
  assert.deepEqual([...game.players.get('c').used].sort((x, y) => x - y), [1, 2], 'c already used 1, so 2 burns');
  assert.equal(game.players.get('c').last.value, 2);
  game.next();
  assert.throws(() => game.submitAnswer('c', { text: 'x', value: 2 }), /استخدمته/);
});

test('joining after the question closed does not burn a number', () => {
  const game = newGame(['a', 'b']);
  game.start();
  game.addPlayer('late-during-question');
  play(game, [['a', 'x', 1], ['b', 'x', 1]]);
  game.addPlayer('late-during-reveal');
  game.confirm();
  assert.deepEqual([...game.players.get('late-during-question').used], [1]);
  assert.deepEqual([...game.players.get('late-during-reveal').used], []);
  assert.equal(game.players.get('late-during-reveal').last.value, null);
});
