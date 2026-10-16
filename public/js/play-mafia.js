/* global $, h, emit, toast, socket, app, state, screenKey: writable, confetti, timerEl, PLAY_GAMES, sfx,
   MF_ROLES, mfRole, mfLineup, mfRulesList, mfPlayers, mfAnnouncement, mfWinnerText */
'use strict';

// Player screens for «مافيا». Your role card shows only while you press on
// it. At night every phone shows a list of names to pick from, whatever the
// role, so nobody can tell who's doing what from across the room.
(() => {
function topbar() {
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'مافيا 🎭'),
    state.me.inGame && !state.me.alive && state.phase !== 'final' ? h('div', { class: 'pill' }, '👻 طالع') : null,
    h('div', { class: 'pill' }, state.me.name),
  );
}

/** Press and hold to see your role; let go and it hides again. */
function roleCard() {
  const { me } = state;
  const info = MF_ROLES[me.role];
  const face = [
    h('span', { class: 'os-card-emoji' }, info.emoji),
    h('b', { class: 'os-card-word' }, info.name),
    h('small', {}, info.goal),
  ];
  if (me.team?.length) face.push(h('small', { class: 'mf-team' }, `ربعك: ${me.team.map((t) => `${t.name}${t.alive ? '' : ' 💀'}`).join(' · ')}`));
  if (me.checks?.length) {
    face.push(h('small', { class: 'mf-team' }, me.checks.map((c) => `${c.name}: ${c.mafia ? '🔪 مافيا' : '✅ مو مافيا'}`).join(' · ')));
  }
  if (me.role === 'sniper') face.push(h('small', { class: 'mf-team' }, me.bulletUsed ? 'استخدمت طلقتك' : 'طلقتك لسا معك 🎯'));
  const card = h('button', { type: 'button', class: 'os-card mf-card', 'aria-label': 'اضغط مطولاً عشان تشوف دورك', oncontextmenu: (e) => e.preventDefault() },
    h('div', { class: 'os-card-cover' }, h('span', { class: 'os-card-emoji' }, '🎭'), h('b', {}, 'اضغط مطولاً عشان تشوف دورك')),
    h('div', { class: 'os-card-face' }, ...face),
  );
  const show = (on) => card.classList.toggle('open', on);
  card.addEventListener('pointerdown', (e) => { e.preventDefault(); show(true); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) card.addEventListener(ev, () => show(false));
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(true); } });
  card.addEventListener('keyup', () => show(false));
  return card;
}

function renderLobby() {
  return h('main', { class: 'stage narrow' },
    h('div', { class: 'wave' }, '🎭'),
    h('h1', { class: 'center' }, `أهلاً ${state.me.name}`),
    h('p', { class: 'muted center' }, 'انتظر المضيف يوزّع الأدوار…'),
    h('div', { class: 'card' }, h('h2', {}, 'الأدوار'), mfLineup(state.lineup), mfRulesList(state.lineup)),
  );
}

function renderWatching() {
  return h('main', { class: 'stage narrow mf-stage' },
    h('div', { class: 'mf-big' }, '👀'),
    h('h1', { class: 'center' }, 'دخلت واللعبة شغّالة'),
    h('p', { class: 'center muted' }, 'تابع من الشاشة، وتلعب معهم من اللعبة الجاية.'),
  );
}

/** The dead watch with every role showing, and keep quiet. */
function renderGhost() {
  return h('main', { class: 'stage narrow mf-stage' },
    h('div', { class: 'mf-big' }, '👻'),
    h('h1', { class: 'center' }, 'طلعت من اللعبة'),
    h('p', { class: 'center muted' }, 'تقدر تشوف أدوار الكل… بس لا تتكلم ولا تلمّح! 🤐'),
    state.announcement && ['morning', 'verdict'].includes(state.phase) ? mfAnnouncement(state.announcement) : null,
    state.phase === 'discuss' || state.phase === 'night' ? timerEl(state.endsAt) : null,
    mfPlayers(state.players, { meId: state.me.id }),
  );
}

