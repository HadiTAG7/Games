'use strict';

// What each screen sees of «صح ولا خطأ السريعة». Until the reveal, nobody
// gets the answer: the screen sees how many have answered, a phone sees only
// its own tap.

const { MIN_PLAYERS, ROUNDS_OPTIONS, SECONDS_OPTIONS, MAX_CUSTOM, POINTS } = require('./truth');

const TOP = 3;

function roundView(room) {
  const { game } = room;
  const { round } = game;
  if (!round) return null;
  const { statement, result } = round;
  const best = result && Object.entries(result.gains)
    .map(([id, points]) => ({ name: room.nameOf(id), points }))
    .filter((r) => r.name)
    .sort((x, y) => y.points - x.points)
    .slice(0, TOP);
  return {
    number: game.roundIndex + 1,
    total: game.statements.length,
    statement: statement.s,
    category: game.category(statement.categoryId)?.name ?? null,
    endsAt: round.endsAt,
    seconds: game.settings.seconds,
    answeredCount: round.answers.size,
    playerCount: game.players.size,
    result: result && {
      answer: statement.a,
      why: statement.why,
      yes: result.counts.yes,
      no: result.counts.no,
      none: Math.max(0, game.players.size - result.counts.yes - result.counts.no),
      rightCount: Object.keys(result.gains).length,
      best,
    },
  };
}

function standingsView(room) {
  const gains = room.game.phase === 'reveal' ? room.game.round.result.gains : {};
  return room.game.standings().map((row) => ({ ...row, name: room.nameOf(row.id), gained: gains[row.id] ?? 0 }));
}

function baseView(room) {
  const { game } = room;
  return {
    phase: game.phase,
    step: game.step,
    roundNumber: game.roundIndex + 1,
    settings: game.settings,
    rules: { minPlayers: MIN_PLAYERS, points: POINTS },
    round: roundView(room),
    standings: standingsView(room),
    players: room.playerList(),
  };
}

function hostView(room) {
  const { game } = room;
  return {
    ...baseView(room),
    roundsOptions: ROUNDS_OPTIONS,
    secondsOptions: SECONDS_OPTIONS,
    categories: game.categories.map((c) => ({ id: c.id, name: c.name, count: c.statements.length })),
    custom: { text: game.custom.text, count: game.custom.items.length, bad: game.custom.bad, max: MAX_CUSTOM },
  };
}

function playerView(room, playerId) {
  const { game } = room;
  const { round } = game;
  const row = standingsView(room).find((r) => r.id === playerId);
  const mine = round?.answers.get(playerId) ?? null;
  const revealed = game.phase === 'reveal';
  return {
    ...baseView(room),
    me: {
      id: playerId,
      name: room.nameOf(playerId),
      score: row?.score ?? 0,
      rank: row?.rank ?? null,
      answer: mine ? mine.answer : null,
      gained: revealed ? round.result.gains[playerId] ?? 0 : null,
      right: revealed && mine ? mine.answer === round.statement.a : null,
    },
  };
}

module.exports = { hostView, playerView };
