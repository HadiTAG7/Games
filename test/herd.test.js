'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HerdGame, GameError, groupAnswers, mergeGroups, winningGroupIds, toggleRejected, parseCustomQuestions,
} = require('../src/games/herd');

const prompts = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);
const CATEGORIES = [
  { id: 'food', name: 'أكل', emoji: '🍔', subcategories: [
    { id: 'food-a', name: 'أكل أ', same: prompts('أكل أ', 12), different: prompts('أكل أ مختلف', 5) },
    { id: 'food-b', name: 'أكل ب', same: prompts('أكل ب', 12), different: prompts('أكل ب مختلف', 5) },
    { id: 'food-c', name: 'أكل ج', same: prompts('أكل ج', 12), different: [] },
  ] },
  { id: 'places', name: 'أماكن', emoji: '🏠', subcategories: [
    { id: 'places-a', name: 'أماكن أ', same: prompts('مكان', 10), different: prompts('مكان مختلف', 10) },
  ] },
  { id: 'tiny', name: 'صغيرة', emoji: '🔤', subcategories: [
    { id: 'tiny-a', name: 'صغيرة أ', same: prompts('صغير', 3), different: [] },
  ] },
];
const SUBS = CATEGORIES.flatMap((c) => c.subcategories);
const DIFFERENT_BANK = SUBS.flatMap((sub) => sub.different);
const texts = (questions) => questions.map((q) => q.text);

function newGame(players = ['a', 'b', 'c', 'd']) {
  const game = new HerdGame({ categories: CATEGORIES, random: () => 0.5 });
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
  assert.deepEqual(p('c').last, { answered: true, auto: false, won: false, value: 15, gained: 0, text: 'أزرق', groupSize: 1, rejected: false });
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
  assert.equal(new Set(texts(game.questions)).size, 2);
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
  assert.deepEqual(custom.questions, [
    { text: 'سؤالي الأول', category: null, subcategory: null },
    { text: 'سؤالي الثاني', category: null, subcategory: null },
  ]);

  const mix = newGame();
  mix.updateSettings({ source: 'mix', rounds: 5, customQuestions: ['خاص'] });
  mix.start();
  assert.equal(mix.questions.length, 5);
  assert.ok(texts(mix.questions).includes('خاص'));

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
  const first = new Set(texts(game.questions));
  game.restart();
  game.start();
  assert.ok(game.questions.every((q) => !first.has(q.text)));
});

test('removing a player mid-reveal drops them from the groups', () => {
  const game = newGame();
  game.start();
  play(game, [['a', 'أحمر', 1], ['b', 'أحمر', 2], ['c', 'أزرق', 3]]);
  game.removePlayer('b');
  assert.deepEqual(sizes(game.round.groups), [1, 1]);
  assert.equal(game.winners().size, 0);
});

test('time runs out: what was typed is sent, on the picked number or the lowest free one', () => {
  const game = newGame(['a', 'b', 'c', 'd', 'e', 'f']);
  game.start();
  game.submitAnswer('a', { text: 'أحمر', value: 5 });
  game.saveDraft('a', { text: 'أحمر قديم', value: 5 }); // a late draft from before sending…
  game.submitAnswer('a', { text: 'أحمر', value: 5 }); // …is cleared by sending
  game.saveDraft('b', { text: '  الأحمر ', value: 3 }); // typed, never sent
  game.saveDraft('c', { text: 'أحمر' }); // no number picked
  game.saveDraft('d', { text: '   ', value: 7 }); // nothing really typed
  game.submitAnswer('e', { text: 'أزرق', value: 9 });
  game.saveDraft('e', { text: 'أخضر', value: 9 }); // editing a sent answer
  game.saveDraft('f', { text: 'x'.repeat(300), value: 99 }); // too long, bad number
  game.reveal();
  const answer = (id) => game.round.answers.get(id);
  assert.deepEqual(answer('a'), { playerId: 'a', text: 'أحمر', value: 5 }, 'sent by hand, not auto');
  assert.deepEqual(answer('b'), { playerId: 'b', text: 'الأحمر', value: 3, auto: true });
  assert.deepEqual(answer('c'), { playerId: 'c', text: 'أحمر', value: 1, auto: true }, 'the lowest free number');
  assert.equal(answer('d'), undefined, 'blank counts as no answer');
  assert.equal(answer('e').text, 'أخضر', 'the edit wins');
  assert.equal(answer('f').text.length, 40, 'cut to the longest answer allowed');
  assert.equal(answer('f').value, 1);
  game.saveDraft('d', { text: 'متأخر', value: 2 });
  assert.equal(game.round.drafts.size, 0, 'drafts after the reveal are ignored');
  game.confirm();
  const last = (id) => game.players.get(id).last;
  assert.equal(last('b').auto, true);
  assert.equal(last('b').won, true, 'the auto answer joins the biggest group');
  assert.equal(last('a').auto, false);
  assert.equal(last('d').answered, false);
  assert.deepEqual([...game.players.get('d').used], [1], 'and burns the lowest number as before');
});

