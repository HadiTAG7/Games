/* global $, h, emit, toast, socket, app, state, screenKey: writable, confetti, timerEl, PLAY_GAMES, sfx,
   MF_ROLES, mfRole, mfLineup, mfRulesList, mfPlayers, mfAnnouncement, mfStory, mfWinnerText, mfWon, icon */
'use strict';

// Player screens for «مافيا». Your role card shows only while you press on
// it. At night every phone shows a list of names to pick from, whatever the
// role, so nobody can tell who's doing what from across the room. Two or
// more mafia point at a victim (each sees the others' pointing) and confirm
// it together.
(() => {
function topbar() {
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'مافيا ', icon('drama')),
    state.me.inGame && !state.me.alive && state.phase !== 'final' ? h('div', { class: 'pill' }, icon('ghost'), ' طالع') : null,
    h('div', { class: 'pill' }, state.me.name),
  );
}

/** Press and hold to see your role; let go and it hides again. */
function roleCard() {
  const { me } = state;
  const info = MF_ROLES[me.role];
  const face = [
    h('span', { class: 'os-card-emoji' }, icon(info.icon)),
    h('b', { class: 'os-card-word' }, info.name),
    h('small', {}, info.goal),
  ];
  if (me.team?.length) face.push(h('small', { class: 'mf-team' }, `ربعك: ${me.team.map((t) => `${t.name}${t.alive ? '' : ' (مات)'}`).join(' · ')}`));
  if (me.checks?.length) {
    face.push(h('small', { class: 'mf-team' }, me.checks.map((c) => `${c.name}: ${c.mafia ? 'مافيا' : 'مو مافيا'}`).join(' · ')));
  }
  if (me.role === 'sniper') face.push(h('small', { class: 'mf-team' }, me.bulletUsed ? 'استخدمت طلقتك' : ['طلقتك لسا معك ', icon('crosshair')]));
  const card = h('button', { type: 'button', class: 'os-card mf-card', 'aria-label': 'اضغط مطولاً عشان تشوف دورك', oncontextmenu: (e) => e.preventDefault() },
    h('div', { class: 'os-card-cover' }, h('span', { class: 'os-card-emoji' }, icon('drama')), h('b', {}, 'اضغط مطولاً عشان تشوف دورك')),
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
    h('div', { class: 'wave' }, icon('drama')),
    h('h1', { class: 'center' }, `أهلاً ${state.me.name}`),
    h('p', { class: 'muted center' }, 'انتظر المضيف يوزّع الأدوار…'),
    h('div', { class: 'card' }, h('h2', {}, 'الأدوار'), mfLineup(state.lineup), mfRulesList(state.lineup)),
  );
}

/** The story of the night or the vote, on every phone with the TV (without its sounds). */
const storyNow = () => (state.story && ['morning', 'verdict'].includes(state.phase) ? mfStory(state.story) : null);
const told = () => !state.story || state.story.told;

function renderWatching() {
  return h('main', { class: 'stage narrow mf-stage' },
    h('div', { class: 'mf-big' }, icon('eye')),
    h('h1', { class: 'center' }, 'دخلت واللعبة شغّالة'),
    h('p', { class: 'center muted' }, 'تابع من الشاشة، وتلعب معهم من اللعبة الجاية.'),
    storyNow(),
  );
}

/** The dead watch with every role showing, and keep quiet. */
function renderGhost() {
  return h('main', { class: 'stage narrow mf-stage' },
    h('div', { class: 'mf-big' }, icon('ghost')),
    h('h1', { class: 'center' }, 'طلعت من اللعبة'),
    h('p', { class: 'center muted' }, 'تقدر تشوف أدوار الكل… بس لا تتكلم ولا تلمّح!'),
    storyNow(),
    state.announcement && ['morning', 'verdict'].includes(state.phase) ? mfAnnouncement(state.announcement, { tally: !state.story }) : null,
    state.phase === 'discuss' || state.phase === 'night' ? timerEl(state.endsAt) : null,
    mfPlayers(state.players, { meId: state.me.id }),
  );
}

function renderRoles() {
  const { me } = state;
  return h('main', { class: 'stage narrow mf-stage' },
    roleCard(),
    me.team?.length ? h('p', { class: 'center' }, icon('swords'), ` ربعك في المافيا: ${me.team.map((t) => t.name).join(' و')}`) : null,
    h('p', { class: 'hint center' }, 'شوف دورك وخلّه سر. المضيف بيبدأ الليل.'),
  );
}

