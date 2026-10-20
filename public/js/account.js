/* global $, h, toast */
'use strict';

// «حسابي»: log in, see your question banks, paste a new one, share one with
// everyone, connect Claude or ChatGPT so they can add banks for you, and keep
// the groups you play with («👥 شللي»).
(() => {
const app = $('#app');
const params = new URLSearchParams(location.search);
// Where to go after logging in (the AI's consent page, or the host page); same-site paths only.
const next = /^\/(?!\/)/.test(params.get('next') ?? '') ? params.get('next') : null;
let me = null;
let persistent = true;
let data = null; // { banks, games, limits }
let groupsData = null; // { groups, games, limits }
const open = new Set(); // banks shown in full

const NEEDS = {
  seen: 'يحتاج سؤالين على الأقل من كل قيمة (200 و400 و600)',
  letters: 'يحتاج سؤال واحد على الأقل',
  herd: 'يحتاج 3 أسئلة على الأقل',
  outsider: 'يحتاج 4 كلمات على الأقل',
  time: 'يحتاج 15 بطاقة على الأقل',
};

async function api(path, body) {
  const res = await fetch(`/api/account${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? 'صار خطأ');
  return out;
}

async function copy(text, done = 'انتسخ ✅') {
  try {
    await navigator.clipboard.writeText(text);
    toast(done, 'ok');
  } catch {
    prompt('انسخ من هنا:', text);
  }
}

function nav() {
  return h('nav', { class: 'landing-nav' }, h('a', { href: '/' }, '→ الصفحة الرئيسية'), h('a', { href: '/add' }, '✍️ أضف أسئلة للكل'));
}

/* ---------- Log in / sign up ---------- */

function renderAuth(mode = 'login', error = '') {
  const username = h('input', { id: 'username', autocomplete: 'username', maxlength: 20, placeholder: 'مثل: abu_fahad' });
  const password = h('input', { id: 'password', type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', placeholder: '8 أحرف على الأقل' });
  app.replaceChildren(nav(), h('form', {
    class: 'card join-form account-auth',
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api(mode === 'login' ? '/login' : '/signup', { username: username.value, password: password.value });
        if (next) {
          location.href = next;
          return;
        }
        await start();
      } catch (err) {
        renderAuth(mode, err.message);
      }
    },
  },
    h('h1', { class: 'center' }, mode === 'login' ? '👤 تسجيل الدخول' : '👤 حساب جديد'),
    h('div', { class: 'review-tabs' },
      h('button', { type: 'button', class: `btn small${mode === 'login' ? ' primary' : ''}`, onclick: () => renderAuth('login') }, 'دخول'),
      h('button', { type: 'button', class: `btn small${mode === 'signup' ? ' primary' : ''}`, onclick: () => renderAuth('signup') }, 'حساب جديد')),
    error ? h('p', { class: 'banner bad' }, error) : null,
    h('label', { class: 'field' }, h('span', {}, 'اسم المستخدم'), username),
    h('label', { class: 'field' }, h('span', {}, 'كلمة السر'), password),
    h('button', { class: 'btn primary big', type: 'submit' }, mode === 'login' ? 'ادخل' : 'سوّ الحساب'),
    h('p', { class: 'hint center' }, 'بحسابك تحفظ بنوك أسئلة خاصة فيك، وتربط Claude أو ChatGPT عشان يضيفون لك أسئلة.'),
  ));
  username.focus();
}

/* ---------- The account ---------- */

function connectSection() {
  const url = `${location.origin}/mcp`;
  const example = 'سوّ لي بنك «سين جيم» عن الدوري السعودي، 4 أسئلة لكل قيمة، وأضفه لحسابي في ألعاب الشلة.';
  return h('section', { class: 'card contrib-card' },
    h('h2', {}, '🤖 اربط الذكاء الاصطناعي'),
    h('p', { class: 'muted' }, 'اربط Claude أو ChatGPT بحسابك، واطلب منه بنك أسئلة، ويضيفه لك على طول.'),
    h('div', { class: 'mcp-url' }, h('code', {}, url), h('button', { type: 'button', class: 'btn small', onclick: () => copy(url) }, 'نسخ')),
    h('details', { class: 'rules' }, h('summary', {}, 'في Claude'),
      h('ol', { class: 'rules-list' },
        h('li', {}, 'افتح الإعدادات ← Connectors ← Add custom connector.'),
        h('li', {}, 'الصق الرابط فوق، وسمّه «ألعاب الشلة».'),
        h('li', {}, 'اضغط Connect، وبتطلع لك صفحة موقعنا: ادخل بحسابك واضغط «اسمح».'))),
    h('details', { class: 'rules' }, h('summary', {}, 'في ChatGPT'),
      h('ol', { class: 'rules-list' },
        h('li', {}, 'افتح الإعدادات ← Apps & Connectors، وشغّل Developer mode من الإعدادات المتقدمة.'),
        h('li', {}, 'اضغط Create، والصق الرابط فوق، واختر OAuth.'),
        h('li', {}, 'بتطلع لك صفحة موقعنا: ادخل بحسابك واضغط «اسمح».'),
        h('li', {}, 'مهم: في كل محادثة جديدة اضغط «+» ← «المزيد» وفعّل «ألعاب الشلة» قبل ما تطلب منه، وإلا بيقول لك إن الأدوات مو متاحة.'))),
    h('p', { class: 'hint' }, 'الميزة هذي تعتمد على اشتراكك في Claude أو ChatGPT. لو قال إنه ما يقدر يحفظ: شيّك إن التطبيق موجود في «🔌 الأجهزة المربوطة» تحت (لو مو موجود اربطه من جديد)، أو انسخ اللي كتبه والصقه في «بنك جديد بالصق»، والأرقام والعناوين تنشال لحالها.'),
    h('div', { class: 'mcp-url' }, h('span', {}, `مثال: «${example}»`), h('button', { type: 'button', class: 'btn small', onclick: () => copy(example) }, 'نسخ')),
  );
}

async function share(bank) {
  let subcategory = null;
  if (bank.game === 'herd') {
    const spec = await (await fetch('/api/contrib/spec')).json();
    const options = spec.games.find((g) => g.id === 'herd').fields.find((f) => f.key === 'subcategory').options;
    const choice = prompt(`أي قسم تروح له الأسئلة؟ اكتب رقمه:\n${options.map((o, i) => `${i + 1}. ${o.label}`).join('\n')}`);
    subcategory = options[Number(choice) - 1]?.value;
    if (!subcategory) return;
  }
  try {
    const out = await api(`/banks/${bank.id}/share`, { subcategory });
    toast(`وصلت ${out.added} لصفحة المراجعة${out.errors.length ? ` (${out.errors.length} موجودة أو ناقصة)` : ''}${out.skipped ? ` · ${out.skipped} بصور ما تنرسل` : ''}`, 'ok');
  } catch (err) {
    toast(err.message);
  }
}

function itemText(game, item) {
  switch (game) {
    case 'seen': return `${item.value} · ${item.q} ← ${item.a}`;
    case 'letters': return `${item.letter} · ${item.q} ← ${item.a}`;
    case 'herd': return `${item.mode === 'same' ? '🐄' : '🦄'} ${item.q}`;
    case 'outsider': return item.word;
    default: return item.type === 'image' ? `🖼️ ← ${item.answer}` : `${item.face} ← ${item.answer}`;
  }
}

async function bankDetails(bank, box) {
  const { bank: full } = await api(`/banks/${bank.id}`);
  const text = h('textarea', { rows: 3, placeholder: data.games.find((g) => g.id === bank.game).paste });
  box.replaceChildren(
    h('ol', { class: 'contrib-queue bank-items' }, full.items.map((item) => h('li', {},
      item.img ? h('img', { class: 'bank-thumb', src: item.img, alt: '', loading: 'lazy' }) : null,
      h('span', {}, itemText(bank.game, item)),
      h('button', {
        type: 'button',
        class: 'x',
        'aria-label': 'احذف',
        onclick: async () => {
          await api(`/banks/${bank.id}/remove`, { ids: [item.id] });
          await refresh();
        },
      }, '×')))),
    h('label', { class: 'field' }, h('span', {}, 'أضف بالصق'), text),
    h('button', {
      type: 'button',
      class: 'btn small',
      onclick: async () => {
        try {
          const out = await api(`/banks/${bank.id}/items`, { text: text.value });
          toast(`انضاف ${out.added}${out.errors.length ? ` · ${out.errors.length} ما انضاف` : ''}`, 'ok');
          await refresh();
        } catch (err) {
          toast(err.message);
        }
      },
    }, '➕ أضف'),
  );
}

function bankRow(bank) {
  const game = data.games.find((g) => g.id === bank.game);
  const details = h('div', { class: 'bank-details' });
  if (open.has(bank.id)) bankDetails(bank, details);
  return h('li', { class: 'card bank-row', 'data-bank': bank.id },
    h('div', { class: 'bank-head' },
      h('b', {}, `${bank.emoji} ${bank.name}`),
      h('span', { class: 'muted' }, ` · ${bank.count} ${game.unit}${bank.images ? ` · ${bank.images} صورة` : ''}`),
      h('span', { class: `bank-state ${bank.playable ? 'good' : ''}` }, bank.playable ? '✅ جاهز للعب' : `⏳ ${NEEDS[bank.game]}`)),
    h('div', { class: 'review-actions' },
      h('button', { type: 'button', class: 'btn small', onclick: () => { if (open.has(bank.id)) open.delete(bank.id); else open.add(bank.id); render(); } },
        open.has(bank.id) ? 'إخفاء' : 'عرض'),
      bank.game !== 'time' ? h('button', { type: 'button', class: 'btn small', onclick: () => share(bank) }, '📤 أرسله للكل') : null,
      h('button', {
        type: 'button',
        class: 'btn small danger',
        onclick: async () => {
          if (!confirm(`تحذف «${bank.name}»؟`)) return;
          await api(`/banks/${bank.id}/delete`, {});
          await refresh();
        },
      }, '🗑️')),
    details,
  );
}

function newBankForm() {
  const game = h('select', { id: 'new-game', onchange: () => { text.placeholder = data.games.find((g) => g.id === game.value).paste; } },
    data.games.map((g) => h('option', { value: g.id }, `${g.emoji} ${g.name}`)));
  const name = h('input', { id: 'new-name', maxlength: 30, placeholder: 'مثل: سوالف الشلة' });
  const emoji = h('input', { id: 'new-emoji', maxlength: 8, placeholder: '✍️' });
  const text = h('textarea', { id: 'new-text', rows: 6, placeholder: data.games[0].paste });
  return h('section', { class: 'card contrib-card' },
    h('h2', {}, '➕ بنك جديد بالصق'),
    h('p', { class: 'hint' }, 'اضغط «انسخ التعليمات» والصقها في أي شات ذكاء اصطناعي، وبعدين الصق اللي يكتبه هنا.'),
    h('div', { class: 'contrib-fields' },
      h('label', { class: 'field' }, h('span', {}, 'اللعبة'), game),
      h('label', { class: 'field' }, h('span', {}, 'اسم البنك'), name),
      h('label', { class: 'field' }, h('span', {}, 'إيموجي'), emoji),
      h('label', { class: 'field wide' }, h('span', {}, 'الأسئلة'), text)),
    h('div', { class: 'review-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => copy(data.games.find((g) => g.id === game.value).prompt, 'انتسخت التعليمات ✅') }, '📋 انسخ التعليمات'),
      h('button', {
        type: 'button',
        class: 'btn primary',
        onclick: async () => {
          try {
            const out = await api('/banks', { game: game.value, name: name.value, emoji: emoji.value, text: text.value });
            toast(`انحفظ «${out.bank.name}»: ${out.added}${out.errors.length ? ` · ${out.errors.length} ما انضاف` : ''}`, 'ok');
            open.add(out.bank.id);
            await refresh();
          } catch (err) {
            toast(err.message);
          }
        },
      }, '💾 احفظ البنك')),
  );
}

async function connectionsSection() {
  const { connections } = await api('/connections');
  return h('section', { class: 'card contrib-card' },
    h('h2', {}, '🔌 الأجهزة المربوطة'),
    connections.length
      ? h('ul', { class: 'contrib-queue' }, connections.map((c) => h('li', {},
        h('span', {}, `${c.name} · من ${new Date(c.since).toLocaleDateString('ar-SA-u-nu-latn')}`),
        h('button', {
          type: 'button',
          class: 'btn small',
          onclick: async () => {
            await api(`/connections/${encodeURIComponent(c.clientId)}/revoke`, {});
            toast('انلغى الربط', 'ok');
            await refresh();
          },
        }, 'إلغاء الربط'))))
      : h('p', { class: 'hint' }, 'ما فيه شي مربوط.'),
  );
}

function passwordSection() {
  const current = h('input', { type: 'password', autocomplete: 'current-password' });
  const fresh = h('input', { type: 'password', autocomplete: 'new-password' });
  return h('details', { class: 'card contrib-card' }, h('summary', {}, '🔑 غيّر كلمة السر'),
    h('label', { class: 'field' }, h('span', {}, 'الحالية'), current),
    h('label', { class: 'field' }, h('span', {}, 'الجديدة'), fresh),
    h('button', {
      type: 'button',
      class: 'btn small',
      onclick: async () => {
        try {
          await api('/password', { current: current.value, next: fresh.value });
          toast('تغيّرت ✅', 'ok');
        } catch (err) {
          toast(err.message);
        }
      },
    }, 'غيّر'));
}

/* ---------- «👥 شللي» ---------- */

const questionsText = (n) => (n === 1 ? 'سؤال واحد' : n === 2 ? 'سؤالين' : n <= 10 ? `${n} أسئلة` : `${n} سؤال`);

function ago(iso) {
  const days = Math.floor((Date.now() - new Date(iso)) / 86400000);
  if (days <= 0) return 'اليوم';
  if (days === 1) return 'أمس';
  return days <= 10 ? `قبل ${days} أيام` : `قبل ${days} يوم`;
}

function groupRow(group) {
  const games = Object.entries(group.games).map(([id, n]) => {
    const game = groupsData.games.find((g) => g.id === id);
    return game ? h('span', { class: 'category-chip' }, `${game.emoji} ${game.name} · ${n}`) : null;
  });
  const call = async (path, body, confirmText) => {
    if (confirmText && !confirm(confirmText)) return;
    try {
      await api(path, body);
      await refresh();
    } catch (err) {
      toast(err.message);
    }
  };
  return h('li', { class: 'card group-card', 'data-group': group.id },
    h('div', { class: 'bank-head' },
      h('b', {}, `👥 ${group.name}`),
      h('span', { class: 'muted' }, ` · ${group.total ? `لعبتوا ${questionsText(group.total)}` : 'لسا ما لعبتوا معها'}${group.playedAt ? ` · آخر مرة ${ago(group.playedAt)}` : ''}`)),
    group.total ? h('div', { class: 'group-games' }, games) : null,
    h('div', { class: 'group-actions' },
      h('button', {
        type: 'button',
        class: 'btn small',
        onclick: () => {
          const name = prompt('الاسم الجديد؟', group.name);
          if (name?.trim() && name.trim() !== group.name) call(`/groups/${group.id}/rename`, { name: name.trim() });
        },
      }, '✏️ الاسم'),
      group.total ? h('button', {
        type: 'button',
        class: 'btn small',
        onclick: () => call(`/groups/${group.id}/reset`, {}, `تصفّر أسئلة «${group.name}»؟ بعدها ممكن تنعاد عليهم كل الأسئلة.`),
      }, '🔄 صفّر أسئلتها') : null,
      h('button', {
        type: 'button',
        class: 'btn small danger',
        onclick: () => call(`/groups/${group.id}/delete`, {}, `تحذف شلة «${group.name}»؟`),
      }, '🗑️')),
  );
}

function groupsSection() {
  const { groups, limits } = groupsData;
  const name = h('input', { id: 'new-group', maxlength: limits.name, placeholder: 'مثل: ولاد خالتي', enterkeyhint: 'done' });
  const add = async () => {
    try {
      await api('/groups', { name: name.value });
      await refresh();
    } catch (err) {
      toast(err.message);
    }
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  return h('section', { class: 'card contrib-card', id: 'groups' },
    h('h2', {}, '👥 شللي'),
    h('p', { class: 'hint' }, 'اختر الشلة في لوبي الغرفة، والموقع يتذكر الأسئلة اللي انسألت عليهم عشان ما تتكرر في السهرات الجاية. ومع شلة ثانية عادي تنعاد.'),
    groups.length ? h('ol', { class: 'review-list' }, groups.map(groupRow)) : h('p', { class: 'hint center' }, 'لسا ما عندك شلل.'),
    h('div', { class: 'group-row' }, name, h('button', { type: 'button', class: 'btn primary', onclick: add }, '➕ أضف شلة')),
  );
}

async function render() {
  const groups = data.games.map((g) => ({ g, list: data.banks.filter((b) => b.game === g.id) })).filter((x) => x.list.length);
  app.replaceChildren(...[
    nav(),
    h('header', { class: 'contrib-hero' },
      h('div', { class: 'logo' }, '👤'),
      h('h1', {}, `أهلاً ${me.username}`),
      h('button', { type: 'button', class: 'link-btn', onclick: async () => { await api('/logout', {}); me = null; renderAuth(); } }, 'تسجيل الخروج')),
    persistent ? null : h('p', { class: 'banner bad' }, '⚠️ قاعدة البيانات مو مجهزة على السيرفر، فالحسابات والبنوك تنمسح مع كل تحديث للموقع.'),
    connectSection(),
    h('section', { class: 'card contrib-card' },
      h('h2', {}, '📚 بنوكي'),
      h('p', { class: 'hint' }, 'افتح غرفة وأنت مسجّل دخول، وبتلقى بنوكك الجاهزة في اللوبي.'),
      groups.length ? null : h('p', { class: 'hint center' }, 'لسا ما عندك بنوك. اطلب من الذكاء الاصطناعي، أو سوّ واحد بالصق تحت.'),
      ...groups.map(({ g, list }) => h('div', { class: 'review-group' },
        h('h3', {}, `${g.emoji} ${g.name}`),
        h('ol', { class: 'review-list' }, list.map(bankRow))))),
    newBankForm(),
    groupsSection(),
    await connectionsSection(),
    passwordSection(),
  ].filter(Boolean));
}

async function refresh() {
  [data, groupsData] = await Promise.all([api('/banks'), api('/groups')]);
  await render();
}

async function start() {
  const out = await api('/me');
  me = out.account;
  persistent = out.persistent;
  if (!me) {
    renderAuth(params.get('signup') ? 'signup' : 'login');
    return;
  }
  await refresh();
  if (location.hash === '#groups') $('#groups')?.scrollIntoView();
}

start().catch((err) => {
  app.replaceChildren(nav(), h('p', { class: 'banner bad' }, err.message));
});
})();
