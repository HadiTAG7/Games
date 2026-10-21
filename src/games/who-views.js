'use strict';

// What each screen sees of «مين فينا؟». Nobody, the big screen included, ever
// sees who voted for whom: the screen gets how many have voted, then how many
// votes each one got; a phone also gets its own vote and whether it guessed
// the majority.

const { MIN_PLAYERS, ROUNDS_OPTIONS, TIMER_OPTIONS, MAX_CUSTOM_QUESTIONS, POINT, MAJORITY_FROM } = require('./who');

const named = (room, ids) => ids.map((id) => room.nameOf(id)).filter(Boolean);

function roundView(room) {
  const { game } = room;
  const { round } = game;
  if (!round) return null;
  const { result } = round;
  return {
    number: game.roundIndex + 1,
    total: game.questions.length,
    question: round.question,
    category: game.category(round.categoryId)?.name ?? null,
    endsAt: round.endsAt,
    votedCount: round.votes.size,
    voterCount: game.players.size,
    result: result && {
      // Players who left since aren't listed.
      tally: result.tally.map((t) => ({ id: t.id, name: room.nameOf(t.id), votes: t.votes })).filter((t) => t.name),
      top: named(room, result.top),
      most: result.most,
      guessedCount: result.guessed.length,
    },
  };
}

function standingsView(room) {
  return room.game.standings().map((row) => ({ ...row, name: room.nameOf(row.id) }));
}

function baseView(room) {
  const { game } = room;
  return {
    phase: game.phase,
    step: game.step,
    roundNumber: game.roundIndex + 1,
    settings: { ...game.settings, customQuestions: undefined },
    rules: { minPlayers: MIN_PLAYERS, point: POINT, majorityFrom: MAJORITY_FROM },
    round: roundView(room),
    standings: standingsView(room),
    players: room.playerList(),
    titles: game.phase === 'final'
      ? game.titles.map((t) => ({ question: t.question, names: named(room, t.top), votes: t.votes })).filter((t) => t.names.length)
      : [],
  };
}

function hostView(room) {
  const { game } = room;
  return {
    ...baseView(room),
    roundsOptions: ROUNDS_OPTIONS,
    timerOptions: TIMER_OPTIONS,
    categories: game.categories.map((c) => ({ id: c.id, name: c.name, count: c.questions.length })),
    custom: { text: game.settings.customQuestions.join('\n'), count: game.settings.customQuestions.length, max: MAX_CUSTOM_QUESTIONS },
  };
}

function playerView(room, playerId) {
  const { game } = room;
  const { round } = game;
  const row = standingsView(room).find((r) => r.id === playerId);
  const vote = round?.votes.get(playerId) ?? null;
  const result = game.phase === 'reveal' ? round.result : null;
  return {
    ...baseView(room),
    me: {
      id: playerId,
      name: room.nameOf(playerId),
      score: row?.score ?? 0,
      rank: row?.rank ?? null,
      vote,
      voteName: room.nameOf(vote),
      guessed: result ? result.guessed.includes(playerId) : null,
    },
  };
}

module.exports = { hostView, playerView };
