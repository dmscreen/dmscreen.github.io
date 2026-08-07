// Loot & Treasure Generator: coins, gems, art, and SRD magic items by CR band.
import { loadMagicItems } from '../srd.js';
import { el, esc, md, modal } from '../components/ui.js';
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

    container.innerHTML = `
      <div class="card">
        <div class="row">
          <label class="field"><span>CR band</span><select id="l-band">${BANDS.map((b, i) => `<option value="${i}">${b.label}</option>`).join('')}</select></label>
          <button class="btn primary" id="l-hoard">Roll hoard</button>
          <button class="btn" id="l-individual">Roll individual</button>
        </div>
        <p class="small faint mt">Hoard treasure is meant for a lair or a milestone, not every fight. Tables are original approximations tuned to SRD magic item rarities.</p>
      </div>
      <div id="l-out"></div>`;

    const out = container.querySelector('#l-out');

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
        if (pool.length) items.push(pick(pool));
      }
      return items;
    };

    const show = (title, coins, gems, art, items) => {
      const card = el(`<div class="card">
        <h2>${esc(title)}</h2>
        <p>${fmtCoins(coins) || '<span class="muted">No coins</span>'}</p>
        ${gems.length ? `<p><b>Gems.</b> <span class="muted">${gems.map(esc).join('; ')}</span></p>` : ''}
        ${art.length ? `<p><b>Art objects.</b> <span class="muted">${art.map(esc).join('; ')}</span></p>` : ''}
        ${items.length ? `<p><b>Magic items.</b></p>` : ''}
        <div data-items></div>
      </div>`);
      const itemsEl = card.querySelector('[data-items]');
      for (const item of items) {
        const rowEl = el(`<p><a href="javascript:void 0">${esc(item.name)}</a> <span class="pill">${esc(item.rarity)}</span>${item.attunement ? ' <span class="pill accent">attunement</span>' : ''}</p>`);
        rowEl.querySelector('a').addEventListener('click', () =>
          modal(item.name, el(`<div><p class="muted"><i>${esc(item.type)}, ${esc(item.rarity)}${item.attunement ? ` (${esc(item.attunement)})` : ''}</i></p>${md(item.desc)}</div>`), { wide: true }));
        itemsEl.append(rowEl);
      }
      out.prepend(card);
    };

    container.querySelector('#l-individual').addEventListener('click', () => {
      const band = BANDS[Number(container.querySelector('#l-band').value)];
      show(`Individual treasure (${band.label})`, band.individual(), [], [], []);
    });

    container.querySelector('#l-hoard').addEventListener('click', () => {
      const band = BANDS[Number(container.querySelector('#l-band').value)];
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
      show(`Treasure hoard (${band.label})`, band.hoardCoins(), gems, art, rollItems(band));
    });
  },
};