function renderRoles() {
  const { me } = state;
  return h('main', { class: 'stage narrow mf-stage' },
    roleCard(),
    me.team?.length ? h('p', { class: 'center' }, `🔪 ربعك في المافيا: ${me.team.map((t) => t.name).join(' و')}`) : null,
    h('p', { class: 'hint center' }, 'شوف دورك وخلّه سر. المضيف بيبدأ الليل.'),
  );
}

const NIGHT_PROMPTS = {
  mafia: '🔪 اختاروا ضحية الليلة',
  doctor: '🩺 مين تنقذ الليلة؟',
  police: '👮 مين تسأل عنه؟',
  sniper: '🎯 تطلق على أحد؟',
  mayor: '🤔 مين تشك فيه؟',
  citizen: '🤔 مين تشك فيه؟',
};

async function pick(target) {
  const res = await emit(socket, 'player:mf-pick', { target });
  if (!res.ok) toast(res.error);
}

function renderNight() {
  const { me } = state;
  const role = me.role === 'sniper' && me.bulletUsed ? 'citizen' : me.role;
  const others = state.players.filter((p) => p.alive && (p.id !== me.id || role === 'doctor'));
  const choices = others.filter((p) => !(role === 'mafia' && me.team.some((t) => t.id === p.id)));
  const police = me.role === 'police' && me.picked;
  const lastCheck = police ? me.checks.at(-1) : null;
  return h('main', { class: 'stage narrow mf-stage mf-night' },
    h('h1', { class: 'center' }, `🌙 الليلة ${state.dayNumber}`),
    h('p', { class: 'center mf-prompt' }, NIGHT_PROMPTS[role]),
    role === 'mafia' && me.team.length ? h('p', { class: 'center hint' }, me.team.map((t) => `${t.name}: ${t.pick ?? '…'}`).join(' · ')) : null,
    lastCheck ? h('div', { class: `verdict ${lastCheck.mafia ? 'bad' : 'good'}` },
      `${lastCheck.name} ${lastCheck.mafia ? 'مافيا! 🔪' : 'مو مافيا ✅'}`) : null,
    police ? null : h('div', { class: 'os-vote-grid' }, choices.map((p) => h('button', {
      type: 'button',
      class: `btn big os-vote-btn${me.pick === p.id ? ' picked' : ''}`,
      disabled: role === 'doctor' && p.id === me.lastSaved,
      onclick: () => pick(p.id),
    }, p.id === me.id ? 'نفسي' : p.name, me.pick === p.id ? ' ✅' : ''))),
    role === 'sniper' ? h('button', {
      type: 'button',
      class: `btn big ghost${me.picked && me.pick === null ? ' picked' : ''}`,
      onclick: () => pick(null),
    }, me.picked && me.pick === null ? '✋ خلّيت الطلقة ✅' : '✋ خلّ الطلقة لليلة ثانية') : null,
    timerEl(state.endsAt),
    h('p', { class: 'hint center' }, me.picked ? 'اخترت. ننتظر الباقين…' : 'اختر قبل لا يخلص الوقت'),
    roleCard(),
  );
}

function renderMorning() {
  return h('main', { class: 'stage narrow mf-stage' },
    h('h1', { class: 'center' }, '☀️ صباح الخير'),
    mfAnnouncement(state.announcement),
    state.winner ? h('div', { class: 'verdict good' }, mfWinnerText(state.winner)) : null,
    h('p', { class: 'hint center' }, 'شوفوا الشاشة، والمضيف بيبدأ النقاش.'),
    roleCard(),
  );
}

function renderDiscuss() {
  return h('main', { class: 'stage narrow mf-stage' },
    h('h1', { class: 'center' }, '🗣️ تناقشوا'),
    timerEl(state.endsAt),
    h('p', { class: 'center muted' }, 'مين تشكّون فيه؟ بعدها تصوّتون من الجوالات.'),
    mfPlayers(state.players, { meId: state.me.id }),
    roleCard(),
  );
}

