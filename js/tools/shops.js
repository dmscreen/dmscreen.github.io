// Shop Generator: inventory with prices, editable and savable.
import { loadTables } from '../srd.js';
import { dbAll, dbPut, dbDelete, activeCampaignId, getState, setState } from '../store.js';
import { el, esc, toast, confirmDialog } from '../components/ui.js';
import { pick } from '../dice.js';
import { shopName, personName } from './names.js';

export default {
  id: 'shops', title: 'Shop Generator', shortTitle: 'Shops', group: 'Generators', icon: 'store',
  subtitle: 'Stocked shelves and a keeper to haggle with',

  async render(container) {
    const [shopData, names] = await Promise.all([loadTables('shops'), loadTables('names')]);
    const types = Object.keys(shopData.types);
    const sizes = Object.keys(shopData.sizes);

    let selType = types[0];
    let selSize = sizes.includes('Town') ? 'Town' : sizes[0];

    container.innerHTML = `
      <div class="card">
        <div class="field"><span>Shop type</span>
          <div class="row" id="sh-type" style="gap:6px;margin:4px 0 12px">
            ${types.map(t => `<button class="btn small" data-val="${esc(t)}">${esc(t)}</button>`).join('')}
          </div>
        </div>
        <div class="field"><span>Settlement</span>
          <div class="row" id="sh-size" style="gap:6px;margin:4px 0 12px">
            ${sizes.map(s => `<button class="btn small" data-val="${esc(s)}">${esc(s)}</button>`).join('')}
          </div>
        </div>
        <button class="btn primary" id="sh-gen">Generate shop</button>
      </div>
      <div id="sh-current"></div>
      <div class="card"><h2>Saved shops</h2><div id="sh-saved"></div></div>`;

    const currentEl = container.querySelector('#sh-current');

    // The working shop persists per campaign, so it survives tab switches and reloads.
    const persistCurrent = (shop, savedId) => setState('shopCurrent', shop ? { shop, savedId } : null);

    const renderShop = (shop, savedRecord = null) => {
      currentEl.innerHTML = '';
      persistCurrent(shop, savedRecord?.id || null);
      const card = el(`<div class="card">
        <h2>${esc(shop.name)}</h2>
        <p class="muted">${esc(shop.type)} in a ${esc(shop.size).toLowerCase()}. Keeper: <b>${esc(shop.keeper)}</b>.</p>
        <p class="small faint">${esc(shop.note)}</p>
        <div class="table-scroll"><table class="data">
          <thead><tr><th>Item</th><th>Price</th><th></th></tr></thead>
          <tbody></tbody>
        </table></div>
        <div class="row mt">
          <button class="btn primary" data-save>${savedRecord ? 'Update saved shop' : 'Save shop'}</button>
          <button class="btn danger" data-discard>Discard</button>
        </div>
      </div>`);
      const tbody = card.querySelector('tbody');
      const drawRows = () => {
        tbody.innerHTML = '';
        shop.items.forEach((item, i) => {
          const tr = el(`<tr><td>${esc(item.name)}${item.flavor ? ' <span class="pill">odd</span>' : ''}</td><td>${esc(item.price)}</td>
            <td style="text-align:right"><button class="btn small danger" title="Sold / remove">Sold</button></td></tr>`);
          tr.querySelector('button').addEventListener('click', () => {
            shop.items.splice(i, 1);
            persistCurrent(shop, savedRecord?.id || null);
            drawRows();
          });
          tbody.append(tr);
        });
      };
      drawRows();
      card.querySelector('[data-save]').addEventListener('click', async () => {
        const rec = await dbPut('shops', { ...(savedRecord || {}), ...shop, campaignId: activeCampaignId() });
        toast('Shop saved');
        renderShop(shop, rec);
        drawSaved();
      });
      card.querySelector('[data-discard]').addEventListener('click', async () => {
        await persistCurrent(null);
        currentEl.innerHTML = '';
      });
      currentEl.append(card);
    };

    // single-select toggle rows for shop type and settlement size
    const wireToggles = (rowId, getVal, setVal) => {
      const row = container.querySelector(rowId);
      const paint = () => row.querySelectorAll('.btn').forEach(b =>
        b.classList.toggle('primary', b.dataset.val === getVal()));
      row.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn');
        if (!btn) return;
        setVal(btn.dataset.val);
        paint();
      });
      paint();
    };
    wireToggles('#sh-type', () => selType, (v) => { selType = v; });
    wireToggles('#sh-size', () => selSize, (v) => { selSize = v; });

    const gen = () => {
      const type = selType;
      const size = selSize;
      const conf = shopData.types[type];
      const sizeConf = shopData.sizes[size];
      const [min, max] = sizeConf.stock;
      const count = min + Math.floor(Math.random() * (max - min + 1));
      const pool = [...conf.items].sort(() => Math.random() - 0.5).slice(0, count);
      const items = pool.map(i => ({ ...i }));
      if (Math.random() < 0.7) items.push({ ...pick(shopData.flavor), flavor: true });
      renderShop({
        name: shopName(names), type, size, note: sizeConf.note,
        keeper: personName(names), items,
      });
    };

    const drawSaved = async () => {
      const saved = await dbAll('shops', activeCampaignId());
      const box = container.querySelector('#sh-saved');
      box.innerHTML = saved.length ? '' : '<p class="faint small">No saved shops. Save one and party purchases will persist.</p>';
      for (const s of saved.sort((a, b) => b.updated - a.updated)) {
        const row = el(`<div class="row" style="align-items:center;padding:4px 0">
          <b>${esc(s.name)}</b><span class="pill">${esc(s.type)}</span>
          <span class="muted small">${s.items.length} items</span>
          <span style="margin-left:auto;white-space:nowrap">
            <button class="btn small" data-open>Open</button>
            <button class="btn small danger" data-del>Del</button>
          </span></div>`);
        row.querySelector('[data-open]').addEventListener('click', () => renderShop(structuredClone(s), s));
        row.querySelector('[data-del]').addEventListener('click', () =>
          confirmDialog(`Delete ${s.name}?`, async () => { await dbDelete('shops', s.id); drawSaved(); }));
        box.append(row);
      }
    };

    container.querySelector('#sh-gen').addEventListener('click', gen);

    // restore the working shop from the last visit, if any
    const prev = await getState('shopCurrent');
    if (prev?.shop) {
      const savedRec = prev.savedId ? (await dbAll('shops', activeCampaignId())).find(s => s.id === prev.savedId) : null;
      renderShop(prev.shop, savedRec || null);
    }
    drawSaved();
  },
};
