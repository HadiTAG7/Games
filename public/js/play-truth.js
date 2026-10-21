/* global $, h, emit, toast, socket, app, state, screenKey: writable, confetti, timerEl, standingsList, PLAY_GAMES, sfx, pointsText,
   tfRulesList, tfRoundTitle, tfAnswer, icon */
'use strict';

// Player screens for «صح ولا خطأ»: two big buttons, and your first tap counts.
(() => {
let sending = null; // the answer on its way, so a second tap can't send another
let sendingStep = null; // …for this statement only (a reply lost to a dropped connection mustn't lock the next)

function topbar() {
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'صح ولا خطأ ', icon('circle-check-big')),
    state.phase !== 'lobby' ? h('div', { class: 'pill' }, pointsText(state.me.score)) : null,
    h('div', { class: 'pill' }, state.me.name),
  );
}

function renderLobby() {
  return h('main', { class: 'stage narrow' },
    h('div', { class: 'wave' }, icon('circle-check-big')),
    h('h1', { class: 'center' }, `أهلاً ${state.me.name}`),
    h('p', { class: 'muted center' }, 'انتظر المضيف يبدأ اللعبة…'),
    h('div', { class: 'card' }, h('h2', {}, 'طريقة اللعب'), tfRulesList(state.settings, state.rules)),
  );
}

async function answer(value) {
  if (sending !== null || state.me.answer !== null) return;
  sending = value;
  sendingStep = state.step;
  document.querySelectorAll('.tf-btn').forEach((b) => {
    b.disabled = true;
    b.classList.toggle('picked', b.dataset.answer === String(value));
  });
  const res = await emit(socket, 'player:tf-answer', { answer: value });
  if (sendingStep === state.step) sending = null;
  if (!res.ok) {
    toast(res.error);
    render(true);
  }
}

function renderStatement() {
  const { round, me } = state;
  const mine = me.answer ?? sending;
  const button = (value, label, name) => h('button', {
    type: 'button',
    class: `tf-btn ${value ? 'yes' : 'no'}${mine === value ? ' picked' : ''}`,
    'data-answer': String(value),
    disabled: mine !== null,
    onclick: () => answer(value),
  }, icon(name), h('span', {}, label));
  return h('main', { class: 'stage narrow tf-stage' },
    h('p', { class: 'center muted' }, tfRoundTitle(round)),
    timerEl(round.endsAt),
    h('h1', { class: 'question tf-statement' }, round.statement),
    h('div', { class: 'tf-buttons' }, button(true, 'صح', 'circle-check-big'), button(false, 'خطأ', 'circle-x')),
    h('p', { class: 'hint center' }, mine === null ? 'أول ضغطة هي جوابك، وكل ما أسرع زادت نقاطك' : `جوابك: ${mine ? 'صح' : 'خطأ'} · انتظر الكشف`),
  );
}

function myVerdict() {
  const { me } = state;
  if (me.answer === null) return h('div', { class: 'verdict bad' }, 'ما جاوبت هالمرة');
  if (me.right) return h('div', { class: 'verdict good' }, 'صح! ', h('bdi', { dir: 'ltr' }, `+${me.gained}`), ' ', icon('party-popper'));
  return h('div', { class: 'verdict bad' }, 'غلط هالمرة');
}

function renderReveal() {
  const { round, me } = state;
  return h('main', { class: 'stage narrow tf-stage' },
    h('p', { class: 'tf-asked' }, round.statement),
    myVerdict(),
    tfAnswer(round.result),
    standingsList(state.standings, { highlightId: me.id }),
    h('p', { class: 'hint center' }, round.number >= round.total ? 'انتظر النتيجة النهائية…' : 'انتظر العبارة الجاية…'),
  );
}

function renderFinal() {
  const { me } = state;
  const won = me.rank === 1 && me.score > 0;
  const top = state.standings.filter((r) => r.rank === 1 && r.score > 0).map((r) => r.name);
  return h('main', { class: 'stage narrow final' },
    won ? confetti() : null,
    h('div', { class: 'trophy' }, won ? icon('trophy') : icon('gamepad-2')),
    h('h1', { class: 'center' }, won ? 'أنت الفائز!' : 'انتهت اللعبة'),
    !won && top.length ? h('p', { class: 'center' }, 'الفائز: ', h('b', {}, top.join(' و '))) : null,
    standingsList(state.standings, { highlightId: me.id, showGain: false }),
    h('p', { class: 'hint center' }, 'المضيف يقدر يبدأ لعبة جديدة'),
  );
}

const SCREENS = { lobby: renderLobby, statement: renderStatement, reveal: renderReveal, final: renderFinal };

function render(force = false) {
  screenKey = 'truth';
  if (sending !== null && sendingStep !== state.step) sending = null;
  const key = JSON.stringify([state.phase, state.step, state.me, state.round, state.standings, state.settings]);
  if (!force && $('#tf-root')?.dataset.key === key) return;
  const main = SCREENS[state.phase]();
  main.id = 'tf-root';
  main.dataset.key = key;
  app.replaceChildren(topbar(), main);
}

/** A chime for each statement, and right or wrong at the reveal. */
function sounds(prev, next) {
  if (prev.step === next.step) return;
  if (next.phase === 'statement') sfx.play('turn');
  else if (next.phase === 'reveal' && next.me.answer !== null) sfx.play(next.me.right ? 'correct' : 'wrong');
}

const won = (s) => s.me.rank === 1 && s.me.score > 0;

PLAY_GAMES.truth = { render, sounds, won };
})();
