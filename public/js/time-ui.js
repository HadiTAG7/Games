/* global h, serverNow, TEAM_ORDER, TEAM_INFO, otherTeam, teamLabel, icon */
'use strict';

// Pieces of «تحدي الوقت» shared by the host, player and preview pages:
// card faces, the two chess clocks, the category wheel and the round recap.

const flagSrc = (code) => `/flags/4x3/${code}.svg`;

function roundsText(n) {
  if (n === 1) return 'جولة وحدة';
  if (n === 2) return 'جولتين';
  return `${n} جولات`;
}

/* ---------- Cards ---------- */

/**
 * The picture (or emoji / text) players have to name.
 * reveal: show hidden flags whole (recap and preview).
 */
function cardFace(card, { reveal = false, lazy = false, brokenText = 'الصورة ما فتحت', onBroken } = {}) {
  if (!card) return null;
  if (card.type === 'emoji') return h('div', { class: 'tc-face emoji' }, card.emoji);
  if (card.type === 'text') {
    const size = card.text.length > 22 ? ' long' : card.text.length <= 6 ? ' short' : '';
    return h('div', { class: `tc-face text${size}`, dir: 'auto' }, card.text);
  }
  if (card.type === 'flag' || card.type === 'hidden-flag') {
    const hidden = card.type === 'hidden-flag' && !reveal;
    const focus = card.focus ?? { x: 50, y: 50 };
    return h('div', { class: `tc-face flag${hidden ? ' hidden' : ''}` },
      h('img', {
        src: flagSrc(card.code),
        alt: '',
        loading: lazy ? 'lazy' : null,
        style: hidden ? `transform-origin:${focus.x}% ${focus.y}%` : null,
      }));
  }
  const img = h('img', {
    src: card.src,
    alt: '',
    decoding: 'async',
    loading: lazy ? 'lazy' : null,
  });
  img.addEventListener('error', () => {
    img.replaceWith(h('div', { class: 'tc-broken' }, brokenText));
    onBroken?.(card);
  });
  return h('div', { class: `tc-face ${card.type}` }, img);
}

// Every device loads the round's next pictures as soon as the wheel stops,
// so nobody's clock runs while a picture is still loading.
const preloaded = new Map(); // src → { img, done }

function preloadImages(urls, onProgress) {
  for (const src of urls) {
    if (preloaded.has(src)) continue;
    const img = new Image();
    const entry = { img, done: false };
    img.onload = img.onerror = () => {
      entry.done = true;
      onProgress?.();
    };
    img.src = src;
    preloaded.set(src, entry);
  }
}

function preloadNote(urls) {
  if (!urls?.length) return null;
  const el = h('p', { class: 'tc-preload', 'data-preload': '' });
  const update = () => {
    const done = urls.filter((src) => preloaded.get(src)?.done).length;
    el.textContent = done >= urls.length ? 'الصور جاهزة' : `تحميل الصور ${done}/${urls.length}`;
  };
  preloadImages(urls, update);
  update();
  // Progress events can come from images started by an earlier screen.
  const timer = setInterval(() => {
    if (!el.isConnected) clearInterval(timer);
    else update();
  }, 400);
  return el;
}

/* ---------- Clocks ---------- */

/** A team's time left right now, following the server's clock. */
function clockMs(round, team) {
  const left = round.remaining[team];
  if (round.active !== team || round.runningSince == null) return left;
  return Math.max(0, left - (serverNow() - round.runningSince));
}

function formatClock(ms) {
  if (ms >= 10000) return String(Math.ceil(ms / 1000));
  return (Math.ceil(ms / 100) / 10).toFixed(1);
}

/** duel: this round's two players ({ red: { name }, blue: … }), named on their clocks. */
function clocksEl(round, { seconds, myTeam = null, playing = true, duel = null }) {
  const total = seconds * 1000;
  return h('div', { class: 'tc-clocks' }, TEAM_ORDER.map((team) => {
    const ms = clockMs(round, team);
    const active = playing && round.active === team;
    return h('div', {
      class: `tc-clock ${team}${active ? ' active' : ''}${myTeam === team ? ' mine' : ''}`,
      'data-clock': team,
    },
      h('div', { class: 'tc-clock-name' }, `${TEAM_INFO[team].name}`, myTeam === team ? h('small', {}, ' · فريقك') : null),
      duel?.[team] ? h('div', { class: 'tc-clock-player' }, duel[team].name) : null,
      h('div', { class: 'tc-clock-time' }, formatClock(ms)),
      h('div', { class: 'tc-clock-bar' }, h('span', { style: `width:${Math.min(100, (ms / total) * 100)}%` })),
    );
  }));
}

