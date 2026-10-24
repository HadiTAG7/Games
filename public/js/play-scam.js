/* global $, h, emit, toast, socket, app, state, screenKey: writable, confetti, standingsList, timerEl, PLAY_GAMES, sfx, pointsText,
   scRulesList, scRoundTitle, scTally, scImpostorBanner, scMission, scLines, scVoters, scWheel, icon */
'use strict';

// Player screens for «مين النصاب؟». Your card (the word, or «أنت النصاب» with
// your mission) opens with a tap and closes by itself a few seconds later, so
// the person next to you can't peek. Every phone's vote looks the same.
(() => {
const CARD_OPEN_MS = 7000;
let cardOpenUntil = 0; // survives redraws, so an update doesn't snap the card shut…
let cardOpenRound = 0; // …but a new round's card starts shut
let cardTimer = null;

function topbar() {
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'مين النصاب؟ ', icon('fingerprint')),
    state.phase !== 'lobby' ? h('div', { class: 'pill' }, pointsText(state.me.score)) : null,
    h('div', { class: 'pill' }, state.me.name),
  );
}

async function swapMission() {
  const res = await emit(socket, 'player:sc-swap', {});
  if (!res.ok) toast(res.error);
  else toast('تبدّلت مهمتك', 'ok');
}

/** Tap to see your card; it closes by itself (or on a second tap). */
function secretCard() {
  const { me, round } = state;
  const open = () => Date.now() < cardOpenUntil && cardOpenRound === state.roundNumber;
  const face = me.impostor
    ? [h('span', { class: 'os-card-emoji' }, icon('fingerprint')), h('b', { class: 'os-card-word' }, 'أنت النصاب!'),
      h('small', {}, 'ما تعرف الكلمة. جارِهم، وخمّن وش هي'),
      h('div', { class: 'sc-card-mission' }, h('small', {}, 'مهمتك السرية'), h('b', {}, me.mission.text))]
    : [h('small', {}, 'الكلمة'), h('b', { class: 'os-card-word' }, me.word), h('small', {}, 'لمّح لها بكلمة، بدون ما تفضحها')];
  const card = h('button', { type: 'button', class: `os-card sc-card${me.impostor ? ' impostor' : ''}`, 'aria-label': 'اضغط عشان تشوف بطاقتك' },
    h('div', { class: 'os-card-cover' },
      h('span', { class: 'os-card-emoji' }, icon('eye-off')),
      h('b', {}, 'اضغط عشان تشوف بطاقتك'),
      h('small', {}, `الفئة: ${round.category.name}`)),
    h('div', { class: 'os-card-face' }, ...face, h('small', { class: 'os-card-cat' }, round.category.name)),
  );
  // Only the impostor's open card offers a swap; a shut card looks the same on every phone.
  const canSwap = me.impostor && !me.swapped && ['roles', 'hints', 'discuss'].includes(state.phase);
  const swap = canSwap ? h('button', { type: 'button', class: 'btn small sc-swap', hidden: true, onclick: swapMission }, icon('refresh-cw'), ' المهمة ما تنفع؟ بدّلها (مرة وحدة)') : null;
  const show = (on) => {
    card.classList.toggle('open', on);
    if (swap) swap.hidden = !on;
  };
  card.addEventListener('click', () => {
    cardOpenUntil = open() ? 0 : Date.now() + CARD_OPEN_MS;
    cardOpenRound = state.roundNumber;
    show(open());
    clearTimeout(cardTimer);
    if (open()) cardTimer = setTimeout(() => show(false), cardOpenUntil - Date.now());
  });
  if (open()) {
    show(true);
    clearTimeout(cardTimer);
    cardTimer = setTimeout(() => show(false), cardOpenUntil - Date.now());
  }
  return h('div', { class: 'sc-card-wrap' }, card, swap);
}

