'use strict';

// What each screen sees of a «تحدي الوقت» game. The host judges, so only the
// host's view carries answers while a round is running; everyone sees them
// in the round recap.

const { TEAMS } = require('./time');

const IMAGE_TYPES = new Set(['image', 'map', 'flag', 'hidden-flag']);
// Devices load this many pictures ahead: enough that the clock never waits
// on a picture, without every phone hitting Wikimedia for the whole deck.
const PRELOAD_AHEAD = 12;

function categoryInfo(category) {
  return category ? { id: category.id, name: category.name, emoji: category.emoji } : null;
}

function cardView(card, { withAnswer }) {
  if (!card) return null;
  const { answer, ...face } = card;
  return withAnswer ? { ...face, answer } : face;
}

function teamsView(room) {
  const teams = Object.fromEntries(TEAMS.map((t) => [t, []]));
  for (const p of room.playerList()) {
    const team = room.game.teams.get(p.id);
    if (team) teams[team].push(p);
  }
  return teams;
}

/** The next pictures of the round, so devices load them before they're needed. */
function preloadList(game) {
  const { round } = game;
  if (!round) return [];
  const category = game.category(round.category);
  return round.deck
    .slice(round.position, round.position + PRELOAD_AHEAD)
    .map((entry) => category.cards[entry.index])
    .filter((card) => IMAGE_TYPES.has(card.type))
    .map((card) => (card.type === 'flag' || card.type === 'hidden-flag' ? `/flags/4x3/${card.code}.svg` : card.src));
}

function recap(game) {
  const { round } = game;
  const category = game.category(round.category);
  const items = round.log.map((entry) => ({
    ...cardView(category.cards[entry.index], { withAnswer: true }),
    team: entry.team,
    result: entry.result,
  }));
  if (round.result.stuck !== null) {
    items.push({
      ...cardView(category.cards[round.result.stuck], { withAnswer: true }),
      team: round.result.loser,
      result: 'stuck',
    });
  }
  return items;
}

function roundView(room, { host }) {
  const { game } = room;
  const { round, phase } = game;
  if (!round) return null;
  const view = {
    number: game.roundNumber,
    category: categoryInfo(game.category(round.category)),
    wheel: round.wheel.map((id) => categoryInfo(game.category(id))),
    spinId: round.spinId,
    startTeam: round.startTeam,
    active: round.active,
    remaining: round.remaining,
    runningSince: round.runningSince,
    paused: round.paused,
    step: round.step,
    cardNumber: round.position + 1,
    cardsLeft: Math.max(0, round.deck.length - round.position),
    card: cardView(game.currentCard(), { withAnswer: host }),
  };
  if (phase === 'ready' || phase === 'playing') view.preload = preloadList(game);
  if (host && phase === 'playing') view.canUndo = round.history.length > 0;
  if (phase === 'roundOver') {
    view.result = { winner: round.result.winner, reason: round.result.reason };
    view.recap = recap(game);
  }
  return view;
}

function baseView(room, { host }) {
  const { game } = room;
  return {
    phase: game.phase,
    settings: game.settings,
    score: game.score,
    roundsToWin: game.settings.roundsToWin,
    roundNumber: game.roundNumber,
    matchWinner: game.matchWinner,
    nextStartTeam: game.nextStartTeam,
    teams: teamsView(room),
    round: roundView(room, { host }),
  };
}

function hostView(room) {
  return {
    ...baseView(room, { host: true }),
    categories: room.game.categories.map((c) => ({ ...categoryInfo(c), count: c.cards.length })),
    players: room.playerList(),
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
