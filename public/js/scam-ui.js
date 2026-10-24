/* global h, icon, wheelEl, spinRemaining */
'use strict';

// Pieces of «مين النصاب؟» shared by the host and player pages.

/** «+2» / «−2», kept the right way round in Arabic text. */
const scPoints = (n) => h('bdi', { dir: 'ltr', class: n > 0 ? 'good' : n < 0 ? 'bad' : null }, n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

function scRulesList(s, rules) {
  const p = rules.points;
  return h('ul', { class: 'rules-list' },
    h('li', {}, 'كل جولة تطلع كلمة سرية في جوال الكل، إلا واحد: ', h('b', {}, 'النصاب'), '. ما يعرف الكلمة، وعنده مهمة سرية ينفّذها وسط الكلام بدون ما تنتبهون، مثل «قل كلمة نقانيش ثلاث مرات».'),
    h('li', {}, 'بالدور، كل واحد يقول كلمة وحدة تلمّح للكلمة: لا يقول الكلمة نفسها، ولا يكرر تلميح، ولا يشرح على المكشوف.'),
    h('li', {}, s.discussSeconds ? `بعدها ${s.discussSeconds / 60} دقايق نقاش: كل واحد يسأل اللي يشك فيه أو يعطي تلميح زيادة.` : 'بعدها نقاش: كل واحد يسأل اللي يشك فيه أو يعطي تلميح زيادة.'),
    h('li', {}, `تصوّتون من جوالاتكم على سؤالين: مين النصاب؟ ووش كانت مهمته؟ (من ${rules.missionChoices} خيارات، أو «ما لاحظت»).`),
    h('li', {}, 'وفي الآخر النصاب يخمّن الكلمة من 6 خيارات.'),
    h('li', {}, 'النقاط: كل واحد صوّت صح ', scPoints(p.vote), '. والنصاب: لو نجا ', scPoints(p.escaped), ' ولو انقفط ', scPoints(p.caught),
      '، ولو نفّذ المهمة بدون ما تنكشف ', scPoints(p.done), ' ولو انكشفت ', scPoints(p.exposed), '، ولو خمّن الكلمة ', scPoints(p.guessed), '.'),
    h('li', {}, `بعد ${s.rounds} جولات، صاحب أعلى نقاط يفوز… وصاحب أقل نقاط يدوّر دولاب العقاب!`),
  );
}

function scRoundTitle(s) {
  return `الجولة ${s.roundNumber} من ${s.totalRounds}`;
}

function scCategory(round) {
  return h('div', { class: 'os-category' }, h('b', {}, round.category.name));
}

/** Votes per player, most first, the impostor marked. */
function scTally(round) {
  const max = Math.max(1, ...round.tally.map((t) => t.votes));
  return h('ol', { class: 'os-tally' }, round.tally.map((t) => {
    const it = t.id === round.impostor.id;
    return h('li', { class: it ? 'outsider' : null },
      h('span', { class: 'os-tally-name' }, t.name, it ? [' ', icon('fingerprint')] : ''),
      h('span', { class: 'os-tally-bar' }, h('span', { style: `width:${(t.votes / max) * 100}%` })),
      h('b', {}, t.votes));
  }));
}

/** «النصاب كان: فلان»: caught or not. */
function scImpostorBanner(round) {
  return h('div', { class: `os-outsider ${round.caught ? 'caught' : 'escaped'}` },
    h('small', {}, 'النصاب كان'),
    h('b', {}, `${round.impostor.name} `, icon('fingerprint')),
    h('span', {}, round.caught ? 'انقفط!' : 'نجا من التصويت!'),
  );
}

/** The mission, and whether the group spotted it. */
function scMission(round) {
  const spotted = round.answered ? `${round.named} من ${round.answered} عرفوها` : 'محد جاوب';
  let verdict = `ما انكشفت (${spotted})`;
  if (round.exposed) verdict = `انكشفت! ${spotted}`;
  else if (round.done === true) verdict = 'ما انكشفت، ونفّذها!';
  else if (round.done === false) verdict = 'ما انكشفت، بس ما نفّذها';
  return h('div', { class: `sc-mission-reveal ${round.exposed ? 'exposed' : round.done ? 'done' : ''}` },
    h('small', {}, 'مهمته السرية كانت'),
    h('b', {}, round.mission.text),
    h('span', {}, verdict),
  );
}

const LINE_TEXT = {
  caught: 'انقفط بالتصويت',
  escaped: 'نجا من التصويت',
  exposed: 'انكشفت مهمته',
  done: 'نفّذ مهمته',
  notDone: 'ما نفّذ مهمته',
  guessed: 'خمّن الكلمة',
  missed: 'ما خمّن الكلمة',
};

/** The impostor's points this round, line by line. */
function scLines(round) {
  const total = round.lines.reduce((n, l) => n + l.points, 0);
  return h('div', { class: 'sc-lines' },
    h('ul', {}, round.lines.map((l) => h('li', {}, h('span', {}, LINE_TEXT[l.key]), scPoints(l.points)))),
    h('p', {}, `${round.impostor.name} (النصاب): `, scPoints(total)),
  );
}

/** Who got +1 for voting right. */
function scVoters(round) {
  const right = round.order.filter((p) => p.id !== round.impostor.id && round.gains[p.id] > 0);
  if (!right.length) return h('p', { class: 'hint center' }, 'محد صوّت صح هالجولة');
  return h('ul', { class: 'chips os-gains' }, right.map((p) => h('li', { class: 'chip' }, p.name, ' ', scPoints(round.gains[p.id]))));
}

/** The punishment wheel, turning on every screen at once, then the punishment in full. */
function scWheel(p) {
  const wheel = wheelEl({ wheel: p.wheel, category: { id: p.punishment.id }, spinId: p.spinId }, { hubIcon: 'gavel' });
  const card = h('div', { class: 'sc-punishment' },
    h('small', {}, `عقاب ${p.loser.name}`),
    h('b', {}, p.punishment.text));
  const left = spinRemaining(p.spinId);
  if (left > 0) setTimeout(() => card.classList.add('shown'), left);
  else card.classList.add('shown', 'calm');
  return h('div', { class: 'sc-wheel' }, wheel, card);
}
