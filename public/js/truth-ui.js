/* global h, icon */
'use strict';

// Pieces of «صح ولا خطأ» shared by the host and player pages.

function tfRulesList(s, rules) {
  const { right, speed } = rules.points;
  return h('ul', { class: 'rules-list' },
    h('li', {}, 'تطلع عبارة على الشاشة، وعندكم ', h('b', {}, `${s.seconds} ثواني`), ' تجاوبون من جوالاتكم: «صح» ولا «خطأ».'),
    h('li', {}, 'أول ضغطة هي جوابك، وما تقدر تغيّرها.'),
    h('li', {}, `الجواب الصح ياخذ ${right} نقطة، وفوقها لين ${speed} على السرعة: كل ما جاوبت أبكر زادت نقاطك.`),
    h('li', {}, 'الجواب الغلط واللي ما جاوب ما ياخذون شي.'),
    h('li', {}, 'بعد كل عبارة ينكشف الجواب مع معلومة صغيرة تشرحه.'),
    h('li', {}, `بعد ${s.source === 'custom' ? 'آخر عبارة' : `${s.rounds} عبارة`}، صاحب أعلى نقاط يفوز.`),
  );
}

function tfRoundTitle(round) {
  return `العبارة ${round.number} من ${round.total}`;
}

/** «صح» or «خطأ», big, with the line on why. */
function tfAnswer(result) {
  return h('div', { class: `tf-answer ${result.answer ? 'yes' : 'no'}` },
    h('b', {}, icon(result.answer ? 'circle-check-big' : 'circle-x'), result.answer ? ' صح' : ' خطأ'),
    result.why ? h('p', { class: 'tf-why' }, result.why) : null,
  );
}

/** How the room split: said «صح», said «خطأ», didn't answer. */
function tfSplit(result) {
  const box = (cls, label, n, right) => h('div', { class: `tf-split-box ${cls}${right ? ' right' : ''}` }, h('b', {}, n), h('small', {}, label));
  return h('div', { class: 'tf-split' },
    box('yes', 'قالوا صح', result.yes, result.answer === true),
    box('no', 'قالوا خطأ', result.no, result.answer === false),
    result.none ? box('none', 'ما جاوبوا', result.none, false) : null,
  );
}

/** The fastest right answers of this statement. */
function tfBest(result) {
  if (!result.best.length) return h('p', { class: 'hint center' }, 'محد جابها هالمرة');
  return h('ol', { class: 'chips tf-best' }, result.best.map((r, i) => h('li', { class: 'chip' },
    i === 0 ? [icon('zap'), ' '] : '', r.name, h('b', {}, h('bdi', { dir: 'ltr' }, ` +${r.points}`)))));
}
