// Shop Generator: inventory with prices, saved automatically and editable.
import { loadTables } from '../srd.js';
import { dbAll, dbPut, dbDelete, activeCampaignId, getState, setState } from '../store.js';
import { el, esc, toast, confirmDialog, toggleRow } from '../components/ui.js';
import { pick } from '../dice.js';
import { shopName, personName } from './names.js';

export default {
  id: 'shops', title: 'Shop Generator', shortTitle: 'Shops', group: 'Generators', icon: 'store',
  subtitle: 'Stocked shelves and a keeper to haggle with',

  async render(container) {
    const [shopData, names] = await Promise.all([loadTables('shops'), loadTables('names')]);
    const types = Object.keys(shopData.types);
    const sizes = Object.keys(shopData.sizes);

    container.innerHTML = `
      <div class="card">
        <div id="sh-type-row"></div>
        <div id="sh-size-row"></div>
        <button class="btn primary" id="sh-gen">Generate shop</button>
      </div>
      <div class="grid-2">
        <div id="sh-current"></div>
        <div class="card" style="margin-bottom:0"><h2>Saved shops</h2><div id="sh-saved"></div></div>
      </div>`;

    const type = toggleRow('Shop type', types, types[0], null);
    container.querySelector('#sh-type-row').append(type.el);
    const size = toggleRow('Settlement', sizes, sizes.includes('Town') ? 'Town' : sizes[0], null);
    container.querySelector('#sh-size-row').append(size.el);

    const currentEl = container.querySelector('#sh-current');

    // Which saved shop is open right now; survives tab switches and reloads.
    const rememberOpen = (id) => setState('shopOpenId', id || null);

    const renderShop = (shop) => {
      currentEl.innerHTML = '';
      if (!shop) return;
      const card = el(`<div class="card" style="margin-bottom:0">
        <h2>${esc(shop.name)}</h2>
        <p class="muted">${esc(shop.type)} in a ${esc(shop.size).toLowerCase()}. Keeper: <b>${esc(shop.keeper)}</b>.</p>
        <p class="small faint">${esc(shop.note)}</p>
        <div class="table-scroll"><table class="data">
          <thead><tr><th>Item</th><th>Price</th><th></th></tr></thead>
          <tbody></tbody>
        </table></div>
        <p class="small faint mt">Saved automatically. Marking an item sold updates the saved shop.</p>
      </div>`);
      const tbody = card.querySelector('tbody');
      const drawRows = () => {
        tbody.innerHTML = '';
        shop.items.forEach((item, i) => {
          const tr = el(`<tr><td>${esc(item.name)}${item.flavor ? ' <span class="pill">odd</span>' : ''}</td><td>${esc(item.price)}</td>
            <td style="text-align:right"><button class="btn small danger" title="Sold / remove">Sold</button></td></tr>`);
          tr.querySelector('button').addEventListener('click', async () => {
            shop.items.splice(i, 1);
            await dbPut('shops', shop);
            drawRows();
            drawSaved();
          });
          tbody.append(tr);
        });
      };
      drawRows();
      currentEl.append(card);
    };

    const gen = async () => {
      const conf = shopData.types[type.get()];
      const sizeConf = shopData.sizes[size.get()];
      const [min, max] = sizeConf.stock;
      const count = min + Math.floor(Math.random() * (max - min + 1));
      const pool = [...conf.items].sort(() => Math.random() - 0.5).slice(0, count);
      const items = pool.map(i => ({ ...i }));
      if (Math.random() < 0.7) items.push({ ...pick(shopData.flavor), flavor: true });
      // saved to the campaign as soon as it's generated
      const shop = await dbPut('shops', {
        name: shopName(names), type: type.get(), size: size.get(), note: sizeConf.note,
        keeper: personName(names), items, campaignId: activeCampaignId(),
      });
      await rememberOpen(shop.id);
      toast(`${shop.name} generated and saved`);
      renderShop(shop);
      drawSaved();
    };

    const drawSaved = async () => {
      const saved = await dbAll('shops', activeCampaignId());
      const openId = await getState('shopOpenId');
      const box = container.querySelector('#sh-saved');
      box.innerHTML = saved.length ? '' : '<p class="faint small">No shops yet. Generate one and it is saved here automatically.</p>';
      for (const s of saved.sort((a, b) => b.updated - a.updated)) {
        const row = el(`<div class="row" style="align-items:center;padding:4px 0">
          <b>${esc(s.name)}</b>${s.id === openId ? '<span class="pill accent">open</span>' : ''}
          <span class="pill">${esc(s.type)}</span>
          <span class="muted small">${s.items.length} items</span>
          <span style="margin-left:auto;white-space:nowrap">
            <button class="btn small" data-open>Open</button>
            <button class="btn small danger" data-del>Del</button>
          </span></div>`);
        row.querySelector('[data-open]').addEventListener('click', async () => {
          await rememberOpen(s.id);
          renderShop(s);
          drawSaved();
        });
        row.querySelector('[data-del]').addEventListener('click', () =>
          confirmDialog(`Delete ${s.name}?`, async () => {
            await dbDelete('shops', s.id);
            if ((await getState('shopOpenId')) === s.id) { await rememberOpen(null); currentEl.innerHTML = ''; }
            drawSaved();
          }));
        box.append(row);
      }
    };

    container.querySelector('#sh-gen').addEventListener('click', gen);

    // reopen whatever shop was last being viewed
    const openId = await getState('shopOpenId');
    if (openId) {
      const rec = (await dbAll('shops', activeCampaignId())).find(s => s.id === openId);
      if (rec) renderShop(rec);
    }
    drawSaved();
  },
};
