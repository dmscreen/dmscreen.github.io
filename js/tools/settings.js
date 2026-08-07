// Settings: theme, mobile tabs, campaigns, backup and restore.
import { getPrefs, setPref, exportAll, exportCampaign, importAll, dbAll, dbPut, dbDelete, activeCampaignId, setActiveCampaign, STORES } from '../store.js';
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
          <label class="field mt"><span>Left nav switching</span>
            <select id="st-navmode">
              <option value="hover" ${prefs.navHover !== false ? 'selected' : ''}>Hover (default)</option>
              <option value="click" ${prefs.navHover === false ? 'selected' : ''}>Click</option>
            </select>
          </label>
          <p class="small faint">With hover, resting the pointer on a sidebar entry switches to it without a click.</p>
        </div>
        <div class="card">
          <h2>Campaigns</h2>
          <div id="st-campaigns"></div>
        </div>
        <div class="card">
          <h2>Backup & transfer</h2>
          <p class="small muted">Everything lives in this browser. Export a backup file regularly, especially on iPhones and iPads, where the browser can evict site data that hasn't been used in a while.</p>
          <p class="small muted"><b>Export campaign</b> saves just the active campaign: party, encounters, combat state, NPCs, notes, shops, custom tables, calendar, and every generator's history. Import it on another device to pick up where you left off. <b>Export everything</b> saves all campaigns plus preferences.</p>
          <div class="row mt">
            <button class="btn primary" id="st-export-campaign">Export campaign</button>
            <button class="btn" id="st-export">Export everything</button>
            <button class="btn" id="st-import">Import...</button>
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

    container.querySelector('#st-navmode').addEventListener('change', (e) => {
      setPref('navHover', e.target.value === 'hover');
      toast(e.target.value === 'hover' ? 'Sidebar switches on hover' : 'Sidebar switches on click');
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

    const download = (dump, filename) => {
      const blob = new Blob([JSON.stringify(dump, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    };
    const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'campaign';
    const today = () => new Date().toISOString().slice(0, 10);

    container.querySelector('#st-export').addEventListener('click', async () => {
      download(await exportAll(), `dm-screen-backup-${today()}.json`);
      toast('Full backup downloaded');
    });

    container.querySelector('#st-export-campaign').addEventListener('click', async () => {
      const dump = await exportCampaign();
      download(dump, `dm-screen-campaign-${slugify(dump.campaign.name)}-${today()}.json`);
      toast(`Campaign "${dump.campaign.name}" exported`);
    });

    const fileInput = container.querySelector('#st-file');
    container.querySelector('#st-import').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        const dump = JSON.parse(await file.text());
        const msg = dump.type === 'campaign'
          ? `Import campaign "${dump.campaign?.name || '?'}"? It becomes the active campaign; if it already exists here, its records are updated in place.`
          : 'Import this full backup? Existing records with the same ids will be overwritten; everything else is kept.';
        confirmDialog(msg, async () => {
          await importAll(dump);
          toast(dump.type === 'campaign' ? 'Campaign imported' : 'Backup imported');
          setTimeout(() => location.reload(), 600);
        }, { label: 'Import', danger: false });
      } catch (err) {
        toast(`Import failed: ${err.message}`, 'danger');
      }
      fileInput.value = '';
    });
  },
};
