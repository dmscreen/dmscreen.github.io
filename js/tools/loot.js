// Loot & Treasure Generator: coins, gems, art, gear and magic by CR band.
//
// Four sizes of find, because "what this one goblin had on it" and "what is
// in the dragon's pile" are not the same question, and neither is the chest
// in the corner of the room.
import { loadMagicItems, loadItems } from '../srd.js';
import { el, esc, md, modal, toggleRow } from '../components/ui.js';
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

// What a chest is, before anyone opens it. Rolled alongside the contents so
// the DM has the thing in the room, not just the list inside it.
const CHEST_BODY = [
  'a banded oak chest, iron at the corners', 'a small ironbound coffer', 'a cedar case that still smells of it',
  'a warped sea chest with salt in the grain', 'a stone casket with a slab lid', 'a strongbox bolted to the floor',
  'a wicker hamper, surprisingly heavy', 'a lacquered box inlaid with shell', 'a soldier\'s footlocker, name scratched out',
  'a leather-covered trunk, the hide gone hard',
];
const CHEST_LOCK = [
  { text: 'unlocked, and the lid stands open a finger\'s width', w: 20 },
  { text: 'locked; a simple ward, DC 12 with thieves\' tools', w: 30 },
  { text: 'locked; good work, DC 15 with thieves\' tools', w: 25 },
  { text: 'locked; a masterwork mechanism, DC 20, and the key is elsewhere', w: 10 },
  { text: 'not locked but swollen shut; DC 13 Strength to force without splitting it', w: 15 },
];
const CHEST_TRAP = [
  { text: null, w: 55 },
  { text: 'a needle in the catch, DC 13 to spot, poison the maker has long since forgotten the name of', w: 15 },
  { text: 'the hinges are wired to a bell somewhere else in the building', w: 12 },
  { text: 'a glass vial of acid set to break across the contents, DC 14 to spot', w: 10 },
  { text: 'a rune on the underside of the lid that goes off in the face of whoever lifts it, DC 15 to spot', w: 8 },
];
const CHEST_EXTRA = [
  'a false bottom, shallow but real', 'a folded letter, the seal already broken', 'a child\'s drawing, kept for years',
  'a tally of names with half of them struck through', 'a key to something that is not this chest',
  'a lock of hair tied with thread', 'a map with one place circled and no others named',
  'a bundle of receipts from a merchant house two regions away',
];

// Bands: 0-4, 5-10, 11-16, 17+. Coin rolls are a base and a spread rather
// than one fixed formula, so two rolls at the same CR do not read the same.
// The four sizes are also a promise the buttons make left to right: at every
// band, expected value runs individual < pile < treasure chest < hoard.
const BANDS = [
  {
    label: 'CR 0-4',
    individual: () => ({ cp: roll('5d6').total, sp: roll('4d6').total, gp: roll('3d6').total }),
    pileCoins: () => ({ cp: roll('4d6').total * 10, sp: roll('3d6').total * 10, gp: roll('2d6').total * 5 }),
    hoardCoins: () => ({ cp: roll('6d6').total * 100, sp: roll('3d6').total * 100, gp: roll('2d6').total * 10 }),
    gemTier: 0, artTier: 0,
    rarities: { common: 62, uncommon: 34, rare: 4 },
    itemChance: 0.5, itemCount: () => roll('1d4').total - 1,
    gearTier: 0,
  },
  {
    label: 'CR 5-10',
    individual: () => ({ sp: roll('6d6').total * 10, gp: roll('4d6').total * 10 }),
    pileCoins: () => ({ sp: roll('4d6').total * 20, gp: roll('3d6').total * 20, pp: roll('1d6').total }),
    hoardCoins: () => ({ cp: roll('2d6').total * 100, sp: roll('2d6').total * 1000, gp: roll('6d6').total * 100, pp: roll('3d6').total * 10 }),
    gemTier: 1, artTier: 1,
    rarities: { common: 22, uncommon: 56, rare: 20, 'very rare': 2 },
    itemChance: 0.75, itemCount: () => roll('1d4').total,
    gearTier: 1,
  },
  {
    label: 'CR 11-16',
    individual: () => ({ gp: roll('3d6').total * 50, pp: roll('1d6').total * 10 }),
    pileCoins: () => ({ gp: roll('4d6').total * 50, pp: roll('2d6').total * 5 }),
    hoardCoins: () => ({ gp: roll('4d6').total * 1000, pp: roll('5d6').total * 100 }),
    gemTier: 3, artTier: 2,
    rarities: { uncommon: 34, rare: 47, 'very rare': 17, legendary: 2 },
    itemChance: 0.9, itemCount: () => roll('1d4').total,
    gearTier: 2,
  },
  {
    label: 'CR 17+',
    individual: () => ({ gp: roll('6d6').total * 100, pp: roll('1d6').total * 100 }),
    pileCoins: () => ({ gp: roll('6d6').total * 100, pp: roll('3d6').total * 50 }),
    hoardCoins: () => ({ gp: roll('12d6').total * 1000, pp: roll('8d6').total * 1000 }),
    gemTier: 4, artTier: 3,
    rarities: { rare: 36, 'very rare': 46, legendary: 18 },
    itemChance: 1, itemCount: () => roll('1d6').total,
    gearTier: 3,
  },
];

