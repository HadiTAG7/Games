/* global $, h, emit, toast, socket, app, state, screenKey: writable, confetti, timerEl, standingsList, PLAY_GAMES, sfx, pointsText,
   osRulesList, osCategory, osTally, osOutsiderBanner, osGains, osRoundTitle */
'use strict';

// Player screens for «برا السالفة». Your card (the word, or «أنت برا السالفة»)
// only shows while you press on it, so the person next to you can't peek.
(() => {
function topbar() {
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'برا السالفة 🤫'),
    state.phase !== 'lobby' ? h('div', { class: 'pill' }, pointsText(state.me.score)) : null,
    h('div', { class: 'pill' }, state.me.name),
  );
}

/** Press and hold to see your card; let go and it hides again. */
function secretCard() {
  const { me, round } = state;
  const face = me.outsider
    ? [h('span', { class: 'os-card-emoji' }, '🤫'), h('b', { class: 'os-card-word' }, 'أنت برا السالفة!'),
      h('small', {}, 'جارِهم بالأسئلة وحاول تعرف وش السالفة')]
    : [h('small', {}, 'السالفة'), h('b', { class: 'os-card-word' }, me.word), h('small', {}, 'لا تفضحها، بس بيّن إنك تعرفها')];
  const card = h('button', {
    type: 'button',
    class: 'os-card',
    'aria-label': 'اضغط مطولاً عشان تشوف بطاقتك',
    oncontextmenu: (e) => e.preventDefault(),
  },
    h('div', { class: 'os-card-cover' },
      h('span', { class: 'os-card-emoji' }, '🃏'),
      h('b', {}, 'اضغط مطولاً عشان تشوف بطاقتك'),
      h('small', {}, `الفئة: ${round.category.emoji} ${round.category.name}`)),
    h('div', { class: 'os-card-face' }, ...face, h('small', { class: 'os-card-cat' }, `${round.category.emoji} ${round.category.name}`)),
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
    h('div', { class: 'wave' }, '🤫'),
    h('h1', { class: 'center' }, `أهلاً ${state.me.name}`),
    h('p', { class: 'muted center' }, 'انتظر المضيف يبدأ اللعبة…'),
    h('div', { class: 'card' }, h('h2', {}, 'طريقة اللعب'), osRulesList(state.settings, state.rules)),
  );
}

function renderWaiting() {
  return h('main', { class: 'stage narrow os-stage' },
    h('div', { class: 'os-big' }, '⏳'),
    h('h1', { class: 'center' }, 'دخلت والجولة شغّالة'),
    h('p', { class: 'center muted' }, 'تلعب معهم من الجولة الجاية.'),
  );
}

function renderRoles() {
  return h('main', { class: 'stage narrow os-stage' },
    h('p', { class: 'center muted' }, osRoundTitle(state)),
    secretCard(),
    h('p', { class: 'hint center' }, 'شوف بطاقتك وخلّها سر. المضيف بيبدأ الأسئلة.'),
  );
}

function askingLine() {
  const { round, me } = state;
  const pair = round.pairs[round.askIndex];
  if (pair.asker.id === me.id) return h('div', { class: 'tc-turn mine os-turn' }, `دورك! اسأل ${pair.target.name} 🎤`);
  if (pair.target.id === me.id) return h('div', { class: 'tc-turn mine os-turn' }, `${pair.asker.name} بيسألك 👂`);
  return h('div', { class: 'tc-turn os-turn' }, `${pair.asker.name} يسأل ${pair.target.name}`);
}

function renderAsking() {
  return h('main', { class: 'stage narrow os-stage' },
    askingLine(),
    secretCard(),
  );
}

function renderFree() {
  return h('main', { class: 'stage narrow os-stage' },
    h('div', { class: 'tc-turn os-turn' }, 'أسئلة حرة! اسأل أي أحد 🗣️', timerEl(state.round.endsAt)),
    secretCard(),
  );
}

async function vote(target) {
  const res = await emit(socket, 'player:os-vote', { target });
  if (!res.ok) toast(res.error);
}

function renderVote() {
  const { round, me } = state;
  return h('main', { class: 'stage narrow os-stage' },
    h('h1', { class: 'center' }, '🗳️ مين برا السالفة؟'),
    h('p', { class: 'center muted' }, me.vote ? 'تقدر تغيّر صوتك لين يقفل التصويت' : 'اختر واحد'),
    h('div', { class: 'os-vote-grid' }, round.players.filter((p) => p.id !== me.id).map((p) => h('button', {
      type: 'button',
      class: `btn big os-vote-btn${me.vote === p.id ? ' picked' : ''}`,
      onclick: () => vote(p.id),
    }, p.name, me.vote === p.id ? ' ✅' : ''))),
    h('p', { class: 'hint center' }, `صوّت ${round.voted.length} من ${round.players.length}`),
    secretCard(),
  );
}

