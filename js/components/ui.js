// Shared UI helpers: element creation, toasts, modals, stat blocks.
import { abilityMod, fmtMod, fmtCR, monsterXP } from '../srd.js';
import { getPrefs } from '../store.js';
import { icon } from './icons.js';

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const esc = (s) => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

// Minimal markdown-ish rendering for SRD text: **bold**, _italic_, paragraphs.
export function md(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/_(.+?)_/g, '<i>$1</i>')
    .split(/\n\n+/).map(p => `<p>${p.replaceAll('\n', '<br>')}</p>`).join('');
}

export function toast(msg, type = '') {
  const wrap = document.getElementById('toast-wrap');
  const t = el(`<div class="toast ${type}">${esc(msg)}</div>`);
  wrap.append(t);
  setTimeout(() => t.remove(), 2600);
}

export function modal(title, bodyNode, { actions = [], wide = false, onClose } = {}) {
  const d = el(`<dialog class="modal" ${wide ? 'style="width:min(860px,calc(100vw - 28px))"' : ''}>
    <div class="modal-head"><h2>${esc(title)}</h2>
      <button class="btn icon-btn" data-close aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6 L18 18 M18 6 L6 18"/></svg>
      </button>
    </div>
    <div class="modal-body"></div>
  </dialog>`);
  d.querySelector('.modal-body').append(bodyNode);
  if (actions.length) {
    const foot = el('<div class="modal-foot"></div>');
    for (const a of actions) {
      const b = el(`<button class="btn ${a.class || ''}">${esc(a.label)}</button>`);
      b.addEventListener('click', () => { if (a.onClick(d) !== false) d.close(); });
      foot.append(b);
    }
    d.append(foot);
  }
  // Close + cleanup in one place. Not wired to the 'close' event because some
  // browsers don't fire it reliably; instead d.close() is wrapped so every
  // caller (close button, backdrop, Esc, action buttons, tool code) cleans up.
  const nativeClose = d.close.bind(d);
  let closed = false;
  d.close = () => {
    if (closed) return;
    closed = true;
    try { nativeClose(); } catch { /* already closed */ }
    onClose?.();
    d.remove();
  };
  d.querySelector('[data-close]').addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.addEventListener('close', () => d.close()); // Esc key path
  d.addEventListener('cancel', () => d.close());
  // Enter confirms. Handled on the dialog itself rather than relying on
  // focus, which mouse interactions do not reliably leave in the right
  // place. Textareas keep Enter for newlines, and a deliberately focused
  // Cancel (or other) button keeps its own click.
  if (actions.length) {
    d.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const affirm = d.querySelector('.modal-foot .btn:last-child');
      if (!affirm) return;
      const t = e.target;
      if (t && t.tagName === 'TEXTAREA') return;
      if (t && t.closest?.('.btn') && t.closest('.btn') !== affirm) return;
      e.preventDefault();
      affirm.click();
    });
  }
  document.body.append(d);
  d.showModal();
  if (actions.length) d.querySelector('.modal-foot .btn:last-child')?.focus();
  return d;
}

export function confirmDialog(message, onYes, { label = 'Delete', danger = true } = {}) {
  modal('Are you sure?', el(`<p>${esc(message)}</p>`), {
    actions: [
      { label: 'Cancel', onClick: () => {} },
      { label, class: danger ? 'danger' : 'primary', onClick: () => onYes() },
    ],
  });
}

