'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RoomManager, ROOM_TTL_MS } = require('../src/rooms');
const { GameError } = require('../src/games/herd');

const BANK = Array.from({ length: 20 }, (_, i) => `سؤال ${i + 1}`);

function setup(names = ['أحمد', 'سارة', 'فهد']) {
  const manager = new RoomManager({ questionBank: BANK });
  const room = manager.create();
  const players = names.map((name, i) => {
    const p = room.join({ name });
    room.connect(p.id, `socket-${i}`);
    return p;
  });
  return { manager, room, players };
}

test('rooms get unique 4-digit codes and can be looked up', () => {
  const manager = new RoomManager({ questionBank: BANK });
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

test('views show who holds the pink cow and the final winners', () => {
  const { room, players: [a, b, c] } = setup();
  room.game.updateSettings({ rounds: 1 });
  room.game.start();
  room.submitAnswer(a.id, { text: 'أحمر', value: 2 });
  room.submitAnswer(b.id, { text: 'أحمر', value: 3 });
  room.submitAnswer(c.id, { text: 'أزرق', value: 15 });
  room.game.confirm();
  assert.equal(room.hostView().pinkCowTaker, 'فهد');
  assert.equal(room.hostView().players.find((p) => p.id === c.id).pinkCow, true);
  assert.equal(room.playerView(c.id).me.pinkCow, true);
  assert.equal(room.playerView(c.id).last.pinkCow, true);
  room.game.next();
  assert.deepEqual(room.hostView().winners, ['سارة']);
  assert.equal(room.playerView(b.id).isWinner, true);
  assert.equal(room.playerView(c.id).isWinner, false);
  assert.equal(room.hostView().pinkCowTaker, null);
});
