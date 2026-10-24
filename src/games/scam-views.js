'use strict';

// What each screen sees of «مين النصاب؟». The big screen sees neither the word,
// nor the impostor, nor the mission until the vote is in. A phone sees its own
// card only: the word, or (for the impostor) the mission. Everyone's vote
// screen looks the same, so nobody gives themselves away by their phone.

const { MIN_PLAYERS, ROUNDS_OPTIONS, DISCUSS_OPTIONS, MISSION_CHOICES, POINTS, NOT_NOTICED } = require('./scam');

const named = (room, id) => ({ id, name: room.nameOf(id) });

function roundView(room) {
  const { game } = room;
  const { round, phase } = game;
  if (!round) return null;
  const { result } = round;
  const category = game.category(round.categoryId);
  const revealed = ['reveal', 'guess', 'roundOver'].includes(phase) && result && !result.aborted;
  const over = phase === 'roundOver' && result && !result.aborted;
  const mission = (id) => ({ id, text: game.mission(id)?.text ?? '' });
  return {
    category: { id: category.id, name: category.name },
    order: round.order.map((id) => named(room, id)),
    hintIndex: round.hintIndex,
    endsAt: round.endsAt,
    voted: round.order.filter((id) => round.votes.has(id) && round.picks.has(id)),
    missionChoices: round.missionChoices ? round.missionChoices.map(mission) : null,
    aborted: Boolean(result?.aborted),
    // Once the vote is in, everyone may know.
    tally: revealed ? result.tally.map((t) => ({ ...named(room, t.id), votes: t.votes })) : null,
    impostor: revealed ? named(room, round.impostor) : null,
    caught: revealed ? result.caught : null,
    mission: revealed ? mission(round.mission) : null,
    exposed: revealed ? result.exposed : null,
    named: revealed ? result.named : null,
    answered: revealed ? result.answered : null,
    done: revealed ? result.done : null,
    word: over ? round.word : null,
    guess: over ? { word: round.guess, right: round.guess === round.word } : null,
    gains: over ? result.gains : null,
    lines: over ? result.lines : null,
  };
}

function standingsView(room) {
  return room.game.standings().map((row) => ({ ...row, name: room.nameOf(row.id) }));
}

function punishmentView(room) {
  const { game } = room;
  const p = game.punishment;
  if (!p || game.phase !== 'final') return null;
  const chosen = game.punishmentOf(p.id);
  return {
    loser: named(room, p.loser),
    punishment: { id: chosen.id, short: chosen.short, text: chosen.text },
    wheel: p.wheel.map((id) => ({ id, name: game.punishmentOf(id).short })),
    spinId: p.spinId,
  };
}

function baseView(room) {
  const { game } = room;
  return {
    phase: game.phase,
    step: game.step,
    settings: game.settings,
    roundNumber: game.roundNumber,
    totalRounds: game.settings.rounds,
    rules: { minPlayers: MIN_PLAYERS, points: POINTS, missionChoices: MISSION_CHOICES, notNoticed: NOT_NOTICED },
    round: roundView(room),
    standings: standingsView(room),
    players: room.playerList(),
    punishment: punishmentView(room),
  };
}

function hostView(room) {
  return {
    ...baseView(room),
    roundsOptions: ROUNDS_OPTIONS,
    discussOptions: DISCUSS_OPTIONS,
    categories: room.game.categories.map((c) => ({ id: c.id, name: c.name, count: c.words.length })),
  };
}

function playerView(room, playerId) {
  const { game } = room;
  const { round, phase } = game;
  const inRound = Boolean(round?.order.includes(playerId));
  const impostor = inRound && round.impostor === playerId;
  const row = standingsView(room).find((r) => r.id === playerId);
  return {
    ...baseView(room),
    me: {
      id: playerId,
      name: room.nameOf(playerId),
      score: row?.score ?? 0,
      rank: row?.rank ?? null,
      inRound,
      impostor,
      // Your own card: the word, or the mission if you're the impostor.
      word: inRound && !impostor ? round.word : null,
      mission: impostor ? { id: round.mission, text: game.mission(round.mission).text } : null,
      swapped: impostor ? round.swapped : null,
      vote: inRound ? round.votes.get(playerId) ?? null : null,
      pick: inRound ? round.picks.get(playerId) ?? null : null,
      guessChoices: impostor && phase === 'guess' ? round.guessChoices : null,
      guess: impostor ? round.guess : null,
    },
  };
}

module.exports = { hostView, playerView };
