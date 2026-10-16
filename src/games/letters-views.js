'use strict';

// What each screen sees of a «حروف» game. Everyone sees the question; only
// the host sees the answer, and phones get it once the cell is decided.

const { teamsView } = require('./teams');

function currentView(room, { host }) {
  const { game } = room;
  const { current } = game;
  if (!current) return null;
  const question = game.question();
  return {
    cell: current.cell,
    letter: current.letter,
    question: question.q,
    answer: host ? question.a : null,
    locked: [...current.locked],
    buzz: current.buzz && {
      team: current.buzz.team,
      playerId: current.buzz.playerId,
      name: room.nameOf(current.buzz.playerId),
      endsAt: current.buzz.endsAt,
    },
  };
}

function baseView(room, { host }) {
  const { game } = room;
  return {
    phase: game.phase,
    step: game.step,
    settings: game.settings,
    score: game.score,
    roundsToWin: game.settings.roundsToWin,
    roundNumber: game.roundNumber,
    matchWinner: game.matchWinner,
    picker: game.picker,
    board: game.board,
    current: currentView(room, { host }),
    result: game.result,
    teams: teamsView(room),
  };
}

function hostView(room) {
  return {
    ...baseView(room, { host: true }),
    players: room.playerList(),
    canUndo: room.game.history.length > 0,
    letterCount: room.game.letters.length,
    custom: room.game.custom,
  };
}

function playerView(room, playerId) {
  const player = room.players.get(playerId);
  return {
    ...baseView(room, { host: false }),
    me: { id: playerId, name: player.name, team: room.game.teams.get(playerId) ?? null },
  };
}

module.exports = { hostView, playerView };
