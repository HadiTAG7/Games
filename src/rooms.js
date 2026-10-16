'use strict';

const crypto = require('crypto');
const { GameError } = require('./errors');
const { HerdGame } = require('./games/herd');
const { TimeGame } = require('./games/time');
const { SeenGame } = require('./games/seen');
const herdViews = require('./games/herd-views');
const timeViews = require('./games/time-views');
const seenViews = require('./games/seen-views');
const { normalizeAnswer } = require('./normalize');

const MAX_PLAYERS = 40;
const MAX_NAME_LENGTH = 20;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

const GAMES = {
  herd: { Game: HerdGame, views: herdViews, name: 'عقلية القطيع', emoji: '🐄' },
  time: { Game: TimeGame, views: timeViews, name: 'تحدي الوقت', emoji: '⏱️' },
  seen: { Game: SeenGame, views: seenViews, name: 'سين جيم', emoji: '❓' },
};
const GAME_LIST = Object.entries(GAMES).map(([id, g]) => ({ id, name: g.name, emoji: g.emoji }));

function cleanName(name) {
  return typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH) : '';
}

class Room {
  /** content: { herd: herd categories, time: time-challenge cards, seen: سين جيم questions } */
  constructor({ code, content, random }) {
    this.code = code;
    this.content = content;
    this.random = random;
    this.hostToken = crypto.randomBytes(16).toString('hex');
    this.players = new Map(); // id → { id, name, sockets: Set<socketId>, joinedAt }
    this.onChange = () => {};
    this.gameType = 'herd';
    this.game = this.createGame('herd');
    this.touch();
  }

  createGame(type) {
    const { Game } = GAMES[type];
    const game = new Game({ categories: this.content[type] ?? [], random: this.random, onTimeout: () => this.onChange() });
    for (const id of this.players.keys()) game.addPlayer(id);
    return game;
  }

  /** Switch games between games; everyone stays in the room. */
  setGameType(type) {
    if (!Object.hasOwn(GAMES, type ?? '')) throw new GameError('لعبة غير معروفة');
    if (type === this.gameType) return;
    if (!['lobby', 'final'].includes(this.game.phase)) throw new GameError('خلّص اللعبة الحالية أول');
    this.game.dispose();
    this.gameType = type;
    this.game = this.createGame(type);
  }

  /** Throws unless the room is playing the given game, so game-specific actions can't misfire. */
  gameOf(type) {
    if (this.gameType !== type) throw new GameError('هذا الإجراء مو لهذي اللعبة');
    return this.game;
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
    this.maybeFinishVote();
  }

  connect(playerId, socketId) {
    this.players.get(playerId)?.sockets.add(socketId);
  }

  disconnect(playerId, socketId) {
    this.players.get(playerId)?.sockets.delete(socketId);
    this.maybeFinishVote();
  }

  isConnected(playerId) {
    return (this.players.get(playerId)?.sockets.size ?? 0) > 0;
  }

  nameOf(playerId) {
    return playerId ? this.players.get(playerId)?.name ?? null : null;
  }

  /** [{ id, name, connected }] in join order. */
  playerList() {
    return [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({ id: p.id, name: p.name, connected: p.sockets.size > 0 }));
  }

  /* ---------- «عقلية القطيع» room rules ---------- */

  /** Everyone connected may vote; the game leaves out the answer's authors. */
  startVote(groupId) {
    const connected = [...this.players.keys()].filter((id) => this.isConnected(id));
    this.gameOf('herd').startVote(groupId, connected);
  }

  castVote(playerId, choice) {
    this.gameOf('herd').castVote(playerId, choice);
    this.maybeFinishVote();
  }

  /** Close the vote once every voter who is still connected has voted. */
  maybeFinishVote() {
    if (this.gameType !== 'herd') return;
    const vote = this.game.round?.vote;
    if (!vote || vote.status !== 'open') return;
    const waiting = [...vote.eligible].some((id) => !vote.votes.has(id) && this.isConnected(id));
    if (!waiting) this.game.finishVote();
  }

  submitAnswer(playerId, payload) {
    this.gameOf('herd').submitAnswer(playerId, payload);
    this.maybeAutoReveal();
  }

  /** Reveal as soon as everyone who is still connected has answered. */
  maybeAutoReveal() {
    if (this.gameType !== 'herd') return;
    const { game } = this;
    if (game.phase !== 'question' || game.round.answers.size === 0) return;
    const waiting = [...this.players.values()].some(
      (p) => p.sockets.size > 0 && !game.round.answers.has(p.id),
    );
    if (!waiting) game.reveal();
  }

  /* ---------- Views ---------- */

  commonView(role) {
    return {
      role,
      code: this.code,
      gameType: this.gameType,
      games: GAME_LIST,
      serverTime: Date.now(),
      playerCount: this.players.size,
    };
  }

  hostView() {
    return { ...this.commonView('host'), ...GAMES[this.gameType].views.hostView(this) };
  }

  playerView(playerId) {
    return { ...this.commonView('player'), ...GAMES[this.gameType].views.playerView(this, playerId) };
  }

  dispose() {
    this.game.dispose();
  }
}

class RoomManager {
  /** categories: the «عقلية القطيع» bank; timeCategories: the «تحدي الوقت» cards; seenCategories: «سين جيم» questions. */
  constructor({ categories = [], timeCategories = [], seenCategories = [], random = Math.random } = {}) {
    this.content = { herd: categories, time: timeCategories, seen: seenCategories };
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
    const room = new Room({ code: this.newCode(), content: this.content, random: this.random });
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

module.exports = { Room, RoomManager, GAMES, MAX_PLAYERS, MAX_NAME_LENGTH, ROOM_TTL_MS };
