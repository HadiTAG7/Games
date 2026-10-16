'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const sharp = require('sharp');
const { FileAccounts, hashPassword, checkPassword, usernameKey } = require('../src/accounts');
const { GAMES, addItems, removeItems, deleteBank, playableContent, isEmojiOnly } = require('../src/banks');
const { isPrivate, savePicture } = require('../src/images');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'banks-'));
const seenBank = require('../data/seen-jeem.json').categories;
const lettersBank = require('../data/letters.json').letters;

test('passwords are salted and checked in constant time; names ignore case', async () => {
  const a = await hashPassword('كلمة سر طويلة');
  const b = await hashPassword('كلمة سر طويلة');
  assert.notEqual(a, b, 'a fresh salt each time');
  assert.equal(await checkPassword('كلمة سر طويلة', a), true);
  assert.equal(await checkPassword('غلط', a), false);
  assert.equal(usernameKey('Fahad'), usernameKey(' fahad '));
});

test('accounts, sessions, tokens and banks in the file store', async () => {
  const store = new FileAccounts(tmp());
  const fahad = await store.createAccount('Fahad', 'h');
  assert.equal(await store.createAccount('fahad', 'h2'), null, 'the name is taken');
  assert.equal((await store.findAccount('FAHAD')).id, fahad.id);
  await store.addSession('s1', fahad.id, new Date(Date.now() + 1000));
  assert.deepEqual(await store.getSession('s1'), { accountId: fahad.id });
  await store.addToken({ hash: 't1', kind: 'refresh', accountId: fahad.id, clientId: 'c1', expiresAt: new Date(Date.now() + 1000) });
  await store.saveClient({ client_id: 'c1', client_name: 'Claude' });
  assert.deepEqual((await store.listConnections(fahad.id)).map((c) => c.name), ['Claude']);
  await store.deleteTokens({ accountId: fahad.id, clientId: 'c1' });
  assert.equal(await store.getToken('t1'), null);
  const again = new FileAccounts(store.dir);
  assert.equal((await again.getAccount(fahad.id)).username, 'Fahad', 'kept on disk');
});

test('each game checks its items; duplicates and bad letters are refused', () => {
  assert.throws(() => GAMES.seen.check({ value: 300, q: 'س', a: 'ج' }), /200/);
  assert.equal(GAMES.letters.check({ q: 'سفينة الصحراء؟', a: 'الجمل' }).item.letter, 'ج');
  assert.throws(() => GAMES.letters.check({ q: 'س', a: '42' }), /حرف عربي/);
  assert.throws(() => GAMES.herd.check({ mode: 'x', q: 'س' }), /same/);
  assert.throws(() => GAMES.time.check({ type: 'emoji', face: 'أسد', answer: 'x' }), /إيموجي/);
  assert.equal(GAMES.time.check({ type: 'emoji', face: '🦁👑', answer: 'الأسد الملك' }).item.face, '🦁👑');
  assert.deepEqual(GAMES.time.check({ type: 'image', image_url: 'https://x/y.jpg', answer: 'برج' }).picture, { url: 'https://x/y.jpg', base64: null });
  assert.ok(isEmojiOnly('👨‍👩‍👧‍👦🏠') && !isEmojiOnly('🦁 أسد'));
});

test('pasted text: one line per item in each game\'s format', () => {
  assert.deepEqual(GAMES.seen.parseText('200 | سؤال | جواب'), [{ value: '200', q: 'سؤال', a: 'جواب', image_url: undefined }]);
  assert.deepEqual(GAMES.herd.parseText('عكس | يوم من أيام الأسبوع\nاذكر لون'), [{ mode: 'different', q: 'يوم من أيام الأسبوع' }, { mode: 'same', q: 'اذكر لون' }]);
  assert.deepEqual(GAMES.outsider.parseText('مخيم، استراحة\nشاليه').map((i) => i.word), ['مخيم', 'استراحة', 'شاليه']);
  assert.deepEqual(GAMES.time.parseText('🦁👑 | الأسد الملك\nعاصمة اليابان | طوكيو').map((i) => i.type), ['emoji', 'text']);
});

