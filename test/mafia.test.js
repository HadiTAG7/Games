'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MafiaGame, autoMafia } = require('../src/games/mafia');
const { RoomManager } = require('../src/rooms');

const IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

/** A started game with the roles dealt as given: { id: role }. */
function dealt(roles) {
  const game = new MafiaGame({ random: () => 0.5 });
  Object.keys(roles).forEach((id) => game.addPlayer(id));
  game.start();
  for (const [id, role] of Object.entries(roles)) game.players.set(id, { role, alive: true });
  return game;
}

const SEVEN = { a: 'mafia', b: 'doctor', c: 'police', d: 'sniper', e: 'mayor', f: 'citizen', g: 'citizen' };

/** Everyone alive picks: the given picks, or a harmless guess. */
function night(game, picks) {
  game.startNight();
  for (const id of game.alive()) {
    const target = picks[id] !== undefined ? picks[id] : game.alive().find((t) => t !== id && game.roleOf(t) !== 'mafia');
    if (game.roleOf(id) === 'sniper' && picks[id] === undefined) game.pick(id, null);
    else game.pick(id, target);
  }
  game.endNight();
}

test('the lineup: mafia by player count, special roles while a citizen is left', () => {
  assert.deepEqual([5, 7, 8, 11, 12, 20].map(autoMafia), [1, 1, 2, 2, 3, 3]);
  const game = new MafiaGame();
  IDS.slice(0, 5).forEach((id) => game.addPlayer(id));
  assert.deepEqual(game.lineup(), { mafia: 1, doctor: 1, police: 1, mayor: 1, citizen: 1 });
  game.addPlayer('f');
  assert.deepEqual(game.lineup(), { mafia: 1, doctor: 1, police: 1, mayor: 1, sniper: 1, citizen: 1 });
  game.updateSettings({ roles: { sniper: false, mayor: false }, mafia: 3 });
  assert.deepEqual(game.lineup(), { mafia: 1, doctor: 1, police: 1, citizen: 3 }, 'mafia capped below a third');
  game.start();
  const roles = [...game.players.values()].map((p) => p.role).sort();
  assert.deepEqual(roles, ['citizen', 'citizen', 'citizen', 'doctor', 'mafia', 'police']);
});

test('the doctor saves the mafia\'s victim; the police learn the truth at once', () => {
  const game = dealt(SEVEN);
  game.startNight();
  game.pick('c', 'a');
  assert.deepEqual(game.checks, [{ night: 1, target: 'a', mafia: true }]);
  assert.throws(() => game.pick('c', 'f'), /خلاص/, 'one question a night');
  assert.throws(() => game.pick('a', 'a'), /غيرك/);
  game.pick('a', 'f');
  game.pick('b', 'f');
  game.endNight();
  assert.equal(game.phase, 'morning');
  assert.deepEqual(game.announcement, { kind: 'morning', deaths: [], saved: true, shot: false });
  assert.ok(game.players.get('f').alive);
  // Not the same person two nights running.
  game.startDiscussion();
  game.startVote();
  game.endVote();
  game.startNight();
  assert.throws(() => game.pick('b', 'f'), /ليلتين/);
});

test('the sniper has one bullet; a kill without the doctor lands', () => {
  const game = dealt(SEVEN);
  night(game, { a: 'g', d: 'f', b: 'b' });
  assert.deepEqual(game.announcement.deaths.sort(), ['f', 'g']);
  assert.equal(game.announcement.shot, true);
  assert.equal(game.bulletUsed, true);
  game.startDiscussion();
  game.startVote();
  game.endVote();
  game.startNight();
  assert.throws(() => game.pick('d', null), /اختر لاعب/, 'no bullet left to hold');
});

test('the mayor\'s vote counts twice; a tie sends nobody out', () => {
  const game = dealt(SEVEN);
  night(game, { a: 'g', b: 'g' }); // saved
  game.startDiscussion();
  game.startVote();
  game.castVote('e', 'a'); // mayor: 2
  game.castVote('f', 'b');
  game.castVote('g', 'b'); // 2 – 2
  game.endVote();
  assert.equal(game.announcement.out, null, 'a tie');
  game.startNight();
  game.endNight();
  game.startDiscussion();
  game.startVote();
  game.castVote('e', 'a');
  game.castVote('f', 'b');
  game.endVote();
  assert.equal(game.announcement.out, 'a');
  assert.equal(game.winner, 'town', 'the only mafia is out');
  game.next();
  assert.equal(game.phase, 'final');
  assert.deepEqual(game.nightPoints(), { b: 3, c: 3, d: 3, e: 3, f: 3, g: 3 });
});

