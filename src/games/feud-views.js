'use strict';

// What each screen sees of «فاميلي فيود». The host's devices get every
// answer (the big screen hides the closed ones itself; the host's phone shows
// them); phones see a slot's answer only once it opens, or at the end of the
// round. In «المال السريع», nobody but the host sees the first player's
// answers while the second player plays.

const { teamsView } = require('./teams');
const { ROUNDS_OPTIONS, FAST_QUESTIONS, FAST_SECONDS, FAST_TARGET } = require('./feud');

const person = (room, id) => (id ? { id, name: room.nameOf(id) ?? 'لاعب طلع' } : null);

function roundView(room, { host }) {
  const { game } = room;
  const { round, phase } = game;
  if (!round) return null;
  const all = host || phase === 'roundOver';
  const { question } = round;
  const f = round.faceoff;
  return {
    q: question.q,
    source: question.source ?? 'bank',
    responses: question.responses ?? null,
    slots: question.answers.map((ans, i) => {
      const open = round.revealed.includes(i);
      return { index: i, open, a: open || all ? ans.a : null, points: open || all ? ans.points : null };
    }),
    pot: game.pot(),
    multiplier: game.multiplier(),
    strikes: round.strikes,
    faceoff: {
      players: { red: person(room, f.players.red), blue: person(room, f.players.blue) },
      buzz: f.buzz ? { team: f.buzz.team, player: person(room, f.buzz.playerId) } : null,
      turn: f.turn,
      tries: f.tries,
    },
    control: round.control,
    playing: round.playing,
    result: round.result,
    canUndo: host ? game.history.length > 0 : undefined,
  };
}

/**
 * Who sees an answer of «المال السريع» (the host always does): the player
 * typing sees their own; in a review each one shows as the host reveals it
 * (the first player's stay hidden while the second plays); everything at the end.
 */
function fastVisible(fast, phase, stage, index, me) {
  if (phase === 'final') return true;
  if (phase === 'fast') return me === stage && fast.stage === stage;
  if (phase === 'fastReview') return stage <= fast.stage && index < fast.shown[stage];
  return false;
}

function fastView(room, { host, playerId = null }) {
  const { game } = room;
  const { fast, phase } = game;
  if (!fast) return null;
  const me = fast.players.indexOf(playerId);
  let shownTotal = 0;
  const stages = [0, 1].map((s) => fast.questions.map((q, i) => {
    if (!host && !fastVisible(fast, phase, s, i, me)) return null;
    const slot = fast.matches[s][i];
    const points = game.fastPoints(s, i);
    if (fastVisible(fast, phase, s, i, -1)) shownTotal += points;
    return { text: fast.answers[s][i], slot, a: slot === null ? null : q.answers[slot].a, points };
  }));
  return {
    team: fast.team,
    players: fast.players.map((id) => person(room, id)),
    stage: fast.stage,
    endsAt: fast.endsAt,
    questions: fast.questions.map((q) => ({
      q: q.q,
      answers: host ? q.answers.map((a) => ({ a: a.a, points: a.points })) : undefined,
    })),
    shown: fast.shown,
    stages,
    shownTotal, // what the room has seen added up so far
    total: host || phase === 'final' ? game.fastTotal() : null,
    won: fast.won,
    target: FAST_TARGET,
  };
}

function baseView(room, opts) {
  const { game } = room;
  return {
    phase: game.phase,
    step: game.step,
    settings: game.settings,
    score: game.score,
    roundNumber: game.roundNumber,
    rounds: game.settings.rounds,
    matchWinner: game.matchWinner,
    teams: teamsView(room),
    round: roundView(room, opts),
    fast: fastView(room, opts),
    rules: { roundsOptions: ROUNDS_OPTIONS, fastQuestions: FAST_QUESTIONS, fastSeconds: FAST_SECONDS, fastTarget: FAST_TARGET },
  };
}

function hostView(room) {
  return { ...baseView(room, { host: true }), players: room.playerList(), questionCount: room.game.bank.length };
}

function playerView(room, playerId) {
  const player = room.players.get(playerId);
  return {
    ...baseView(room, { host: false, playerId }),
    me: { id: playerId, name: player.name, team: room.game.teams.get(playerId) ?? null },
  };
}

module.exports = { hostView, playerView };
