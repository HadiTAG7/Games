/* global h */
'use strict';

// Builds a question form from a game's field list (sent by the server), for
// «أضف أسئلة» and the review page. Fields: { key, label, type: select|text|textarea,
// options?, max?, placeholder?, showIf?: { otherKey: value } }.

function contribForm(fields, values = {}) {
  const inputs = {};
  const rows = {};
  const sync = () => {
    for (const f of fields) {
      if (!f.showIf) continue;
      const [other, wanted] = Object.entries(f.showIf)[0];
      rows[f.key].hidden = String(inputs[other].value) !== String(wanted);
    }
  };
  const el = h('div', { class: 'contrib-fields' }, fields.map((f) => {
    let input;
    if (f.type === 'select') {
      input = h('select', { onchange: sync }, f.options.map((o) => h('option', { value: o.value, selected: String(values[f.key]) === String(o.value) }, o.label)));
    } else if (f.type === 'textarea') {
      input = h('textarea', { rows: 2, maxlength: f.max, placeholder: f.placeholder ?? '', value: values[f.key] ?? '' });
    } else {
      input = h('input', { maxlength: f.max, placeholder: f.placeholder ?? '', value: values[f.key] ?? '', autocomplete: 'off' });
    }
    input.dataset.key = f.key;
    inputs[f.key] = input;
    rows[f.key] = h('label', { class: `field${f.type === 'textarea' ? ' wide' : ''}` }, h('span', {}, f.label), input);
    return rows[f.key];
  }));
  sync();
  return {
    el,
    /** The visible fields' values. */
    read() {
      const out = {};
      for (const f of fields) if (!rows[f.key].hidden) out[f.key] = inputs[f.key].value.trim();
      return out;
    },
    clear(keys) {
      for (const k of keys) if (inputs[k] && inputs[k].tagName !== 'SELECT') inputs[k].value = '';
      inputs[keys.find((k) => inputs[k]?.tagName !== 'SELECT')]?.focus();
    },
  };
}

/** A one-line description of an entry, using the labels of its select fields. */
function contribSummary(fields, values) {
  return fields.filter((f) => values[f.key] !== undefined && values[f.key] !== '').map((f) => {
    if (f.type === 'select') return f.options.find((o) => String(o.value) === String(values[f.key]))?.label ?? values[f.key];
    return values[f.key];
  }).join(' · ');
}
