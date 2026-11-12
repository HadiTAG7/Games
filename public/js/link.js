/* global $, h, icon */
'use strict';

// «اربط حسابك»: an AI conversation asks to work in your account. Log in with
// your username and password (every time, even if this browser is logged in),
// and the banks made in that conversation go to your account.
(() => {
const app = $('#app');
const code = new URLSearchParams(location.search).get('code') ?? '';

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
  app.replaceChildren(h('section', { class: 'card join-form consent' }, h('div', { class: 'logo center' }, icon('link')), ...children));
}

function renderLogin(info, error = '', typed = '') {
  const username = h('input', { autocomplete: 'username', maxlength: 20, required: true, value: typed });
  const password = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  frame(
    h('h1', { class: 'center' }, 'اربط حسابك'),
    h('p', { class: 'center' }, 'محادثة في «', h('bdi', {}, h('b', {}, info.client)), '» تبي تضيف بنوك أسئلة. ادخل بحسابك أنت، وكل اللي تسويه هالمحادثة ينحفظ في حسابك.'),
    error ? h('p', { class: 'banner bad' }, error) : null,
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const { username: name } = await call('/api/link/confirm', { code, username: username.value, password: password.value });
          frame(
            h('h1', { class: 'center' }, icon('circle-check'), ' تم الربط'),
            h('p', { class: 'center' }, 'هالمحادثة صارت مربوطة بحساب ', h('bdi', {}, h('b', {}, name)), '.'),
            h('p', { class: 'center muted' }, 'ارجع للمحادثة وقل «خلصت».'),
          );
        } catch (err) {
          renderLogin(info, err.message, username.value);
        }
      },
    },
      h('label', { class: 'field' }, h('span', {}, 'اسم المستخدم'), username),
      h('label', { class: 'field' }, h('span', {}, 'كلمة السر'), password),
      h('button', { class: 'btn primary big', type: 'submit' }, icon('link'), ' اربط حسابي')),
    h('p', { class: 'hint center' }, 'ما عندك حساب؟ ',
      h('a', { href: `/account?signup=1&next=${encodeURIComponent(location.pathname + location.search)}` }, 'سوّ حساب'), ' وارجع لهالصفحة.'),
  );
  (typed ? password : username).focus();
}

async function start() {
  try {
    const info = await call(`/api/link/info?code=${encodeURIComponent(code)}`);
    if (info.linked) frame(h('p', { class: 'banner bad' }, 'الرابط هذا مستخدم، اطلب من Claude رابط جديد.'));
    else renderLogin(info);
  } catch (err) {
    frame(h('p', { class: 'banner bad' }, err.message));
  }
}

start();
})();
