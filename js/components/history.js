// Shared persistent history for generators. Entries live in the per-campaign
// misc store, so they survive tab switches, reloads, and browser restarts.
// Every list gets a "Clear all" button and a per-entry remove button.
import { getState, setState, uid } from '../store.js';
import { el, esc, confirmDialog } from './ui.js';

export async function historyList({ container, key, title = 'History', max = 50, renderEntry, empty = 'Nothing generated yet. Results are saved here automatically.' }) {
  let items = (await getState(key, [])) || [];

  const card = el(`<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <h2 style="margin:0">${esc(title)}</h2>
      <button class="btn small" data-clear>Clear all</button>
    </div>
    <div class="mt" data-list></div>
  </div>`);
  container.append(card);
  const listEl = card.querySelector('[data-list]');
  const clearBtn = card.querySelector('[data-clear]');
  const save = () => setState(key, items);

  const draw = () => {
    listEl.innerHTML = items.length ? '' : `<p class="faint small">${esc(empty)}</p>`;
    for (const entry of items) {
      const row = el('<div style="position:relative;border-bottom:1px solid var(--border);padding:8px 30px 8px 0"></div>');
      const x = el('<button class="btn small icon-btn" title="Remove" aria-label="Remove" style="position:absolute;top:6px;right:0;padding:1px 8px">&times;</button>');
      x.addEventListener('click', async () => {
        items = items.filter(i => i !== entry);
        await save();
        draw();
      });
      const body = el('<div></div>');
      renderEntry(entry, body);
      row.append(body, x);
      listEl.append(row);
    }
    clearBtn.style.visibility = items.length ? 'visible' : 'hidden';
  };

  clearBtn.addEventListener('click', () =>
    confirmDialog('Clear this entire history?', async () => {
      items = [];
      await save();
      draw();
    }, { label: 'Clear all' }));

  draw();

  return {
    async add(payload) {
      const entry = { id: uid(), ts: Date.now(), ...payload };
      items.unshift(entry);
      if (items.length > max) items = items.slice(0, max);
      await save();
      draw();
      return entry;
    },
  };
}

export const timeStamp = (ts) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
