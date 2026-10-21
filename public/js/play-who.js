/* global $, h, emit, toast, socket, app, state, screenKey: writable, confetti, timerEl, standingsList, PLAY_GAMES, sfx, pointsText,
   whoRulesList, whoRoundTitle, whoTally, whoVerdict, whoTitles, icon */
'use strict';

// Player screens for «مين فينا؟»: vote in secret for one of the players, and
// see whether you guessed the majority.
(() => {
function topbar() {
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'مين فينا؟ ', icon('pointer')),
    state.phase !== 'lobby' ? h('div', { class: 'pill' }, pointsText(state.me.score)) : null,
    h('div', { class: 'pill' }, state.me.name),
  );
}

function renderLobby() {
  return h('main', { class: 'stage narrow' },
    h('div', { class: 'wave' }, icon('pointer')),
    h('h1', { class: 'center' }, `أهلاً ${state.me.name}`),
    h('p', { class: 'muted center' }, 'انتظر المضيف يبدأ اللعبة…'),
    h('div', { class: 'card' }, h('h2', {}, 'طريقة اللعب'), whoRulesList(state.settings, state.rules)),
  );
}

async function vote(target) {
  const res = await emit(socket, 'player:who-vote', { target });
  if (!res.ok) toast(res.error);
}

function renderQuestion() {
  const { round, me } = state;
  return h('main', { class: 'stage narrow who-stage' },
    h('p', { class: 'center muted' }, whoRoundTitle(round)),
    timerEl(round.endsAt),
    h('h1', { class: 'question who-question' }, round.question),
    h('div', { class: 'os-vote-grid who-vote-grid', role: 'group', 'aria-label': 'صوّت' }, state.players.map((p) => h('button', {
      type: 'button',
      class: `btn big os-vote-btn${me.vote === p.id ? ' picked' : ''}`,
      'aria-pressed': String(me.vote === p.id),
      onclick: () => vote(p.id),
    }, h('span', {}, p.name, me.vote === p.id ? [' ', icon('circle-check')] : ''), p.id === me.id ? h('small', {}, 'أنت') : null))),
    h('p', { class: 'hint center' }, me.vote ? `صوّت لـ${me.voteName}، وتقدر تغيّر لين تنكشف الأصوات` : 'اختر واحد، ومحد بيعرف مين اخترت'),
    h('p', { class: 'hint center' }, `صوّت ${round.votedCount} من ${round.voterCount}`),
  );
}

function myVerdict() {
  const { round, me, rules } = state;
  if (!me.vote) return h('div', { class: 'verdict bad' }, 'ما صوّت هالمرة');
  if (me.guessed) return h('div', { class: 'verdict good' }, 'خمّنت الأغلبية! ', h('bdi', { dir: 'ltr' }, `+${rules.point}`), ' ', icon('party-popper'));
  if (!round.result.top.length) return h('div', { class: 'verdict' }, 'ما فيه أغلبية، محد ياخذ نقاط');
  return h('div', { class: 'verdict bad' }, 'ما خمّنت الأغلبية');
}

function renderReveal() {
  const { round, me } = state;
  return h('main', { class: 'stage narrow who-stage' },
    h('p', { class: 'who-asked' }, round.question),
    whoVerdict(round.result),
    myVerdict(),
    me.voteName ? h('p', { class: 'center muted' }, `صوتك كان لـ${me.voteName}`) : null,
    whoTally(round.result),
    standingsList(state.standings, { highlightId: me.id, showGain: false }),
    h('p', { class: 'hint center' }, round.number >= round.total ? 'انتظر النتيجة النهائية…' : 'انتظر السؤال الجاي…'),
  );
}

function renderFinal() {
  const { me } = state;
  const won = me.rank === 1 && me.score > 0;
  const top = state.standings.filter((r) => r.rank === 1 && r.score > 0).map((r) => r.name);
  const mine = state.titles.filter((t) => t.names.includes(me.name));
  return h('main', { class: 'stage narrow final' },
    won ? confetti() : null,
    h('div', { class: 'trophy' }, won ? icon('trophy') : icon('gamepad-2')),
    h('h1', { class: 'center' }, won ? 'أنت الفائز!' : 'انتهت اللعبة'),
    !won && top.length ? h('p', { class: 'center' }, 'الفائز: ', h('b', {}, top.join(' و '))) : null,
    standingsList(state.standings, { highlightId: me.id, showGain: false }),
    mine.length ? [h('h2', { class: 'center' }, 'ألقابك'), whoTitles(mine, { meName: me.name })] : null,
    h('p', { class: 'hint center' }, 'المضيف يقدر يبدأ لعبة جديدة'),
  );
}

const SCREENS = { lobby: renderLobby, question: renderQuestion, reveal: renderReveal, final: renderFinal };

function render() {
  screenKey = 'who';
  const key = JSON.stringify([state.phase, state.step, state.me, state.round, state.standings, state.players, state.settings]);
  if ($('#who-root')?.dataset.key === key) return;
  const main = SCREENS[state.phase]();
  main.id = 'who-root';
  main.dataset.key = key;
  app.replaceChildren(topbar(), main);
}

/** A chime for a new question, and a happy one when you guessed the majority. */
function sounds(prev, next) {
  if (prev.step === next.step) return;
  if (next.phase === 'question') sfx.play('turn');
  else if (next.phase === 'reveal' && next.me.guessed) sfx.play('correct');
}

const won = (s) => s.me.rank === 1 && s.me.score > 0;

PLAY_GAMES.who = { render, sounds, won };
})();