function renderLobby() {
  return h('main', { class: 'stage narrow' },
    h('div', { class: 'wave' }, icon('fingerprint')),
    h('h1', { class: 'center' }, `أهلاً ${state.me.name}`),
    h('p', { class: 'muted center' }, 'انتظر المضيف يبدأ اللعبة…'),
    h('div', { class: 'card' }, h('h2', {}, 'طريقة اللعب'), scRulesList(state.settings, state.rules)),
  );
}

function renderWaiting() {
  return h('main', { class: 'stage narrow sc-stage' },
    h('div', { class: 'os-big' }, icon('hourglass')),
    h('h1', { class: 'center' }, 'دخلت والجولة شغّالة'),
    h('p', { class: 'center muted' }, 'تلعب معهم من الجولة الجاية.'),
  );
}

function renderRoles() {
  return h('main', { class: 'stage narrow sc-stage' },
    h('p', { class: 'center muted' }, scRoundTitle(state)),
    secretCard(),
    h('p', { class: 'hint center' }, 'شوف بطاقتك وخلّها سر. المضيف بيبدأ التلميح.'),
  );
}

function renderHints() {
  const { round, me } = state;
  const now = round.order[round.hintIndex];
  const mine = now.id === me.id;
  return h('main', { class: 'stage narrow sc-stage' },
    h('div', { class: `tc-turn os-turn${mine ? ' mine' : ''}` }, mine ? ['دورك! قل كلمة وحدة تلمّح ', icon('mic')] : `دور ${now.name} يلمّح`),
    secretCard(),
  );
}

function renderDiscuss() {
  return h('main', { class: 'stage narrow sc-stage' },
    h('div', { class: 'tc-turn os-turn' }, 'نقاش! اسأل اللي تشك فيه ', icon('megaphone'), timerEl(state.round.endsAt)),
    secretCard(),
  );
}

async function vote(answers) {
  const res = await emit(socket, 'player:sc-vote', answers);
  if (!res.ok) toast(res.error);
}

function renderVote() {
  const { round, me, rules } = state;
  return h('main', { class: 'stage narrow sc-stage' },
    h('h2', { class: 'center' }, icon('vote'), ' مين النصاب؟'),
    h('div', { class: 'os-vote-grid' }, round.order.filter((p) => p.id !== me.id).map((p) => h('button', {
      type: 'button',
      class: `btn big os-vote-btn${me.vote === p.id ? ' picked' : ''}`,
      onclick: () => vote({ target: p.id }),
    }, p.name, me.vote === p.id ? [' ', icon('circle-check')] : ''))),
    h('h2', { class: 'center' }, icon('fingerprint'), ' وش كانت مهمته السرية؟'),
    h('div', { class: 'sc-mission-choices' },
      round.missionChoices.map((m) => h('button', {
        type: 'button',
        class: `btn sc-mission-btn${me.pick === m.id ? ' picked' : ''}`,
        onclick: () => vote({ mission: m.id }),
      }, m.text, me.pick === m.id ? [' ', icon('circle-check')] : '')),
      h('button', {
        type: 'button',
        class: `btn ghost sc-mission-btn${me.pick === rules.notNoticed ? ' picked' : ''}`,
        onclick: () => vote({ mission: rules.notNoticed }),
      }, icon('eye-off'), ' ما لاحظت شي'),
    ),
    h('p', { class: 'hint center' }, `جاوب ${round.voted.length} من ${round.order.length} · تقدر تغيّر لين يقفل التصويت`),
  );
}

async function guess(word) {
  const res = await emit(socket, 'player:sc-guess', { word });
  if (!res.ok) toast(res.error);
}

function renderReveal() {
  const { round } = state;
  return h('main', { class: 'stage narrow sc-stage' },
    scImpostorBanner(round),
    scMission(round),
    scTally(round),
    h('p', { class: 'hint center' }, 'شوفوا الشاشة…'),
  );
}