/** Keeps the clocks on screen counting down between state updates. */
function startClockTicker(getState, onTick) {
  setInterval(() => {
    const s = getState();
    if (!s || s.gameType !== 'time' || !s.round) return;
    const { round } = s;
    const total = s.settings.seconds * 1000;
    document.querySelectorAll('[data-clock]').forEach((el) => {
      const team = el.dataset.clock;
      const ms = clockMs(round, team);
      el.querySelector('.tc-clock-time').textContent = formatClock(ms);
      el.querySelector('.tc-clock-bar span').style.width = `${Math.min(100, (ms / total) * 100)}%`;
      el.classList.toggle('urgent', s.phase === 'playing' && round.active === team && ms <= 5000);
    });
    onTick?.(s);
  }, 100);
}

/* ---------- Wheel ---------- */

const SPIN_MS = 4200;
const WHEEL_COLORS = ['#ff5d7d', '#ffd23f', '#2fe0a0', '#7cc8ff', '#c792ff', '#ff9f43', '#4dd4c6', '#f78fb3'];
const spinStarts = new Map(); // spinId → when this device started showing it

/** ms until the wheel for this spin stops; the first call starts it. */
function spinRemaining(spinId) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  if (!spinStarts.has(spinId)) spinStarts.set(spinId, performance.now());
  return Math.max(0, SPIN_MS - (performance.now() - spinStarts.get(spinId)));
}

function escapeXml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function wheelSvg(items) {
  const n = items.length;
  const seg = 360 / n;
  const point = (deg, r) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
  };
  const slices = items.map((c, i) => {
    const color = WHEEL_COLORS[i % WHEEL_COLORS.length];
    const shape = n === 1
      ? `<circle r="97" fill="${color}"/>`
      : `<path d="M0 0 L${point(i * seg, 97)} A97 97 0 0 1 ${point((i + 1) * seg, 97)} Z" fill="${color}" stroke="#1d1238" stroke-width="1"/>`;
    // The name runs along the radius, from the hub to the rim.
    const name = c.name.replace(/ من الإيموجي$/, '');
    const size = Math.min(10.5, 70 / (name.length * 0.55)).toFixed(1);
    return `${shape}<g transform="rotate(${i * seg + seg / 2})">`
      + `<text transform="translate(0 -58) rotate(-90)" font-size="${size}" text-anchor="middle" dominant-baseline="central" fill="#1d1238" font-weight="800">${escapeXml(name)}</text>`
      + '</g>';
  });
  return `<svg viewBox="-100 -100 200 200" aria-hidden="true">${slices.join('')}</svg>`;
}

/** Turns the wheel so the picked category ends under the pointer. */
function wheelTarget(round) {
  const n = round.wheel.length;
  const seg = 360 / n;
  const index = Math.max(0, round.wheel.findIndex((c) => c.id === round.category.id));
  // Land somewhere inside the slice, the same spot on every device.
  const jitter = ((round.spinId % 997) / 997 - 0.5) * seg * 0.6;
  return 360 * 6 - (index * seg + seg / 2) - jitter;
}

function wheelEl(round) {
  const disk = h('div', { class: 'tc-wheel-disk', html: wheelSvg(round.wheel) });
  const target = wheelTarget(round);
  const left = spinRemaining(round.spinId);
  if (left > 0 && disk.animate) {
    const anim = disk.animate(
      [{ transform: 'rotate(0deg)' }, { transform: `rotate(${target}deg)` }],
      { duration: SPIN_MS, easing: 'cubic-bezier(0.1, 0.6, 0.1, 1)', fill: 'forwards' },
    );
    anim.currentTime = SPIN_MS - left;
  } else {
    disk.style.transform = `rotate(${target}deg)`;
  }
  // The clip keeps the turned square from widening the page (phones zoom out).
  return h('div', { class: 'tc-wheel' },
    h('div', { class: 'tc-wheel-pointer' }),
    h('div', { class: 'tc-wheel-clip' }, disk),
    h('div', { class: 'tc-wheel-hub' }, icon('timer')),
  );
}