// Rarity, on top of whatever the band allows. Steeper than a flat weight so
// that a legendary is a story and not a Tuesday: even in the top band, where
// legendaries are on the table, they are the thin end of it.
const RARITY_SCARCITY = { common: 1, uncommon: 0.75, rare: 0.4, 'very rare': 0.16, legendary: 0.05, artifact: 0.01 };

// Rarity as published is not always one word: "rare (silver or brass), very
// rare (bronze) or legendary (iron)" is a real entry. Read the first rarity
// named and treat "varies" as the rarest thing it could be.
const rarityOf = (m) => {
  const t = String(m.rarity || '').toLowerCase();
  if (t.includes('artifact')) return 'artifact';
  if (t.startsWith('legendary')) return 'legendary';
  if (t.startsWith('very rare')) return 'very rare';
  if (t.startsWith('rare')) return 'rare';
  if (t.startsWith('uncommon')) return 'uncommon';
  if (t.startsWith('common')) return 'common';
  return 'rare';                                    // "varies", "rarity by figurine"
};

// Everyday things a party can actually find. Vehicles and livestock are left
// out because nobody finds a rowboat in a chest, and trade goods because
// those rows are a commodity price list: "Silver", "Wheat", "Electrum Piece"
// are what a pound of the stuff costs, not something to pull out of a sack.
const GEAR_CATEGORIES = ['Adventuring Gear', 'Weapon', 'Tools', 'Medicinals', 'Survival Gear',
  'Armor', 'Shield', 'Ammunition', 'Container', 'Poison'];

const costInCopper = (cost) => {
  const m = /([\d,.]+)\s*(cp|sp|ep|gp|pp)/i.exec(String(cost || ''));
  if (!m) return 0;
  const mult = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 }[m[2].toLowerCase()] || 1;
  return parseFloat(m[1].replace(/,/g, '')) * mult;
};

const fmtCoins = (c) => ['pp', 'gp', 'sp', 'cp'].filter(k => c[k]).map(k => `<b>${c[k].toLocaleString()}</b> ${k}`).join(', ');

// weighted pick from [{...,w}] or from a map of value->weight
const weighted = (entries) => {
  const total = entries.reduce((a, e) => a + e.w, 0);
  let r = Math.random() * total;
  for (const e of entries) { r -= e.w; if (r < 0) return e; }
  return entries[entries.length - 1];
};