const NIGHT_PROMPTS = {
  mafia: 'اختاروا ضحية الليلة',
  doctor: 'مين تنقذ الليلة؟',
  police: 'مين تسأل عنه؟',
  sniper: 'تطلق على أحد؟',
  mayor: 'مين تشك فيه؟',
  jester: 'مين تشك فيه؟',
  citizen: 'مين تشك فيه؟',
};

async function pick(target) {
  const res = await emit(socket, 'player:mf-pick', { target });
  if (!res.ok) toast(res.error);
}

async function confirmPick() {
  const res = await emit(socket, 'player:mf-confirm', {});
  if (!res.ok) toast(res.error);
}

/** Two or more mafia: where each points, and «🔪 اعتمد» once they all point at the same person. */
function mafiaPlanBox() {
  const { me } = state;
  const { plan } = me;
  const mates = me.team.filter((t) => t.alive);
  let main;
  if (plan.locked) {
    main = [h('div', { class: 'verdict good' }, icon('circle-check'), ` اتفقتوا: الضحية ${plan.agreed.name}`), h('p', { class: 'hint' }, 'تقدرون تغيّرون لين يخلص الليل')];
  } else if (plan.agreed && me.pick === plan.agreed.id) {
    main = plan.confirmed
      ? h('p', { class: 'mf-plan-wait' }, icon('circle-check'), ' اعتمدت، ننتظر ربعك')
      : h('button', { type: 'button', class: 'btn big danger mf-confirm', onclick: confirmPick }, icon('swords'), ` اعتمد ${plan.agreed.name}`);
  } else {
    main = h('p', { class: 'mf-plan-wait' }, me.pick ? [icon('pointer'), ' ربعك يشوفون إشارتك. أشّروا كلكم على نفس الشخص'] : [icon('pointer'), ' أشّر على اللي تبيه، وربعك يشوفون إشارتك']);
  }
  return h('div', { class: 'card mf-plan' }, main,
    h('ul', { class: 'mf-plan-team' }, mates.map((t) => h('li', {},
      h('b', {}, t.name), t.pick ? [` `, icon('pointer'), ` ${t.pick.name}`] : ' … لسا ما أشّر',
      plan.agreed && t.pick?.id === plan.agreed.id ? (t.confirmed ? [' ', icon('circle-check')] : [' ', icon('hourglass')]) : ''))));
}

function renderNight() {
  const { me } = state;
  const role = me.role === 'sniper' && me.bulletUsed ? 'citizen' : me.role;
  const others = state.players.filter((p) => p.alive && (p.id !== me.id || role === 'doctor'));
  const choices = others.filter((p) => !(role === 'mafia' && me.team.some((t) => t.id === p.id)));
  const police = me.role === 'police' && me.picked;
  const lastCheck = police ? me.checks.at(-1) : null;
  const team = role === 'mafia' && me.plan?.team;
  /** Who points at this name: me, and my teammates. */
  const pointers = (p) => (team ? [me.pick === p.id ? 'أنا' : null, ...me.team.filter((t) => t.alive && t.pick?.id === p.id).map((t) => t.name)].filter(Boolean) : []);
  return h('main', { class: 'stage narrow mf-stage mf-night' },
    h('h1', { class: 'center' }, icon('moon'), ` الليلة ${state.dayNumber}`),
    h('p', { class: 'center mf-prompt' }, team ? [icon('swords'), ' أشّروا على الضحية، ولما تتفقون اعتمدوا'] : NIGHT_PROMPTS[role]),
    team ? mafiaPlanBox() : null,
    lastCheck ? h('div', { class: `verdict ${lastCheck.mafia ? 'bad' : 'good'}` },
      `${lastCheck.name} ${lastCheck.mafia ? 'مافيا!' : 'مو مافيا'}`) : null,
    police ? null : h('div', { class: 'os-vote-grid' }, choices.map((p) => {
      const marks = pointers(p);
      return h('button', {
        type: 'button',
        class: `btn big os-vote-btn${me.pick === p.id ? ' picked' : ''}${marks.some((m) => m !== 'أنا') ? ' pointed' : ''}`,
        disabled: role === 'doctor' && p.id === me.lastSaved,
        onclick: () => pick(p.id),
      }, h('span', {}, p.id === me.id ? 'نفسي' : p.name, !team && me.pick === p.id ? [' ', icon('circle-check')] : ''),
      marks.length ? h('small', { class: 'mf-pointers' }, icon('pointer'), ` ${marks.join(' · ')}`) : null);
    })),
    role === 'sniper' ? h('button', {
      type: 'button',
      class: `btn big ghost${me.picked && me.pick === null ? ' picked' : ''}`,
      onclick: () => pick(null),
    }, me.picked && me.pick === null ? [icon('hand'), ' خلّيت الطلقة ', icon('circle-check')] : [icon('hand'), ' خلّ الطلقة لليلة ثانية']) : null,
    timerEl(state.endsAt),
    h('p', { class: 'hint center' }, team
      ? (me.plan.locked ? 'ننتظر الباقين…' : 'اتفقوا واعتمدوا قبل لا يخلص الوقت، وإلا محد يموت')
      : (me.picked ? 'اخترت. ننتظر الباقين…' : 'اختر قبل لا يخلص الوقت')),
    roleCard(),
  );
}

