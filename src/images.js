'use strict';

// Pictures for question banks, sent by an AI as a link (or as base64). The
// server fetches the link itself, refusing addresses inside private networks
// (so nobody can use it to reach the server's own network), then shrinks
// the picture to a small WebP with sharp, which also proves it's a picture.

const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const http = require('http');
const https = require('https');
const sharp = require('sharp');
const { GameError } = require('./errors');

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_SIDE = 800;
const USER_AGENT = 'AlabAlShillaBot/1.0 (+https://herd-game-hf2y.onrender.com) question-bank-pictures';

/** Is this address inside a private, local or reserved network? */
function isPrivate(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = address.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivate(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('ff');
}

/** Resolves a host once and checks every address, so the request goes to the address we checked. */
async function safeAddress(hostname) {
  const records = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await dns.lookup(hostname, { all: true });
  if (!records.length) throw new GameError('ما لقينا موقع الصورة');
  if (process.env.IMAGE_ALLOW_PRIVATE !== '1' && records.some((r) => isPrivate(r.address))) {
    throw new GameError('رابط الصورة مو مسموح');
  }
  return records[0];
}

/** GET one URL, pinned to the checked address, without following redirects. */
function getOnce(url, record) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'image/*' },
      lookup: (host, opts, cb) => (opts?.all ? cb(null, [record]) : cb(null, record.address, record.family)),
      timeout: TIMEOUT_MS,
    }, (res) => resolve(res));
    req.on('timeout', () => req.destroy(new GameError('الصورة تأخرت')));
    req.on('error', reject);
  });
}

/** Downloads a picture from a link (http/https, public addresses only, 5 MB at most). */
async function download(link) {
  let url;
  try {
    url = new URL(String(link));
  } catch {
    throw new GameError('رابط الصورة غلط');
  }
  const deadline = Date.now() + 2 * TIMEOUT_MS; // the whole download, so a slow trickle can't hold it open
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!['http:', 'https:'].includes(url.protocol)) throw new GameError('رابط الصورة لازم يبدأ بـ http أو https');
    const record = await safeAddress(url.hostname);
    const res = await getOnce(url, record);
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume();
      url = new URL(res.headers.location, url);
      continue;
    }
    if (res.statusCode !== 200) {
      res.resume();
      throw new GameError(`الموقع رفض يعطينا الصورة (${res.statusCode})`);
    }
    const type = String(res.headers['content-type'] ?? '');
    if (type && !type.startsWith('image/') && !type.startsWith('application/octet-stream')) {
      res.resume();
      throw new GameError('الرابط مو صورة');
    }
    if (Number(res.headers['content-length']) > MAX_BYTES) {
      res.resume();
      throw new GameError('الصورة كبيرة، بالكثير 5 ميجا');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of res) {
      size += chunk.length;
      if (size > MAX_BYTES) {
        res.destroy();
        throw new GameError('الصورة كبيرة، بالكثير 5 ميجا');
      }
      if (Date.now() > deadline) {
        res.destroy();
        throw new GameError('الصورة تأخرت');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new GameError('الرابط يحوّل كثير');
}

/** A base64 picture (optionally a data: URL). */
function fromBase64(text) {
  const data = String(text).replace(/^data:image\/[\w.+-]+;base64,/, '');
  const buffer = Buffer.from(data, 'base64');
  if (!buffer.length) throw new GameError('الصورة فاضية');
  if (buffer.length > MAX_BYTES) throw new GameError('الصورة كبيرة، بالكثير 5 ميجا');
  return buffer;
}

/** Shrinks to 800px at most and turns it into WebP; throws if it isn't a picture. */
async function toWebp(buffer) {
  try {
    const { data, info } = await sharp(buffer, { limitInputPixels: 40_000_000, animated: false })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new GameError('الملف مو صورة نقدر نقراها');
  }
}

/** Fetches (or decodes) and stores one picture for an account; returns its id. */
async function savePicture(store, accountId, { url, base64 }) {
  const raw = base64 ? fromBase64(base64) : await download(url);
  const { data, width, height } = await toWebp(raw);
  const id = crypto.randomBytes(12).toString('hex');
  await store.addImage({ id, accountId, data, width, height });
  return id;
}

const pictureUrl = (id) => `/bank-img/${id}.webp`;

module.exports = { savePicture, download, toWebp, isPrivate, pictureUrl, MAX_BYTES };
