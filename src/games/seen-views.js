'use strict';

// What each screen sees of a «سين جيم» game. Everyone sees the question;
// only the host sees the answer before the reveal.

const { teamsView } = require('./teams');

const categoryInfo = (category) => ({ id: category.id, name: category.name, emoji: category.emoji });

function boardView(game) {
  return game.board.map((column) => ({
    category: categoryInfo(game.category(column.category)),
    tiles: column.tiles.map((t) => ({ id: t.id, value: t.value, wonBy: t.wonBy })),
  }));
}

function currentView(game, { host }) {
  const { current, phase } = game;
  if (!current) return null;
  const { category, tile, question } = game.lookup(current.tileId);
  const asked = ['question', 'steal', 'reveal'].includes(phase);
  return {
    tileId: current.tileId,
    team: current.team,
    value: tile.value,
    category: categoryInfo(category),
    before: [...current.before],
    during: [...current.during],
    endsAt: current.endsAt,
    question: asked ? { q: question.q, img: question.img ?? null } : null,
    answer: asked && (host || phase === 'reveal') ? question.a : null,
    result: current.result,
  };
}

function baseView(room, { host }) {
  const { game } = room;
  return {
    phase: game.phase,
    step: game.step,
    settings: game.settings,
    score: game.score,
    turn: game.turn,
    lifelines: { red: [...game.lifelines.red], blue: [...game.lifelines.blue] },
    board: boardView(game),
    tilesLeft: game.tilesLeft(),
    current: currentView(game, { host }),
    winner: game.phase === 'final' ? game.winner() : null,
    teams: teamsView(room),
  };
}

function hostView(room) {
  const { game } = room;
  return {
    ...baseView(room, { host: true }),
    categories: game.categories.map((c) => ({
      ...categoryInfo(c),
      count: Object.values(c.questions).reduce((n, list) => n + list.length, 0),
    })),
    players: room.playerList(),
    canUndo: game.history.length > 0,
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
