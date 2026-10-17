'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FileSurvey, roundRecord, toFeudQuestions, MIN_RESPONSES } = require('../src/survey');
const { HerdGame } = require('../src/games/herd');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'survey-')), 's.json');

test('a round becomes counts per answer (spellings together); small rounds don\'t count', () => {
  const r = roundRecord('اذكر لون', [{ text: 'أحمر', count: 3 }, { text: 'الاحمر', count: 1 }, { text: 'أزرق', count: 2 }]);
  assert.equal(r.responses, 6);
  assert.deepEqual(r.answers.map((a) => [a.text, a.count]), [['أحمر', 4], ['أزرق', 2]]);
  assert.equal(roundRecord('اذكر لون', [{ text: 'أحمر', count: 2 }]), null, 'fewer than three answers');
});

test('a question plays once it has enough answers over enough rounds; points out of 100', async () => {
  const store = new FileSurvey(tmpFile());
  const round = [{ text: 'أحمر', count: 5 }, { text: 'أزرق', count: 3 }, { text: 'أخضر', count: 2 }, { text: 'أصفر', count: 2 }, { text: 'بنفسجي', count: 1 }];
  await store.record(roundRecord('اذكر لون', round));
  await store.record(roundRecord('اذكر لون', round));
  assert.deepEqual(toFeudQuestions(await store.all()), [], 'not enough yet');
  await store.record(roundRecord('اذكر لون', round));
  const [q] = toFeudQuestions(await new FileSurvey(store.file).all());
  assert.equal(q.q, 'اذكر لون');
  assert.equal(q.source, 'survey');
  assert.equal(q.responses, 39);
  assert.ok(q.responses >= MIN_RESPONSES);
  assert.deepEqual(q.answers.map((a) => [a.a, a.points]), [['أحمر', 38], ['أزرق', 23], ['أخضر', 15], ['أصفر', 15], ['بنفسجي', 8]],
    'بنفسجي: once a round, three in all, so it counts');
});

test('«عقلية القطيع» sends «مع القطيع» rounds on its own questions, not custom ones or «عكس القطيع»', () => {
  const sent = [];
  const categories = [{ id: 'c', name: 'ألوان', emoji: '🎨', subcategories: [{ id: 'c-a', name: 'أ', same: ['اذكر لون', 'اذكر فاكهة', 'اذكر حيوان'], different: ['اذكر رقم'] }] }];
  const game = new HerdGame({ categories, random: () => 0.1, onSurvey: (r) => sent.push(r) });
  ['a', 'b', 'c', 'd'].forEach((id) => game.addPlayer(id));
  game.updateSettings({ rounds: 2 });
  game.start();
  game.submitAnswer('a', { text: 'أحمر', value: 1 });
  game.submitAnswer('b', { text: 'احمر', value: 2 });
  game.submitAnswer('c', { text: 'أزرق', value: 3 });
  game.submitAnswer('d', { text: 'شي غلط', value: 4 });
  game.reveal();
  game.toggleReject(game.round.groups.find((g) => g.text === 'شي غلط').id);
  game.confirm();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].groups.map((g) => [g.text, g.count]), [['أحمر', 2], ['أزرق', 1]], 'rejected answers left out; no names');
  assert.ok(!JSON.stringify(sent[0]).includes('"a"'));

  const custom = new HerdGame({ categories, onSurvey: (r) => sent.push(r) });
  ['a', 'b', 'c'].forEach((id) => custom.addPlayer(id));
  custom.updateSettings({ source: 'custom', customQuestions: ['مين أطول واحد فينا؟'] });
  custom.start();
  ['a', 'b', 'c'].forEach((id, i) => custom.submitAnswer(id, { text: 'فهد', value: i + 1 }));
  custom.reveal();
  custom.confirm();
  assert.equal(sent.length, 1, 'the host\'s own question stays out');

  const different = new HerdGame({ categories, onSurvey: (r) => sent.push(r) });
  ['a', 'b', 'c'].forEach((id) => different.addPlayer(id));
  different.updateSettings({ mode: 'different' });
  different.start();
  ['أ', 'ب', 'ج'].forEach((text, i) => different.submitAnswer(['a', 'b', 'c'][i], { text, value: i + 1 }));
  different.reveal();
  different.confirm();
  assert.equal(sent.length, 1, '«عكس القطيع» answers are meant to differ, so they stay out');
});