/* ---------- Scores and results ---------- */

function scoreboardEl(s) {
  return h('div', { class: 'tc-score' },
    TEAM_ORDER.map((team, i) => [
      i === 1 ? h('div', { class: 'tc-score-mid' }, 'أول فريق يكسب ', h('b', {}, roundsText(s.roundsToWin)), ' يفوز') : null,
      h('div', { class: `tc-score-team ${team}` }, h('span', {}, `${TEAM_INFO[team].name}`), h('b', { 'data-bump': `score-${team}` }, s.score[team])),
    ]),
  );
}

/** «🔴 أبو فهد ضد 🔵 نورة»: who plays this round. */
function duelEl(duel, { meId = null } = {}) {
  if (!duel) return null;
  const side = (team) => h('span', { class: `tc-duel-side ${team}${duel[team]?.id === meId ? ' me' : ''}` },
    h('small', {}, `${TEAM_INFO[team].name}`), h('b', {}, duel[team]?.name ?? '—'));
  return h('div', { class: 'tc-duel' }, side('red'), h('span', { class: 'tc-duel-vs' }, 'ضد'), side('blue'));
}

function roundResultText(result) {
  if (!result.winner) return { title: 'تعادل!', detail: 'خلصت صور الفئة والوقت متساوي' };
  const loser = otherTeam(result.winner);
  return {
    title: `${teamLabel(result.winner)} فاز بالجولة!`,
    detail: result.reason === 'time'
      ? `${teamLabel(loser)} خلص وقته`
      : `خلصت صور الفئة، و${teamLabel(result.winner)} باقي له وقت أكثر`,
  };
}

const RESULT_MARK = { correct: 'circle-check', skip: 'skip-forward', stuck: 'hourglass' };

function recapEl(items) {
  if (!items.length) return h('p', { class: 'muted center' }, 'ما انعرضت صور هالجولة');
  return h('div', { class: 'tc-recap' }, items.map((item) => h('figure', { class: `tc-recap-item ${item.team} ${item.result}` },
    cardFace(item, { reveal: true }),
    h('figcaption', {},
      h('span', { class: 'tc-recap-mark', title: item.result === 'correct' ? 'صح' : item.result === 'skip' ? 'تخطي' : 'خلص الوقت عليها' },
        icon(RESULT_MARK[item.result])),
      h('b', {}, item.answer)),
  )));
}

function timeRulesList(settings) {
  return h('ul', { class: 'rules-list' },
    h('li', {}, 'فريقين: ', h('span', { class: 'team-dot red', 'aria-hidden': 'true' }), ' الأحمر و', h('span', { class: 'team-dot blue', 'aria-hidden': 'true' }), ' الأزرق، وكل فريق عنده ساعته الخاصة.'),
    h('li', {}, 'كل جولة شخص ضد شخص: واحد من كل فريق بالدور، عشان الكل يلعب. وهو بس اللي يجاوب، وفريقه ما يساعده ', icon('venetian-mask')),
    h('li', {}, 'كل جولة تدور العجلة وتختار الفئة.'),
    h('li', {}, 'تطلع صورة، واللي عليه الدور يقول وش هي بصوت عالي.'),
    h('li', {}, 'لو الجواب صح، يوقف وقته ويبدأ وقت اللاعب الثاني على صورة جديدة.'),
    h('li', {}, 'يقدر يتخطى الصورة، بس وقته يبقى شغّال',
      settings.skipPenalty ? ` وينخصم منه ${settings.skipPenalty} ثواني` : '', '.'),
    h('li', {}, 'اللي يخلص وقته يخسر الجولة لفريقه.'),
    h('li', {}, `أول فريق يكسب ${roundsText(settings.roundsToWin)} يفوز باللعبة.`),
  );
}
