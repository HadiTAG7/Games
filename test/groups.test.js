'use strict';

// «👥 الشلة»: a group's played questions don't come back on its next nights.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { GroupHistory, NO_HISTORY, preferNew } = require('../src/groups');
const groups = require('../src/groups');
const { FileAccounts } = require('../src/accounts');
const { FeudGame } = require('../src/games/feud');
const { HerdGame } = require('../src/games/herd');
const { SeenGame } = require('../src/games/seen');
const { LettersGame } = require('../src/games/letters');
const { OutsiderGame } = require('../src/games/outsider');
const { TimeGame } = require('../src/games/time');
const { RoomManager } = require('../src/rooms');
const { normalizeAnswer } = require('../src/normalize');

/** A history that also logs what the store would be told. */
function tracked(entries = []) {
  const log = [];
  const history = new GroupHistory(entries.map((k) => [k, 1]), {
    onAdd: (keys) => log.push(['add', ...keys]),
    onRecycle: (keys) => log.push(['recycle', ...keys.sort()]),
  });
  return { history, log };
}

test('a history adds new keys, ignores null ones, and starts a section over', () => {
  const { history, log } = tracked(['a']);
  history.add(['a', 'b', null, 'b']);
  assert.deepEqual(log, [['add', 'a', 'b']]);
  assert.ok(history.has('b') && !history.has(null));
  history.recycle(['a', 'z']);
  assert.deepEqual(log.at(-1), ['recycle', 'a'], 'only keys it had');
  assert.equal(history.size, 1);
  assert.equal(NO_HISTORY.has('a'), false);
  // preferNew keeps the unplayed while there are enough, else the whole section is new again.
  assert.deepEqual(preferNew(['a', 'b', 'c'], 2, new GroupHistory([['a', 1]]), (x) => x), ['b', 'c']);
  const short = new GroupHistory([['a', 1], ['b', 1]]);
  assert.deepEqual(preferNew(['a', 'b', 'c'], 2, short, (x) => x), ['a', 'b', 'c']);
  assert.equal(short.size, 0);
});

test('فاميلي فيود: questions the group had are skipped; once they run out the bank starts over for it', () => {
  const bank = Array.from({ length: 6 }, (_, i) => ({ id: `q${i}`, q: `سؤال ${i}`, answers: Array.from({ length: 5 }, (__, j) => ({ a: `ج${j}`, points: 30 - j })) }));
  const { history, log } = tracked(['q0', 'q1', 'q2', 'q3']);
  const game = new FeudGame({ categories: bank, groupHistory: history });
  ['a', 'b', 'c', 'd'].forEach((id) => game.addPlayer(id));
  game.updateSettings({ rounds: 3, fastMoney: false });
  game.start();
  const first = game.round.question.id;
  assert.ok(['q4', 'q5'].includes(first), 'a question new to the group');
  assert.deepEqual(log, [['add', first]], 'remembered once it shows');
  assert.equal(game.unitCount(), 6);
  // The next draw takes the last new one; after that, the group's bank starts over.
  const [second] = game.draw(1);
  assert.ok(['q4', 'q5'].includes(second.id) && second.id !== first);
  game.draw(1);
  assert.equal(log.at(-1)[0], 'recycle');
});

test('عقلية القطيع: picks avoid the group\'s prompts, and only a round that starts is remembered', () => {
  const sub = { id: 's', name: 'قسم', same: ['لون', 'فاكهة', 'حيوان', 'مدينة'], different: [] };
  const { history, log } = tracked([normalizeAnswer('لون'), normalizeAnswer('فاكهة')]);
  const game = new HerdGame({ categories: [{ id: 'c', name: 'فئة', emoji: '🎲', subcategories: [sub] }], random: () => 0.5, groupHistory: history });
  ['a', 'b'].forEach((id) => game.addPlayer(id));
  game.updateSettings({ rounds: 2 });
  game.start();
  assert.deepEqual(game.questions.map((q) => q.text).sort(), ['حيوان', 'مدينة']);
  assert.deepEqual(log, [['add', normalizeAnswer(game.questions[0].text)]], 'the second round has not been asked yet');
  // The host's own questions are never remembered.
  const own = new HerdGame({ categories: [{ id: 'c', name: 'فئة', emoji: '🎲', subcategories: [sub] }], groupHistory: history });
  ['a', 'b'].forEach((id) => own.addPlayer(id));
  own.updateSettings({ source: 'custom', customQuestions: ['سؤالي الخاص'], rounds: 1 });
  own.start();
  assert.equal(log.length, 1);
});