export function promptDialog(title, fields, onSubmit, { submitLabel = 'Save' } = {}) {
  // fields: [{key, label, type?, value?, options?}]
  const body = el('<div style="display:flex;flex-direction:column;gap:10px"></div>');
  for (const f of fields) {
    const field = el(`<label class="field"><span>${esc(f.label)}</span></label>`);
    let input;
    if (f.type === 'select') {
      input = el(`<select>${f.options.map(o => `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`);
    } else if (f.type === 'textarea') {
      input = el('<textarea rows="4"></textarea>');
      input.value = f.value ?? '';
    } else {
      input = el(`<input type="${f.type || 'text'}">`);
      input.value = f.value ?? '';
    }
    input.dataset.key = f.key;
    field.append(input);
    body.append(field);
  }
  const d = modal(title, body, {
    actions: [
      { label: 'Cancel', onClick: () => {} },
      {
        label: submitLabel, class: 'primary',
        onClick: () => {
          const out = {};
          body.querySelectorAll('[data-key]').forEach(i => {
            out[i.dataset.key] = i.type === 'number' ? (i.value === '' ? '' : Number(i.value)) : i.value;
          });
          return onSubmit(out);
        },
      },
    ],
  });
  const first = body.querySelector('input,textarea,select');
  if (first) first.focus();
  return d;
}

/* ---------- stat block ---------- */

export function statBlockHTML(m) {
  const abil = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const saves = abil.filter(a => m.saves?.[a] != null).map(a => `${a.toUpperCase()} ${fmtMod(m.saves[a])}`).join(', ');
  const skills = Object.entries(m.skills || {}).map(([k, v]) => `${cap(k)} ${fmtMod(v)}`).join(', ');
  const speed = Object.entries(m.speed || {})
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => (k === 'walk' ? `${v} ft.` : `${k} ${v} ft.${k === 'fly' && m.speed.hover ? ' (hover)' : ''}`))
    .join(', ');
  const line = (label, val) => val ? `<p><b>${label}</b> ${esc(val)}</p>` : '';
  const section = (title, items) => items?.length
    ? `<div class="sb-section">${title}</div>` + items.map(a => `<p><b><i>${esc(a.name)}.</i></b> ${md(a.desc).replace(/^<p>|<\/p>$/g, '')}</p>`).join('')
    : '';

  return `<div class="stat-block">
    <div class="sb-name">${esc(m.name)}</div>
    <div class="sb-meta">${esc(m.size)} ${esc(m.type)}${m.subtype ? ` (${esc(m.subtype)})` : ''}, ${esc(m.alignment)}${m.source ? ` <span class="pill">${esc(m.source)}</span>` : ''}</div>
    <hr>
    <p><b>Armor Class</b> ${m.ac}${m.acDesc ? ` (${esc(m.acDesc)})` : ''}</p>
    <p><b>Hit Points</b> ${m.hp}${m.hitDice ? ` (${esc(m.hitDice)})` : ''}</p>
    <p><b>Speed</b> ${esc(speed)}</p>
    <hr>
    <div class="sb-abilities">${abil.map(a => `<div><b>${a.toUpperCase()}</b>${m[a]} (${fmtMod(abilityMod(m[a]))})</div>`).join('')}</div>
    <hr>
    ${line('Saving Throws', saves)}
    ${line('Skills', skills)}
    ${line('Damage Vulnerabilities', m.vulnerabilities)}
    ${line('Damage Resistances', m.resistances)}
    ${line('Damage Immunities', m.immunities)}
    ${line('Condition Immunities', m.conditionImmunities)}
    ${line('Senses', m.senses)}
    ${line('Languages', m.languages)}
    <p><b>Challenge</b> ${fmtCR(m.cr)} (${monsterXP(m).toLocaleString()} XP)</p>
    ${section('Traits', m.abilities)}
    ${section('Actions', m.actions)}
    ${section('Bonus Actions', m.bonusActions)}
    ${section('Reactions', m.reactions)}
    ${m.legendaryActions?.length ? `<div class="sb-section">Legendary Actions</div>${m.legendaryDesc ? `<p class="small muted">${esc(m.legendaryDesc)}</p>` : ''}` + m.legendaryActions.map(a => `<p><b><i>${esc(a.name)}.</i></b> ${esc(a.desc)}</p>`).join('') : ''}
  </div>`;
}

export function showStatBlock(m) {
  modal(m.name, el(`<div>${statBlockHTML(m)}</div>`), { wide: true });
}

export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- toggle rows ---------- */

// A single-select row of toggle buttons, used instead of dropdowns in the
// generators. options: [{value, label, icon}] or plain strings.
// opts.segmented joins the buttons into one bordered control.
// Returns { get, set, el }.
export function toggleRow(label, options, initial, onChange, { segmented = false } = {}) {
  const opts = options.map(o => (typeof o === 'string' ? { value: o, label: o } : o));
  let value = opts.some(o => o.value === initial) ? initial : opts[0]?.value;
  const wrap = el(`<div class="field toggle-field">
    ${label ? `<span>${esc(label)}</span>` : ''}
    <div class="row toggle-row ${segmented ? 'segmented' : ''}">${opts.map(o =>
      `<button type="button" class="btn small" data-val="${esc(o.value)}">${o.icon ? icon(o.icon) : ''}${esc(o.label)}</button>`).join('')}</div>
  </div>`);
  const row = wrap.querySelector('.toggle-row');
  const paint = () => row.querySelectorAll('.btn').forEach(b =>
    b.classList.toggle('primary', b.dataset.val === String(value)));
  row.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn || btn.dataset.val === String(value)) return;
    value = btn.dataset.val;
    paint();
    onChange?.(value);
  });
  paint();
  return { el: wrap, get: () => value, set: (v) => { value = v; paint(); } };
}

/* ---------- hover switching ---------- */

// Switch on hover inside a chip/tab row, matching the sidebar's behavior and
// honoring the same Settings preference. Uses delegation, so the row's
// contents can be re-rendered freely after this is attached once.
export function attachHoverSwitch(row, selector, onPick, delay = 60) {
  let timer = null;
  row.addEventListener('mouseover', (e) => {
    if (getPrefs().navHover === false) return;
    const target = e.target.closest(selector);
    if (!target || !row.contains(target)) return;
    clearTimeout(timer);
    timer = setTimeout(() => onPick(target), delay);
  });
  row.addEventListener('mouseleave', () => clearTimeout(timer));
}

/* ---------- number steppers ---------- */

// Wrap a number input in a [- value +] stepper. Applied automatically to every
// input[type=number] on the page (see the MutationObserver in app.js).
function attachStepper(input) {
  input.dataset.stepper = '1';
  const wrap = el('<span class="stepper"></span>');
  input.replaceWith(wrap);
  const dec = el('<button type="button" class="step-btn" aria-label="Decrease" tabindex="-1">&minus;</button>');
  const inc = el('<button type="button" class="step-btn" aria-label="Increase" tabindex="-1">+</button>');
  wrap.append(dec, input, inc);

  const step = (dir) => {
    const by = Number(input.step) || 1;
    const cur = input.value === '' ? 0 : Number(input.value);
    let next = (Number.isFinite(cur) ? cur : 0) + dir * by;
    if (input.min !== '' && next < Number(input.min)) next = Number(input.min);
    if (input.max !== '' && next > Number(input.max)) next = Number(input.max);
    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  dec.addEventListener('click', () => step(-1));
  inc.addEventListener('click', () => step(1));
}

export function enhanceNumberInputs(root = document.body) {
  root.querySelectorAll('input[type="number"]:not([data-stepper])').forEach(attachStepper);
}

/* ---------- searchable list input ---------- */

export function searchInput(placeholder, onQuery) {
  const input = el(`<input type="search" placeholder="${esc(placeholder)}" style="width:100%">`);
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => onQuery(input.value.trim().toLowerCase()), 120);
  });
  return input;
}

// A "Random" button to sit beside a search box. The pool is asked for at
// click time rather than handed over once, so whatever the search and the
// filters have left on screen is what it draws from: type "heal" and it
// picks a healing spell.
export function randomButton(pool, open, what = 'entries') {
  const btn = el(`<button class="btn" title="Open one at random from whatever the search and filters have left">Random</button>`);
  btn.addEventListener('click', () => {
    const rows = pool();
    if (!rows || !rows.length) return toast(`No ${what} to pick from; widen the search`, 'danger');
    open(rows[Math.floor(Math.random() * rows.length)]);
  });
  return btn;
}
