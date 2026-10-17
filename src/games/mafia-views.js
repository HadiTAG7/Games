'use strict';

// What each screen sees of «مافيا». Roles go only to their owner; the mafia
// see each other (and, at night, who each points at); the mayor is known to
// all; the dead see everyone. The big screen sees a role only once its
// player is out (if the host chose that) or when the game is over.

const { MIN_PLAYERS, DISCUSS_OPTIONS, NIGHT_OPTIONS } = require('./mafia');

function playersView(room, { all }) {
  const { game } = room;
  return room.playerList().map((p) => {
    const g = game.players.get(p.id);
    const inGame = Boolean(g?.role);
    const shown = inGame && (all || g.role === 'mayor' || (!g.alive && game.settings.revealOnDeath));
    return { id: p.id, name: p.name, connected: p.connected, inGame, alive: inGame && g.alive, role: shown ? g.role : null };
  });
}

function announcementView(room, { all }) {
  const { game } = room;
  const a = game.announcement;
  if (!a) return null;
  const who = (id) => {
    if (!id || id === 'none') return id;
    const shown = all || game.settings.revealOnDeath || game.roleOf(id) === 'mayor';
    return { id, name: room.nameOf(id), role: shown ? game.roleOf(id) : null };
  };
  if (a.kind === 'morning') return { kind: a.kind, deaths: a.deaths.map(who), saved: a.saved, shot: a.shot };
  return {
    kind: a.kind,
    out: who(a.out),
    tally: a.tally.map((t) => ({ target: t.target === 'none' ? 'none' : { id: t.target, name: room.nameOf(t.target) }, votes: t.votes })),
    votes: a.votes.map((v) => ({ voter: room.nameOf(v.voter), target: v.target === 'none' ? 'none' : room.nameOf(v.target) })),
  };
}

function baseView(room, { all }) {
  const { game } = room;
  const alive = game.alive();
  return {
    phase: game.phase,
    step: game.step,
    settings: game.settings,
    lineup: game.lineup(),
    dayNumber: game.dayNumber,
    endsAt: game.endsAt,
    winner: game.winner,
    players: playersView(room, { all }),
    mayor: game.phase === 'lobby' ? null : game.mayor(),
    nightProgress: game.night ? { acted: alive.filter((id) => game.night.picks.has(id)).length, total: alive.length } : null,
    voted: game.vote ? alive.filter((id) => game.vote.votes.has(id)) : null,
    announcement: announcementView(room, { all }),
    rules: { minPlayers: MIN_PLAYERS, discussOptions: DISCUSS_OPTIONS, nightOptions: NIGHT_OPTIONS },
  };
}

function hostView(room) {
  return baseView(room, { all: room.game.phase === 'final' });
}

function playerView(room, playerId) {
  const { game } = room;
  const me = game.players.get(playerId);
  const role = me?.role ?? null;
  const dead = Boolean(role) && !me.alive;
  const view = baseView(room, { all: game.phase === 'final' || dead });
  const mafia = role === 'mafia';
  const plan = mafia && game.night ? game.mafiaPlan() : null;
  const person = (id) => (id ? { id, name: room.nameOf(id) } : null);
  return {
    ...view,
    me: {
      id: playerId,
      name: room.nameOf(playerId),
      role,
      inGame: Boolean(role),
      alive: Boolean(role) && me.alive,
      // The mafia see each other, and tonight who each points at and whether they've confirmed.
      team: mafia
        ? [...game.players].filter(([id, p]) => p.role === 'mafia' && id !== playerId).map(([id, p]) => ({
          id, name: room.nameOf(id), alive: p.alive, pick: person(game.night?.picks.get(id) ?? null), confirmed: Boolean(plan?.confirmed.includes(id)),
        }))
        : null,
      plan: plan ? { team: plan.team, agreed: person(plan.agreed), confirmed: plan.confirmed.includes(playerId), locked: plan.locked } : null,
      picked: game.night ? game.night.picks.has(playerId) : false,
      pick: game.night ? game.night.picks.get(playerId) ?? null : null,
      vote: game.vote ? game.vote.votes.get(playerId) ?? null : null,
      checks: role === 'police' ? game.checks.map((c) => ({ night: c.night, name: room.nameOf(c.target), mafia: c.mafia })) : null,
      bulletUsed: role === 'sniper' ? game.bulletUsed : null,
      lastSaved: role === 'doctor' ? game.lastSaved : null,
    },
  };
}

module.exports = { hostView, playerView };
