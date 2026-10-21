/* global $, h, toast, storage, setTheme, contribForm, contribSummary, icon, gameLogo */
'use strict';

// «أضف أسئلة»: pick a game, fill in questions one by one, then send them all
// for the owner's approval.
(() => {
const app = $('#app');
const NAME_KEY = 'contrib:name';
let games = [];
let game = null; // the picked game
let form = null;
const queue = new Map(); // game id → [entries]

async function load() {
  try {
    const res = await fetch('/api/contrib/spec');
    games = (await res.json()).games;
  } catch {
    app.querySelector('.loading').textContent = 'ما قدرنا نحمّل الصفحة، جرّب مرة ثانية';
    return;
  }
  const wanted = new URLSearchParams(location.search).get('game');
  pick(games.find((g) => g.id === wanted) ?? games[0]);
}

function pick(next) {
  game = next;
  setTheme(game.id);
  history.replaceState(null, '', `?game=${game.id}`);
  render();
}

function entries() {
  if (!queue.has(game.id)) queue.set(game.id, []);
  return queue.get(game.id);
}

function addEntry(e) {
  e.preventDefault();
  const values = form.read();
  const empty = game.fields.filter((f) => f.type !== 'select' && values[f.key] === '');
  if (empty.length) {
    toast(`اكتب ${empty[0].label}`);
    return;
  }
  entries().push(values);
  form.clear(game.fields.filter((f) => f.type !== 'select' && !f.key.startsWith('new')).map((f) => f.key));
  renderList();
}

async function send() {
  const items = entries();
  if (!items.length) return;
  const button = $('#send');
  button.disabled = true;
  const submitter = $('#submitter').value.trim();
  storage(NAME_KEY, submitter);
  try {
    const res = await fetch('/api/contrib', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ game: game.id, items, submitter }),
    });
    const out = await res.json();
    if (!res.ok) {
      toast(out.error);
      return;
    }
    const failed = new Set(out.errors.map((x) => x.index));
    const kept = items.filter((_, i) => failed.has(i));
    queue.set(game.id, kept);
    renderList(out.errors.map((x) => `«${contribSummary(game.fields, items[x.index])}»: ${x.error}`));
    if (out.added) toast(`وصلت ${out.added} ${out.added === 1 ? 'سؤال' : 'أسئلة'} تنتظر الموافقة`, 'ok');
  } catch {
    toast('ما قدرنا نرسل، تأكد من النت وجرّب مرة ثانية');
  } finally {
    button.disabled = false;
  }
}

function renderList(problems = []) {
  const items = entries();
  $('#queue').replaceChildren(
    ...problems.map((p) => h('p', { class: 'banner bad' }, p)),
    items.length
      ? h('ol', { class: 'contrib-queue' }, items.map((item, i) => h('li', {},
        h('span', {}, contribSummary(game.fields, item)),
        h('button', { type: 'button', class: 'x', 'aria-label': 'شيله', onclick: () => { items.splice(i, 1); renderList(); } }, '×'))))
      : h('p', { class: 'hint center' }, 'لسا ما أضفت شي. اكتب فوق واضغط «أضف للقائمة».'),
  );
  $('#send').disabled = !items.length;
  $('#send').textContent = items.length ? `أرسل ${items.length === 1 ? 'السؤال' : `${items.length} أسئلة`}` : 'أرسل';
}

function render() {
  form = contribForm(game.fields);
  app.replaceChildren(
    h('nav', { class: 'landing-nav' }, h('a', { href: '/' }, '→ كل الألعاب'), h('a', { href: `/${game.id}` }, `صفحة ${game.name}`)),
    h('header', { class: 'contrib-hero' },
      h('div', { class: 'logo' }, icon('pen-line')),
      h('h1', {}, 'أضف أسئلة'),
      h('p', { class: 'muted' }, 'اكتب أسئلتك، وبعد ما يوافق عليها صاحب الموقع تطلع للكل في كل الغرف.')),
    h('div', { class: 'game-picker contrib-games', role: 'radiogroup', 'aria-label': 'اللعبة' }, games.map((g) => h('button', {
      type: 'button',
      class: `game-option${g.id === game.id ? ' picked' : ''}`,
      role: 'radio',
      'aria-checked': String(g.id === game.id),
      onclick: () => pick(g),
    }, gameLogo(g.id), h('b', {}, g.name)))),
    h('form', { class: 'card contrib-card', onsubmit: addEntry },
      h('h2', {}, `سؤال جديد لـ«${game.name}»`),
      form.el,
      h('button', { class: 'btn big', type: 'submit' }, icon('plus'), ' أضف للقائمة'),
    ),
    h('section', { class: 'card contrib-card' },
      h('h2', {}, 'القائمة'),
      h('div', { id: 'queue' }),
      h('label', { class: 'field' }, h('span', {}, 'اسمك (اختياري)'),
        h('input', { id: 'submitter', maxlength: 30, value: storage(NAME_KEY) ?? '', placeholder: 'عشان نعرف مين أرسلها' })),
      h('button', { id: 'send', class: 'btn primary big', type: 'button', onclick: send }, icon('send'), ' أرسل'),
    ),
  );
  renderList();
}

load();
})();