function renderMorning() {
  return h('main', { class: 'stage narrow mf-stage' },
    h('h1', { class: 'center mf-story-title' }, told() ? [icon('sun'), ' صباح الخير'] : [icon('moon'), ` الليلة ${state.dayNumber}`]),
    storyNow(),
    told() ? mfAnnouncement(state.announcement) : null,
    told() && state.winner ? h('div', { class: 'verdict good' }, mfWinnerText(state.winner)) : null,
    h('p', { class: 'hint center' }, told() ? 'المضيف بيبدأ النقاش.' : 'اسمعوا الراوي…'),
    roleCard(),
  );
}

function renderDiscuss() {
  return h('main', { class: 'stage narrow mf-stage' },
    h('h1', { class: 'center' }, icon('megaphone'), ' تناقشوا'),
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
    h('h1', { class: 'center' }, icon('vote'), ' مين يطلع؟'),
    me.role === 'mayor' ? h('p', { class: 'center mf-mayor' }, icon('award'), ' صوتك يحسب بصوتين') : null,
    h('div', { class: 'os-vote-grid' }, choices.map((p) => h('button', {
      type: 'button',
      class: `btn big os-vote-btn${me.vote === p.id ? ' picked' : ''}`,
      onclick: () => vote(p.id),
    }, p.name, me.vote === p.id ? [' ', icon('circle-check')] : ''))),
    h('button', { type: 'button', class: `btn big ghost${me.vote === 'none' ? ' picked' : ''}`, onclick: () => vote('none') },
      me.vote === 'none' ? [icon('ban'), ' ما نطلّع أحد ', icon('circle-check')] : [icon('ban'), ' ما نطلّع أحد']),
    h('p', { class: 'hint center' }, `صوّت ${state.voted.length} من ${choices.length + 1} · تقدر تغيّر لين يقفل التصويت`),
    roleCard(),
  );
}

function renderVerdict() {
  return h('main', { class: 'stage narrow mf-stage' },
    h('h1', { class: 'center mf-story-title' }, icon('vote'), ' نتيجة التصويت'),
    storyNow(),
    told() ? mfAnnouncement(state.announcement, { tally: !state.story }) : null,
    told() && state.winner ? h('div', { class: 'verdict good' }, mfWinnerText(state.winner)) : null,
    roleCard(),
  );
}

function renderFinal() {
  const { me, winner } = state;
  const mine = mfWon(me.role, winner);
  return h('main', { class: 'stage narrow final mf-stage' },
    mine ? confetti() : null,
    h('div', { class: 'trophy' }, mine ? icon('trophy') : icon('drama')),
    h('h1', { class: 'center' }, winner ? mfWinnerText(winner) : 'انتهت اللعبة'),
    me.role ? h('p', { class: 'center' }, `كنت ${mfRole(me.role)}${mine ? (me.role === 'jester' ? '، وضحكت عليهم!' : '، وفريقك فاز!') : ''}`) : null,
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
  // You're out (killed at night or voted out) as the story ends.
  if (prev.me.alive && !next.me.alive && next.phase !== 'final') {
    sfx.play('lose');
    return;
  }
  if (prev.phase === next.phase) return;
  if (next.phase === 'night' && next.me.alive) sfx.play('night');
}

const won = (s) => mfWon(s.me.role, s.winner);

PLAY_GAMES.mafia = { render, sounds, won };
})();