test('سين جيم: the board avoids the group\'s questions and remembers one when it opens; the host\'s own aren\'t', () => {
  const questions = (prefix) => Object.fromEntries([200, 400, 600].map((v) => [v, Array.from({ length: 4 }, (_, i) => ({ q: `${prefix} ${v} ${i}`, a: `${prefix}${v}${i}` }))]));
  const cats = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, name: id, emoji: '❓', questions: questions(id) }));
  const key = (q) => `${normalizeAnswer(q.q)}|${normalizeAnswer(q.a)}`;
  const played = cats.flatMap((c) => [200, 400, 600].flatMap((v) => c.questions[v].slice(0, 2).map(key)));
  const { history, log } = tracked(played);
  const game = new SeenGame({ categories: cats, groupHistory: history });
  ['p1', 'p2', 'p3', 'p4'].forEach((id) => game.addPlayer(id));
  game.updateSettings({ categories: ['a', 'b', 'c', 'd', 'e', 'f'] });
  game.start();
  for (const column of game.board) {
    for (const tile of column.tiles) assert.ok(tile.index >= 2, `${column.category} ${tile.value} is new to the group`);
  }
  const tile = game.board[0].tiles[0];
  game.pick(tile.id);
  game.showQuestion();
  assert.equal(log.length, 1);
  assert.equal(log[0][1], key(cats.find((c) => c.id === game.board[0].category).questions[tile.value][tile.index]));
});

test('حروف: a letter\'s question is one the group hasn\'t had; the host\'s own come first and aren\'t remembered', () => {
  const letters = 'أبتثجحخدذرزسشصضطظعغفقكلمن'.split('').map((letter) => ({ letter, questions: [0, 1, 2].map((i) => ({ q: `${letter} سؤال ${i}`, a: `${letter}${i}` })) }));
  const played = letters.flatMap((l) => l.questions.slice(0, 2).map((q) => `${l.letter}:${normalizeAnswer(q.q)}`));
  const { history, log } = tracked(played);
  const game = new LettersGame({ categories: letters, groupHistory: history });
  ['r1', 'b1', 'r2', 'b2'].forEach((id) => game.addPlayer(id));
  game.start();
  game.pick(0);
  const { letter, question } = game.current;
  assert.equal(question, 2, 'the one question the group hasn\'t had');
  assert.deepEqual(log, [['add', `${letter}:${normalizeAnswer(`${letter} سؤال 2`)}`]]);
  // No new one left for that letter: it starts over for the group.
  game.newQuestion();
  assert.equal(log.at(-2)[0], 'recycle');
  // The host's own question for a letter comes first, and isn't remembered.
  const own = new LettersGame({ categories: letters, groupHistory: history });
  own.updateSettings({ custom: letters.map((l) => `سؤالي لحرف ${l.letter} | ${l.letter}كلمة`).join('\n') });
  ['r1', 'b1'].forEach((id) => own.addPlayer(id));
  own.start();
  const before = log.length;
  own.pick(0);
  assert.equal(own.letters.find((l) => l.letter === own.current.letter).questions[own.current.question].custom, true);
  assert.equal(log.length, before);
});

test('برا السالفة: the word is new to the group, and words the host writes aren\'t remembered', () => {
  const cats = [{ id: 'food', name: 'أكل', emoji: '🍔', words: ['كبسة', 'مندي', 'جريش', 'مرقوق'] }];
  const { history, log } = tracked(['كبسه', 'مندي', 'جريش'].map(normalizeAnswer));
  const game = new OutsiderGame({ categories: cats, groupHistory: history });
  ['a', 'b', 'c', 'd'].forEach((id) => game.addPlayer(id));
  game.start();
  assert.equal(game.round.word, 'مرقوق');
  assert.deepEqual(log, [['add', normalizeAnswer('مرقوق')]]);
});

