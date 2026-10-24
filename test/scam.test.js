'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ScamGame, POINTS, NOT_NOTICED } = require('../src/games/scam');
const { RoomManager } = require('../src/rooms');
const { GroupHistory } = require('../src/groups');
const { normalizeAnswer } = require('../src/normalize');

const words = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);
const CATEGORIES = [
  { id: 'food', name: 'أكلات', emoji: '🍔', words: words('أكلة', 10) },
  { id: 'places', name: 'أماكن', emoji: '🏙️', words: words('مكان', 10) },
];
const MISSIONS = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, text: `مهمة ${i}` }));
const PUNISHMENTS = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, short: `ع${i}`, text: `عقوبة ${i}` }));

function newGame(ids = ['a', 'b', 'c', 'd', 'e'], options = {}) {
  const game = new ScamGame({ categories: CATEGORIES, missions: MISSIONS, punishments: PUNISHMENTS, ...options });
  ids.forEach((id) => game.addPlayer(id));
  return game;
}

/** Plays the round up to the vote. */
function toVote(game) {
  game.begin();
  for (let i = 0; i < game.round.order.length; i++) game.nextHinter();
  game.openVote();
}

const others = (game) => game.round.order.filter((id) => id !== game.round.impostor);

/**
 * Everyone votes: `onImpostor` of the others vote for the impostor (the rest for
 * someone else), `naming` of them name the mission (the rest «ما لاحظت»).
 */
function voteAll(game, { onImpostor, naming }) {
  const { impostor, mission } = game.round;
  const crowd = others(game);
  crowd.forEach((id, i) => {
    const target = i < onImpostor ? impostor : crowd.find((t) => t !== id);
    game.vote(id, { target, mission: i < naming ? mission : NOT_NOTICED });
  });
  game.vote(impostor, { target: crowd[0], mission: game.round.missionChoices[0] });
}

test('a round: one impostor with a mission and no word, a circle of hints, then talk and the vote', () => {
  const game = newGame();
  game.start();
  assert.equal(game.phase, 'roles');
  const { round } = game;
  assert.equal(round.order.length, 5);
  assert.ok(round.order.includes(round.impostor));
  assert.ok(MISSIONS.some((m) => m.id === round.mission));
  assert.ok(game.category(round.categoryId).words.includes(round.word));
  assert.equal(round.guessChoices.length, 6);
  assert.ok(round.guessChoices.includes(round.word));
  game.begin();
  assert.equal(game.phase, 'hints');
  for (let i = 1; i < 5; i++) {
    game.nextHinter();
    assert.equal(game.round.hintIndex, i);
  }
  game.nextHinter(); // after the last hint, the talk
  assert.equal(game.phase, 'discuss');
  assert.ok(game.round.endsAt > Date.now(), 'three minutes by default');
  game.openVote();
  assert.equal(game.phase, 'vote');
  assert.equal(game.round.missionChoices.length, 6);
  assert.ok(game.round.missionChoices.includes(game.round.mission));
  game.dispose();
});

test('scoring: right votes, escaping or being caught, the mission and the guess', () => {
  // Caught, mission exposed, word missed: the impostor ends at −4; each right vote +1.
  let game = newGame();
  game.start();
  toVote(game);
  voteAll(game, { onImpostor: 4, naming: 3 });
  game.closeVote();
  assert.deepEqual([game.round.result.caught, game.round.result.exposed], [true, true]);
  game.toGuess();
  game.guess(game.round.impostor, game.round.guessChoices.find((w) => w !== game.round.word));
  assert.equal(game.phase, 'roundOver');
  const { gains, lines } = game.round.result;
  assert.deepEqual(lines.map((l) => [l.key, l.points]), [['caught', -2], ['exposed', -2], ['missed', 0]]);
  assert.equal(gains[game.round.impostor], -4);
  assert.ok(others(game).every((id) => gains[id] === POINTS.vote));

  // Escaped, mission done unnoticed, word guessed: the best round for the impostor, +5.
  game = newGame();
  game.start();
  toVote(game);
  voteAll(game, { onImpostor: 1, naming: 0 });
  game.closeVote();
  assert.deepEqual([game.round.result.caught, game.round.result.exposed], [false, false]);
  assert.throws(() => game.toGuess(), /قرروا/, 'the group decides on the mission first');
  game.toGuess(true);
  game.guess(game.round.impostor, game.round.word);
  assert.deepEqual(game.round.result.lines.map((l) => l.key), ['escaped', 'done', 'guessed']);
  assert.equal(game.round.result.gains[game.round.impostor], 5);
  assert.equal(Object.values(game.round.result.gains).filter((n) => n === 1).length, 1, 'the one right vote');

  // Escaped, mission not done, guess skipped: +2.
  game = newGame();
  game.start();
  toVote(game);
  voteAll(game, { onImpostor: 0, naming: 0 });
  game.closeVote();
  game.toGuess(false);
  game.skipGuess();
  assert.deepEqual(game.round.result.lines.map((l) => [l.key, l.points]), [['escaped', 2], ['notDone', 0], ['missed', 0]]);
});

