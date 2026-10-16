'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HerdGame, GameError, groupAnswers, mergeGroups, winningGroupIds, toggleRejected, parseCustomQuestions,
} = require('../src/games/herd');

const BANK = Array.from({ length: 30 }, (_, i) => `سؤال ${i + 1}`);
const DIFFERENT_BANK = Array.from({ length: 20 }, (_, i) => `سؤال مختلف ${i + 1}`);
const BANKS = { same: BANK, different: DIFFERENT_BANK };

function newGame(players = ['a', 'b', 'c', 'd']) {
  const game = new HerdGame({ questionBanks: BANKS, random: () => 0.5 });
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
  assert.deepEqual(p('c').last, { answered: true, won: false, value: 15, gained: 0, text: 'أزرق', groupSize: 1, rejected: false });
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
  game.undo();
  assert.equal(game.round.groups.length, 3);
  assert.throws(() => game.undo(), GameError);
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
  const game = new HerdGame({ questionBanks: BANKS, now: () => now });
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

test('different mode: answers nobody else gave win, shared answers lose', () => {
  const groups = groupAnswers([
    { playerId: 'a', text: 'أحمر', value: 1 },
    { playerId: 'b', text: 'الأحمر', value: 1 },
    { playerId: 'c', text: 'أزرق', value: 1 },
    { playerId: 'd', text: 'أخضر', value: 1 },
  ]);
  const winners = winningGroupIds(groups, 'different');
  assert.deepEqual([...winners].map((id) => groups.find((g) => g.id === id).text).sort(), ['أخضر', 'أزرق']);
  assert.equal(winningGroupIds(groupAnswers([{ playerId: 'a', text: 'x', value: 1 }]), 'different').size, 0,
    'a lone answer with nobody to differ from does not win');
});

test('different mode: a full round scores the unique answers', () => {
  const game = newGame(['a', 'b', 'c']);
  game.updateSettings({ mode: 'different' });
  game.start();
  assert.ok(DIFFERENT_BANK.includes(game.round.question), 'uses the different-mode bank');
  play(game, [['a', 'أحمر', 5], ['b', 'أحمر', 6], ['c', 'أزرق', 7]]);
  game.confirm();
  assert.deepEqual(['a', 'b', 'c'].map((id) => game.players.get(id).score), [0, 0, 7]);
  assert.equal(game.players.get('a').last.groupSize, 2);
  assert.deepEqual([...game.players.get('a').used], [5], 'losing still burns the bet');
});

test('different mode: merging synonyms makes them shared', () => {
  const game = newGame(['a', 'b', 'c']);
  game.updateSettings({ mode: 'different' });
  game.start();
  play(game, [['a', 'بحر', 1], ['b', 'شاطئ', 2], ['c', 'رمل', 3]]);
  assert.equal(game.winners().size, 3);
  const sea = game.round.groups.find((g) => g.text === 'بحر');
  const beach = game.round.groups.find((g) => g.text === 'شاطئ');
  game.merge(sea.id, beach.id);
  game.confirm();
  assert.deepEqual(['a', 'b', 'c'].map((id) => game.players.get(id).score), [0, 0, 3]);
});

test('rejected answers never win, in either mode, and rejecting can be undone', () => {
  const different = newGame(['a', 'b', 'c']);
  different.updateSettings({ mode: 'different' });
  different.start();
  play(different, [['a', 'زرافة', 4], ['b', 'أخضر', 3], ['c', 'أصفر', 2]]);
  const giraffe = different.round.groups.find((g) => g.text === 'زرافة');
  different.toggleReject(giraffe.id);
  assert.equal(different.round.groups.at(-1).id, giraffe.id, 'rejected groups sort last');
  assert.equal(different.winners().size, 2);
  different.undo();
  assert.equal(different.winners().size, 3);
  different.toggleReject(giraffe.id);
  different.confirm();
  assert.deepEqual(['a', 'b', 'c'].map((id) => different.players.get(id).score), [0, 3, 2]);
  assert.equal(different.players.get('a').last.rejected, true);

  const same = newGame(['a', 'b', 'c', 'd']);
  same.start();
  play(same, [['a', 'غلط', 1], ['b', 'غلط', 1], ['c', 'صح', 1], ['d', 'أزرق', 1]]);
  same.toggleReject(same.round.groups.find((g) => g.text === 'غلط').id);
  assert.equal(same.winners().size, 0, 'the biggest group was rejected and the rest are singles');
  assert.throws(() => toggleRejected(same.round.groups, 'nope'), GameError);
});

test('the mode is part of the settings and locked mid-game', () => {
  const game = newGame();
  game.updateSettings({ mode: 'other' });
  assert.equal(game.settings.mode, 'same');
  game.updateSettings({ mode: 'different' });
  assert.equal(game.settings.mode, 'different');
  game.start();
  assert.throws(() => game.updateSettings({ mode: 'same' }), GameError);
});
