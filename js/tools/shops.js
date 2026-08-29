// Shop Generator: a stocked shelf with counts on it, saved automatically and
// editable. A shop is a thing a party comes back to, so it keeps its stock
// between visits: buying three torches leaves the rest on the shelf, and a
// day's trade adds some things and clears others out.
import { loadTables } from '../srd.js';
import { dbAll, dbPut, dbDelete, activeCampaignId, getState, setState } from '../store.js';
import { el, esc, toast, confirmDialog, toggleRow } from '../components/ui.js';
import { pick } from '../dice.js';
import { shopName, personName } from './names.js';

// How many of a thing a shop keeps on the shelf. A shop has a lot of
// candles and one breastplate, and price is the best guess at which is
// which without hand-tagging two hundred items.
const priceInCopper = (price) => {
  const m = /([\d,.]+)\s*(cp|sp|ep|gp|pp)/i.exec(String(price || ''));
  if (!m) return 100;
  const mult = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 }[m[2].toLowerCase()] || 100;
  return parseFloat(m[1].replace(/,/g, '')) * mult;
};
const stockFor = (item, depth = 1) => {
  const cp = priceInCopper(item.price);
  const band = cp <= 10 ? [8, 24] : cp <= 100 ? [4, 12] : cp <= 1000 ? [2, 6] : cp <= 10000 ? [1, 3] : [1, 1];
  const n = band[0] + Math.floor(Math.random() * (band[1] - band[0] + 1));
  // A bigger place stocks deeper as well as wider. It has to: most shop
  // types have about a dozen lines to their name, so a metropolis cannot
  // simply have more of them than exist.
  return Math.max(1, Math.round(n * depth));
};