test('«ما نطلّع أحد» on top keeps everyone in', () => {
  const game = dealt(SEVEN);
  night(game, { a: 'g', b: 'g' });
  game.startVote();
  game.castVote('b', 'none');
  game.castVote('c', 'none');
  game.castVote('f', 'a');
  game.endVote();
  assert.equal(game.announcement.out, null);
});

test('the mafia win once they match the rest', () => {
  const game = dealt({ a: 'mafia', b: 'citizen', c: 'citizen', d: 'citizen', e: 'citizen' });
  night(game, { a: 'b' });
  assert.equal(game.winner, null);
  game.startVote();
  game.castVote('a', 'c');
  game.castVote('d', 'c');
  game.endVote(); // c out: a vs d, e
  night(game, { a: 'd' }); // d dead: a vs e
  assert.equal(game.winner, 'mafia');
  assert.deepEqual(game.nightPoints(), { a: 3 });
});

const EIGHT = { ...SEVEN, h: 'mafia' };

test('two mafia: they point, see each other, and only an agreed and confirmed victim dies', () => {
  const game = dealt(EIGHT);
  game.startNight();
  game.pick('d', null);
  game.pick('a', 'f');
  assert.deepEqual(game.mafiaPlan(), { team: true, pointed: ['a'], agreed: 'f', confirmed: [], locked: false, victim: null });
  assert.throws(() => game.confirmPick('b'), /للمافيا/);
  assert.throws(() => game.confirmPick('h'), /اتفقوا/, 'h hasn\'t pointed at f');
  game.pick('h', 'g');
  assert.throws(() => game.confirmPick('a'), /اتفقوا/, 'f and g: no agreement');
  game.endNight();
  assert.deepEqual(game.announcement.deaths, [], 'no agreement, nobody dies');

  game.phase = 'verdict';
  game.startNight();
  game.pick('a', 'f');
  game.pick('h', 'f');
  game.confirmPick('a');
  assert.equal(game.mafiaPlan().locked, false, 'h still to confirm');
  game.endNight();
  assert.deepEqual(game.announcement.deaths, [], 'agreed but not confirmed by both');

  game.phase = 'verdict';
  game.startNight();
  game.pick('a', 'f');
  game.confirmPick('a');
  assert.equal(game.mafiaPlan().locked, true, 'alone so far: h hasn\'t pointed');
  game.pick('h', 'f');
  assert.deepEqual(game.mafiaPlan().confirmed, ['a'], 'pointing at the agreed one keeps a\'s confirmation');
  game.pick('h', 'g');
  assert.deepEqual(game.mafiaPlan().confirmed, [], 'pointing elsewhere undoes everyone\'s');
  game.pick('h', 'f');
  assert.equal(game.mafiaPlan().confirmed.length, 0, 'back on f, both confirm again');
  game.confirmPick('a');
  game.confirmPick('h');
  assert.equal(game.mafiaPlan().victim, 'f');
  game.endNight();
  assert.deepEqual(game.announcement.deaths, ['f']);
});

test('two mafia: the doctor still saves their victim; the night waits for their «اعتمد»', () => {
  const game = dealt(EIGHT);
  game.startNight();
  const online = game.alive();
  for (const id of online) {
    if (id === 'a' || id === 'h') game.pick(id, 'g');
    else if (id === 'b') game.pick(id, 'g');
    else if (id === 'd') game.pick(id, null);
    else game.pick(id, 'a');
  }
  game.maybeEndNight(online);
  assert.equal(game.night.ending, false, 'everyone picked, the mafia haven\'t confirmed');
  assert.equal(game.hasActed('a'), false);
  game.confirmPick('a');
  game.maybeEndNight(online);
  assert.equal(game.night.ending, false);
  game.confirmPick('h');
  game.maybeEndNight(online);
  assert.equal(game.night.ending, true);
  game.endNight();
  assert.deepEqual([game.announcement.deaths, game.announcement.saved], [[], true]);
  game.dispose();
});

test('a lone mafia (the other one out) picks with one tap', () => {
  const game = dealt(EIGHT);
  game.players.get('h').alive = false;
  game.startNight();
  game.pick('a', 'f');
  assert.equal(game.hasActed('a'), true);
  game.confirmPick('a'); // harmless
  game.endNight();
  assert.deepEqual(game.announcement.deaths, ['f']);
});

