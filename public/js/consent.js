/* global $, h, icon */
'use strict';

// «تسمح لـClaude…؟»: an AI app wants to add question banks to your account.
// Allowing always takes your username and password, even if this browser is
// logged in, so the app is linked to the account of whoever is allowing it.
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

function renderConsent(info, error = '', typed = '') {
  const username = h('input', { autocomplete: 'username', maxlength: 20, required: true, value: typed });
  const password = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  frame(
    h('h1', { class: 'center' }, 'تسمح بالربط؟'),
    h('p', { class: 'center consent-who' }, h('b', {}, '«', h('bdi', {}, info.client.name), '»'), ' ', h('small', { class: 'muted' }, '(', h('bdi', {}, info.client.host), ')')),
    h('p', { class: 'center' }, 'يبي يضيف ويعدّل بنوك الأسئلة في حسابك في ألعاب الشلة.'),
    h('ul', { class: 'rules-list' },
      h('li', {}, 'يقدر يشوف بنوكك، ويسوي بنوك جديدة، ويضيف أسئلة وصور، ويحذف من بنوكك.'),
      h('li', {}, 'وفي كل محادثة جديدة بيعطيك رابط تأكد فيه إنك أنت صاحب الحساب.'),
      h('li', {}, 'ما يقدر يشوف كلمة السر، ولا يلعب بدالك. وتقدر تلغي الربط أي وقت من صفحة حسابك.')),
    error ? h('p', { class: 'banner bad' }, error) : null,
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        await decide(true, { username: username.value, password: password.value }, info);
      },
    },
      h('p', { class: 'hint' }, 'ادخل بحسابك أنت عشان تسمح:'),
      h('label', { class: 'field' }, h('span', {}, 'اسم المستخدم'), username),
      h('label', { class: 'field' }, h('span', {}, 'كلمة السر'), password),
      h('div', { class: 'review-actions consent-actions' },
        h('button', { type: 'submit', class: 'btn primary big' }, icon('circle-check'), ' اسمح'),
        h('button', { type: 'button', class: 'btn big', onclick: () => decide(false, {}, info) }, 'لا'))),
    h('p', { class: 'hint center' }, 'ما عندك حساب؟ ',
      h('a', { href: `/account?signup=1&next=${encodeURIComponent(location.pathname + location.search)}` }, 'سوّ حساب')),
  );
  (typed ? password : username).focus();
}

async function decide(allow, login, info) {
  try {
    const { redirect, username } = await call('/oauth/decision', { req: reqId, allow, ...login });
    frame(h('p', { class: 'center' }, allow ? [icon('circle-check'), ' تم الربط بحساب ', h('bdi', {}, h('b', {}, username)), '، نرجّعك للتطبيق…'] : 'رجعناك للتطبيق.'));
    location.href = redirect;
  } catch (err) {
    if (allow) renderConsent(info, err.message, login.username);
    else frame(h('p', { class: 'banner bad' }, err.message));
  }
}

async function start() {
  try {
    renderConsent(await call(`/oauth/request?req=${encodeURIComponent(reqId)}`));
  } catch (err) {
    frame(h('p', { class: 'banner bad' }, err.message));
  }
}

start();
})();
