// Custom Random Tables: build, roll, import/export your own weighted tables.
import { dbAll, dbPut, dbDelete, activeCampaignId } from '../store.js';
import { el, esc, toast, confirmDialog, modal, promptDialog } from '../components/ui.js';
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
        <span class="muted small" style="align-self:center">Custom tables also appear in the Random Encounters tool. Want hundreds of ready-made tables? Try <a href="https://autorolltables.github.io" target="_blank" rel="noopener">Auto Roll Tables</a>.</span>
      </div>
      <div id="ct-list"></div>
      <div id="ct-result"></div>`;

    const listEl = container.querySelector('#ct-list');
    const resultEl = container.querySelector('#ct-result');

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
            <span style="margin-left:auto;white-space:nowrap">
              <button class="btn primary small" data-roll>Roll</button>
              <button class="btn small" data-edit>Edit</button>
              <button class="btn small danger" data-del>Del</button>
            </span>
          </div>
        </div>`);
        card.querySelector('[data-roll]').addEventListener('click', () => {
          const row = rollTable(t.rows);
          resultEl.innerHTML = `<div class="card"><h2>${esc(t.name)}</h2><p style="font-size:1.2rem">${esc(row.text)}</p></div>`;
          resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
        card.querySelector('[data-edit]').addEventListener('click', () => editTable(t));
        card.querySelector('[data-del]').addEventListener('click', () =>
          confirmDialog(`Delete table "${t.name}"?`, async () => { await dbDelete('customTables', t.id); draw(); }));
        listEl.append(card);
      }
    };

    container.querySelector('#ct-new').addEventListener('click', () => editTable(null));
    await draw();
  },
};