test('caught means more votes than anyone else; exposed means more than half the others who answered named it', () => {
  const game = newGame(['a', 'b', 'c', 'd', 'e', 'f']);
  game.start();
  toVote(game);
  const { impostor, mission } = game.round;
  const [x, y, z, w, v] = others(game);
  // Two each on the impostor and on x: a tie, so not caught.
  game.vote(x, { target: impostor, mission });
  game.vote(y, { target: impostor, mission });
  game.vote(z, { target: x, mission: NOT_NOTICED });
  game.vote(w, { target: x, mission: NOT_NOTICED });
  game.vote(v, { target: y }); // didn't answer the mission
  game.vote(impostor, { target: x, mission }); // the impostor's pick doesn't count
  game.closeVote();
  const { result } = game.round;
  assert.equal(result.caught, false);
  assert.deepEqual([result.named, result.answered, result.exposed], [2, 4, false], 'two of four isn\'t more than half');
});

test('both questions are needed before the vote closes by itself; answers can change until then', () => {
  const manager = new RoomManager({ outsiderCategories: CATEGORIES });
  const room = manager.create();
  room.setGameType('scam');
  const ps = ['أحمد', 'سارة', 'فهد', 'نورة'].map((name, i) => {
    const p = room.join({ name });
    room.connect(p.id, `s${i}`);
    return p.id;
  });
  room.game.start();
  toVote(room.game);
  const { impostor, mission } = room.game.round;
  const crowd = ps.filter((id) => id !== impostor);
  for (const id of crowd) room.scamVote(id, { target: impostor });
  room.scamVote(impostor, { target: crowd[0] });
  assert.equal(room.game.phase, 'vote', 'nobody has named a mission yet');
  room.scamVote(crowd[0], { target: crowd[1] }); // changed their mind
  for (const id of ps) room.scamVote(id, { mission: id === impostor ? NOT_NOTICED : mission });
  assert.equal(room.game.phase, 'reveal');
  assert.equal(room.game.round.result.caught, true);
  assert.equal(room.game.round.result.exposed, true);
  room.dispose();
});

test('nobody sees what isn\'t theirs: the TV no word, impostor or mission before the vote is in', () => {
  const manager = new RoomManager({ outsiderCategories: CATEGORIES });
  const room = manager.create();
  room.setGameType('scam');
  const ps = ['أحمد', 'سارة', 'فهد', 'نورة', 'خالد'].map((name, i) => {
    const p = room.join({ name });
    room.connect(p.id, `s${i}`);
    return p.id;
  });
  room.game.start();
  const { word, impostor, mission } = room.game.round;
  const missionText = MISSIONS.find((m) => m.id === mission)?.text ?? room.game.mission(mission).text;
  const host = JSON.stringify(room.hostView());
  assert.ok(!host.includes(word) && !host.includes(missionText), 'the TV knows neither');
  assert.equal(room.hostView().round.impostor, null);
  for (const id of ps) {
    const me = room.playerView(id).me;
    if (id === impostor) {
      assert.equal(me.word, null);
      assert.equal(me.mission.text, missionText);
      assert.ok(!JSON.stringify(room.playerView(id)).includes(word), 'the impostor never gets the word');
    } else {
      assert.equal(me.word, word);
      assert.equal(me.mission, null);
      assert.ok(!JSON.stringify(room.playerView(id)).includes(missionText));
    }
  }
  toVote(room.game);
  const choices = room.playerView(ps[0]).round.missionChoices.map((m) => m.id);
  assert.ok(ps.every((id) => JSON.stringify(room.playerView(id).round.missionChoices.map((m) => m.id)) === JSON.stringify(choices)), 'the same six on every phone');
  room.game.closeVote();
  assert.equal(room.hostView().round.impostor.id, impostor);
  assert.equal(room.hostView().round.mission.text, missionText);
  assert.equal(room.hostView().round.word, null, 'the word only at the end of the round');
  room.dispose();
});

