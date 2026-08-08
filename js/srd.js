// Loader and helpers for bundled SRD data.

const cache = {};

async function fetchJSON(name) {
  const r = await fetch(`data/${name}.json`);
  if (!r.ok) throw new Error(`Failed to load ${name}.json (HTTP ${r.status})`);
  return r.json();
}

function load(name) {
  if (!cache[name]) {
    // Retry once (an interrupted fetch, e.g. during a service worker update,
    // throws AbortError), and never cache a failure, so the next visit
    // to the page tries again instead of showing a stale error forever.
    cache[name] = fetchJSON(name)
      .catch(() => fetchJSON(name))
      .catch(err => {
        delete cache[name];
        throw err;
      });
  }
  return cache[name];
}

export const loadMonsters = () => load('monsters');
export const loadSpells = () => load('spells');
export const loadConditions = () => load('conditions');
export const loadMagicItems = () => load('magic-items');
export const loadRules = () => load('rules');
export const loadFeats = () => load('feats');
export const loadItems = () => load('items');
export const loadBackgrounds = () => load('backgrounds');
export const loadTables = (name) => load(`tables/${name}`);

// Warm every dataset in the background so page switches never wait on a fetch+parse.
export function preloadAll() {
  const jobs = [
    () => load('monsters'), () => load('spells'), () => load('items'),
    () => load('magic-items'), () => load('conditions'), () => load('rules'),
    () => load('feats'), () => load('backgrounds'),
    () => load('tables/names'), () => load('tables/npc'), () => load('tables/quests'), () => load('tables/shops'),
  ];
  const runNext = () => {
    const job = jobs.shift();
    if (!job) return;
    job().catch(() => {}).finally(() => {
      const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 150));
      idle(runNext);
    });
  };
  runNext();
}

/* ---------- 5e math ---------- */

export const abilityMod = (score) => Math.floor((score - 10) / 2);
export const fmtMod = (n) => (n >= 0 ? `+${n}` : String(n));

// XP by CR (SRD)
export const CR_XP = {
  0: 10, 0.125: 25, 0.25: 50, 0.5: 100,
  1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900,
  9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000,
  16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000, 21: 33000,
  22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000, 27: 105000,
  28: 120000, 29: 135000, 30: 155000,
};

// XP thresholds per character level: [easy, medium, hard, deadly]
export const XP_THRESHOLDS = {
  1: [25, 50, 75, 100], 2: [50, 100, 150, 200], 3: [75, 150, 225, 400],
  4: [125, 250, 375, 500], 5: [250, 500, 750, 1100], 6: [300, 600, 900, 1400],
  7: [350, 750, 1100, 1700], 8: [450, 900, 1400, 2100], 9: [550, 1100, 1600, 2400],
  10: [600, 1200, 1900, 2800], 11: [800, 1600, 2400, 3600], 12: [1000, 2000, 3000, 4500],
  13: [1100, 2200, 3400, 5100], 14: [1250, 2500, 3800, 5700], 15: [1400, 2800, 4300, 6400],
  16: [1600, 3200, 4800, 7200], 17: [2000, 3900, 5900, 8800], 18: [2100, 4200, 6300, 9500],
  19: [2400, 4900, 7300, 10900], 20: [2800, 5700, 8500, 12700],
};

export function encounterMultiplier(monsterCount, partySize = 4) {
  const brackets = [[1, 1], [2, 1.5], [3, 2], [7, 2.5], [11, 3], [15, 4]];
  let idx = 0;
  for (let i = 0; i < brackets.length; i++) if (monsterCount >= brackets[i][0]) idx = i;
  // small parties count one bracket higher, large parties one lower
  if (partySize < 3) idx = Math.min(idx + 1, brackets.length - 1);
  else if (partySize > 5) idx = Math.max(idx - 1, 0);
  return brackets[idx][1];
}

export const fmtCR = (cr) => cr === 0.125 ? '1/8' : cr === 0.25 ? '1/4' : cr === 0.5 ? '1/2' : String(cr);

// XP for a monster: prefer the value published with the stat block (A5E), fall back to the CR table.
export const monsterXP = (m) => m.xp ?? CR_XP[m.cr] ?? 0;

export const CR_LIST = [0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, i) => i + 1)];
