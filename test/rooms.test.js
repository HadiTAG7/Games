'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RoomManager, ROOM_TTL_MS } = require('../src/rooms');
const { GameError } = require('../src/games/herd');

const prompts = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);
const CATEGORIES = [
  { id: 'food', name: 'أكل', emoji: '🍔', subcategories: [
    { id: 'food-a', name: 'شعبي', same: prompts('أكل', 12), different: prompts('أكل مختلف', 4) },
  ] },
  { id: 'places', name: 'أماكن', emoji: '🏠', subcategories: [
    { id: 'places-a', name: 'البيت', same: prompts('مكان', 8), different: prompts('مكان مختلف', 6) },
  ] },
]

function setup(names = ['أحمد', 'سارة', 'فهد']) {
  const manager = new RoomManager({ categories: CATEGORIES });
  const room = manager.create();
  const players = names.map((name, i) => {
    const p = room.join({ name });
    room.connect(p.id, `socket-${i}`);
    return p;
  });
  return { manager, room, players };
}

test('rooms get unique 4-digit codes and can be looked up', () => {
  const manager = new RoomManager({ categories: CATEGORIES });
  const codes = new Set(Array.from({ length: 50 }, () => manager.create().code));
  assert.equal(codes.size, 50);
  for (const code of codes) {
    assert.match(code, /^\d{4}$/);
    assert.equal(manager.get(` ${code} `).code, code);
  }
  assert.equal(manager.get('0000'), undefined);
});

test('names must be present and unique (ignoring hamza and spacing)', () => {
  const { room } = setup(['أحمد']);
  assert.throws(() => room.join({ name: '  ' }), GameError);
  assert.throws(() => room.join({ name: ' احمد ' }), /مأخوذ/);
});

test('rejoining with a player id keeps score and bets', () => {
  const { room, players: [a, b] } = setup();
  room.game.start();
  room.submitAnswer(a.id, { text: 'أحمر', value: 5 });
  room.submitAnswer(b.id, { text: 'أحمر', value: 4 });
  room.game.reveal();
  room.game.confirm();
  room.disconnect(a.id, 'socket-0');
  const again = room.join({ playerId: a.id, name: 'ignored' });
  assert.equal(again.id, a.id);
  assert.equal(room.players.size, 3);
  assert.equal(room.playerView(a.id).me.score, 5);
  assert.deepEqual(room.playerView(a.id).me.used, [5]);
});

test('reveal happens once every connected player has answered', () => {
  const { room, players: [a, b, c] } = setup();
  room.game.start();
  room.disconnect(c.id, 'socket-2');
  room.submitAnswer(a.id, { text: 'أحمر', value: 1 });
  assert.equal(room.game.phase, 'question');
  room.submitAnswer(b.id, { text: 'أحمر', value: 1 });
  assert.equal(room.game.phase, 'reveal');
});

test('kicking the last player who has not answered triggers the reveal', () => {
  const { room, players: [a, b, c] } = setup();
  room.game.start();
  room.submitAnswer(a.id, { text: 'أحمر', value: 1 });
  room.submitAnswer(b.id, { text: 'أحمر', value: 1 });
  room.kick(c.id);
  assert.equal(room.game.phase, 'reveal');
  assert.equal(room.players.has(c.id), false);
  assert.equal(room.game.players.has(c.id), false);
});

test('players never see other answers before the results', () => {
  const { room, players: [a, b, c] } = setup();
  room.game.start();
  room.submitAnswer(a.id, { text: 'سري', value: 3 });
  const view = room.playerView(b.id);
  assert.equal(view.myAnswer, null);
  assert.equal(view.groups, undefined);
  assert.equal(JSON.stringify(view).includes('سري'), false);
  assert.equal(room.hostView().players.find((p) => p.id === a.id).answered, true);
  assert.equal(JSON.stringify(room.hostView()).includes('سري'), false, 'host sees who answered, not what');

  room.submitAnswer(b.id, { text: 'سري', value: 2 });
  room.submitAnswer(c.id, { text: 'غيره', value: 2 });
  assert.equal(room.game.phase, 'reveal');
  assert.equal(room.playerView(c.id).groups, undefined, 'still hidden while the host reviews');
  room.game.confirm();
  const results = room.playerView(c.id);
  assert.equal(results.groups.length, 2);
  assert.equal(results.last.won, false);
  assert.equal(room.playerView(a.id).me.rank, 1);
});

