'use strict';

// «📚 بنوكي» in a room: the host's banks join each game's categories.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RoomManager } = require('../src/rooms');
const { FileAccounts } = require('../src/accounts');
const banks = require('../src/banks');

const content = {
  categories: require('../data/questions.json').categories,
  timeCategories: require('../data/time-challenge.json').categories,
  seenCategories: require('../data/seen-jeem.json').categories,
  letters: require('../data/letters.json').letters,
  outsiderCategories: require('../data/outsider.json').categories,
};
const PUBLIC = { herd: content.categories, time: content.timeCategories, seen: content.seenCategories, letters: content.letters, outsider: content.outsiderCategories };

async function setup() {
  const store = new FileAccounts(fs.mkdtempSync(path.join(os.tmpdir(), 'room-banks-')));
  const { id: accountId } = await store.createAccount('hind', 'h');
  const add = async (game, name, items) => (await banks.addItems(store, accountId, { game, name, items }, PUBLIC[game])).bank;
  const made = {
    seen: await add('seen', 'سوالف الشلة', [200, 200, 400, 400, 600, 600].map((value, i) => ({ value, q: `سؤال الشلة رقم ${i}`, a: `جواب ${i}` }))),
    letters: await add('letters', 'حروفنا', [{ q: 'وش اسم جمل الشلة؟ (بنك)', a: 'جمل الشلة' }]),
    herd: await add('herd', 'قطيعنا', ['اذكر أكلة الشلة 1', 'اذكر أكلة الشلة 2', 'اذكر أكلة الشلة 3'].map((q) => ({ mode: 'same', q }))),
    outsider: await add('outsider', 'استراحاتنا', ['مخيم الشلة', 'شاليه الشلة', 'استراحة الشلة', 'مزرعة الشلة'].map((word) => ({ word }))),
    time: await add('time', 'بطاقاتنا', Array.from({ length: 15 }, (_, i) => ({ type: 'text', face: `تلميح ${i}`, answer: `جواب ${i}` }))),
  };
  const room = new RoomManager(content).create();
  room.ownerId = accountId;
  room.ownerName = 'hind';
  room.bankList = (await store.listBanks(accountId)).map(banks.summary);
  const switchOn = async (game) => room.useBanks(await banks.playableContent(store, accountId, game, [made[game].id]));
  return { room, made, switchOn };
}

test('a switched-on bank shows up in every question game', async () => {
  const { room, made, switchOn } = await setup();

  room.setGameType('seen');
  assert.deepEqual(room.hostView().myBanks.list.map((b) => [b.name, b.on]), [['سوالف الشلة', false]]);
  await switchOn('seen');
  assert.ok(room.game.categories.some((c) => c.id === `bank-${made.seen.id}`), 'a board category');
  assert.equal(room.hostView().myBanks.list[0].on, true);

  room.setGameType('letters');
  await switchOn('letters');
  const jeem = room.game.letters.find((l) => l.letter === 'ج');
  assert.deepEqual(jeem.questions[0], { q: 'وش اسم جمل الشلة؟ (بنك)', a: 'جمل الشلة', custom: true }, 'drawn before the site\'s own');

  room.setGameType('herd');
  await switchOn('herd');
  const sub = `bank-${made.herd.id}-all`;
  assert.ok(room.game.settings.subcategories.includes(sub), 'picked straight away');
  assert.equal(room.game.subcategories.find((s) => s.id === sub).same.length, 3);

  room.setGameType('outsider');
  await switchOn('outsider');
  assert.ok(room.game.settings.categories.includes(`bank-${made.outsider.id}`));

  room.setGameType('time');
  await switchOn('time');
  const wheel = room.game.enabledCategories().find((c) => c.id === `bank-${made.time.id}`);
  assert.deepEqual(wheel.cards[0], { type: 'text', text: 'تلميح 0', answer: 'جواب 0' });

  // Back to سين جيم: the bank is still on there.
  room.setGameType('seen');
  assert.ok(room.game.categories.some((c) => c.id === `bank-${made.seen.id}`));
  room.useBanks([]);
  assert.ok(!room.game.categories.some((c) => c.id.startsWith('bank-')), 'switched off');
  assert.ok(!room.game.settings.categories.some((id) => id.startsWith('bank-')));
});

test('banks only change between games, and a room without a login shows the link', async () => {
  const { room, switchOn } = await setup();
  room.setGameType('outsider');
  room.game.phase = 'clues';
  await assert.rejects(switchOn('outsider'), /خلّص/);
  room.game.phase = 'lobby';
  await switchOn('outsider');

  const guest = new RoomManager(content).create();
  guest.setGameType('seen');
  assert.deepEqual(guest.hostView().myBanks, { loggedIn: false, owner: null, list: [] });
  guest.setGameType('mafia');
  assert.equal(guest.hostView().myBanks, null, 'no banks in مافيا');
});
