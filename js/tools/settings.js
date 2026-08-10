// Settings: theme, mobile tabs, campaigns, backup and restore.
import { getPrefs, setPref, exportAll, exportCampaign, importAll, dbAll, dbPut, dbDelete, activeCampaignId, setActiveCampaign, STORES, storageStatus, requestPersistence } from '../store.js';
import { el, esc, toast, confirmDialog, promptDialog, toggleRow } from '../components/ui.js';

export default {
  id: 'settings', title: 'Settings', shortTitle: 'Settings', group: 'More', icon: 'gear',
  subtitle: 'Theme, campaigns, and your data',

  async render(container) {
    const prefs = getPrefs();

    container.innerHTML = `
      <div class="grid-2">
        <div class="card">
          <h2>Appearance</h2>
          <div id="st-theme-row"></div>
          <div id="st-navmode-row"></div>
          <p class="small faint">With hover, resting the pointer on a sidebar entry or a page's tab switches to it without a click.</p>
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
          <h2>Storage health</h2>
          <div id="st-storage"></div>
        </div>
        <div class="card">
          <h2>About your data</h2>
          <p class="small muted">No account, no server, no tracking. Campaign data is stored with IndexedDB and preferences with localStorage, on this device only. The app works offline once loaded.</p>
        </div>
      </div>`;

    const theme = toggleRow('Theme', [
      { value: 'dark', label: 'Dark', icon: 'moon' },
      { value: 'light', label: 'Light', icon: 'sun' },
    ], prefs.theme === 'light' ? 'light' : 'dark', (v) => {
      setPref('theme', v);
      document.documentElement.dataset.theme = v;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.content = v === 'dark' ? '#191512' : '#f3eee5';
    }, { segmented: true });
    container.querySelector('#st-theme-row').append(theme.el);

    const navMode = toggleRow('Navigation switching', [
      { value: 'hover', label: 'Hover', icon: 'hover' },
      { value: 'click', label: 'Click', icon: 'cursor' },
    ], prefs.navHover === false ? 'click' : 'hover', (v) => {
      setPref('navHover', v === 'hover');
      toast(v === 'hover' ? 'Navigation switches on hover' : 'Navigation switches on click');
    }, { segmented: true });
    container.querySelector('#st-navmode-row').append(navMode.el);

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

    const fmtBytes = (n) => {
      if (n == null) return 'unknown';
      if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
      return `${(n / 1024 / 1024).toFixed(1)} MB`;
    };

    const drawStorage = async () => {
      const box = container.querySelector('#st-storage');
      if (!box) return;
      const s = await storageStatus();
      const last = getPrefs().lastBackup;
      box.innerHTML = `
        <p class="small">
          <span class="pill ${s.persisted ? 'success' : ''}">${s.persisted ? 'Persistent' : 'Best effort'}</span>
          <span class="muted">${s.persisted
            ? 'This browser has been asked to keep your data and will not evict it to reclaim space.'
            : 'The browser may evict this site\'s data if it needs space, or after a long absence on iOS.'}</span>
        </p>
        <p class="small muted">Using ${fmtBytes(s.usage)}${s.quota ? ` of about ${fmtBytes(s.quota)} available` : ''}.</p>
        <p class="small ${last ? 'muted' : ''}">${last
          ? `Last backup exported ${new Date(last).toLocaleString()}.`
          : '<b>No backup exported yet.</b> Export one below so a lost browser profile cannot take your campaign with it.'}</p>
        ${s.persisted ? '' : '<button class="btn small" id="st-persist">Ask browser to keep my data</button>'}
        <p class="small faint mt">Code updates to the site never clear this data; it lives in your browser, keyed to this address, not in the app files.</p>`;
      box.querySelector('#st-persist')?.addEventListener('click', async () => {
        const ok = await requestPersistence();
        toast(ok ? 'Browser will keep your data' : 'The browser declined; keep exporting backups');
        drawStorage();
      });
    };
    drawStorage();

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
      setPref('lastBackup', Date.now());
      drawStorage();
      toast('Full backup downloaded');
    });

    container.querySelector('#st-export-campaign').addEventListener('click', async () => {
      const dump = await exportCampaign();
      download(dump, `dm-screen-campaign-${slugify(dump.campaign.name)}-${today()}.json`);
      setPref('lastBackup', Date.now());
      drawStorage();
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