test('a draft with a number already used goes on the lowest free one', () => {
  const game = newGame(['a', 'b']);
  game.start();
  play(game, [['a', 'x', 1], ['b', 'x', 2]]);
  game.confirm();
  game.next();
  game.saveDraft('a', { text: 'y', value: 1 });
  game.reveal();
  assert.equal(game.round.answers.get('a').value, 2);
});

test('the timer reveals automatically', async () => {
  let now = 1_000;
  const game = new HerdGame({ categories: CATEGORIES, now: () => now });
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

test('every subcategory is picked by default and unknown ids are ignored', () => {
  const game = newGame();
  assert.deepEqual(game.settings.subcategories, ['food-a', 'food-b', 'food-c', 'places-a', 'tiny-a']);
  game.updateSettings({ subcategories: ['places-a', 'food-b', 'nope'] });
  assert.deepEqual(game.settings.subcategories, ['food-b', 'places-a'], 'kept in tree order');
  assert.equal(game.bankSize(), 22);
  game.updateSettings({ mode: 'different' });
  assert.equal(game.bankSize(), 15);
});

test('questions are drawn evenly across categories, then across their subcategories', () => {
  const game = newGame();
  game.updateSettings({ subcategories: ['food-a', 'food-b', 'places-a'], rounds: 10 });
  game.start();
  const byCategory = {};
  const bySub = {};
  for (const q of game.questions) {
    byCategory[q.category] = (byCategory[q.category] || 0) + 1;
    bySub[q.subcategory] = (bySub[q.subcategory] || 0) + 1;
  }
  assert.deepEqual(byCategory, { food: 5, places: 5 }, 'two food subcategories do not double food');
  assert.ok(Math.abs(bySub['food-a'] - bySub['food-b']) <= 1, JSON.stringify(bySub));
  const sub = SUBS.find((x) => x.id === game.round.subcategory);
  assert.ok(sub.same.includes(game.round.question));
});

test('picking one subcategory only asks from it', () => {
  const game = newGame();
  game.updateSettings({ subcategories: ['food-c'], rounds: 5 });
  game.start();
  assert.ok(game.questions.every((q) => q.subcategory === 'food-c' && q.category === 'food'));
});

test('a small category runs out and the others fill the rest', () => {
  const game = newGame();
  game.updateSettings({ subcategories: ['tiny-a', 'places-a'], rounds: 9 });
  game.start();
  assert.equal(game.questions.filter((q) => q.category === 'tiny').length, 3);
  assert.equal(game.questions.length, 9);
});

test('there must be bank questions for the chosen categories and mode', () => {
  const none = newGame();
  none.updateSettings({ subcategories: [] });
  assert.throws(() => none.start(), /اختر قسم/);

  const empty = newGame();
  empty.updateSettings({ subcategories: ['tiny-a'], mode: 'different' });
  assert.throws(() => empty.start(), /ما فيه أسئلة/);

  const custom = newGame();
  custom.updateSettings({ subcategories: [], source: 'mix', customQuestions: 'سؤالي' });
  custom.start();
  assert.deepEqual(texts(custom.questions), ['سؤالي'], 'mix still works with only custom questions');
});

/* ---------- Voting on a doubtful answer ---------- */

function reviewing(mode = 'same') {
  const game = newGame(['a', 'b', 'c', 'd', 'e']);
  game.updateSettings({ mode });
  game.start();
  play(game, [['a', 'زرافة', 4], ['b', 'أخضر', 3], ['c', 'أصفر', 2], ['d', 'أحمر', 1], ['e', 'أزرق', 5]]);
  const giraffe = game.round.groups.find((g) => g.text === 'زرافة');
  return { game, giraffe };
}

test('authors cannot vote on their own answer', () => {
  const { game, giraffe } = reviewing();
  game.startVote(giraffe.id, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual([...game.round.vote.eligible].sort(), ['b', 'c', 'd', 'e']);
  assert.throws(() => game.castVote('a', 'keep'), /ما تقدر تصوّت/);
  assert.throws(() => game.castVote('b', 'maybe'), GameError);
});

test('a reject majority rejects the answer, and undo brings it back', () => {
  const { game, giraffe } = reviewing('different');
  game.startVote(giraffe.id, ['b', 'c', 'd', 'e']);
  game.castVote('b', 'reject');
  game.castVote('c', 'reject');
  game.castVote('d', 'keep');
  game.castVote('c', 'reject'); // changing your mind is fine
  game.finishVote();
  assert.equal(game.round.vote, null);
  assert.equal(game.round.groups.find((g) => g.id === giraffe.id).rejected, true);
  assert.deepEqual(game.round.lastVote, { text: 'زرافة', keep: 1, reject: 2, rejected: true, decidedBy: 'players' });
  game.undo();
  assert.equal(game.round.groups.find((g) => g.id === giraffe.id).rejected, false);
  assert.equal(game.round.lastVote, null);
});

test('a keep majority accepts an answer the host had rejected', () => {
  const { game, giraffe } = reviewing();
  game.toggleReject(giraffe.id);
  game.startVote(giraffe.id, ['b', 'c']);
  game.castVote('b', 'keep');
  game.castVote('c', 'keep');
  game.finishVote();
  assert.equal(game.round.groups.find((g) => g.id === giraffe.id).rejected, false);
});

test('a tie waits for the host to decide', () => {
  const { game, giraffe } = reviewing();
  game.startVote(giraffe.id, ['b', 'c']);
  game.castVote('b', 'keep');
  game.castVote('c', 'reject');
  game.finishVote();
  assert.equal(game.round.vote.status, 'tie');
  assert.throws(() => game.castVote('b', 'reject'), GameError, 'voting is closed');
  game.decideTie(true);
  assert.equal(game.round.groups.find((g) => g.id === giraffe.id).rejected, true);
  assert.equal(game.round.lastVote.decidedBy, 'host');
  assert.throws(() => game.decideTie(false), GameError);
});

test('nothing else can change while a vote is open, and it can be cancelled', () => {
  const { game, giraffe } = reviewing();
  game.startVote(giraffe.id, ['b']);
  assert.throws(() => game.startVote(giraffe.id, ['c']), /تصويت شغّال/);
  assert.throws(() => game.toggleReject(giraffe.id), /تصويت شغّال/);
  assert.throws(() => game.confirm(), /تصويت شغّال/);
  game.cancelVote();
  assert.equal(game.round.vote, null);
  assert.equal(game.round.history.length, 0, 'a cancelled vote changes nothing');
  game.confirm();
});

test('a vote needs someone to vote, and only runs while reviewing', () => {
  const { game, giraffe } = reviewing();
  assert.throws(() => game.startVote(giraffe.id, ['a']), /ما فيه أحد يقدر يصوّت/);
  assert.throws(() => game.startVote('nope', ['b']), GameError);
  const fresh = newGame();
  fresh.start();
  assert.throws(() => fresh.startVote('g1', ['a']), GameError);
});

test('removing a voter or the answer during a vote', () => {
  const { game, giraffe } = reviewing();
  game.startVote(giraffe.id, ['b', 'c']);
  game.castVote('b', 'reject');
  game.removePlayer('b');
  assert.deepEqual([...game.round.vote.eligible], ['c']);
  assert.equal(game.voteTally().reject, 0);
  game.removePlayer('a');
  assert.equal(game.round.vote, null, 'the answer is gone, so is its vote');
});