test('تحدي الوقت: the deck leads with cards the group hasn\'t seen; the ones shown are remembered at the round\'s end', () => {
  const cards = Array.from({ length: 30 }, (_, i) => ({ type: 'text', text: `بطاقة ${i}`, answer: `جواب ${i}` }));
  const key = (i) => `cars:بطاقة ${i}:${normalizeAnswer(`جواب ${i}`)}`;
  const { history, log } = tracked(Array.from({ length: 15 }, (_, i) => key(i)));
  const game = new TimeGame({ categories: [{ id: 'cars', name: 'سيارات', emoji: '🚗', cards }], groupHistory: history });
  ['a', 'b', 'c', 'd'].forEach((id) => game.addPlayer(id));
  game.start();
  game.spin();
  assert.ok(game.round.deck.every((e) => e.index >= 15), 'only cards new to the group');
  game.go();
  game.correct();
  game.correct();
  game.endRound('red', 'time');
  const shown = log.at(-1);
  assert.equal(shown[0], 'add');
  assert.equal(shown.length, 4, 'two answered and the one they were stuck on');
});

test('a room plays with a group across games, tells the server what was played, and shows it in the lobby', () => {
  const plays = [];
  const rooms = new RoomManager({
    feudQuestions: Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, q: `س${i}`, answers: Array.from({ length: 5 }, (__, j) => ({ a: `ج${j}`, points: 9 - j })) })),
    outsiderCategories: [{ id: 'food', name: 'أكل', emoji: '🍔', words: ['كبسة', 'مندي', 'جريش', 'مرقوق'] }],
  });
  rooms.onGroupPlay = (id, game, keys) => plays.push([id, game, ...keys]);
  const room = rooms.create();
  room.setGameType('feud');
  room.ownerId = 1;
  room.groupList = [{ id: 7, name: 'ولاد خالتي' }];
  room.setGroup({ id: 7, name: 'ولاد خالتي', plays: { feud: [['f0', 1], ['f1', 1]] } });
  assert.deepEqual(room.groupView().current, { id: 7, name: 'ولاد خالتي', played: 2, total: 5, top: [] });
  assert.equal(room.commonView('player').groupName, 'ولاد خالتي');
  for (const name of ['أ', 'ب', 'ج', 'د']) room.join({ name });
  room.game.updateSettings({ rounds: 3, fastMoney: false });
  room.game.start();
  assert.ok(!['f0', 'f1'].includes(room.game.round.question.id));
  assert.deepEqual(plays, [[7, 'feud', room.game.round.question.id]]);
  assert.throws(() => room.setGroup(null), /خلّص/);
  room.game.finish?.();
  // Another game in the same room keeps the group.
  room.game.phase = 'final';
  room.setGameType('outsider');
  assert.equal(room.groupView().current.played, 0);
  assert.equal(room.game.groupHistory, room.group.histories.outsider);
  room.setGroup(null);
  assert.equal(room.groupView().current, null);
  assert.equal(room.commonView('player').groupName, null);
  room.dispose();
});