test('the night ends a few seconds after everyone online has picked', async () => {
  const game = new MafiaGame({ random: () => 0 });
  let woke = 0;
  game.onTimeout = () => { woke += 1; };
  IDS.slice(0, 5).forEach((id) => game.addPlayer(id));
  game.start();
  game.startNight();
  const alive = game.alive();
  for (const id of alive.slice(0, 4)) {
    const role = game.roleOf(id);
    const target = alive.find((t) => t !== id && (role !== 'mafia' || game.roleOf(t) !== 'mafia'));
    game.pick(id, target);
  }
  game.maybeEndNight(alive);
  assert.equal(game.night.ending, false, 'one still to pick');
  game.maybeEndNight(alive.slice(0, 4)); // the fifth went offline
  assert.equal(game.night.ending, true);
  await new Promise((r) => setTimeout(r, 2100));
  assert.equal(game.phase, 'morning');
  assert.equal(woke, 1);
  game.dispose();
});

test('screens: roles go to their owner, the mafia see each other, the big screen sees none', () => {
  const manager = new RoomManager({ categories: [] });
  const room = manager.create();
  const ps = ['أحمد', 'سارة', 'فهد', 'نورة', 'خالد', 'ريم', 'سلطان', 'منى'].map((name, i) => {
    const p = room.join({ name });
    room.connect(p.id, `s${i}`);
    return p;
  });
  room.setGameType('mafia');
  room.game.start();
  const roleOf = (p) => room.game.roleOf(p.id);
  const host = room.hostView();
  for (const row of host.players) assert.equal(row.role, roleOf({ id: row.id }) === 'mayor' ? 'mayor' : null);
  const mafia = ps.filter((p) => roleOf(p) === 'mafia');
  assert.equal(mafia.length, 2);
  const mine = room.playerView(mafia[0].id);
  assert.equal(mine.me.role, 'mafia');
  assert.deepEqual(mine.me.team.map((t) => t.id), [mafia[1].id]);
  const citizen = ps.find((p) => roleOf(p) !== 'mafia' && roleOf(p) !== 'mayor');
  const theirs = room.playerView(citizen.id);
  assert.equal(theirs.me.team, null);
  assert.ok(theirs.players.every((row) => row.role === null || row.role === 'mayor' || row.id === citizen.id));
  // Night: the room waits for everyone, the mafia's «اعتمد» too, then the host screen still shows no roles.
  room.game.startNight();
  for (const p of ps) {
    const target = ps.find((t) => t !== p && (roleOf(p) !== 'mafia' || roleOf(t) !== 'mafia'));
    room.mafiaPick(p.id, target.id);
  }
  assert.equal(room.game.night.ending, false, 'the mafia agree but haven\'t confirmed');
  // Each mafia sees the other's pointing; nobody else does.
  const plan = room.playerView(mafia[0].id).me;
  const target = room.game.night.picks.get(mafia[1].id);
  assert.deepEqual(plan.team[0].pick, { id: target, name: room.nameOf(target) });
  assert.deepEqual(plan.plan, { team: true, agreed: { id: target, name: room.nameOf(target) }, confirmed: false, locked: false });
  assert.equal(room.playerView(citizen.id).me.plan, null);
  assert.ok(!JSON.stringify(room.hostView()).includes('"plan"'));
  room.mafiaConfirm(mafia[0].id);
  assert.equal(room.playerView(mafia[1].id).me.team[0].confirmed, true);
  for (const p of mafia) room.mafiaConfirm(p.id);
  assert.equal(room.game.night.ending, true);
  room.game.endNight();
  const dead = room.game.announcement.deaths;
  for (const id of dead) {
    const ghost = room.playerView(id);
    assert.ok(ghost.players.every((row) => row.role), 'the dead see everyone');
  }
  room.dispose();
});

test('«بطل السهرة» reaches the screens when a mafia game ends', () => {
  const room = new RoomManager({ categories: [] }).create();
  const ps = ['a', 'b', 'c', 'd', 'e'].map((name, i) => {
    const p = room.join({ name });
    room.connect(p.id, `s${i}`);
    return p;
  });
  room.setGameType('mafia');
  room.game.start();
  const game = room.game;
  const mafia = ps.find((p) => game.roleOf(p.id) === 'mafia');
  game.startNight();
  game.endNight();
  game.startVote();
  for (const p of ps) if (p !== mafia) game.castVote(p.id, mafia.id);
  game.endVote();
  game.next();
  room.settleNight();
  assert.equal(room.hostView().night.standings.length, 4);
  assert.equal(room.playerView(mafia.id).night.standings.length, 4);
});