export default {
  id: 'shops', title: 'Shop Generator', shortTitle: 'Shops', group: 'Generators', icon: 'store',
  subtitle: 'Stocked shelves, counted, that stay stocked between visits',

  async render(container) {
    const [shopData, names] = await Promise.all([loadTables('shops'), loadTables('names')]);
    // commonest first: a village has a general store and a baker long before
    // it has an alchemist
    const types = Object.keys(shopData.types)
      .sort((a, b) => (shopData.types[a].rank || 99) - (shopData.types[b].rank || 99));
    const sizes = Object.keys(shopData.sizes);

    container.innerHTML = `
      <div class="card">
        <div id="sh-type-row"></div>
        <div id="sh-size-row"></div>
        <button class="btn primary" id="sh-gen">Generate shop</button>
      </div>
      <div class="shop-layout">
        <div class="shop-list card" id="sh-saved-wrap">
          <h3>Saved shops</h3>
          <div id="sh-saved"></div>
        </div>
        <div id="sh-current"></div>
      </div>`;

    const type = toggleRow('Shop type', types, types[0], null, { segmented: true });
    container.querySelector('#sh-type-row').append(type.el);
    const size = toggleRow('Settlement', sizes, sizes.includes('Town') ? 'Town' : sizes[0], null, { segmented: true });
    container.querySelector('#sh-size-row').append(size.el);

    const currentEl = container.querySelector('#sh-current');

    // Which saved shop is open right now; survives tab switches and reloads.
    const rememberOpen = (id) => setState('shopOpenId', id || null);

    // Older shops were saved as a bare list with no counts. Give them one
    // rather than showing a blank column.
    const withStock = (shop) => {
      let changed = false;
      for (const it of shop.items) {
        if (typeof it.qty !== 'number') { it.qty = stockFor(it); changed = true; }
      }
      return changed;
    };

    const renderShop = async (shop) => {
      currentEl.innerHTML = '';
      if (!shop) return;
      if (withStock(shop)) await dbPut('shops', shop);

      const card = el(`<div class="card" style="margin-bottom:0">
        <h2>${esc(shop.name)}</h2>
        <p class="muted">${esc(shop.type)} in a ${esc(shop.size).toLowerCase()}.</p>
        <p class="small faint">${esc(shop.note)}</p>
        <div class="row mb">
          <button class="btn small" data-refresh title="A day of trade: some stock sells through, some is restocked, and something new comes in">Refresh items</button>
          <input type="search" class="shop-filter" data-filter placeholder="Filter the shelf..." aria-label="Filter items">
          <span class="small faint" data-summary></span>
        </div>
        <div class="table-scroll"><table class="data">
          <thead><tr><th>Item</th><th>Price</th><th style="text-align:center">In stock</th><th></th></tr></thead>
          <tbody></tbody>
        </table></div>
        <p class="small faint mt">Saved as you go. Sell an item with the minus, or clear the shelf with Sold.</p>
        <div class="row mt shop-danger">
          <button class="btn small danger" data-del>Delete shop</button>
        </div>
      </div>`);

      const tbody = card.querySelector('tbody');
      const summary = card.querySelector('[data-summary]');
      const save = () => dbPut('shops', shop);

      // What the filter box has left. The index is into the shop's own list,
      // so selling one row still removes the right line when the shelf is
      // filtered down to three of thirty.
      const filterEl = card.querySelector('[data-filter]');
      const visible = () => {
        const term = filterEl.value.trim().toLowerCase();
        return shop.items.map((item, i) => ({ item, i }))
          .filter(({ item }) => !term || item.name.toLowerCase().includes(term));
      };

      const drawRows = () => {
        tbody.innerHTML = '';
        const rows = visible();
        const onShelf = shop.items.reduce((a, i) => a + (i.qty || 0), 0);
        summary.textContent = rows.length === shop.items.length
          ? `${shop.items.length} lines, ${onShelf} items on the shelf`
          : `${rows.length} of ${shop.items.length} lines shown`;
        if (!shop.items.length) {
          tbody.innerHTML = '<tr><td colspan="4" class="faint">Shelves bare. Refresh items to see what comes in.</td></tr>';
          return;
        }
        if (!rows.length) {
          tbody.innerHTML = '<tr><td colspan="4" class="faint">Nothing on the shelf matches that.</td></tr>';
          return;
        }
        rows.forEach(({ item, i }) => {
          const tr = el(`<tr>
            <td>${esc(item.name)}${item.flavor ? ' <span class="pill">odd</span>' : ''}</td>
            <td>${esc(item.price)}</td>
            <td>
              <span class="qty-cell">
                <button class="btn small" data-less title="One sold">&minus;</button>
                <input type="number" class="qty-num" min="0" value="${item.qty}" aria-label="In stock">
                <button class="btn small" data-more title="One more in">+</button>
              </span>
            </td>
            <td style="text-align:right"><button class="btn small danger" data-sold title="Sold out; take the line off the shelf">Sold</button></td>
          </tr>`);
          const num = tr.querySelector('.qty-num');
          const setQty = async (n) => {
            item.qty = Math.max(0, n);
            num.value = item.qty;
            await save();
            const shown = visible().length;
            summary.textContent = shown === shop.items.length
              ? `${shop.items.length} lines, ${shop.items.reduce((a, x) => a + (x.qty || 0), 0)} items on the shelf`
              : `${shown} of ${shop.items.length} lines shown`;
            drawSaved();
          };
          tr.querySelector('[data-less]').addEventListener('click', () => setQty((item.qty || 0) - 1));
          tr.querySelector('[data-more]').addEventListener('click', () => setQty((item.qty || 0) + 1));
          num.addEventListener('change', () => setQty(parseInt(num.value, 10) || 0));
          tr.querySelector('[data-sold]').addEventListener('click', async () => {
            shop.items.splice(i, 1);
            await save();
            drawRows();
            drawSaved();
          });
          tbody.append(tr);
        });
      };

      // A day's trade. Some lines sell down or out, the ones that are left
      // are topped up a little, and a couple of things arrive that were not
      // there yesterday.
      card.querySelector('[data-refresh]').addEventListener('click', async () => {
        const conf = shopData.types[shop.type] || { items: [] };
        const [, maxLines] = (shopData.sizes[shop.size] || { stock: [6, 16] }).stock;
        const kept = [];
        let soldOut = 0;
        for (const it of shop.items) {
          // a fifth to three fifths of what was on the shelf goes over the
          // counter, and at least one of anything the shop actually had
          const have = it.qty || 0;
          const sold = have ? Math.max(1, Math.round(have * (0.2 + Math.random() * 0.4))) : 0;
          let left = Math.max(0, have - sold);
          // a few lines get topped up from whatever the cart brought
          if (left > 0 && Math.random() < 0.3) left += 1 + Math.floor(Math.random() * 3);
          if (left <= 0) { soldOut++; continue; }             // cleared off the shelf
          kept.push({ ...it, qty: left });
        }
        const have = new Set(kept.map(i => i.name));
        const room = Math.max(0, maxLines + 2 - kept.length);
        const fresh = conf.items.filter(i => !have.has(i.name)).sort(() => Math.random() - 0.5)
          .slice(0, Math.min(room, 1 + Math.floor(Math.random() * 3)))
          .map(i => ({ ...i, qty: stockFor(i, (shopData.sizes[shop.size] || {}).depth || 1) }));
        if (room > fresh.length && Math.random() < 0.35) {
          const odd = pick(shopData.flavor);
          if (!have.has(odd.name)) fresh.push({ ...odd, flavor: true, qty: 1 });
        }
        shop.items = [...kept, ...fresh];
        await save();
        drawRows();
        drawSaved();
        toast(`A day passes at ${shop.name}: ${fresh.length} in, ${soldOut} sold out`);
      });

      card.querySelector('[data-del]').addEventListener('click', () =>
        confirmDialog(`Delete ${shop.name}? Its stock goes with it.`, async () => {
          await dbDelete('shops', shop.id);
          if ((await getState('shopOpenId')) === shop.id) await rememberOpen(null);
          currentEl.innerHTML = '';
          drawSaved();
        }));

      // typing in the filter redraws the shelf, not the shop
      let filterTimer;
      filterEl.addEventListener('input', () => {
        clearTimeout(filterTimer);
        filterTimer = setTimeout(drawRows, 100);
      });

      drawRows();
      currentEl.append(card);
    };

    // One shop, stocked. Shared by the button here and by a settlement's own
    // shops, which generate themselves through the same path.
    const buildShop = (typeName, sizeName, name) => {
      const conf = shopData.types[typeName];
      const sizeConf = shopData.sizes[sizeName];
      const [min, max] = sizeConf.stock;
      const count = min + Math.floor(Math.random() * (max - min + 1));
      const depth = sizeConf.depth || 1;
      const items = [...conf.items].sort(() => Math.random() - 0.5).slice(0, count)
        .map(i => ({ ...i, qty: stockFor(i, depth) }));
      if (Math.random() < 0.7) {
        const odd = pick(shopData.flavor);
        items.push({ ...odd, flavor: true, qty: 1 });
      }
      return {
        name: name || shopName(names), type: typeName, size: sizeName, note: sizeConf.note,
        // still rolled and still saved, just not on the card: a shop is its
        // shelves here, and the person behind the counter belongs to the
        // settlement that has one
        keeper: personName(names), items, campaignId: activeCampaignId(),
      };
    };

    const gen = async () => {
      const shop = await dbPut('shops', buildShop(type.get(), size.get()));
      await rememberOpen(shop.id);
      toast(`${shop.name} generated and saved`);
      renderShop(shop);
      drawSaved();
    };

    const drawSaved = async () => {
      const saved = await dbAll('shops', activeCampaignId());
      const openId = await getState('shopOpenId');
      const box = container.querySelector('#sh-saved');
      box.innerHTML = saved.length ? '' : '<p class="faint small">No shops yet. Generate one and it is saved here.</p>';
      for (const s of saved.sort((a, b) => b.updated - a.updated)) {
        const row = el(`<button class="shop-row${s.id === openId ? ' is-open' : ''}">
          <b>${esc(s.name)}</b>
          <span class="small faint">${esc(s.type)}</span>
          <span class="small faint">${s.items.length} lines</span>
        </button>`);
        row.addEventListener('click', async () => {
          await rememberOpen(s.id);
          renderShop(s);
          drawSaved();
        });
        box.append(row);
      }
    };

    container.querySelector('#sh-gen').addEventListener('click', gen);

    // A settlement's shop card asks for a shop by name; it is made here so
    // there is only one way a shop comes into being.
    const pending = await getState('shopToCreate');
    if (pending?.name) {
      const existing = (await dbAll('shops', activeCampaignId())).find(s => s.name === pending.name);
      const shop = existing || await dbPut('shops', buildShop(
        shopData.types[pending.type] ? pending.type : types[0],
        shopData.sizes[pending.size] ? pending.size : 'Town',
        pending.name));
      await setState('shopToCreate', null);
      await rememberOpen(shop.id);
      renderShop(shop);
      drawSaved();
      return;
    }

    // reopen whatever shop was last being viewed
    const openId = await getState('shopOpenId');
    if (openId) {
      const rec = (await dbAll('shops', activeCampaignId())).find(s => s.id === openId);
      if (rec) renderShop(rec);
    }
    drawSaved();
  },
};
