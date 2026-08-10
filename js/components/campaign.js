// Campaign switcher, shared by the desktop sidebar and the mobile More page.
import { dbPut, ensureCampaign, activeCampaignId, setActiveCampaign } from '../store.js';
import { el, esc, toast, promptDialog } from './ui.js';

// Returns a <select> listing every campaign plus a "new campaign" entry.
export async function campaignSelect() {
  const all = await ensureCampaign();
  const active = activeCampaignId();
  const select = el(`<select aria-label="Campaign">${
    all.map(c => `<option value="${c.id}" ${c.id === active ? 'selected' : ''}>${esc(c.name)}</option>`).join('')
  }<option value="__new">+ New campaign...</option></select>`);

  select.addEventListener('change', async () => {
    if (select.value === '__new') {
      promptDialog('New campaign', [{ key: 'name', label: 'Campaign name', value: '' }], async ({ name }) => {
        if (!name.trim()) return false;
        const c = await dbPut('campaigns', { name: name.trim(), created: Date.now() });
        await setActiveCampaign(c.id);
        toast(`Campaign "${name.trim()}" created`);
      });
      select.value = active;
    } else {
      await setActiveCampaign(select.value);
    }
  });
  return select;
}

// Card version for the More page; the sidebar (and its switcher) is hidden on
// mobile, so this is the only way to change campaigns there.
export async function campaignCard() {
  const card = el(`<div class="card mobile-only">
    <h2>Campaign</h2>
    <label class="field"><span>Active campaign</span></label>
    <p class="small faint mt">Everything you track is stored per campaign. Manage or delete campaigns in Settings.</p>
  </div>`);
  card.querySelector('label.field').append(await campaignSelect());
  return card;
}