test('adding to a bank: new or existing, bad items reported, ready to play once enough', async () => {
  const store = new FileAccounts(tmp());
  const { id } = await store.createAccount('reem', 'h');
  const existing = seenBank[0].questions[200][0].q;
  const first = await addItems(store, id, { game: 'seen', name: 'دوري روشن', emoji: '⚽', items: [
    { value: 200, q: 'كم فريق في دوري روشن؟', a: '18' },
    { value: 200, q: 'كم فريق في دوري روشن؟', a: '18' },
    { value: 200, q: existing, a: 'x' },
    { value: 900, q: 'س', a: 'ج' },
  ] }, seenBank);
  assert.equal(first.added, 1);
  assert.deepEqual(first.errors.map((e) => e.index), [1, 2, 3]);
  assert.equal(first.bank.playable, false);
  const more = [200, 400, 400, 600, 600].map((value, i) => ({ value, q: `سؤال دوري ${i}`, a: `جواب ${i}` }));
  const second = await addItems(store, id, { game: 'seen', bankId: first.bank.id, items: more }, seenBank);
  assert.equal(second.bank.count, 6);
  assert.equal(second.bank.playable, true);
  await assert.rejects(addItems(store, id, { game: 'letters', bankId: first.bank.id, items: [{ q: 'س', a: 'جمل' }] }), /سين جيم/);
  const [{ content }] = await playableContent(store, id, 'seen', [first.bank.id]);
  assert.equal(content.id, `bank-${first.bank.id}`);
  assert.equal(content.questions[400].length, 2);
  const bank = await store.getBank(first.bank.id);
  const removed = await removeItems(store, id, first.bank.id, [bank.items[0].id]);
  assert.equal(removed.bank.count, 5);
  const other = await store.createAccount('noura', 'h');
  await assert.rejects(deleteBank(store, other.id, first.bank.id), /ما لقينا/, 'not your bank');
  await deleteBank(store, id, first.bank.id);
  assert.equal((await store.listBanks(id)).length, 0);
  void lettersBank;
});

test('pictures: fetched, shrunk to WebP, private addresses refused', async (t) => {
  assert.ok(['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1'].every(isPrivate));
  assert.ok(!isPrivate('8.8.8.8') && !isPrivate('2606:4700::1111'));
  const png = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#c33' } }).png().toBuffer();
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/pic.png')) { res.writeHead(200, { 'content-type': 'image/png' }); res.end(png); return; }
    if (req.url === '/moved') { res.writeHead(302, { location: '/pic.png' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const store = new FileAccounts(tmp());
  const { id } = await store.createAccount('khaled', 'h');
  await assert.rejects(savePicture(store, id, { url: `${base}/pic.png` }), /مو مسموح/, 'local addresses are refused');
  process.env.IMAGE_ALLOW_PRIVATE = '1';
  t.after(() => { delete process.env.IMAGE_ALLOW_PRIVATE; });
  const pic = await savePicture(store, id, { url: `${base}/moved` });
  const meta = await sharp(await store.getImage(pic)).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['webp', 800, 450]);
  await assert.rejects(savePicture(store, id, { url: `${base}/page` }), /مو صورة/);
  await assert.rejects(savePicture(store, id, { url: 'ftp://x/y.png' }), /http/);
  const b64 = await savePicture(store, id, { base64: `data:image/png;base64,${png.toString('base64')}` });
  assert.ok(await store.getImage(b64));
  // A time-challenge bank with picture cards.
  const cards = Array.from({ length: 15 }, (_, i) => ({ type: 'image', image_url: `${base}/pic.png?${i}`, answer: `صورة ${i}` }));
  const out = await addItems(store, id, { game: 'time', name: 'صورنا', items: cards });
  assert.equal(out.added, 15);
  assert.equal(out.bank.images, 15);
  assert.equal(out.bank.playable, true);
  const [{ content }] = await playableContent(store, id, 'time', [out.bank.id]);
  assert.match(content.cards[0].src, /^\/bank-img\/[0-9a-f]{24}\.webp$/);
});
