'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const { RoomManager, GAMES } = require('./src/rooms');
const { GameError } = require('./src/errors');
const { categories } = require('./data/questions.json');
const timeCategories = require('./data/time-challenge.json').categories;
const seenCategories = require('./data/seen-jeem.json').categories;
// A game whose question file isn't there yet stays hidden from the game picker.
const optional = (file, key) => (fs.existsSync(path.join(__dirname, file)) ? require(`./${file}`)[key] : []);
const letters = optional('data/letters.json', 'letters');

const PORT = Number(process.env.PORT) || 3000;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

const app = express();
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
// Country flags for «تحدي الوقت» (flag-icons, MIT).
app.use('/flags', express.static(path.join(path.dirname(require.resolve('flag-icons/package.json')), 'flags'), { maxAge: '7d' }));
// Card data for the preview page.
app.get('/time-challenge.json', (req, res) => res.json({ categories: timeCategories }));
app.get('/healthz', (req, res) => res.send('ok'));

const server = http.createServer(app);
const io = new Server(server);
const rooms = new RoomManager({ categories, timeCategories, seenCategories, letters });

const hostChannel = (code) => `${code}:host`;
const playerChannel = (code, playerId) => `${code}:player:${playerId}`;

function broadcast(room) {
  io.to(hostChannel(room.code)).emit('host:state', room.hostView());
  for (const id of room.players.keys()) {
    io.to(playerChannel(room.code, id)).emit('player:state', room.playerView(id));
  }
}

function lanAddress() {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
  const isPrivate = (ip) => /^(10|192\.168)\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  return addresses.find(isPrivate) || addresses[0] || null;
}

/**
 * The address phones should open. A host browsing on localhost gets the
 * machine's Wi-Fi address instead, since "localhost" on a phone is the phone.
 * Render provides RENDER_EXTERNAL_URL with the service's public address.
 */
function publicBaseUrl(handshake) {
  const configured = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const { headers } = handshake;
  const first = (value) => String(value).split(',')[0].trim();
  const host = first(headers['x-forwarded-host'] || headers.host || `localhost:${PORT}`);
  const proto = first(headers['x-forwarded-proto'] || (handshake.secure ? 'https' : 'http'));
  const { hostname, port } = new URL(`${proto}://${host}`);
  if (LOCAL_HOSTNAMES.has(hostname)) {
    const ip = lanAddress();
    if (ip) return `http://${ip}${port ? `:${port}` : ''}`;
  }
  return `${proto}://${host}`;
}

