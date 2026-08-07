// Settings: theme, mobile tabs, campaigns, backup and restore.
import { getPrefs, setPref, exportAll, importAll, dbAll, dbPut, dbDelete, activeCampaignId, setActiveCampaign, STORES } from '../store.js';
import { el, esc, toast, confirmDialog, promptDialog } from '../components/ui.js';

export default {
  id: 'settings', title: 'Settings', shortTitle: 'Settings', group: 'More', icon: 'gear',
  subtitle: 'Theme, campaigns, and your data',

  async render(container) {
    const prefs = getPrefs();

    container.innerHTML = `
      <div class="grid-2">
        <div class="card">
          <h2>Appearance</h2>
          <label class="field"><span>Theme</span>
            <select id="st-theme">
              <option value="dark" ${prefs.theme !== 'light' ? 'selected' : ''}>Dark (default)</option>
              <option value="light" ${prefs.theme === 'light' ? 'selected' : ''}>Light</option>
            </select>
          </label>
        </div>
        <div class="card">
          <h2>Campaigns</h2>
          <div id="st-campaigns"></div>
        </div>
        <div class="card">
          <h2>Backup</h2>
          <p class="small muted">Everything lives in this browser. Export a backup file regularly, especially on iPhones and iPads, where the browser can evict site data that hasn't been used in a while.</p>
          <div class="row mt">
            <button class="btn primary" id="st-export">Export backup</button>
            <button class="btn" id="st-import">Import backup...</button>
            <input type="file" id="st-file" accept=".json,application/json" style="display:none">
          </div>
        </div>
        <div class="card">
          <h2>About your data</h2>
          <p class="small muted">No account, no server, no tracking. Campaign data is stored with IndexedDB and preferences with localStorage, on this device only. The app works offline once loaded.</p>
        </div>
      </div>`;

    container.querySelector('#st-theme').addEventListener('change', (e) => {
      setPref('theme', e.target.value);
      document.documentElement.dataset.theme = e.target.value;
    });

    const drawCampaigns = async () => {
      const all = await dbAll('campaigns');
      const active = activeCampaignId();
      const box = container.querySelector('#st-campaigns');
      box.innerHTML = '';
      for (const c of all) {
        const row = el(`<div class="row" style="align-items:center;padding:4px 0">
          <b>${esc(c.name)}</b>${c.id === active ? '<span class="pill accent">active</span>' : ''}
          <span style="margin-left:auto;white-space:nowrap">
            <button class="btn small" data-rename>Rename</button>
            ${all.length > 1 ? '<button class="btn small danger" data-del>Delete</button>' : ''}
          </span></div>`);
        row.querySelector('[data-rename]').addEventListener('click', () => {
          promptDialog('Rename campaign', [{ key: 'name', label: 'Name', value: c.name }], async ({ name }) => {
            if (!name.trim()) return false;
            c.name = name.trim();
            await dbPut('campaigns', c);
            location.reload();
          });
        });
        row.querySelector('[data-del]')?.addEventListener('click', () => {
          confirmDialog(`Delete campaign "${c.name}" and ALL its data (party, notes, encounters, everything)? Export a backup first if unsure.`, async () => {
            for (const store of STORES) {
              if (store === 'campaigns') continue;
              const records = await dbAll(store, c.id);
              for (const r of records) await dbDelete(store, r.id);
            }
            await dbDelete('campaigns', c.id);
            if (activeCampaignId() === c.id) {
              const rest = await dbAll('campaigns');
              await setActiveCampaign(rest[0].id);
            }
            location.reload();
          });
        });
        box.append(row);
      }
    };
    drawCampaigns();

    container.querySelector('#st-export').addEventListener('click', async () => {
      const dump = await exportAll();
      const blob = new Blob([JSON.stringify(dump, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `dm-screen-kit-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Backup downloaded');
    });

    const fileInput = container.querySelector('#st-file');
    container.querySelector('#st-import').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        const dump = JSON.parse(await file.text());
        confirmDialog('Import this backup? Existing records with the same ids will be overwritten; everything else is kept.', async () => {
          await importAll(dump);
          toast('Backup imported');
          setTimeout(() => location.reload(), 600);
        }, { label: 'Import', danger: false });
      } catch (err) {
        toast(`Import failed: ${err.message}`, 'danger');
      }
      fileInput.value = '';
    });
  },
};
