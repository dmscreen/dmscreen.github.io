// Loot & Treasure Generator: coins, gems, art, and SRD magic items by CR band.
import { loadMagicItems } from '../srd.js';
import { el, esc, md, modal } from '../components/ui.js';
import { historyList, timeStamp } from '../components/history.js';
import { roll, pick } from '../dice.js';

const GEMS = [
  [10, ['azurite', 'banded agate', 'blue quartz', 'hematite', 'moss agate', 'obsidian', 'tiger eye', 'turquoise']],
  [50, ['bloodstone', 'carnelian', 'chalcedony', 'citrine', 'jasper', 'moonstone', 'onyx', 'star rose quartz']],
  [100, ['amber', 'amethyst', 'coral', 'garnet', 'jade', 'pearl', 'spinel', 'tourmaline']],
  [500, ['alexandrite', 'aquamarine', 'black pearl', 'blue spinel', 'peridot', 'topaz']],
  [1000, ['black opal', 'blue sapphire', 'emerald', 'fire opal', 'opal', 'star ruby']],
  [5000, ['black sapphire', 'diamond', 'jacinth', 'ruby']],
];
const ART = [
  [25, ['silver ewer', 'carved bone statuette', 'small gold bracelet', 'cloth-of-gold vestments', 'black velvet mask stitched with silver thread']],
  [250, ['gold ring with bloodstones', 'carved ivory statuette', 'bronze crown', 'silk robe with gold embroidery', 'silver and gold brooch']],
  [750, ['silver chalice set with moonstones', 'silver-plated longsword with jet in the hilt', 'carved harp of exotic wood', 'small gold idol']],
  [2500, ['fine gold chain set with a fire opal', 'old masterpiece painting', 'embroidered gold-thread mantle', 'jeweled platinum ring']],
];

// Bands: 0-4, 5-10, 11-16, 17+
const BANDS = [
  { label: 'CR 0-4', individual: () => ({ cp: roll('5d6').total, sp: roll('4d6').total, gp: roll('3d6').total }),
    hoardCoins: () => ({ cp: roll('6d6').total * 100, sp: roll('3d6').total * 100, gp: roll('2d6').total * 10 }),
    gemTier: 0, artTier: 0, itemRarities: { common: 60, uncommon: 38, rare: 2 }, itemChance: 0.5, itemCount: () => roll('1d4').total - 1 },
  { label: 'CR 5-10', individual: () => ({ sp: roll('6d6').total * 10, gp: roll('4d6').total * 10 }),
    hoardCoins: () => ({ cp: roll('2d6').total * 100, sp: roll('2d6').total * 1000, gp: roll('6d6').total * 100, pp: roll('3d6').total * 10 }),
    gemTier: 1, artTier: 1, itemRarities: { common: 25, uncommon: 55, rare: 18, 'very rare': 2 }, itemChance: 0.75, itemCount: () => roll('1d4').total },
  { label: 'CR 11-16', individual: () => ({ gp: roll('4d6').total * 100, pp: roll('2d6').total * 10 }),
    hoardCoins: () => ({ gp: roll('4d6').total * 1000, pp: roll('5d6').total * 100 }),
    gemTier: 3, artTier: 2, itemRarities: { uncommon: 30, rare: 48, 'very rare': 20, legendary: 2 }, itemChance: 0.9, itemCount: () => roll('1d4').total },
  { label: 'CR 17+', individual: () => ({ gp: roll('8d6').total * 100, pp: roll('3d6').total * 100 }),
    hoardCoins: () => ({ gp: roll('12d6').total * 1000, pp: roll('8d6').total * 1000 }),
    gemTier: 4, artTier: 3, itemRarities: { rare: 30, 'very rare': 45, legendary: 25 }, itemChance: 1, itemCount: () => roll('1d6').total },
];

const fmtCoins = (c) => ['pp', 'gp', 'sp', 'cp'].filter(k => c[k]).map(k => `<b>${c[k].toLocaleString()}</b> ${k}`).join(', ');