async function vote(target) {
  const res = await emit(socket, 'player:mf-vote', { target });
  if (!res.ok) toast(res.error);
}

function renderVote() {
  const { me } = state;
  const choices = state.players.filter((p) => p.alive && p.id !== me.id);
  return h('main', { class: 'stage narrow mf-stage' },
    h('h1', { class: 'center' }, '🗳️ مين يطلع؟'),
    me.role === 'mayor' ? h('p', { class: 'center mf-mayor' }, '🎩 صوتك يحسب بصوتين') : null,
    h('div', { class: 'os-vote-grid' }, choices.map((p) => h('button', {
      type: 'button',
      class: `btn big os-vote-btn${me.vote === p.id ? ' picked' : ''}`,
      onclick: () => vote(p.id),
    }, p.name, me.vote === p.id ? ' ✅' : ''))),
    h('button', { type: 'button', class: `btn big ghost${me.vote === 'none' ? ' picked' : ''}`, onclick: () => vote('none') },
      me.vote === 'none' ? '🙅 ما نطلّع أحد ✅' : '🙅 ما نطلّع أحد'),
    h('p', { class: 'hint center' }, `صوّت ${state.voted.length} من ${choices.length + 1} · تقدر تغيّر لين يقفل التصويت`),
    roleCard(),
  );
}

function renderVerdict() {
  return h('main', { class: 'stage narrow mf-stage' },
    h('h1', { class: 'center' }, 'نتيجة التصويت'),
    mfAnnouncement(state.announcement),
    state.winner ? h('div', { class: 'verdict good' }, mfWinnerText(state.winner)) : null,
    roleCard(),
  );
}

function renderFinal() {
  const { me, winner } = state;
  const mine = me.role && winner && (me.role === 'mafia') === (winner === 'mafia');
  return h('main', { class: 'stage narrow final mf-stage' },
    mine ? confetti() : null,
    h('div', { class: 'trophy' }, mine ? '🏆' : '🎭'),
    h('h1', { class: 'center' }, winner ? mfWinnerText(winner) : 'انتهت اللعبة'),
    me.role ? h('p', { class: 'center' }, `كنت ${mfRole(me.role)}${mine ? '، وفريقك فاز!' : ''}`) : null,
    h('h2', { class: 'center' }, 'الأدوار كانت'),
    mfPlayers(state.players, { meId: me.id }),
    h('p', { class: 'hint center' }, 'المضيف يقدر يبدأ لعبة جديدة'),
  );
}

const SCREENS = {
  lobby: renderLobby,
  roles: renderRoles,
  night: renderNight,
  morning: renderMorning,
  discuss: renderDiscuss,
  vote: renderVote,
  verdict: renderVerdict,
  final: renderFinal,
};

function render() {
  screenKey = 'mafia';
  const key = JSON.stringify([state.phase, state.step, state.me, state.players, state.announcement, state.winner,
    state.phase === 'vote' && state.voted, state.lineup]);
  if ($('#mf-root')?.dataset.key === key) return;
  let main;
  if (['lobby', 'final'].includes(state.phase)) main = SCREENS[state.phase]();
  else if (!state.me.inGame) main = renderWatching();
  else if (!state.me.alive) main = renderGhost();
  else main = SCREENS[state.phase]();
  main.id = 'mf-root';
  main.dataset.key = key;
  app.replaceChildren(topbar(), main);
}

function sounds(prev, next) {
  if (prev.phase === next.phase) return;
  if (next.phase === 'night' && next.me.alive) sfx.play('night');
  else if (next.phase === 'morning' && prev.me.alive && !next.me.alive) sfx.play('lose');
}

const won = (s) => Boolean(s.me.role && s.winner && (s.me.role === 'mafia') === (s.winner === 'mafia'));

PLAY_GAMES.mafia = { render, sounds, won };
})();