async function guess(word) {
  const res = await emit(socket, 'player:os-guess', { word });
  if (!res.ok) toast(res.error);
}

function renderGuess() {
  const { round, me } = state;
  const mine = round.outsiders.find((o) => o.id === me.id);
  const parts = [];
  if (mine && !mine.guessed) {
    parts.push(
      h('div', { class: `verdict ${mine.caught ? 'bad' : 'good'}` }, mine.caught ? 'انكشفت! 😅 بس لسا تقدر تكسب' : 'ما انكشفت! 😎'),
      h('h1', { class: 'center' }, 'وش السالفة؟'),
      h('p', { class: 'center muted' }, `${round.category.emoji} ${round.category.name} · لو جبتها تاخذ نقطتين`),
      h('div', { class: 'os-choices' }, me.choices.map((w) => h('button', { type: 'button', class: 'btn big', onclick: () => guess(w) }, w))),
    );
  } else {
    const waiting = round.outsiders.filter((o) => !o.guessed).map((o) => o.name);
    parts.push(
      osOutsiderBanner(round),
      mine ? h('p', { class: 'center' }, `خمّنت «${me.guess}» 🤞`) : null,
      waiting.length ? h('div', { class: 'os-waiting' }, `🤔 ${waiting.join(' و')} ${waiting.length > 1 ? 'يخمّنون' : 'يخمّن'} السالفة…`) : null,
      osTally(round),
    );
  }
  return h('main', { class: 'stage narrow os-stage' }, parts);
}

function renderRoundOver() {
  const { round, me } = state;
  if (round.aborted) {
    return h('main', { class: 'stage narrow os-stage' },
      h('div', { class: 'verdict bad' }, 'اللي برا السالفة طلع من الغرفة 🙃'),
      h('p', { class: 'hint center' }, 'انتظر الجولة الجاية…'));
  }
  const gained = round.gains?.[me.id] ?? 0;
  return h('main', { class: 'stage narrow os-stage' },
    h('div', { class: 'os-word' }, h('small', {}, 'السالفة كانت'), h('b', {}, round.word)),
    osOutsiderBanner(round),
    h('div', { class: `verdict ${gained ? 'good' : 'bad'}` }, gained ? `كسبت +${gained} 🎉` : 'ما كسبت شي هالجولة'),
    osGains(round),
    standingsList(state.standings, { highlightId: me.id, showGain: false }),
    h('p', { class: 'hint center' }, state.roundNumber >= state.totalRounds ? 'انتظر النتيجة النهائية…' : 'انتظر الجولة الجاية…'),
  );
}

function renderFinal() {
  const { me } = state;
  const won = me.rank === 1 && me.score > 0;
  const top = state.standings.filter((r) => r.rank === 1 && r.score > 0).map((r) => r.name);
  return h('main', { class: 'stage narrow final' },
    won ? confetti() : null,
    h('div', { class: 'trophy' }, won ? '🏆' : '🎮'),
    h('h1', { class: 'center' }, won ? 'أنت الفائز!' : 'انتهت اللعبة'),
    !won && top.length ? h('p', { class: 'center' }, 'الفائز: ', h('b', {}, top.join(' و '))) : null,
    standingsList(state.standings, { highlightId: me.id, showGain: false }),
    h('p', { class: 'hint center' }, 'المضيف يقدر يبدأ لعبة جديدة'),
  );
}

const SCREENS = {
  lobby: renderLobby,
  roles: renderRoles,
  asking: renderAsking,
  free: renderFree,
  vote: renderVote,
  guess: renderGuess,
  roundOver: renderRoundOver,
  final: renderFinal,
};

function render() {
  screenKey = 'outsider';
  const key = JSON.stringify([state.phase, state.step, state.me, state.round, state.standings, state.settings]);
  if ($('#os-root')?.dataset.key === key) return;
  const inRound = state.me.inRound || ['lobby', 'final'].includes(state.phase);
  const main = inRound ? SCREENS[state.phase]() : renderWaiting();
  main.id = 'os-root';
  main.dataset.key = key;
  app.replaceChildren(topbar(), main);
}

/** A chime when it's your turn to ask. */
function sounds(prev, next) {
  if (next.phase !== 'asking' || !next.round) return;
  const pair = next.round.pairs[next.round.askIndex];
  const before = prev.phase === 'asking' ? prev.round.pairs[prev.round.askIndex] : null;
  if (pair.asker.id === next.me.id && before?.asker.id !== next.me.id) sfx.play('turn');
}

PLAY_GAMES.outsider = { render, sounds };
})();