async function joinInfo(room, handshake) {
  const joinUrl = `${publicBaseUrl(handshake)}/play?room=${room.code}`;
  const qrSvg = await QRCode.toString(joinUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { joinUrl, qrSvg };
}

io.on('connection', (socket) => {
  socket.data = {};

  const on = (event, handler) => {
    socket.on(event, async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        reply({ ok: true, ...(await handler(payload || {})) });
      } catch (err) {
        if (!(err instanceof GameError)) console.error(`[${event}]`, err);
        reply({ ok: false, error: err instanceof GameError ? err.message : 'صار خطأ، جرّب مرة ثانية' });
      }
    });
  };

  function leaveCurrent() {
    const { role, code, playerId } = socket.data;
    socket.data = {};
    if (!code) return;
    const room = rooms.get(code);
    if (role === 'host') socket.leave(hostChannel(code));
    if (role === 'player') {
      socket.leave(playerChannel(code, playerId));
      if (room) {
        room.disconnect(playerId, socket.id);
        broadcast(room);
      }
    }
  }

  async function attachHost(room) {
    leaveCurrent();
    socket.data = { role: 'host', code: room.code };
    socket.join(hostChannel(room.code));
    const info = await joinInfo(room, socket.handshake);
    socket.emit('host:state', room.hostView());
    return { code: room.code, hostToken: room.hostToken, ...info };
  }

  function currentRoom(role) {
    const room = socket.data.role === role && rooms.get(socket.data.code);
    if (!room) throw new GameError('الغرفة انتهت');
    if (role === 'player' && !room.players.has(socket.data.playerId)) {
      throw new GameError('أنت مو داخل الغرفة');
    }
    room.touch();
    return room;
  }

  const hostAction = (event, action) => {
    on(event, (payload) => {
      const room = currentRoom('host');
      action(room, payload);
      broadcast(room);
    });
  };

  on('host:create', ({ gameType }) => {
    const room = rooms.create();
    if (room.games().some((g) => g.id === gameType)) room.setGameType(gameType);
    room.onChange = () => broadcast(room);
    return attachHost(room);
  });

  on('host:resume', ({ code, hostToken }) => {
    const room = rooms.get(code);
    if (!room || room.hostToken !== hostToken) throw new GameError('الغرفة انتهت');
    room.touch();
    return attachHost(room);
  });

  // Shared by every game.
  hostAction('host:game-type', (room, { gameType }) => room.setGameType(gameType));
  hostAction('host:settings', (room, settings) => room.game.updateSettings(settings));
  hostAction('host:start', (room, options) => room.game.start(options));
  hostAction('host:next', (room) => room.game.next());
  hostAction('host:end', (room) => room.game.finish());
  hostAction('host:restart', (room) => room.game.restart());
  // The team games («تحدي الوقت», «سين جيم»).
  const teamGame = (room) => {
    if (!room.game.setTeam) throw new GameError('هذي اللعبة ما فيها فرق');
    return room.game;
  };
  hostAction('host:team', (room, { playerId, team }) => teamGame(room).setTeam(playerId, team));
  hostAction('host:shuffle', (room) => teamGame(room).shuffleTeams());
  hostAction('host:kick', (room, { playerId }) => {
    room.kick(playerId);
    const channel = playerChannel(room.code, playerId);
    io.to(channel).emit('player:kicked');
    io.in(channel).socketsLeave(channel);
  });

  // «عقلية القطيع»
  const herd = (room) => room.gameOf('herd');
  hostAction('host:reveal', (room) => herd(room).reveal());
  hostAction('host:merge', (room, { from, to }) => herd(room).merge(from, to));
  hostAction('host:reject', (room, { groupId }) => herd(room).toggleReject(groupId));
  hostAction('host:undo', (room) => herd(room).undo());
  hostAction('host:vote-start', (room, { groupId }) => room.startVote(groupId));
  hostAction('host:vote-end', (room) => herd(room).finishVote());
  hostAction('host:vote-cancel', (room) => herd(room).cancelVote());
  hostAction('host:vote-decide', (room, { reject }) => herd(room).decideTie(reject));
  hostAction('host:confirm', (room) => herd(room).confirm());

  // «تحدي الوقت»
  const time = (room) => room.gameOf('time');
  hostAction('host:tc-spin', (room) => time(room).spin());
  hostAction('host:tc-go', (room) => time(room).go());
  hostAction('host:tc-correct', (room, { step }) => time(room).correct(step));
  hostAction('host:tc-skip', (room, { step }) => time(room).skip(step));
  hostAction('host:tc-pause', (room, { step }) => time(room).pause(step));
  hostAction('host:tc-resume', (room, { step }) => time(room).resume(step));
  hostAction('host:tc-undo', (room, { step }) => time(room).undo(step));
  hostAction('host:tc-exclude', (room, { step }) => time(room).exclude(step));

  // «سين جيم»
  const seen = (room) => room.gameOf('seen');
  hostAction('host:sj-pick', (room, { tileId, step }) => seen(room).pick(tileId, step));
  hostAction('host:sj-cancel', (room, { step }) => seen(room).cancelPick(step));
  hostAction('host:sj-lifeline', (room, { name, step }) => seen(room).lifeline(name, step));
  hostAction('host:sj-show', (room, { step }) => seen(room).showQuestion(step));
  hostAction('host:sj-judge', (room, { correct, step }) => seen(room).judge(Boolean(correct), step));
  hostAction('host:sj-undo', (room, { step }) => seen(room).undo(step));
  hostAction('host:sj-next', (room, { step }) => seen(room).next(step));

  // «حروف»
  const hr = (room) => room.gameOf('letters');
  hostAction('host:hr-pick', (room, { cell, step }) => hr(room).pick(Number(cell), step));
  hostAction('host:hr-buzz', (room, { team, step }) => hr(room).hostBuzz(team, step));
  hostAction('host:hr-judge', (room, { correct, step }) => hr(room).judge(Boolean(correct), step));
  hostAction('host:hr-new', (room, { step }) => hr(room).newQuestion(step));
  hostAction('host:hr-release', (room, { step }) => hr(room).release(step));
  hostAction('host:hr-undo', (room, { step }) => hr(room).undo(step));
  hostAction('host:hr-next', (room, { step }) => hr(room).next(step));

  on('player:join', ({ code, name, playerId }) => {
    const room = rooms.get(code);
    if (!room) throw new GameError('ما لقينا الغرفة، تأكد من الرقم');
    room.touch();
    const player = room.join({ name, playerId });
    leaveCurrent();
    socket.data = { role: 'player', code: room.code, playerId: player.id };
    socket.join(playerChannel(room.code, player.id));
    room.connect(player.id, socket.id);
    broadcast(room);
    return { code: room.code, playerId: player.id, name: player.name };
  });

  on('player:answer', (answer) => {
    const room = currentRoom('player');
    room.submitAnswer(socket.data.playerId, answer);
    broadcast(room);
  });

  on('player:buzz', () => {
    const room = currentRoom('player');
    const first = room.gameOf('letters').buzz(socket.data.playerId);
    if (first) broadcast(room);
    return { first };
  });

  on('player:vote', ({ choice }) => {
    const room = currentRoom('player');
    room.castVote(socket.data.playerId, choice);
    broadcast(room);
  });

  socket.on('disconnect', leaveCurrent);
});

setInterval(() => rooms.cleanup(), 10 * 60 * 1000).unref();

server.listen(PORT, () => {
  const ip = lanAddress();
  console.log(`🎮 السيرفر شغّال: http://localhost:${PORT}`);
  if (ip) console.log(`📱 من الجوالات على نفس الشبكة: http://${ip}:${PORT}`);
});
