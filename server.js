'use strict';

const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const { RoomManager } = require('./src/rooms');
const { GameError } = require('./src/games/herd');
const questionBank = require('./data/questions.json');

const PORT = Number(process.env.PORT) || 3000;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

const app = express();
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/healthz', (req, res) => res.send('ok'));

const server = http.createServer(app);
const io = new Server(server);
const rooms = new RoomManager({ questionBank });

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

  on('host:create', () => {
    const room = rooms.create();
    room.onChange = () => broadcast(room);
    return attachHost(room);
  });

  on('host:resume', ({ code, hostToken }) => {
    const room = rooms.get(code);
    if (!room || room.hostToken !== hostToken) throw new GameError('الغرفة انتهت');
    room.touch();
    return attachHost(room);
  });

  hostAction('host:settings', (room, settings) => room.game.updateSettings(settings));
  hostAction('host:start', (room) => room.game.start());
  hostAction('host:reveal', (room) => room.game.reveal());
  hostAction('host:merge', (room, { from, to }) => room.game.merge(from, to));
  hostAction('host:undo', (room) => room.game.undoMerge());
  hostAction('host:confirm', (room) => room.game.confirm());
  hostAction('host:next', (room) => room.game.next());
  hostAction('host:end', (room) => room.game.finish());
  hostAction('host:restart', (room) => room.game.restart());
  hostAction('host:kick', (room, { playerId }) => {
    room.kick(playerId);
    const channel = playerChannel(room.code, playerId);
    io.to(channel).emit('player:kicked');
    io.in(channel).socketsLeave(channel);
  });

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

  socket.on('disconnect', leaveCurrent);
});

setInterval(() => rooms.cleanup(), 10 * 60 * 1000).unref();

server.listen(PORT, () => {
  const ip = lanAddress();
  console.log(`🎮 السيرفر شغّال: http://localhost:${PORT}`);
  if (ip) console.log(`📱 من الجوالات على نفس الشبكة: http://${ip}:${PORT}`);
});