export default {
  id: 'loot', title: 'Loot Generator', shortTitle: 'Loot', group: 'Generators', icon: 'coins',
  subtitle: 'Individual pockets or full hoards, by CR band',

  async render(container) {
    const magicItems = await loadMagicItems();
    const bySlug = new Map(magicItems.map(m => [m.slug, m]));

    let bandIdx = 0;

    container.innerHTML = `
      <div class="card">
        <div class="field"><span>CR band</span>
          <div class="row" id="l-band" style="gap:6px;margin:4px 0 12px">
            ${BANDS.map((b, i) => `<button class="btn small ${i === 0 ? 'primary' : ''}" data-val="${i}">${b.label}</button>`).join('')}
          </div>
        </div>
        <div class="row">
          <button class="btn primary" id="l-hoard">Roll hoard</button>
          <button class="btn" id="l-individual">Roll individual</button>
        </div>
        <p class="small faint mt">Hoard treasure is meant for a lair or a milestone, not every fight. Tables are original approximations tuned to SRD magic item rarities.</p>
      </div>
      <div id="l-history"></div>`;

    const history = await historyList({
      container: container.querySelector('#l-history'),
      key: 'history:loot',
      title: 'Rolled treasure',
      renderEntry: (e, body) => {
        body.innerHTML = `
          <div><b>${esc(e.title)}</b> <span class="small faint">${timeStamp(e.ts)}</span></div>
          <div class="small">${fmtCoins(e.coins) || '<span class="muted">No coins</span>'}</div>
          ${e.gems.length ? `<div class="small"><b>Gems.</b> <span class="muted">${e.gems.map(esc).join('; ')}</span></div>` : ''}
          ${e.art.length ? `<div class="small"><b>Art.</b> <span class="muted">${e.art.map(esc).join('; ')}</span></div>` : ''}
          <div data-items></div>`;
        const itemsEl = body.querySelector('[data-items]');
        for (const it of e.items) {
          const p = el(`<div class="small"><a href="javascript:void 0">${esc(it.name)}</a> <span class="pill">${esc(it.rarity)}</span></div>`);
          p.querySelector('a').addEventListener('click', () => {
            const item = bySlug.get(it.slug);
            if (item) modal(item.name, el(`<div><p class="muted"><i>${esc(item.type)}, ${esc(item.rarity)}${item.attunement ? ` (${esc(item.attunement)})` : ''}</i></p>${md(item.desc)}</div>`), { wide: true });
          });
          itemsEl.append(p);
        }
      },
    });

    // CR band toggle row (single select)
    const bandRow = container.querySelector('#l-band');
    bandRow.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn');
      if (!btn) return;
      bandIdx = Number(btn.dataset.val);
      bandRow.querySelectorAll('.btn').forEach(b => b.classList.toggle('primary', Number(b.dataset.val) === bandIdx));
    });

    const rollItems = (band) => {
      if (Math.random() > band.itemChance) return [];
      const n = band.itemCount();
      const items = [];
      for (let i = 0; i < n; i++) {
        const total = Object.values(band.itemRarities).reduce((a, b) => a + b, 0);
        let r = Math.random() * total;
        let rarity = Object.keys(band.itemRarities)[0];
        for (const [k, w] of Object.entries(band.itemRarities)) {
          r -= w;
          if (r < 0) { rarity = k; break; }
        }
        const pool = magicItems.filter(m => (m.rarity || '').toLowerCase().startsWith(rarity));
        if (pool.length) {
          const item = pick(pool);
          items.push({ slug: item.slug, name: item.name, rarity: item.rarity });
        }
      }
      return items;
    };

    container.querySelector('#l-individual').addEventListener('click', () => {
      const band = BANDS[bandIdx];
      history.add({ title: `Individual (${band.label})`, coins: band.individual(), gems: [], art: [], items: [] });
    });

    container.querySelector('#l-hoard').addEventListener('click', () => {
      const band = BANDS[bandIdx];
      const gems = [];
      const art = [];
      if (Math.random() < 0.6) {
        const [value, list] = GEMS[Math.min(band.gemTier + (Math.random() < 0.3 ? 1 : 0), GEMS.length - 1)];
        const n = roll('2d4').total;
        for (let i = 0; i < n; i++) gems.push(`${pick(list)} (${value} gp)`);
      }
      if (Math.random() < 0.5) {
        const [value, list] = ART[Math.min(band.artTier, ART.length - 1)];
        const n = roll('1d4').total;
        for (let i = 0; i < n; i++) art.push(`${pick(list)} (${value} gp)`);
      }
      history.add({ title: `Hoard (${band.label})`, coins: band.hoardCoins(), gems, art, items: rollItems(band) });
    });
  },
};
