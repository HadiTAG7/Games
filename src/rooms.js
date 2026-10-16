'use strict';

const crypto = require('crypto');
const { HerdGame, GameError, winningGroupIds, MAX_BET } = require('./games/herd');
const { normalizeAnswer } = require('./normalize');

const MAX_PLAYERS = 40;
const MAX_NAME_LENGTH = 20;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

function cleanName(name) {
  return typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH) : '';
}

class Room {
  constructor({ code, questionBank, random }) {
    this.code = code;
    this.hostToken = crypto.randomBytes(16).toString('hex');
    this.players = new Map(); // id → { id, name, sockets: Set<socketId>, joinedAt }
    this.onChange = () => {};
    this.game = new HerdGame({ questionBank, random, onTimeout: () => this.onChange() });
    this.touch();
  }

  touch() {
    this.lastActivity = Date.now();
  }

  join({ name, playerId } = {}) {
    if (playerId && this.players.has(playerId)) return this.players.get(playerId);
    const clean = cleanName(name);
    if (!clean) throw new GameError('اكتب اسمك');
    const key = normalizeAnswer(clean);
    if ([...this.players.values()].some((p) => normalizeAnswer(p.name) === key)) {
      throw new GameError('الاسم مأخوذ، اختر اسم ثاني');
    }
    if (this.players.size >= MAX_PLAYERS) throw new GameError('الغرفة ممتلئة');
    const player = { id: crypto.randomUUID(), name: clean, sockets: new Set(), joinedAt: Date.now() };
    this.players.set(player.id, player);
    this.game.addPlayer(player.id);
    return player;
  }

  kick(playerId) {
    if (!this.players.has(playerId)) throw new GameError('اللاعب مو موجود');
    this.players.delete(playerId);
    this.game.removePlayer(playerId);
    this.maybeAutoReveal();
  }

  connect(playerId, socketId) {
    this.players.get(playerId)?.sockets.add(socketId);
  }

  disconnect(playerId, socketId) {
    this.players.get(playerId)?.sockets.delete(socketId);
  }

  submitAnswer(playerId, payload) {
    this.game.submitAnswer(playerId, payload);
    this.maybeAutoReveal();
  }

  /** Reveal as soon as everyone who is still connected has answered. */
  maybeAutoReveal() {
    const { game } = this;
    if (game.phase !== 'question' || game.round.answers.size === 0) return;
    const waiting = [...this.players.values()].some(
      (p) => p.sockets.size > 0 && !game.round.answers.has(p.id),
    );
    if (!waiting) game.reveal();
  }

  standings() {
    return this.game.standings({ cowLast: this.game.phase === 'final' }).map((row) => {
      const state = this.game.players.get(row.id);
      return { ...row, name: this.players.get(row.id).name, gained: state.last?.gained ?? 0 };
    });
  }

  groupsView() {
    const { round } = this.game;
    if (!round) return [];
    const winners = winningGroupIds(round.groups);
    return round.groups.map((g) => ({
      id: g.id,
      text: g.text,
      size: g.members.length,
      winner: winners.has(g.id),
      members: g.members.map((m) => ({
        id: m.playerId,
        name: this.players.get(m.playerId)?.name ?? '؟',
        text: m.text,
        value: m.value,
        pinkCow: m.playerId === round.pinkCowTaker,
      })),
    }));
  }

  nameOf(playerId) {
    return playerId ? this.players.get(playerId)?.name ?? null : null;
  }

  baseView() {
    const { game } = this;
    const { phase, round } = game;
    const view = {
      code: this.code,
      phase: game.phase,
      roundNumber: game.roundIndex + 1,
      totalRounds: game.questions.length || game.settings.rounds,
      isLastRound: game.phase !== 'lobby' && game.isLastRound(),
      question: round?.question ?? null,
      endsAt: round?.endsAt ?? null,
      serverTime: Date.now(),
      answeredCount: round ? round.answers.size : 0,
      playerCount: this.players.size,
      maxBet: MAX_BET,
      pinkCow: game.settings.pinkCow,
      pinkCowHolder: this.nameOf(game.pinkCowHolder),
      pinkCowTaker: phase === 'results' ? this.nameOf(round.pinkCowTaker) : null,
    };
    if (phase === 'final') view.winners = game.gameWinners().map((id) => this.nameOf(id));
    return view;
  }

  hostView() {
    const { game } = this;
    const { phase, round } = game;
    const view = {
      ...this.baseView(),
      role: 'host',
      settings: game.settings,
      bankSize: game.questionBank.length,
      players: [...this.players.values()]
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map((p) => ({
          id: p.id,
          name: p.name,
          connected: p.sockets.size > 0,
          score: game.players.get(p.id).score,
          answered: Boolean(round && round.answers.has(p.id)),
          pinkCow: game.pinkCowHolder === p.id,
        })),
    };
    if (phase === 'reveal' || phase === 'results') {
      view.groups = this.groupsView();
      view.canUndo = phase === 'reveal' && round.history.length > 0;
    }
    if (phase === 'results') {
      view.missed = round.missed
        .filter((m) => this.players.has(m.playerId))
        .map((m) => ({ name: this.nameOf(m.playerId), value: m.value }));
    }
    if (phase === 'results' || phase === 'final') view.standings = this.standings();
    return view;
  }

  playerView(playerId) {
    const { game } = this;
    const { phase, round } = game;
    const player = this.players.get(playerId);
    const state = game.players.get(playerId);
    const answer = round?.answers.get(playerId);
    const view = {
      ...this.baseView(),
      role: 'player',
      me: {
        id: playerId,
        name: player.name,
        score: state.score,
        used: [...state.used].sort((a, b) => a - b),
        pinkCow: game.pinkCowHolder === playerId,
      },
      myAnswer: answer && (phase === 'question' || phase === 'reveal')
        ? { text: answer.text, value: answer.value }
        : null,
    };
    if (phase === 'results' || phase === 'final') {
      const standings = this.standings();
      view.last = state.last;
      view.standings = standings;
      view.me.rank = standings.find((row) => row.id === playerId)?.rank ?? null;
    }
    if (phase === 'final') view.isWinner = game.gameWinners().includes(playerId);
    if (phase === 'results') view.groups = this.groupsView();
    return view;
  }

  dispose() {
    this.game.dispose();
  }
}

class RoomManager {
  constructor({ questionBank = [], random = Math.random } = {}) {
    this.questionBank = questionBank;
    this.random = random;
    this.rooms = new Map();
  }

  newCode() {
    for (let i = 0; i < 1000; i++) {
      const code = String(crypto.randomInt(1000, 10000));
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('No free room codes');
  }

  create() {
    const room = new Room({ code: this.newCode(), questionBank: this.questionBank, random: this.random });
    this.rooms.set(room.code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(String(code ?? '').trim());
  }

  cleanup(now = Date.now()) {
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivity > ROOM_TTL_MS) {
        room.dispose();
        this.rooms.delete(code);
      }
    }
  }
}

module.exports = { Room, RoomManager, MAX_PLAYERS, MAX_NAME_LENGTH, ROOM_TTL_MS };