test('the impostor can swap a mission once, before the vote', () => {
  const game = newGame();
  game.start();
  const { impostor, mission } = game.round;
  const crowd = others(game);
  assert.throws(() => game.swapMission(crowd[0]), /للنصاب/);
  game.swapMission(impostor);
  assert.notEqual(game.round.mission, mission);
  assert.throws(() => game.swapMission(impostor), /خلاص/);
  toVote(game);
  assert.ok(game.round.missionChoices.includes(game.round.mission), 'the swapped mission is the one asked about');
});

test('nobody is the impostor two rounds running; words don\'t repeat; the impostor leaving calls the round off', () => {
  const game = newGame();
  game.start();
  const seen = new Set([game.round.word]);
  for (let i = 0; i < 4; i++) {
    const before = game.round.impostor;
    toVote(game);
    game.closeVote();
    game.toGuess(false);
    game.skipGuess();
    game.next();
    assert.notEqual(game.round.impostor, before);
    assert.ok(!seen.has(game.round.word));
    seen.add(game.round.word);
  }
  game.removePlayer(game.round.impostor);
  assert.equal(game.phase, 'roundOver');
  assert.equal(game.round.result.aborted, true);
});

test('the punishment wheel picks the lowest score (by lot on a tie) and can spin again', () => {
  const game = newGame(['a', 'b', 'c', 'd']);
  game.start();
  game.finish();
  game.players.get('a').score = 3;
  game.players.get('b').score = -2;
  game.players.get('c').score = 1;
  game.players.get('d').score = 0;
  game.spinPunishment();
  const first = game.punishment;
  assert.equal(first.loser, 'b');
  assert.equal(first.wheel.length, 8);
  assert.ok(first.wheel.includes(first.id));
  game.spinPunishment();
  assert.notEqual(game.punishment.id, first.id, 'a new one on the next spin');
  assert.notEqual(game.punishment.spinId, first.spinId);
  game.players.get('d').score = -2;
  const losers = new Set();
  for (let i = 0; i < 20; i++) {
    game.spinPunishment();
    losers.add(game.punishment.loser);
  }
  assert.deepEqual([...losers].sort(), ['b', 'd']);
  assert.deepEqual(game.nightPoints(), { a: 3, c: 2 }, 'negative scores rank last');
});

test('a group gets words it hasn\'t had, recorded as they show', () => {
  const had = CATEGORIES.flatMap((c) => c.words).slice(0, 19).map((w) => [normalizeAnswer(w), 1]);
  const history = new GroupHistory(had);
  const game = newGame(['a', 'b', 'c', 'd'], { groupHistory: history });
  game.start();
  assert.equal(game.round.word, 'مكان 10', 'the one word it hasn\'t had');
  assert.equal(history.size, 20);
  assert.equal(game.unitCount(), 20);
});

test('settings, the four-player minimum, and the data file', () => {
  const game = newGame(['a', 'b', 'c']);
  assert.throws(() => game.start(), /4 لاعبين/);
  game.updateSettings({ rounds: 4, discussSeconds: 60, categories: ['places', 'x'] });
  assert.deepEqual([game.settings.rounds, game.settings.discussSeconds, game.settings.categories], [5, 180, ['places']]);
  const { missions, punishments } = require('../data/scam.json');
  assert.ok(missions.length >= 40 && punishments.length >= 20);
  assert.equal(new Set(missions.map((m) => m.text)).size, missions.length);
  assert.ok(punishments.every((p) => p.short.length <= 10));
});
