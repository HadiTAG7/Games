'use strict';

// What each screen sees of a «عقلية القطيع» game. Players never get other
// people's answers before the results.

const { winningGroupIds, MAX_BET } = require('./herd');

function standings(room) {
  const { game } = room;
  return game.standings().map((row) => {
    const state = game.players.get(row.id);
    return { ...row, name: room.players.get(row.id).name, gained: state.last?.gained ?? 0 };
  });
}

function groupsView(room) {
  const { round } = room.game;
  if (!round) return [];
  const winners = winningGroupIds(round.groups, room.game.settings.mode);
  return round.groups.map((g) => ({
    id: g.id,
    text: g.text,
    size: g.members.length,
    winner: winners.has(g.id),
    rejected: g.rejected,
    members: g.members.map((m) => ({
      id: m.playerId,
      name: room.players.get(m.playerId)?.name ?? '؟',
      text: m.text,
      value: m.value,
    })),
  }));
}

function categoryOf(room, round) {
  const category = round?.category && room.game.categories.find((c) => c.id === round.category);
  if (!category) return null;
  const sub = category.subcategories.find((s) => s.id === round.subcategory);
  return { name: category.name, emoji: category.emoji, sub: sub?.name ?? null };
}

function voteViewFor(room, playerId) {
  const { vote } = room.game.round ?? {};
  if (!vote) return null;
  const group = room.game.round.groups.find((g) => g.id === vote.groupId);
  return {
    text: vote.text,
    status: vote.status,
    votedCount: vote.votes.size,
    eligibleCount: vote.eligible.size,
    canVote: vote.status === 'open' && vote.eligible.has(playerId),
    isAuthor: Boolean(group?.members.some((m) => m.playerId === playerId)),
    myVote: vote.votes.get(playerId) ?? null,
  };
}

/** The host sees who voted but not how, until the vote closes. */
function hostVoteView(room) {
  const { vote } = room.game.round ?? {};
  if (!vote) return null;
  return {
    groupId: vote.groupId,
    text: vote.text,
    status: vote.status,
    votedCount: vote.votes.size,
    eligibleCount: vote.eligible.size,
    voters: [...vote.eligible].map((id) => ({
      name: room.nameOf(id),
      voted: vote.votes.has(id),
      connected: room.isConnected(id),
    })),
    ...(vote.status === 'tie' ? room.game.voteTally() : {}),
  };
}

function baseView(room) {
  const { game } = room;
  const { phase, round } = game;
  const view = {
    mode: game.settings.mode,
    phase,
    roundNumber: game.roundIndex + 1,
    totalRounds: game.questions.length || game.settings.rounds,
    isLastRound: phase !== 'lobby' && game.isLastRound(),
    question: round?.question ?? null,
    category: categoryOf(room, round),
    endsAt: round?.endsAt ?? null,
    answeredCount: round ? round.answers.size : 0,
    maxBet: MAX_BET,
  };
  if (phase === 'final') view.winners = game.gameWinners().map((id) => room.nameOf(id));
  return view;
}

function hostView(room) {
  const { game } = room;
  const { phase, round } = game;
  const view = {
    ...baseView(room),
    settings: game.settings,
    bankSize: game.bankSize(),
    categories: game.categories.map((c) => ({
      id: c.id,
      name: c.name,
      emoji: c.emoji,
      subcategories: c.subcategories.map((sub) => ({
        id: sub.id,
        name: sub.name,
        counts: { same: sub.same.length, different: sub.different.length },
      })),
    })),
    players: room.playerList().map((p) => ({
      ...p,
      score: game.players.get(p.id).score,
      answered: Boolean(round && round.answers.has(p.id)),
    })),
  };
  if (phase === 'reveal' || phase === 'results') {
    view.groups = groupsView(room);
    view.canUndo = phase === 'reveal' && round.history.length > 0;
    view.vote = phase === 'reveal' ? hostVoteView(room) : null;
    view.lastVote = phase === 'reveal' ? round.lastVote : null;
  }
  if (phase === 'results') {
    view.missed = round.missed
      .filter((m) => room.players.has(m.playerId))
      .map((m) => ({ name: room.nameOf(m.playerId), value: m.value }));
  }
  if (phase === 'results' || phase === 'final') view.standings = standings(room);
  return view;
}

function playerView(room, playerId) {
  const { game } = room;
  const { phase, round } = game;
  const player = room.players.get(playerId);
  const state = game.players.get(playerId);
  const answer = round?.answers.get(playerId);
  const view = {
    ...baseView(room),
    me: {
      id: playerId,
      name: player.name,
      score: state.score,
      used: [...state.used].sort((a, b) => a - b),
    },
    myAnswer: answer && (phase === 'question' || phase === 'reveal')
      ? { text: answer.text, value: answer.value }
      : null,
  };
  if (phase === 'results' || phase === 'final') {
    const rows = standings(room);
    view.last = state.last;
    view.standings = rows;
    view.me.rank = rows.find((row) => row.id === playerId)?.rank ?? null;
  }
  if (phase === 'final') view.isWinner = game.gameWinners().includes(playerId);
  if (phase === 'results') view.groups = groupsView(room);
  if (phase === 'reveal') {
    view.vote = voteViewFor(room, playerId);
    view.lastVote = round.lastVote;
  }
  return view;
}

module.exports = { hostView, playerView };
