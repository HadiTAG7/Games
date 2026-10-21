/* global $, h, toast, contribForm, icon */
'use strict';

// The owner's review page: questions people sent wait here until approved
// (they can be edited first) or rejected. The password stays in this tab only.
(() => {
const app = $('#app');
const KEY = 'admin:password';
let password = sessionStorage.getItem(KEY) ?? '';
let tab = 'pending';
let status = null;
let accountQuery = '';

function tabsEl() {
  const tabs = [['pending', `تنتظر (${status.pending})`], ['approved', `المقبولة (${status.approved})`], ['rejected', 'المرفوضة'], ['accounts', 'الحسابات']];
  return h('div', { class: 'review-tabs', role: 'tablist' }, tabs.map(([id, label]) => h('button', {
    type: 'button',
    class: `btn small${tab === id ? ' primary' : ''}`,
    role: 'tab',
    'aria-selected': String(tab === id),
    onclick: () => { tab = id; renderTab(); },
  }, label)));
}

async function api(path, body) {
  const res = await fetch(`/api/admin${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-admin-password': encodeURIComponent(password), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 503 || res.status === 429) {
    sessionStorage.removeItem(KEY);
    renderLogin(out.error);
    throw new Error(out.error);
  }
  if (!res.ok) throw new Error(out.error ?? 'صار خطأ');
  return out;
}

function renderLogin(error = '') {
  const input = h('input', { type: 'password', id: 'password', autocomplete: 'current-password', placeholder: 'كلمة السر' });
  app.replaceChildren(
    h('nav', { class: 'landing-nav' }, h('a', { href: '/' }, '→ الصفحة الرئيسية')),
    h('form', {
      class: 'card join-form',
      onsubmit: async (e) => {
        e.preventDefault();
        password = input.value;
        sessionStorage.setItem(KEY, password);
        await start();
      },
    },
      h('h1', { class: 'center' }, icon('lock'), ' مراجعة الأسئلة'),
      error ? h('p', { class: 'banner bad' }, error) : null,
      h('label', { class: 'field' }, h('span', {}, 'كلمة السر'), input),
      h('button', { class: 'btn primary big', type: 'submit' }, 'ادخل'),
    ),
  );
  input.focus();
}

async function start() {
  try {
    status = await api('/status');
  } catch {
    return;
  }
  await renderTab();
}

function storageBanner() {
  const survey = status.survey
    ? h('p', { class: 'hint center' }, icon('chart-column'), ` استبيان «فاميلي فيود» من أجوبة «عقلية القطيع»: ${status.survey.ready} سؤال جاهز من ${status.survey.questions}`)
    : null;
  const banner = status.persistent
    ? h('p', { class: 'banner good' }, icon('circle-check'), ' الأسئلة محفوظة في قاعدة البيانات، وما تنمسح مع التحديثات.')
    : h('p', { class: 'banner bad' }, status.error ?? '',
      icon('triangle-alert'), ' الأسئلة محفوظة في ملف مؤقت على السيرفر، وتنمسح مع كل تحديث. جهّز قاعدة البيانات (DATABASE_URL) عشان تنحفظ للأبد.');
  return h('div', {}, banner, survey);
}

async function act(path, body, done) {
  try {
    await api(path, body);
    toast(done, 'ok');
    await renderTab();
  } catch (err) {
    toast(err.message);
  }
}

function itemCard(item, spec) {
  const form = contribForm(spec.fields, item.payload);
  const when = new Date(item.createdAt).toLocaleDateString('ar-SA-u-nu-latn', { day: 'numeric', month: 'short' });
  const buttons = tab === 'pending'
    ? [
      h('button', { type: 'button', class: 'btn primary small', onclick: () => act(`/submissions/${item.id}/approve`, { payload: form.read() }, 'انقبل') }, icon('circle-check'), ' وافق'),
      h('button', { type: 'button', class: 'btn small', onclick: () => act(`/submissions/${item.id}/reject`, {}, 'انرفض') }, icon('circle-x'), ' ارفض'),
    ]
    : [h('button', {
      type: 'button',
      class: 'btn small danger',
      onclick: () => { if (confirm('تحذف السؤال؟')) act(`/submissions/${item.id}/delete`, {}, 'انحذف'); },
    }, icon('trash-2'), ' احذف')];
  return h('li', { class: 'card review-item', 'data-id': item.id },
    h('div', { class: 'review-meta' }, `#${item.id} · ${item.submitter ? `من ${item.submitter}` : 'بدون اسم'} · ${when}`),
    tab === 'pending' ? form.el : h('p', { class: 'review-text' }, Object.values(item.payload).filter(Boolean).join(' · ')),
    h('div', { class: 'review-actions' }, buttons),
  );
}

async function approveAll(items) {
  if (!confirm(`توافق على ${items.length} أسئلة؟`)) return;
  let ok = 0;
  for (const el of items) {
    const id = Number(el.dataset.id);
    try {
      await api(`/submissions/${id}/approve`, {});
      ok += 1;
    } catch (err) {
      toast(`#${id}: ${err.message}`);
    }
  }
  toast(`انقبل ${ok}`, 'ok');
  await renderTab();
}

/** «الحسابات»: there's no reset by email, so the owner sets a new password here. */
async function renderAccounts(tabs) {
  let list;
  try {
    list = await api(`/accounts?q=${encodeURIComponent(accountQuery)}`);
  } catch {
    return;
  }
  const search = h('input', { placeholder: 'ابحث باسم المستخدم', value: accountQuery });
  app.replaceChildren(...[
    h('nav', { class: 'landing-nav' }, h('a', { href: '/' }, '→ الصفحة الرئيسية')),
    h('h1', { class: 'center' }, icon('lock'), ' الحسابات'),
    list.persistent ? null : h('p', { class: 'banner bad' }, icon('triangle-alert'), ' الحسابات محفوظة في ملف مؤقت وتنمسح مع كل تحديث.'),
    tabs,
    h('form', { class: 'mcp-url', onsubmit: (e) => { e.preventDefault(); accountQuery = search.value; renderTab(); } },
      search, h('button', { class: 'btn small', type: 'submit' }, 'بحث')),
    list.accounts.length ? h('ol', { class: 'review-list' }, list.accounts.map((a) => h('li', { class: 'card review-item' },
      h('div', { class: 'review-meta' }, `#${a.id} · ${new Date(a.createdAt).toLocaleDateString('ar-SA-u-nu-latn')} · ${a.banks} بنك`),
      h('b', {}, a.username),
      h('div', { class: 'review-actions' },
        h('button', {
          type: 'button',
          class: 'btn small',
          onclick: () => {
            const password = prompt(`كلمة سر جديدة لـ${a.username} (8 أحرف على الأقل):`);
            if (password) act(`/accounts/${a.id}/password`, { password }, 'تغيّرت كلمة السر');
          },
        }, icon('key-round'), ' كلمة سر جديدة'),
        h('button', {
          type: 'button',
          class: 'btn small danger',
          onclick: () => { if (confirm(`تحذف حساب ${a.username} وكل بنوكه؟`)) act(`/accounts/${a.id}/delete`, {}, 'انحذف الحساب'); },
        }, icon('trash-2'), ' احذف')),
    )))
      : h('p', { class: 'hint center' }, 'ما فيه حسابات'),
  ].filter(Boolean));
}

async function renderTab() {
  if (tab === 'accounts') {
    status = await api('/status').catch(() => status);
    await renderAccounts(tabsEl());
    return;
  }
  let data;
  try {
    [data, status] = await Promise.all([api(`/submissions?status=${tab}`), api('/status')]);
  } catch {
    return;
  }
  const groups = data.games.map((spec) => ({ spec, items: data.items.filter((i) => i.game === spec.id) })).filter((g) => g.items.length);
  app.replaceChildren(...[
    h('nav', { class: 'landing-nav' }, h('a', { href: '/' }, '→ الصفحة الرئيسية'), h('a', { href: '/add' }, icon('pen-line'), ' أضف أسئلة')),
    h('h1', { class: 'center' }, icon('lock'), ' مراجعة الأسئلة'),
    storageBanner(),
    tabsEl(),
    groups.length ? null : h('p', { class: 'hint center' }, tab === 'pending' ? 'ما فيه أسئلة تنتظر' : 'ما فيه شي هنا'),
    ...groups.map(({ spec, items }) => {
      const list = h('ol', { class: 'review-list' }, items.map((item) => itemCard(item, spec)));
      return h('section', { class: 'review-group' },
        h('div', { class: 'field-head' },
          h('h2', {}, `${spec.name} (${items.length})`),
          tab === 'pending' ? h('button', { type: 'button', class: 'link-btn small', onclick: () => approveAll([...list.children]) }, icon('circle-check'), ' وافق على الكل') : null),
        list);
    }),
  ].filter(Boolean));
}

if (password) start();
else renderLogin();
})();