test('idle rooms are cleaned up', () => {
  const { manager, room } = setup();
  manager.cleanup(room.lastActivity + ROOM_TTL_MS - 1);
  assert.ok(manager.get(room.code));
  manager.cleanup(room.lastActivity + ROOM_TTL_MS + 1);
  assert.equal(manager.get(room.code), undefined);
});

test('views carry the mode, rejected groups and the final winners', () => {
  const { room, players: [a, b, c] } = setup();
  room.game.updateSettings({ rounds: 1, mode: 'different' });
  assert.equal(room.hostView().mode, 'different');
  assert.equal(room.hostView().bankSize, 10);
  assert.deepEqual(room.hostView().categories.map((c) => [c.id, c.subcategories[0].counts.different]), [['food', 4], ['places', 6]]);
  room.game.start();
  room.submitAnswer(a.id, { text: 'أحمر', value: 2 });
  room.submitAnswer(b.id, { text: 'أزرق', value: 3 });
  room.submitAnswer(c.id, { text: 'زرافة', value: 15 });
  const giraffe = room.hostView().groups.find((g) => g.text === 'زرافة');
  room.game.toggleReject(giraffe.id);
  assert.equal(room.hostView().groups.find((g) => g.id === giraffe.id).rejected, true);
  assert.equal(room.hostView().canUndo, true);
  room.game.confirm();
  assert.equal(room.playerView(c.id).last.rejected, true);
  assert.equal(room.playerView(c.id).mode, 'different');
  room.game.next();
  assert.deepEqual(room.hostView().winners, ['سارة']);
  assert.equal(room.playerView(b.id).isWinner, true);
  assert.equal(room.playerView(a.id).isWinner, false);
});

test('the host sees who skipped and which number burned', () => {
  const { room, players: [a, b, c] } = setup();
  room.game.start();
  room.submitAnswer(a.id, { text: 'أحمر', value: 4 });
  room.submitAnswer(b.id, { text: 'أحمر', value: 5 });
  room.game.reveal();
  room.game.confirm();
  assert.deepEqual(room.hostView().missed, [{ name: 'فهد', value: 1 }]);
  assert.deepEqual(room.playerView(c.id).me.used, [1]);
});

test('views show the category of the current question', () => {
  const { room, players: [a] } = setup();
  room.game.updateSettings({ subcategories: ['places-a'] });
  room.game.start();
  assert.deepEqual(room.hostView().category, { name: 'أماكن', emoji: '🏠', sub: 'البيت' });
  assert.deepEqual(room.playerView(a.id).category, { name: 'أماكن', emoji: '🏠', sub: 'البيت' });
});

