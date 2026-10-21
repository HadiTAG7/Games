/* global $, h, icon */
'use strict';

// «تسمح لـClaude…؟»: an AI app wants to add question banks to your account.
// Log in here if needed, then allow or refuse; the app gets its answer.
(() => {
const app = $('#app');
const reqId = new URLSearchParams(location.search).get('req') ?? '';

async function call(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? 'صار خطأ');
  return out;
}

function frame(...children) {
  app.replaceChildren(h('section', { class: 'card join-form consent' }, h('div', { class: 'logo center' }, icon('dices')), ...children));
}

function renderLogin(info, error = '') {
  const username = h('input', { autocomplete: 'username', maxlength: 20 });
  const password = h('input', { type: 'password', autocomplete: 'current-password' });
  frame(
    h('h1', { class: 'center' }, 'ادخل بحسابك'),
    h('p', { class: 'center muted' }, '«', h('bdi', {}, info.client.name), '» يبي يربط حسابك في ألعاب الشلة.'),
    error ? h('p', { class: 'banner bad' }, error) : null,
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await call('/api/account/login', { username: username.value, password: password.value });
          start();
        } catch (err) {
          renderLogin(info, err.message);
        }
      },
    },
      h('label', { class: 'field' }, h('span', {}, 'اسم المستخدم'), username),
      h('label', { class: 'field' }, h('span', {}, 'كلمة السر'), password),
      h('button', { class: 'btn primary big', type: 'submit' }, 'ادخل')),
    h('p', { class: 'hint center' }, 'ما عندك حساب؟ ',
      h('a', { href: `/account?signup=1&next=${encodeURIComponent(location.pathname + location.search)}` }, 'سوّ حساب')),
  );
  username.focus();
}

async function decide(allow) {
  try {
    const { redirect } = await call('/oauth/decision', { req: reqId, allow });
    frame(h('p', { class: 'center' }, allow ? [icon('circle-check'), ' تم الربط، نرجّعك للتطبيق…'] : 'رجعناك للتطبيق.'));
    location.href = redirect;
  } catch (err) {
    frame(h('p', { class: 'banner bad' }, err.message));
  }
}

function renderConsent(info) {
  frame(
    h('h1', { class: 'center' }, 'تسمح بالربط؟'),
    h('p', { class: 'center consent-who' }, h('b', {}, '«', h('bdi', {}, info.client.name), '»'), ' ', h('small', { class: 'muted' }, '(', h('bdi', {}, info.client.host), ')')),
    h('p', { class: 'center' }, 'يبي يضيف ويعدّل بنوك الأسئلة في حسابك ', h('bdi', {}, h('b', {}, info.account.username)), '.'),
    h('ul', { class: 'rules-list' },
      h('li', {}, 'يقدر يشوف بنوكك، ويسوي بنوك جديدة، ويضيف أسئلة وصور، ويحذف من بنوكك.'),
      h('li', {}, 'ما يقدر يشوف كلمة السر، ولا يلعب بدالك.'),
      h('li', {}, 'تقدر تلغي الربط أي وقت من صفحة حسابك.')),
    h('div', { class: 'review-actions consent-actions' },
      h('button', { type: 'button', class: 'btn primary big', onclick: () => decide(true) }, icon('circle-check'), ' اسمح'),
      h('button', { type: 'button', class: 'btn big', onclick: () => decide(false) }, 'لا')),
    h('p', { class: 'hint center' }, 'مو أنت ', h('bdi', {}, info.account.username), '؟ ',
      h('button', { type: 'button', class: 'link-btn', onclick: async () => { await call('/api/account/logout', {}); start(); } }, 'ادخل بحساب ثاني')),
  );
}

async function start() {
  try {
    const info = await call(`/oauth/request?req=${encodeURIComponent(reqId)}`);
    if (info.account) renderConsent(info);
    else renderLogin(info);
  } catch (err) {
    frame(h('p', { class: 'banner bad' }, err.message));
  }
}

start();
})();