export default {
  id: 'loot', title: 'Loot Generator', shortTitle: 'Loot', group: 'Generators', icon: 'coins',
  subtitle: 'Pockets, piles, chests and hoards, by CR band',

  async render(container) {
    const [magicItems, allItems] = await Promise.all([loadMagicItems(), loadItems()]);
    const bySlug = new Map(magicItems.map(m => [m.slug, m]));
    // how many items each rarity actually has to offer
    const poolSize = new Map();
    for (const m of magicItems) {
      const r = rarityOf(m);
      poolSize.set(r, (poolSize.get(r) || 0) + 1);
    }
    const gearBySlug = new Map(allItems.map(i => [i.slug, i]));

    // Mundane finds, banded by what they cost, so a CR 2 goblin's pockets
    // hold rope and a torch and a CR 18 lair holds the good tools.
    const gear = allItems.filter(i => i.kind !== 'magic' && GEAR_CATEGORIES.includes(i.category));
    const GEAR_BANDS = [
      gear.filter(i => costInCopper(i.cost) <= 500),
      gear.filter(i => costInCopper(i.cost) > 100 && costInCopper(i.cost) <= 5000),
      gear.filter(i => costInCopper(i.cost) > 1000 && costInCopper(i.cost) <= 50000),
      gear.filter(i => costInCopper(i.cost) > 5000),
    ].map((list, i) => (list.length ? list : gear));

    let bandIdx = 0;

    container.innerHTML = `
      <div class="card">
        <div id="l-band"></div>
        <div class="row mt">
          <button class="btn" id="l-individual" title="What one creature was carrying">Individual</button>
          <button class="btn" id="l-pile" title="A stash: a few creatures' worth, or what was swept into a corner">Pile</button>
          <button class="btn" id="l-chest" title="A container, with what it is and how it is shut">Treasure chest</button>
          <button class="btn primary" id="l-hoard" title="A lair, a vault, a milestone">Hoard</button>
        </div>
        <p class="small faint mt">A hoard is for a lair or a milestone, not every fight. Rarer magic is rarer here than the band's own weighting alone would make it, so a legendary stays a story.</p>
      </div>
      <div id="l-history"></div>`;

    const band = toggleRow('CR band', BANDS.map((b, i) => ({ value: String(i), label: b.label })), '0',
      (v) => { bandIdx = Number(v); }, { segmented: true });
    container.querySelector('#l-band').append(band.el);

    const history = await historyList({
      container: container.querySelector('#l-history'),
      key: 'history:loot',
      title: 'Rolled treasure',
      renderEntry: (e, body) => {
        body.innerHTML = `
          <div><b>${esc(e.title)}</b> <span class="small faint">${timeStamp(e.ts)}</span></div>
          ${e.chest ? `<div class="small"><b>The chest.</b> <span class="muted">${esc(e.chest.body)}, ${esc(e.chest.lock)}${
            e.chest.trap ? `. <b>Trapped:</b> ${esc(e.chest.trap)}` : ''}${
            e.chest.extra ? `. Also inside: ${esc(e.chest.extra)}` : ''}</span></div>` : ''}
          <div class="small">${fmtCoins(e.coins) || '<span class="muted">No coins</span>'}</div>
          ${e.gems?.length ? `<div class="small"><b>Gems.</b> <span class="muted">${e.gems.map(esc).join('; ')}</span></div>` : ''}
          ${e.art?.length ? `<div class="small"><b>Art.</b> <span class="muted">${e.art.map(esc).join('; ')}</span></div>` : ''}
          <div data-gear></div>
          <div data-items></div>`;

        const openItem = (rec, item) => {
          if (!item) return;
          modal(item.name, el(`<div><p class="muted"><i>${esc(item.type || item.category || '')}${
            item.rarity ? `, ${esc(item.rarity)}` : ''}${item.attunement ? ` (${esc(item.attunement)})` : ''}${
            item.cost ? `, ${esc(item.cost)}` : ''}</i></p>${item.desc ? md(item.desc) : '<p class="faint small">No description beyond the summary above.</p>'}</div>`), { wide: true });
        };

        const gearEl = body.querySelector('[data-gear]');
        for (const g of (e.gear || [])) {
          const p = el(`<div class="small"><a href="javascript:void 0">${esc(g.name)}</a>${
            g.qty > 1 ? ` <span class="pill">x${g.qty}</span>` : ''} <span class="muted">${esc(g.cost || '')}</span></div>`);
          p.querySelector('a').addEventListener('click', () => openItem(g, gearBySlug.get(g.slug)));
          gearEl.append(p);
        }
        const itemsEl = body.querySelector('[data-items]');
        for (const it of (e.items || [])) {
          const p = el(`<div class="small"><a href="javascript:void 0">${esc(it.name)}</a> <span class="pill">${esc(it.rarity)}</span></div>`);
          p.querySelector('a').addEventListener('click', () => openItem(it, bySlug.get(it.slug)));
          itemsEl.append(p);
        }
      },
    });

    // Coins that do not read the same twice. A find is sometimes all silver,
    // sometimes a purse nobody has counted, and sometimes empty pockets.
    const varyCoins = (base) => {
      const out = {};
      const keys = Object.keys(base);
      for (const k of keys) {
        // most of what is there, give or take half again
        let n = Math.round(base[k] * (0.55 + Math.random() * 0.95));
        // and now and then a denomination simply is not in the pile
        if (Math.random() < 0.28) n = 0;
        if (n > 0) out[k] = n;
      }
      // never hand back nothing at all when there was meant to be something
      if (!Object.keys(out).length && keys.length) {
        const k = keys[keys.length - 1];
        out[k] = Math.max(1, Math.round(base[k] * 0.5));
      }
      return out;
    };

    const rollGear = (bandIndex, n) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        // mostly things that suit the band, sometimes something humbler
        const tier = Math.random() < 0.75 ? bandIndex : Math.max(0, bandIndex - 1);
        const pool = GEAR_BANDS[tier];
        if (!pool.length) continue;
        const item = pick(pool);
        const cheap = costInCopper(item.cost) <= 100;
        const qty = cheap ? roll('1d6').total : (Math.random() < 0.2 ? 2 : 1);
        const found = out.find(g => g.slug === item.slug);
        if (found) found.qty += qty;
        else out.push({ slug: item.slug, name: item.name, cost: item.cost, qty });
      }
      return out;
    };

    const rollMagic = (b, countOverride) => {
      if (countOverride == null && Math.random() > b.itemChance) return [];
      const n = countOverride != null ? countOverride : b.itemCount();
      const items = [];
      // Three things decide the weighting. The band says what is on the
      // table at this CR; scarcity says how thin the top of that table is;
      // and the size of the pool says how much of the table a rarity can
      // actually fill. That last one matters: exactly one magic item in the
      // whole set is common, so without it a low-CR find would be a Potion
      // of Climbing most times it was rolled.
      const weights = Object.entries(b.rarities)
        .map(([k, w]) => ({
          value: k,
          w: w * (RARITY_SCARCITY[k] ?? 0.2) * Math.min(1, (poolSize.get(k) || 0) / 12),
        }))
        .filter(e => e.w > 0);
      if (!weights.length) return items;
      for (let i = 0; i < n; i++) {
        const rarity = weighted(weights).value;
        const pool = magicItems.filter(m => rarityOf(m) === rarity);
        if (pool.length) {
          const item = pick(pool);
          items.push({ slug: item.slug, name: item.name, rarity: item.rarity });
        }
      }
      return items;
    };

    const rollGems = (b, chance, dice) => {
      if (Math.random() >= chance) return [];
      const [value, list] = GEMS[Math.min(b.gemTier + (Math.random() < 0.3 ? 1 : 0), GEMS.length - 1)];
      const n = roll(dice).total;
      return Array.from({ length: n }, () => `${pick(list)} (${value} gp)`);
    };
    const rollArt = (b, chance, dice) => {
      if (Math.random() >= chance) return [];
      const [value, list] = ART[Math.min(b.artTier, ART.length - 1)];
      const n = roll(dice).total;
      return Array.from({ length: n }, () => `${pick(list)} (${value} gp)`);
    };

    container.querySelector('#l-individual').addEventListener('click', () => {
      const b = BANDS[bandIdx];
      history.add({
        title: `Individual (${b.label})`,
        coins: varyCoins(b.individual()),
        gems: [], art: [],
        // whatever they had on them: a rope, a flask, the knife they used
        gear: Math.random() < 0.55 ? rollGear(bandIdx, roll('1d2').total) : [],
        items: Math.random() < 0.08 ? rollMagic(b, 1) : [],
      });
    });

    container.querySelector('#l-pile').addEventListener('click', () => {
      const b = BANDS[bandIdx];
      history.add({
        title: `Pile (${b.label})`,
        coins: varyCoins(b.pileCoins()),
        gems: rollGems(b, 0.35, '1d4'),
        art: rollArt(b, 0.15, '1'),
        gear: rollGear(bandIdx, roll('1d4').total + 1),
        items: Math.random() < 0.3 ? rollMagic(b, 1) : [],
      });
    });

    container.querySelector('#l-chest').addEventListener('click', () => {
      const b = BANDS[bandIdx];
      const trap = weighted(CHEST_TRAP.map(t => ({ ...t })));
      history.add({
        title: `Treasure chest (${b.label})`,
        chest: {
          body: pick(CHEST_BODY),
          lock: weighted(CHEST_LOCK.map(l => ({ ...l }))).text,
          trap: trap.text,
          extra: Math.random() < 0.45 ? pick(CHEST_EXTRA) : null,
        },
        coins: varyCoins(b.pileCoins()),
        gems: rollGems(b, 0.5, '1d4'),
        art: rollArt(b, 0.3, '1d2'),
        gear: rollGear(bandIdx, roll('1d3').total),
        items: Math.random() < 0.45 ? rollMagic(b, 1) : [],
      });
    });

    container.querySelector('#l-hoard').addEventListener('click', () => {
      const b = BANDS[bandIdx];
      history.add({
        title: `Hoard (${b.label})`,
        coins: varyCoins(b.hoardCoins()),
        gems: rollGems(b, 0.6, '2d4'),
        art: rollArt(b, 0.5, '1d4'),
        gear: rollGear(bandIdx, roll('1d4').total),
        items: rollMagic(b),
      });
    });
  },
};
