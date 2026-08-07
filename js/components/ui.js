// Shared UI helpers: element creation, toasts, modals, stat blocks.
import { abilityMod, fmtMod, fmtCR, monsterXP } from '../srd.js';

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
  document.body.append(d);
  d.showModal();
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