function renderGuess() {
  const { round, me } = state;
  if (me.impostor && me.guessChoices) {
    return h('main', { class: 'stage narrow sc-stage' },
      h('h1', { class: 'center' }, 'وش الكلمة؟'),
      h('p', { class: 'center muted' }, `${round.category.name} · لو جبتها تاخذ نقطة`),
      h('div', { class: 'os-choices' }, me.guessChoices.map((w) => h('button', { type: 'button', class: 'btn big', onclick: () => guess(w) }, w))),
    );
  }
  return h('main', { class: 'stage narrow sc-stage' },
    scImpostorBanner(round),
    h('div', { class: 'os-waiting' }, `${round.impostor.name} يخمّن الكلمة…`),
  );
}

function renderRoundOver() {
  const { round, me } = state;
  if (round.aborted) {
    return h('main', { class: 'stage narrow sc-stage' },
      h('div', { class: 'verdict bad' }, 'النصاب طلع من الغرفة'),
      h('p', { class: 'hint center' }, 'انتظر الجولة الجاية…'));
  }
  const gained = round.gains?.[me.id] ?? 0;
  return h('main', { class: 'stage narrow sc-stage' },
    h('div', { class: 'os-word' }, h('small', {}, 'الكلمة كانت'), h('b', {}, round.word)),
    h('div', { class: `verdict ${gained > 0 ? 'good' : 'bad'}` },
      gained > 0 ? ['كسبت ', h('bdi', { dir: 'ltr' }, `+${gained}`), ' ', icon('party-popper')]
        : gained < 0 ? ['خسرت ', h('bdi', { dir: 'ltr' }, `−${-gained}`)] : 'ما كسبت شي هالجولة'),
    scLines(round),
    standingsList(state.standings, { highlightId: me.id, showGain: false }),
    h('p', { class: 'hint center' }, state.roundNumber >= state.totalRounds ? 'انتظر النتيجة النهائية…' : 'انتظر الجولة الجاية…'),
  );
}

function renderFinal() {
  const { me } = state;
  const won = me.rank === 1 && me.score > 0;
  const top = state.standings.filter((r) => r.rank === 1 && r.score > 0).map((r) => r.name);
  const p = state.punishment;
  return h('main', { class: 'stage narrow final sc-stage' },
    won ? confetti() : null,
    h('div', { class: 'trophy' }, won ? icon('trophy') : icon('gamepad-2')),
    h('h1', { class: 'center' }, won ? 'أنت الفائز!' : 'انتهت اللعبة'),
    !won && top.length ? h('p', { class: 'center' }, 'الفائز: ', h('b', {}, top.join(' و '))) : null,
    p ? h('section', { class: 'card sc-punish-box' }, h('h2', { class: 'center' }, icon('gavel'), ' دولاب العقاب'), scWheel(p)) : null,
    standingsList(state.standings, { highlightId: me.id, showGain: false }),
    h('p', { class: 'hint center' }, 'المضيف يقدر يبدأ لعبة جديدة'),
  );
}

const SCREENS = {
  lobby: renderLobby,
  roles: renderRoles,
  hints: renderHints,
  discuss: renderDiscuss,
  vote: renderVote,
  reveal: renderReveal,
  guess: renderGuess,
  roundOver: renderRoundOver,
  final: renderFinal,
};

function render() {
  screenKey = 'scam';
  const key = JSON.stringify([state.phase, state.step, state.me, state.round, state.standings, state.settings, state.punishment]);
  if ($('#sc-root')?.dataset.key === key) return;
  const inRound = state.me.inRound || ['lobby', 'final'].includes(state.phase);
  const main = inRound ? SCREENS[state.phase]() : renderWaiting();
  main.id = 'sc-root';
  main.dataset.key = key;
  app.replaceChildren(topbar(), main);
}

/** A chime when it's your turn to give a hint. */
function sounds(prev, next) {
  if (next.phase !== 'hints' || !next.round) return;
  const now = next.round.order[next.round.hintIndex];
  const before = prev.phase === 'hints' ? prev.round.order[prev.round.hintIndex] : null;
  if (now.id === next.me.id && before?.id !== next.me.id) sfx.play('turn');
}

const won = (s) => s.me.rank === 1 && s.me.score > 0;

PLAY_GAMES.scam = { render, sounds, won };
})();