test('votes: connected non-authors vote, it closes by itself, and the host sees no tally early', () => {
  const { room, players: [a, b, c] } = setup();
  const d = room.join({ name: 'نوف' });
  room.connect(d.id, 'socket-d');
  room.game.start();
  room.submitAnswer(a.id, { text: 'زرافة', value: 1 });
  room.submitAnswer(b.id, { text: 'أحمر', value: 1 });
  room.submitAnswer(c.id, { text: 'أزرق', value: 1 });
  room.disconnect(d.id, 'socket-d');
  room.game.reveal();
  const giraffe = room.hostView().groups.find((g) => g.text === 'زرافة');
  room.startVote(giraffe.id);
  assert.equal(room.hostView().vote.eligibleCount, 2, 'the author and the disconnected player are out');
  assert.equal(room.playerView(a.id).vote.isAuthor, true);
  assert.equal(room.playerView(a.id).vote.canVote, false);
  assert.equal(room.playerView(b.id).vote.canVote, true);

  room.castVote(b.id, 'reject');
  const hostVote = room.hostView().vote;
  assert.equal(hostVote.votedCount, 1);
  assert.equal(hostVote.keep, undefined, 'no tally while voting');
  assert.deepEqual(hostVote.voters.map((v) => v.voted).sort(), [false, true]);
  assert.equal(room.playerView(b.id).vote.myVote, 'reject');

  room.castVote(c.id, 'reject');
  assert.equal(room.hostView().vote, null, 'closed once everyone voted');
  assert.equal(room.hostView().lastVote.rejected, true);
  assert.equal(room.playerView(a.id).lastVote.reject, 2);
  assert.equal(room.hostView().groups.find((g) => g.id === giraffe.id).rejected, true);
});

test('votes close when the last voter who has not voted disconnects, and a tie shows the tally', () => {
  const { room, players: [a, b, c] } = setup();
  const d = room.join({ name: 'نوف' });
  room.connect(d.id, 'socket-d');
  room.game.start();
  room.submitAnswer(a.id, { text: 'زرافة', value: 1 });
  room.submitAnswer(b.id, { text: 'أحمر', value: 1 });
  room.submitAnswer(c.id, { text: 'أزرق', value: 1 });
  room.submitAnswer(d.id, { text: 'أصفر', value: 1 });
  const giraffe = room.hostView().groups.find((g) => g.text === 'زرافة');
  room.startVote(giraffe.id);
  room.castVote(b.id, 'keep');
  room.castVote(c.id, 'reject');
  room.disconnect(d.id, 'socket-d');
  const vote = room.hostView().vote;
  assert.equal(vote.status, 'tie');
  assert.deepEqual([vote.keep, vote.reject], [1, 1]);
  assert.equal(room.playerView(b.id).vote.status, 'tie');
});

test('«بطل السهرة» adds each finished game once, across games', () => {
  const manager = new RoomManager({ categories: CATEGORIES, letters: require('../data/letters.json').letters });
  const room = manager.create();
  const [a, b, c] = ['أحمد', 'سارة', 'فهد'].map((name) => room.join({ name }));
  // «عقلية القطيع» ends with أحمد first and سارة second.
  room.game.start();
  room.game.players.get(a.id).score = 9;
  room.game.players.get(b.id).score = 4;
  room.game.finish();
  assert.equal(room.settleNight(), true);
  assert.equal(room.settleNight(), false, 'counted once');
  assert.deepEqual(room.night.standings(room.playerList()).map((r) => [r.name, r.points, r.rank]),
    [['أحمد', 3, 1], ['سارة', 2, 2]]);
  // Then «حروف»: the blue team wins.
  room.setGameType('letters');
  room.settleNight();
  room.game.setTeam(a.id, 'red');
  room.game.setTeam(b.id, 'blue');
  room.game.setTeam(c.id, 'blue');
  room.game.start();
  room.game.score.blue = 1;
  room.game.finish();
  room.settleNight();
  const rows = room.night.standings(room.playerList());
  assert.deepEqual(rows.map((r) => [r.name, r.points, r.wins]), [['سارة', 5, 1], ['أحمد', 3, 1], ['فهد', 3, 1]]);
  // A new game of the same kind counts again once it ends.
  room.game.restart();
  room.settleNight();
  room.game.start();
  room.game.finish();
  assert.equal(room.settleNight(), true, 'a 0–0 game still settles');
  assert.equal(room.night.standings(room.playerList())[0].points, 5, 'but a game nobody scored in gives nothing');
  room.night.crown(true);
  assert.equal(room.hostView().night.crowned, true);
  room.kick(b.id);
  assert.equal(room.playerView(a.id).night.standings[0].name, 'أحمد');
  room.night.reset();
  assert.deepEqual(room.hostView().night, { standings: [], crowned: false });
});
