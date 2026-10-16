'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { FileStore } = require('../src/community');
const { SPECS, NEW, newId } = require('../src/contrib');

const seenBank = require('../data/seen-jeem.json').categories;
const lettersBank = require('../data/letters.json').letters;
const herdBank = require('../data/questions.json').categories;
const outsiderBank = require('../data/outsider.json').categories;

test('entries are checked: lengths, duplicates, the letter of the answer', () => {
  assert.throws(() => SPECS.seen.validate({ category: 'general', value: 200, q: '', a: 'x' }, seenBank), /السؤال/);
  assert.throws(() => SPECS.seen.validate({ category: 'general', value: 300, q: 'س', a: 'ج' }, seenBank), /القيمة/);
  const existing = seenBank[0].questions[200][0].q;
  assert.throws(() => SPECS.seen.validate({ category: 'general', value: 200, q: existing, a: 'x' }, seenBank), /موجود/);
  const seen = SPECS.seen.validate({ category: NEW, newName: 'سوالف الشلة', newEmoji: '🔥', value: '400', q: 'مين أطول واحد فينا؟', a: 'فهد' }, seenBank);
  assert.deepEqual(seen, { category: NEW, newName: 'سوالف الشلة', newEmoji: '🔥', value: 400, q: 'مين أطول واحد فينا؟', a: 'فهد' });

  assert.equal(SPECS.letters.validate({ q: 'وش اسم شماغ الشلة؟ (اختبار)', a: 'الشماغ الأحمر' }, lettersBank).letter, 'ش');
  assert.throws(() => SPECS.letters.validate({ q: 'سؤال', a: '123' }, lettersBank), /حرف عربي/);

  const sub = herdBank[0].subcategories[0];
  assert.throws(() => SPECS.herd.validate({ subcategory: sub.id, mode: 'same', q: sub.same[0] }, herdBank), /موجود/);
  assert.equal(SPECS.herd.validate({ subcategory: sub.id, mode: 'different', q: 'سؤال جديد تماماً للقطيع' }, herdBank).mode, 'different');

  const places = outsiderBank.find((c) => c.id === 'places');
  assert.throws(() => SPECS.outsider.validate({ category: 'places', word: places.words[0] }, outsiderBank), /موجودة/);
  // A «new» category with an existing name goes into that category.
  assert.equal(SPECS.outsider.validate({ category: NEW, newName: places.name, word: 'خيمة رمضانية' }, outsiderBank).category, 'places');
});

test('approved entries join the banks; new categories appear once they have enough', () => {
  const seenEntries = [200, 200, 400, 400, 600].map((value, i) => ({ category: NEW, newName: 'سوالف', newEmoji: '🔥', value, q: `س${i}`, a: `ج${i}` }));
  let merged = SPECS.seen.merge(seenBank, seenEntries);
  const mine = merged.find((c) => c.id === newId('سوالف'));
  assert.equal(mine.questions[200].length, 2);
  assert.equal(merged.length, seenBank.length + 1);
  merged = SPECS.seen.merge(seenBank, [{ category: 'general', value: 200, q: 'سؤال', a: 'جواب' }]);
  assert.equal(merged.find((c) => c.id === 'general').questions[200].length, seenBank[0].questions[200].length + 1);
  assert.equal(seenBank[0].questions[200].at(-1).q !== 'سؤال', true, 'the shipped bank is not changed');

  const letters = SPECS.letters.merge(lettersBank, [{ letter: 'ش', q: 'سؤال', a: 'شبل' }]);
  assert.equal(letters.find((l) => l.letter === 'ش').questions.at(-1).a, 'شبل');

  const words = (n) => Array.from({ length: n }, (_, i) => ({ category: NEW, newName: 'شلتنا', newEmoji: '🏕️', word: `كلمة ${i}` }));
  assert.equal(SPECS.outsider.merge(outsiderBank, words(5)).length, outsiderBank.length, 'five words are not enough yet');
  assert.equal(SPECS.outsider.merge(outsiderBank, words(6)).length, outsiderBank.length + 1);
});

test('the file store keeps submissions and decisions', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'community-')), 'c.json');
  const store = new FileStore(file);
  const [a, b] = await store.add([{ game: 'letters', payload: { q: 'x', a: 'شبل' } }, { game: 'herd', payload: { q: 'y' }, submitter: 'فهد' }]);
  assert.equal((await store.list('pending')).length, 2);
  await store.decide(a.id, 'approved', { q: 'x2', a: 'شبل' });
  await store.decide(b.id, 'rejected');
  const again = new FileStore(file);
  assert.deepEqual((await again.list('approved')).map((i) => i.payload.q), ['x2']);
  assert.equal((await again.list('rejected'))[0].submitter, 'فهد');
  assert.equal(await again.remove(a.id), true);
  assert.equal((await again.list()).length, 1);
});

test('the API: anyone can send, only the owner approves, and approved questions reach new rooms', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-api-'));
  const port = 3900 + Math.floor(Math.random() * 500);
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), ADMIN_PASSWORD: 'كلمة سر', COMMUNITY_FILE: path.join(dir, 'c.json'), DATABASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => server.kill());
  await new Promise((resolve) => server.stdout.on('data', (d) => { if (String(d).includes('localhost')) resolve(); }));
  const base = `http://127.0.0.1:${port}/api`;
  const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const admin = { 'x-admin-password': encodeURIComponent('كلمة سر') };

  const spec = await (await fetch(`${base}/contrib/spec`)).json();
  assert.deepEqual(spec.games.map((g) => g.id), ['seen', 'letters', 'herd', 'outsider']);

  const sent = await (await post('/contrib', { game: 'letters', submitter: 'أبو فهد', items: [
    { q: 'وش يسمون صغير الأسد؟ (اختبار)', a: 'شبل' },
    { q: 'بدون جواب', a: '' },
  ] })).json();
  assert.deepEqual([sent.added, sent.errors.map((e) => e.index)], [1, [1]]);

  assert.equal((await fetch(`${base}/admin/submissions`)).status, 401, 'no password, no review');
  assert.equal((await fetch(`${base}/admin/submissions`, { headers: { 'x-admin-password': encodeURIComponent('غلط') } })).status, 401);
  const pending = await (await fetch(`${base}/admin/submissions?status=pending`, { headers: admin })).json();
  assert.equal(pending.items.length, 1);
  assert.equal(pending.items[0].submitter, 'أبو فهد');
  const status = await (await fetch(`${base}/admin/status`, { headers: admin })).json();
  assert.deepEqual([status.storage, status.persistent, status.pending], ['file', false, 1]);

  // The owner fixes a typo while approving.
  const edited = { ...pending.items[0].payload, q: 'وش يسمون صغير الأسد؟' };
  assert.equal((await post(`/admin/submissions/${pending.items[0].id}/approve`, { payload: edited }, admin)).status, 200);
  const approved = await (await fetch(`${base}/admin/submissions?status=approved`, { headers: admin })).json();
  assert.equal(approved.items[0].payload.q, 'وش يسمون صغير الأسد؟');
  // Sending the same question again is now a duplicate.
  const again = await (await post('/contrib', { game: 'letters', items: [edited] })).json();
  assert.match(again.errors[0].error, /موجود/);
  assert.equal((await post(`/admin/submissions/${approved.items[0].id}/delete`, {}, admin)).status, 200);
  const back = await (await post('/contrib', { game: 'letters', items: [edited] })).json();
  assert.equal(back.added, 1, 'deleted from the bank, so it can be sent again');
});