test('the store keeps groups per account; limits, names and owners are checked; deleting the account deletes them', async () => {
  const store = new FileAccounts(fs.mkdtempSync(path.join(os.tmpdir(), 'groups-')));
  const me = await store.createAccount('fahad', 'x');
  const other = await store.createAccount('noura', 'x');
  const group = await groups.create(store, me.id, '  ولاد   خالتي ');
  assert.equal(group.name, 'ولاد خالتي');
  await assert.rejects(groups.create(store, me.id, 'ولاد خالتي'), /بنفس الاسم/);
  await assert.rejects(groups.create(store, me.id, '   '), /اكتب اسم/);
  await assert.rejects(groups.load(store, other.id, group.id), /ما لقينا/);
  await store.addGroupPlays(group.id, 'feud', ['f1', 'f2', 'f2']);
  await store.addGroupPlays(group.id, 'seen', ['x']);
  await store.removeGroupPlays(group.id, 'feud', ['f1']);
  const loaded = await groups.load(store, me.id, group.id);
  assert.deepEqual(Object.keys(loaded.plays).sort(), ['feud', 'seen']);
  assert.deepEqual(loaded.plays.feud.map(([k]) => k), ['f2']);
  const [row] = await groups.list(store, me.id);
  assert.deepEqual(row.games, { feud: 1, seen: 1 });
  assert.equal(row.total, 2);
  assert.ok(row.playedAt);
  assert.equal((await groups.rename(store, me.id, group.id, 'العيال')).name, 'العيال');
  await groups.reset(store, me.id, group.id);
  assert.equal((await groups.list(store, me.id))[0].total, 0);
  for (let i = 1; i < groups.LIMITS.groups; i++) await groups.create(store, me.id, `شلة ${i}`);
  await assert.rejects(groups.create(store, me.id, 'وحدة زيادة'), /بالكثير/);
  await groups.remove(store, me.id, group.id);
  assert.equal(await store.getGroup(group.id), null);
  // A store file from before groups existed still opens.
  const legacy = fs.mkdtempSync(path.join(os.tmpdir(), 'groups-old-'));
  fs.writeFileSync(path.join(legacy, 'accounts.json'), JSON.stringify({ next: { account: 2, bank: 1 }, accounts: [], sessions: [], clients: [], tokens: [], banks: [], images: [] }));
  const old = new FileAccounts(legacy);
  assert.equal((await old.createGroup(1, 'شلة')).id, 1);
  await store.addGroupPlays((await store.listGroups(me.id))[0].id, 'feud', ['f9']);
  await store.deleteAccount(me.id);
  assert.deepEqual(await store.listGroups(me.id), []);
  assert.equal(store.d.groupPlays.length, 0);
});

test('members: the owner adds them by username; they can play with the group and see it, not change it', async () => {
  const store = new FileAccounts(fs.mkdtempSync(path.join(os.tmpdir(), 'groups-members-')));
  const fahad = await store.createAccount('fahad', 'x');
  const noura = await store.createAccount('noura', 'x');
  const sami = await store.createAccount('sami', 'x');
  const group = await groups.create(store, fahad.id, 'ولاد خالتي');
  await assert.rejects(groups.addMember(store, fahad.id, group.id, 'nobody'), /ما لقينا حساب/);
  await assert.rejects(groups.addMember(store, fahad.id, group.id, 'fahad'), /صاحب/);
  await assert.rejects(groups.addMember(store, noura.id, group.id, 'sami'), /ما لقينا الشلة/, 'only the owner adds');
  assert.equal((await groups.addMember(store, fahad.id, group.id, 'Noura')).username, 'noura');
  await assert.rejects(groups.addMember(store, fahad.id, group.id, 'noura'), /موجود/);
  // Noura sees it (with the owner's name) and can play with it; Sami can't.
  const [seen] = await groups.list(store, noura.id);
  assert.deepEqual([seen.name, seen.ownerName, seen.mine], ['ولاد خالتي', 'fahad', false]);
  assert.equal((await groups.load(store, noura.id, group.id)).name, 'ولاد خالتي');
  await assert.rejects(groups.load(store, sami.id, group.id), /ما لقينا/);
  await assert.rejects(groups.rename(store, noura.id, group.id, 'لا'), /ما لقينا/);
  await assert.rejects(groups.reset(store, noura.id, group.id), /ما لقينا/);
  await assert.rejects(groups.leave(store, fahad.id, group.id), /صاحب/);
  // Her own groups don't count against the owner's limit, and leaving takes it off her list.
  await groups.leave(store, noura.id, group.id);
  assert.deepEqual(await groups.list(store, noura.id), []);
  await groups.addMember(store, fahad.id, group.id, 'noura');
  await groups.removeMember(store, fahad.id, group.id, noura.id);
  assert.deepEqual(await groups.list(store, noura.id), []);
  // Deleting a member's account takes them out; deleting the owner's deletes the group.
  await groups.addMember(store, fahad.id, group.id, 'sami');
  await store.deleteAccount(sami.id);
  assert.deepEqual((await groups.list(store, fahad.id))[0].members, []);
  await groups.addMember(store, fahad.id, group.id, 'noura');
  await store.addGroupScores(group.id, [{ nameKey: 'x', name: 'x', points: 3 }]);
  await store.deleteAccount(fahad.id);
  assert.deepEqual(await groups.list(store, noura.id), []);
  assert.equal(store.d.groupMembers.length + store.d.groupScores.length, 0);
});

