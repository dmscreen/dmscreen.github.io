// Custom Random Tables: build, roll, import/export your own weighted tables.
import { dbAll, dbPut, dbDelete, activeCampaignId } from '../store.js';
import { loadTables } from '../srd.js';
import { el, esc, toast, confirmDialog, modal, promptDialog, searchInput } from '../components/ui.js';
import { historyList, timeStamp } from '../components/history.js';
import { rollTable } from '../dice.js';

function parseRows(text) {
  // One entry per line. "3x Some result" gives weight 3.
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(\d+)\s*x\s+(.+)$/i);
    return m ? { weight: Number(m[1]), text: m[2] } : { weight: 1, text: l };
  });
}

export default {
  id: 'tables', title: 'Custom Random Tables', shortTitle: 'Tables', group: 'Generators', icon: 'table',
  subtitle: 'Your own tables, weighted and rollable anywhere',

  async render(container) {
    container.innerHTML = `
      <div class="row mb">
        <button class="btn primary" id="ct-new">+ New table</button>
        <button class="btn" id="ct-import">+ Import table</button>
      </div>
      <div id="ct-list"></div>
      <div id="ct-result"></div>
      <div id="ct-history"></div>`;

    const listEl = container.querySelector('#ct-list');
    const resultEl = container.querySelector('#ct-result');

    const history = await historyList({
      container: container.querySelector('#ct-history'),
      key: 'history:customTables',
      title: 'Roll history',
      renderEntry: (e, body) => {
        body.innerHTML = `<span class="pill">${esc(e.table)}</span> ${esc(e.text)} <span class="small faint">${timeStamp(e.ts)}</span>`;
      },
    });

    const editTable = (table) => {
      const body = el(`<div>
        <label class="field mb"><span>Table name</span><input id="ct-name" value="${esc(table?.name || '')}"></label>
        <label class="field"><span>Entries (one per line; prefix "3x " to weight an entry)</span>
        <textarea id="ct-rows" rows="12" placeholder="A wandering merchant with a broken cart\n3x Nothing but wind and bad weather\nGoblin ambush!">${esc((table?.rows || []).map(r => r.weight > 1 ? `${r.weight}x ${r.text}` : r.text).join('\n'))}</textarea></label>
      </div>`);
      modal(table ? 'Edit table' : 'New table', body, {
        actions: [
          { label: 'Cancel', onClick: () => {} },
          {
            label: 'Save', class: 'primary',
            onClick: () => {
              const name = body.querySelector('#ct-name').value.trim();
              const rows = parseRows(body.querySelector('#ct-rows').value);
              if (!name || !rows.length) { toast('Need a name and at least one entry', 'danger'); return false; }
              dbPut('customTables', { ...(table || {}), name, rows, campaignId: activeCampaignId() }).then(draw);
            },
          },
        ],
      });
    };

    const draw = async () => {
      const tables = await dbAll('customTables', activeCampaignId());
      listEl.innerHTML = tables.length ? '' : `<div class="empty-state"><p>No custom tables yet. Random encounter tables, rumor mills, tavern menus, critical fumble tables: anything you roll on repeatedly.</p></div>`;
      for (const t of tables.sort((a, b) => a.name.localeCompare(b.name))) {
        const card = el(`<div class="card">
          <div class="row" style="align-items:center">
            <h2 style="margin:0">${esc(t.name)}</h2>
            <span class="muted small">${t.rows.length} entries</span>
            ${t.source ? `<span class="pill">${esc(t.source)}</span>` : ''}
            <span style="margin-left:auto;white-space:nowrap">
              <button class="btn primary small" data-roll>Roll</button>
              <button class="btn small" data-edit>Edit</button>
              <button class="btn small danger" data-del>Del</button>
            </span>
          </div>
        </div>`);
        card.querySelector('[data-roll]').addEventListener('click', () => {
          const row = rollTable(t.rows);
          history.add({ table: t.name, text: row.text });
          resultEl.innerHTML = `<div class="card"><h2>${esc(t.name)}</h2><p style="font-size:1.2rem">${esc(row.text)}</p></div>`;
          resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
        card.querySelector('[data-edit]').addEventListener('click', () => editTable(t));
        card.querySelector('[data-del]').addEventListener('click', () =>
          confirmDialog(`Delete table "${t.name}"?`, async () => { await dbDelete('customTables', t.id); draw(); }));
        listEl.append(card);
      }
    };

    // ---- import from the Auto Roll Tables catalog ----
    const importDialog = async () => {
      const catalog = await loadTables('art-catalog');
      const categories = [...new Set(catalog.map(t => t.category))].sort();
      const selected = new Set();

      const body = el(`<div>
        <div class="row mb">
          <div class="grow" id="im-search"></div>
          <label class="field"><span>Category</span>
            <select id="im-cat"><option value="">All</option>${categories.map(c => `<option>${esc(c)}</option>`).join('')}</select>
          </label>
        </div>
        <p class="small muted" id="im-count"></p>
        <div id="im-list" style="max-height:46vh;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm)"></div>
        <p class="small faint mt">Tables from <a href="https://autorolltables.github.io" target="_blank" rel="noopener">Auto Roll Tables</a>. Imported copies are yours to edit.</p>
      </div>`);

      const listEl2 = body.querySelector('#im-list');
      const countEl = body.querySelector('#im-count');
      let query = '';

      const draw2 = () => {
        const cat = body.querySelector('#im-cat').value;
        const matches = catalog.filter(t =>
          (!cat || t.category === cat) &&
          (!query || t.name.toLowerCase().includes(query) || t.category.toLowerCase().includes(query)));
        const shown = matches.slice(0, 300);
        countEl.textContent = `${matches.length.toLocaleString()} tables${matches.length > shown.length ? `, showing ${shown.length}` : ''}` +
          (selected.size ? ` - ${selected.size} selected` : '');
        listEl2.innerHTML = '';
        for (const t of shown) {
          const row = el(`<label class="check" style="display:flex;gap:8px;padding:6px 10px;border-bottom:1px solid var(--border);cursor:pointer">
            <input type="checkbox" ${selected.has(t.id) ? 'checked' : ''}>
            <span style="flex:1"><b>${esc(t.name)}</b> <span class="small faint">${esc(t.die)} - ${t.rows.length} entries</span></span>
            <span class="pill">${esc(t.category)}</span>
          </label>`);
          row.querySelector('input').addEventListener('change', (e) => {
            if (e.target.checked) selected.add(t.id); else selected.delete(t.id);
            countEl.textContent = `${matches.length.toLocaleString()} tables${matches.length > shown.length ? `, showing ${shown.length}` : ''}` +
              (selected.size ? ` - ${selected.size} selected` : '');
          });
          listEl2.append(row);
        }
        if (!shown.length) listEl2.innerHTML = '<p class="faint small center" style="padding:20px">No tables match.</p>';
      };

      body.querySelector('#im-search').append(searchInput('Search 2,000+ tables...', (q) => { query = q; draw2(); }));
      body.querySelector('#im-cat').addEventListener('change', draw2);
      draw2();

      modal('Import tables', body, {
        wide: true,
        actions: [
          { label: 'Cancel', onClick: () => {} },
          {
            label: 'Import selected', class: 'primary',
            onClick: () => {
              if (!selected.size) { toast('Nothing selected', 'danger'); return false; }
              const chosen = catalog.filter(t => selected.has(t.id));
              Promise.all(chosen.map(t => dbPut('customTables', {
                name: t.name,
                rows: t.rows.map(text => ({ weight: 1, text })),
                source: 'Auto Roll Tables',
                campaignId: activeCampaignId(),
              }))).then(() => {
                toast(`Imported ${chosen.length} table${chosen.length === 1 ? '' : 's'}`);
                draw();
              });
            },
          },
        ],
      });
    };

    container.querySelector('#ct-new').addEventListener('click', () => editTable(null));
    container.querySelector('#ct-import').addEventListener('click', importDialog);
    await draw();
  },
};
