/* Shared helpers for the host and player pages. */
'use strict';

const $ = (selector, root = document) => root.querySelector(selector);

/** Tiny DOM builder: h('div', { class: 'x', onclick }, 'text', child). */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'html') el.innerHTML = value; // trusted server markup only (QR SVG)
    else if (key === 'value') el.value = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function toLatinDigits(text) {
  return String(text).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x0660)
    .replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x06f0);
}

function emit(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function storage(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
  return value;
}

let toastTimer;
function toast(message, kind = 'error') {
  let el = $('#toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function connectionBanner(socket) {
  const el = h('div', { class: 'offline', hidden: true }, 'انقطع الاتصال… نحاول نرجع');
  document.body.append(el);
  socket.on('disconnect', () => { el.hidden = false; });
  socket.on('connect', () => { el.hidden = true; });
}

// Countdowns follow the server clock so every screen shows the same number.
let clockOffset = 0;
function syncClock(serverTime) {
  if (serverTime) clockOffset = serverTime - Date.now();
}
function secondsLeft(endsAt) {
  return Math.max(0, Math.ceil((endsAt - (Date.now() + clockOffset)) / 1000));
}
function timerEl(endsAt) {
  if (!endsAt) return null;
  return h('div', { class: 'timer', 'data-ends': endsAt }, secondsLeft(endsAt));
}
setInterval(() => {
  document.querySelectorAll('[data-ends]').forEach((el) => {
    const left = secondsLeft(Number(el.dataset.ends));
    el.textContent = left;
    el.classList.toggle('urgent', left <= 5);
  });
}, 250);

const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };
const GAME_NAME = 'عقلية القطيع';

const MODES = {
  same: {
    name: 'مع القطيع',
    emoji: '🐄',
    goal: 'جاوب نفس جواب الأغلبية',
    prompt: 'اكتب الجواب اللي تتوقع الأغلبية تكتبه',
    winLabel: '👑 الأغلبية',
    winnersTitle: 'جواب الأغلبية',
    noWinners: 'ما فيه أغلبية هالمرة 😅',
  },
  different: {
    name: 'عكس القطيع',
    emoji: '🦄',
    goal: 'جاوب جواب صحيح ما أحد غيرك يقوله',
    prompt: 'اكتب جواب صحيح تتوقع ما أحد غيرك بيكتبه',
    winLabel: '🦄 انفرد فيه',
    winnersTitle: 'الأجوبة اللي ما تكررت',
    noWinners: 'ما أحد انفرد بجوابه هالمرة 😅',
  },
};

function categoryTag(category) {
  if (!category) return null;
  return h('div', { class: 'category-tag' },
    `${category.emoji} ${category.name}`, category.sub ? ` · ${category.sub}` : null);
}

function lastVoteBanner(lastVote) {
  if (!lastVote) return null;
  const detail = lastVote.decidedBy === 'host'
    ? `تعادل ${lastVote.keep}–${lastVote.reject} وقرر المضيف`
    : `${lastVote.reject} رفض · ${lastVote.keep} قبول`;
  return h('div', { class: `banner ${lastVote.rejected ? 'bad' : 'good'}` },
    '🗳️ الجواب «', h('b', {}, lastVote.text), `» ${lastVote.rejected ? 'انرفض' : 'انقبل'} (${detail})`);
}

function standingsList(rows, { highlightId = null, showGain = true } = {}) {
  return h('ol', { class: 'standings' }, rows.map((row) => h('li', { class: row.id === highlightId ? 'me' : null },
    h('span', { class: 'rank' }, (row.score > 0 && MEDALS[row.rank]) || row.rank),
    h('span', { class: 'name' }, row.name),
    showGain && row.gained ? h('span', { class: 'gain' }, `+${row.gained}`) : null,
    h('span', { class: 'score' }, row.score),
  )));
}

function rulesList(mode = 'same') {
  const different = mode === 'different';
  return h('ul', { class: 'rules-list' },
    h('li', {}, 'يطلع سؤال للكل، مثل: «اذكر لون من ألوان قوس قزح».'),
    different
      ? h('li', {}, 'اكتب جواب صحيح تتوقع ما أحد غيرك بيكتبه.')
      : h('li', {}, 'اكتب الجواب اللي تتوقع أغلب الشلة بيكتبونه.'),
    h('li', {}, 'قبل ما ترسل، اختر رقم من 1 إلى 15 تراهن فيه. كل رقم تستخدمه مرة وحدة بس في اللعبة.'),
    different
      ? h('li', {}, 'لو جوابك ما قاله أحد غيرك تفوز وتاخذ نقاط رقمك. ولو أحد قال نفس جوابك، تخسرون أنتم الاثنين.')
      : h('li', {}, 'أكبر مجموعة جاوبت نفس الجواب تفوز وكل واحد فيها ياخذ نقاط رقمه. لو تعادلت أكبر مجموعتين، الكل يفوز.'),
    different
      ? h('li', {}, 'الجواب لازم يكون صحيح، والمضيف يقدر يرفض أي جواب غلط.')
      : h('li', {}, 'الجواب اللي ما قاله إلا شخص واحد ما يفوز.'),
    h('li', {}, 'اللي خسر يروح عليه رقمه، واللي ما يجاوب ينحرق أقل رقم باقي عنده.'),
  );
}

function confetti() {
  const colors = ['#ffd23f', '#2fe0a0', '#ff5d7d', '#7cc8ff', '#c792ff'];
  return h('div', { class: 'confetti', 'aria-hidden': 'true' }, range(1, 40).map((i) => h('span', {
    style: `left:${Math.random() * 100}%;background:${colors[i % colors.length]};`
      + `animation-delay:${(Math.random() * 3).toFixed(2)}s;animation-duration:${(3 + Math.random() * 3).toFixed(2)}s`,
  })));
}
