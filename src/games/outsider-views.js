'use strict';

// What each screen sees of «برا السالفة». The big screen never shows the word
// or who is out of the loop until the vote is in, since everyone can see it.
// Each phone sees only its own card.

const { MIN_PLAYERS, ROUNDS_OPTIONS, FREE_SECONDS_OPTIONS, TWO_OUTSIDERS_FROM, POINTS, MIN_CUSTOM_WORDS } = require('./outsider');

const named = (room, id) => ({ id, name: room.nameOf(id) });

function roundView(room) {
  const { game } = room;
  const { round, phase } = game;
  if (!round) return null;
  const category = game.category(round.categoryId);
  const revealed = ['guess', 'roundOver'].includes(phase) && round.result;
  return {
    category: { id: category.id, name: category.name, emoji: category.emoji },
    players: round.players.map((id) => named(room, id)),
    pairs: round.pairs.map((p) => ({ asker: named(room, p.asker), target: named(room, p.target) })),
    askIndex: round.askIndex,
    endsAt: round.endsAt,
    voted: round.players.filter((id) => round.votes.has(id)),
    outsiderCount: round.outsiders.length,
    // Once the votes are counted, everyone may know who it was.
    tally: revealed ? round.result.tally.map((t) => ({ ...named(room, t.id), votes: t.votes })) : null,
    outsiders: revealed ? round.outsiders.map((id) => ({
      ...named(room, id),
      caught: round.result.caught.includes(id),
      guessed: round.guesses.has(id),
      guess: phase === 'roundOver' ? round.guesses.get(id) ?? null : null,
      right: phase === 'roundOver' ? round.guesses.get(id) === round.word : null,
    })) : null,
    word: phase === 'roundOver' ? round.word : null,
    aborted: Boolean(round.result?.aborted),
    gains: phase === 'roundOver' ? round.result.gains : null,
    votes: phase === 'roundOver'
      ? [...round.votes].map(([voter, target]) => ({ voter: named(room, voter), target: named(room, target) }))
      : null,
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
    settings: game.settings,
    roundNumber: game.roundNumber,
    totalRounds: game.settings.rounds,
    outsiderCount: game.outsiderCount(),
    rules: { minPlayers: MIN_PLAYERS, twoOutsidersFrom: TWO_OUTSIDERS_FROM, points: POINTS },
    round: roundView(room),
    standings: standingsView(room),
    players: room.playerList(),
  };
}

function hostView(room) {
  return {
    ...baseView(room),
    roundsOptions: ROUNDS_OPTIONS,
    freeSecondsOptions: FREE_SECONDS_OPTIONS,
    categories: room.game.categories.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, count: c.words.length })),
    custom: { ...room.game.custom, ready: room.game.categories.some((c) => c.id === 'custom'), min: MIN_CUSTOM_WORDS },
  };
}

function playerView(room, playerId) {
  const { game } = room;
  const { round, phase } = game;
  const inRound = Boolean(round?.players.includes(playerId));
  const outsider = inRound && round.outsiders.includes(playerId);
  const row = standingsView(room).find((r) => r.id === playerId);
  return {
    ...baseView(room),
    me: {
      id: playerId,
      name: room.nameOf(playerId),
      score: row?.score ?? 0,
      rank: row?.rank ?? null,
      inRound,
      outsider,
      // Your own card: the word if you're in on it, nothing if you're not.
      word: inRound && !outsider ? round.word : null,
      vote: inRound ? round.votes.get(playerId) ?? null : null,
      choices: outsider && phase === 'guess' ? round.choices : null,
      guess: outsider ? round.guesses.get(playerId) ?? null : null,
    },
  };
}

module.exports = { hostView, playerView };