test('the ranking: each finished game adds «بطل السهرة» points by name; the owner can drop a name or start over', async () => {
  const store = new FileAccounts(fs.mkdtempSync(path.join(os.tmpdir(), 'groups-rank-')));
  const fahad = await store.createAccount('fahad', 'x');
  const group = await groups.create(store, fahad.id, 'ولاد خالتي');
  await store.addGroupScores(group.id, [{ nameKey: groups.nameKey('أبو فهد'), name: 'أبو فهد', points: 3 }, { nameKey: groups.nameKey('ريم'), name: 'ريم', points: 0 }]);
  await store.addGroupScores(group.id, [{ nameKey: groups.nameKey('ابو فهد'), name: 'ابو فهد', points: 2 }, { nameKey: groups.nameKey('ريم'), name: 'ريم', points: 3 }]);
  const [row] = await groups.list(store, fahad.id);
  assert.deepEqual(row.ranking.map((r) => [r.name, r.points, r.wins, r.games, r.rank]), [['ابو فهد', 5, 1, 2, 1], ['ريم', 3, 1, 2, 2]]);
  await assert.rejects(groups.removeScore(store, fahad.id, group.id, 'سلطان'), /مو في الترتيب/);
  await groups.removeScore(store, fahad.id, group.id, 'أبو فهد');
  assert.deepEqual((await groups.list(store, fahad.id))[0].ranking.map((r) => r.name), ['ريم']);
  await groups.resetScores(store, fahad.id, group.id);
  assert.deepEqual((await groups.list(store, fahad.id))[0].ranking, []);
});

test('a room with a group adds each finished game to its ranking once, and phones see their place', () => {
  const scored = [];
  const rooms = new RoomManager({ outsiderCategories: [{ id: 'food', name: 'أكل', emoji: '🍔', words: ['كبسة', 'مندي', 'جريش', 'مرقوق'] }] });
  rooms.onGroupScore = (id, rows) => scored.push([id, rows]);
  const room = rooms.create();
  room.setGameType('outsider');
  const ids = ['فهد', 'ريم', 'سلطان', 'نورة'].map((name) => room.join({ name }).id);
  room.setGroup({ id: 3, name: 'ولاد خالتي', plays: {}, scores: [{ nameKey: groups.nameKey('ريم'), name: 'ريم', points: 10, wins: 3, games: 4 }] });
  assert.deepEqual(room.groupNames(), ['ريم']);
  assert.deepEqual(room.groupMe(ids[1]), { rank: 1, points: 10, of: 1 });
  assert.equal(room.groupMe(ids[0]), null);
  // A game ends: its points go to the group, once.
  room.game.phase = 'final';
  room.game.nightPoints = () => ({ [ids[0]]: 3, [ids[2]]: 1 });
  assert.equal(room.settleNight(), true);
  assert.equal(room.settleNight(), false);
  assert.equal(scored.length, 1);
  assert.deepEqual(scored[0][1].map((r) => [r.name, r.points]), [['فهد', 3], ['ريم', 0], ['سلطان', 1], ['نورة', 0]]);
  assert.deepEqual(room.groupView().current.top.map((r) => [r.name, r.points, r.rank]), [['ريم', 10, 1], ['فهد', 3, 2], ['سلطان', 1, 3], ['نورة', 0, 4]]);
  assert.deepEqual(room.playerView(ids[0]).groupMe, { rank: 2, points: 3, of: 4 });
  // Without a group nothing is sent.
  room.setGroup(null);
  room.game.phase = 'lobby';
  room.settleNight();
  room.game.phase = 'final';
  room.settleNight();
  assert.equal(scored.length, 1);
  room.dispose();
});
