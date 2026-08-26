// Campaign generator: builds a whole published-module-shaped campaign in one
// pass. The shape follows the taxonomy: campaign > acts > chapters > elements
// > nodes > beats, with NPCs, factions, clocks and clues as cross-cutting
// layers. Everything is generated against a single context object so the
// pieces refer to each other by name and the chapters chain logically.
import { loadMonsters, loadItems, loadTables, XP_THRESHOLDS, encounterMultiplier, monsterXP, fmtCR } from './srd.js';
import { pick, roll } from './dice.js';
import { generateDungeonMap } from './dungeon-map.js';

const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const int = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const chance = (p) => Math.random() < p;
const cap1 = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Pick n distinct entries; falls back to repeats only if the source is short.
function some(arr, n) {
  const copy = [...arr];
  const out = [];
  while (out.length < n && copy.length) out.push(...copy.splice(Math.floor(Math.random() * copy.length), 1));
  while (out.length < n) out.push(pick(arr));
  return out;
}

// Fill {slots} from the campaign context. Unknown slots are left alone so a
// missing name is visible rather than silently blank.
function fill(text, ctx) {
  if (!text) return text;
  return String(text).replace(/\{(\w+)\}/g, (m, key) => (ctx[key] != null ? ctx[key] : m));
}

/* ---------- names ---------- */

// Every name generator takes a `used` set and retries, because a campaign
// with two Kellspires makes its own clue text ambiguous, and two NPCs
// sharing a name reads as an error even when it is not.
function unique(used, make) {
  let name = make();
  for (let t = 0; used?.has(name) && t < 30; t++) name = make();
  used?.add(name);
  return name;
}

function settlementName(names, used) {
  return unique(used, () => `${pick(names.settlement.prefixes)}${pick(names.settlement.suffixes)}`);
}

// `short` keeps to one-word place names, for cases where the name gets
// embedded in a longer chapter title.
function siteName(C, short = false, used) {
  const s = C.siteNames;
  return unique(used, () => {
    const form = short ? '{prefix}{suffix}' : pick(s.forms);
    const name = form
      .replace('{prefix}', pick(s.prefixes))
      .replace('{suffix}', pick(s.suffixes))
      .replace('{adj}', pick(s.adjectives))
      .replace('{noun}', pick(s.nouns));
    return name.charAt(0).toUpperCase() + name.slice(1);
  });
}

function personName(names, ancestry, used) {
  let a = ancestry || pick(Object.keys(names.people));
  const name = unique(used, () => {
    a = ancestry || pick(Object.keys(names.people));
    const set = names.people[a];
    return `${pick(set.first)} ${pick(set.last)}`;
  });
  return { name, ancestry: a };
}

/* ---------- monsters ---------- */

// Two pools per campaign: the villain's own forces (used wherever their plan
// reaches) and whatever naturally lives in the terrain (used for wandering
// encounters and unaligned sites).
function buildPools(monsters, villainKind, terrain) {
  const typeMatch = (m) => villainKind.types.includes(String(m.type).toLowerCase());
  const wordMatch = (m) => villainKind.keywords.some(k => m.name.toLowerCase().includes(k));
  const faction = monsters.filter(m => monsterXP(m) > 0 && (typeMatch(m) || wordMatch(m)));
  const wild = monsters.filter(m => monsterXP(m) > 0 && m.environments?.some(e => terrain.includes(e)));
  return {
    faction: faction.length > 20 ? faction : monsters.filter(m => monsterXP(m) > 0),
    wild: wild.length > 20 ? wild : monsters.filter(m => monsterXP(m) > 0),
  };
}

const inBand = (m, level, spread = 2) =>
  m.cr <= level + spread && m.cr >= (level <= 3 ? 0 : (level - 1) / 4);

// One combat encounter budgeted against the actual party at this level.
function buildEncounter(pool, level, difficulty = 2, partySize = 4) {
  const lvl = Math.min(20, Math.max(1, level));
  const size = Math.min(8, Math.max(1, partySize));
  const budget = XP_THRESHOLDS[lvl][difficulty] * size;
  let band = pool.filter(m => inBand(m, lvl) && monsterXP(m) <= budget);
  if (!band.length) band = pool.filter(m => monsterXP(m) <= budget);
  if (!band.length) return null;

  const meaty = band.filter(m => monsterXP(m) >= budget / 10);
  const lead = pick(meaty.length ? meaty : band);
  const leadXP = monsterXP(lead) || 10;
  let count = 1;
  for (let c = 8; c >= 1; c--) {
    if (leadXP * c * encounterMultiplier(c, size) <= budget * 1.1) { count = c; break; }
  }

  const creatures = [{ slug: lead.slug, name: lead.name, cr: fmtCR(lead.cr), count }];
  let raw = leadXP * count;

  // Spend leftover budget on a smaller supporting group, which reads more like
  // a published encounter than one block of identical monsters.
  const spent = () => Math.round(raw * encounterMultiplier(creatures.reduce((a, c) => a + c.count, 0), size));
  if (chance(0.45)) {
    const minions = band.filter(m => m.slug !== lead.slug && monsterXP(m) <= Math.max(25, leadXP / 3));
    if (minions.length) {
      const minion = pick(minions);
      const mXP = monsterXP(minion) || 10;
      for (let n = int(2, 5); n >= 2; n--) {
        const total = raw + mXP * n;
        const adj = Math.round(total * encounterMultiplier(count + n, size));
        if (adj <= budget * 1.25) {
          creatures.push({ slug: minion.slug, name: minion.name, cr: fmtCR(minion.cr), count: n });
          raw = total;
          break;
        }
      }
    }
  }

  const labels = ['easy', 'medium', 'hard', 'deadly'];
  return { creatures, xp: spent(), difficulty: labels[difficulty], budget };
}

/* ---------- treasure ---------- */

function treasureFor(items, level, ctx, { major = false } = {}) {
  const tiers = level <= 4 ? ['common', 'uncommon'] : level <= 10 ? ['uncommon', 'rare'] : level <= 16 ? ['rare', 'very rare'] : ['very rare', 'legendary'];
  const tier = major ? tiers[1] : pick(tiers);
  const magic = items.filter(i => i.kind === 'magic' && i.rarity === tier);
  const out = [];
  if (magic.length) {
    const it = pick(magic);
    out.push({ kind: 'magic', slug: it.slug, name: it.name, rarity: it.rarity, attunement: !!it.attunement });
  }
  const coin = major ? roll(`${level * 2}d10`).total * 10 : roll(`${Math.max(2, level)}d10`).total;
  out.push({ kind: 'coin', gp: coin, name: `${coin.toLocaleString()} gp in coin and portable valuables` });
  // ctx.slots, not ctx: passing the whole context made this a no-op and
  // shipped literal "{villain}" strings into treasure descriptions
  if (chance(0.4)) out.push({ kind: 'goods', name: fill(pick(ctx.C.treasureGoods), ctx.slots || {}) });
  return out;
}

/* ---------- NPCs ---------- */

// A stat block to grab when a roster NPC ends up in a fight. All of these
// exist in the bundled bestiary by exact name.
const NPC_STATS = {
  patron: ['Noble', 'Knight'], authority: ['Noble', 'Veteran'], quartermaster: ['Commoner'],
  broker: ['Spy'], specialist: ['Mage', 'Priest'], betrayer: ['Spy', 'Cultist'],
  guide: ['Scout'], rival: ['Veteran', 'Bandit Captain'], witness: ['Commoner'], survivor: ['Commoner'],
};

function npcStat(ctx, roleId) {
  for (const wanted of NPC_STATS[roleId] || ['Commoner']) {
    const m = ctx.monsters.find(x => x.name === wanted);
    if (m) return { slug: m.slug, name: m.name, cr: fmtCR(m.cr) };
  }
  return null;
}

function makeNPC(ctx, roleId, where) {
  const { C, names, npcTable } = ctx;
  const role = C.npcRoles.find(r => r.id === roleId) || pick(C.npcRoles);
  const { name, ancestry } = personName(names, null, ctx.usedNames);
  // Deliberately no ideals/bonds/flaws: they are PC-sheet concepts that never
  // come up from the DM's chair. Personality, quirk, wants and secret are
  // what improvisation actually runs on.
  return {
    id: uid('npc'),
    name,
    ancestry,
    role: role.label,
    roleId: role.id,
    occupation: pick(npcTable.occupations),
    personality: pick(npcTable.personalities),
    quirk: pick(npcTable.quirks),
    wants: fill(pick(C.npcWants), ctx.slots),
    secret: fill(pick(C.npcSecrets), ctx.slots),
    statSuggestion: npcStat(ctx, role.id),
    where,
  };
}

/* ---------- dungeon elements ---------- */

function weightedRole(roles) {
  const total = roles.reduce((a, r) => a + r.weight, 0);
  let n = Math.random() * total;
  for (const r of roles) { n -= r.weight; if (n < 0) return r; }
  return roles[roles.length - 1];
}

function makeDungeon(ctx, { kindId, level, title, boss = false, pool, sizeScale = 1 }) {
  const { C, items } = ctx;
  const kind = C.dungeonKinds.find(k => k.id === kindId) || pick(C.dungeonKinds);
  const material = pick(kind.materials);
  const motif = pick(kind.motifs);
  // How big this one is, on top of what its kind and its place in the story
  // already ask for. A campaign of identically sized sites reads as one site
  // drawn nine times, so some are a handful of rooms and some sprawl.
  const SPREAD = [
    { id: 'cramped', label: 'cramped', rooms: 0.62, floor: 0.86, weight: 3 },
    { id: 'ordinary', label: 'ordinary', rooms: 1, floor: 1, weight: 5 },
    { id: 'large', label: 'large', rooms: 1.45, floor: 1.12, weight: 3 },
    { id: 'sprawling', label: 'sprawling', rooms: 2.05, floor: 1.24, weight: 2 },
  ];
  const spread = (() => {
    const total = SPREAD.reduce((a, x) => a + x.weight, 0);
    let n = Math.random() * total;
    for (const x of SPREAD) { n -= x.weight; if (n < 0) return x; }
    return SPREAD[1];
  })();
  const count = Math.max(4, Math.round(int(kind.size[0], kind.size[1]) * sizeScale * spread.rooms));

  const roles = C.nodeRoles.filter(r => r.weight > 0);
  const nodes = [];
  for (let i = 0; i < count; i++) {
    const roleDef = i === 0 ? C.nodeRoles.find(r => r.id === 'threshold')
      : (boss && i === count - 1) ? C.nodeRoles.find(r => r.id === 'boss')
        : weightedRole(kind.trapHeavy ? roles : roles.filter(r => r.id !== 'trap' || chance(0.5)));
    const node = {
      id: `${String.fromCharCode(97 + Math.floor(i / 26))}${i + 1}`,
      role: roleDef.id,
      roleLabel: roleDef.label,
      description: '',   // written once the exits are known
      dressing: chance(0.6) ? pick(C.dressings) : null,
      light: pick(C.lightLevels),
      exits: [],
      beats: [],
    };
    nodes.push(node);
  }

  // Real geometry: the engine places every room on a 5-ft grid and routes
  // corridors between them, and adjacency is read off what it drew, so the
  // map and the room tiles can never disagree about what connects to what.
  // Big sites go down as well as across: around nine rooms to a level, up
  // to three levels, each level its own map joined to the next by a stair.
  // Exits and text treat the stair like any other way on.
  let map;
  const nLevels = Math.min(3, Math.ceil(nodes.length / 9));
  if (nLevels > 1) {
    const perLevel = Math.ceil(nodes.length / nLevels);
    const groups = [];
    for (let i = 0; i < nodes.length; i += perLevel) groups.push(nodes.slice(i, i + perLevel));
    const stairs = [];
    const levels = groups.map((g, i) => {
      const lopts = { roomScale: spread.floor };
      if (i > 0) lopts.stairUp = g[0].id;
      if (i < groups.length - 1) {
        lopts.stairDown = g[g.length - 1].id;
        stairs.push({ down: g[g.length - 1].id, up: groups[i + 1][0].id });
      }
      return generateDungeonMap(g, kind.id, lopts);
    });
    map = {
      grid: levels[0].grid, style: levels[0].style, levels, stairs,
      adjacency: Object.assign({}, ...levels.map(l => l.adjacency)),
      thinJunctions: levels.flatMap(l => l.thinJunctions),
    };
    for (const st of stairs) {
      map.adjacency[st.down] = [...(map.adjacency[st.down] || []), st.up];
      map.adjacency[st.up] = [st.down, ...(map.adjacency[st.up] || [])];
    }
  } else {
    map = generateDungeonMap(nodes, kind.id, { roomScale: spread.floor });
  }

  // A junction the geometry could not give three ways out is not a junction;
  // demote it to an empty room rather than let the read-aloud text lie.
  for (const id of map.thinJunctions) {
    const n = nodes.find(x => x.id === id);
    const mr = (map.levels ? map.levels.flatMap(l => l.rooms) : map.rooms).find(r => r.id === id);
    if (n) { n.role = 'empty'; n.roleLabel = C.nodeRoles.find(r => r.id === 'empty').label; }
    if (mr) mr.role = 'empty';
  }

  const order = new Map(nodes.map((n, i) => [n.id, i]));
  for (const n of nodes) {
    n.exits = (map.adjacency[n.id] || []).slice().sort((a, b) => order.get(a) - order.get(b));
  }
  // The way in is a way out as well. Listing it keeps the first room honest:
  // a party can always turn round and leave, and the room's passage count
  // has to include the doorway they came through.
  if (nodes.length) nodes[0].exits = ['outside', ...nodes[0].exits];

  // Now the descriptions, which can finally tell the truth about the exits.
  const COUNT_WORDS = ['No', 'A single', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  for (const node of nodes) {
    const templates = C.roomTemplates[node.role] || C.roomTemplates.empty;
    node.description = pick(templates)
      .replaceAll('{material}', material)
      .replaceAll('{motif}', motif)
      .replaceAll('{passages}', COUNT_WORDS[node.exits.length] || 'Several');
  }

  // The waterway, if the map grew one, appears in the text of every room it
  // crosses, so the drawing and the read-aloud agree.
  for (const lvl of (map.levels || [map])) {
    if (!lvl.water) continue;
    const line = lvl.water.kind === 'stream'
      ? 'A cold stream cuts across the floor here.'
      : 'A chasm splits the floor here, spanned where the old builders bothered.';
    for (const id of lvl.water.rooms) {
      const n = nodes.find(x => x.id === id);
      if (n) n.description += ' ' + line;
    }
  }

  // ---- what is actually in the rooms. Categories are chosen for the kind of
  // site and for what the room is for, so a mine gets shoring and ore chutes
  // where a temple gets fonts and votive candles, and a library room gets
  // shelves wherever it happens to be. Listed rather than woven into the
  // read-aloud, so a DM can spend them at whatever pace the table wants.
  const fixturePool = (node) => {
    const cats = [
      ...((C.fixturesByRole || {})[node.role] || []),
      ...((C.fixturesByKind || {})[kind.id] || []),
      'clutter',
    ];
    const seen = new Set();
    const out = [];
    for (const c of cats) {
      if (seen.has(c)) continue;
      seen.add(c);
      for (const item of (C.fixtures || {})[c] || []) out.push(item);
    }
    return out;
  };
  for (const node of nodes) {
    const pool = fixturePool(node);
    if (!pool.length) continue;
    const want = node.role === 'empty' || node.role === 'junction'
      ? (chance(0.55) ? int(1, 2) : 0)
      : int(1, 3);
    const picked = [];
    for (let i = 0; i < want * 3 && picked.length < want; i++) {
      const item = pick(pool);
      if (!picked.includes(item)) picked.push(item);
    }
    if (picked.length) node.fixtures = picked;
  }

  // ---- a few rooms are hiding something. Not a door onto the map, which the
  // geometry already handles, but a compartment: worth searching for, and
  // worth having found.
  for (const node of nodes) {
    if (node.role === 'threshold' || !chance(0.16)) continue;
    const f = pick(C.secretFeatures || []);
    if (!f) break;
    node.secret = { ...f, holds: pick(C.secretCaches || ['nothing at all, any more']) };
  }

  // ---- and the passages themselves. The engine decided where; this decides
  // what, so a corridor can be as dangerous as a room.
  // What a hallway is, not only where it runs. The engine lays the passages
  // out; this decides which of them are pillared, flooded, bone-lined or
  // part collapsed, so walking between two rooms is something to narrate.
  // Restricted to what suits the site: no sewer under a barrow.
  const hallKinds = (C.hallwayTypes || []).filter(t => !t.kinds || t.kinds.includes(kind.id));
  let hn = 0;
  for (const lvl of (map.levels || [map])) {
    for (const co of lvl.corridors || []) {
      if (co.cells.length < 5 || !hallKinds.length || !chance(0.55)) continue;
      const t = pick(hallKinds);
      const hid = `h${++hn}`;
      co.character = { id: hid, type: t.id, name: t.name, draw: t.draw || '' };
    }
  }

  // Each one carries an id the drawn glyph carries too, so clicking the
  // trap on the map opens the entry that describes it.
  const passages = [];
  let pn = 0;
  for (const lvl of (map.levels || [map])) {
    for (const f of lvl.corridorFeatures || []) {
      const pid = `p${++pn}`;
      if (f.t === 'trap') {
        const t = pick(C.passageTraps || []);
        if (t) { f.pid = pid; passages.push({ kind: 'trap', between: f.between, ...t, id: pid }); }
      } else {
        const sf = pick((C.secretFeatures || []).filter(x => x.inPassage !== false));
        if (sf) { f.pid = pid; passages.push({ kind: 'secret', between: f.between, ...sf, holds: pick(C.secretCaches || []), id: pid }); }
      }
    }
  }

  for (const lvl of (map.levels || [map])) {
    for (const co of lvl.corridors || []) {
      if (!co.character) continue;
      const t = hallKinds.find(x => x.id === co.character.type);
      passages.push({ id: co.character.id, kind: 'hallway', between: [co.a, co.b],
        name: co.character.name, desc: t ? t.desc : '' });
    }
  }

  // Each stair between levels reads as what it is at both ends.
  for (const st of (map.stairs || [])) {
    const dn = nodes.find(x => x.id === st.down);
    const up2 = nodes.find(x => x.id === st.up);
    if (dn) dn.description += ' A stair descends to the level below.';
    if (up2) up2.description += ' A stair climbs back toward the level above.';
  }

  // Beats. Encounter density is deliberately below one per room; the empty and
  // junction rooms are the pacing.
  for (const node of nodes) {
    const roleDef = C.nodeRoles.find(r => r.id === node.role);
    for (const beatKind of roleDef.beats) {
      const beat = makeBeat(ctx, beatKind, { level, pool, node, boss: boss && node.role === 'boss', items });
      if (beat) node.beats.push(beat);
    }
  }

  // Larger and alert-capable sites get a wandering table: a layer on the
  // element, per the taxonomy, not more rooms. Half the entries are sign
  // rather than contact, which is what keeps a dungeon feeling inhabited.
  let wandering = null;
  if (kind.alerts || nodes.length >= 10) {
    wandering = Array.from({ length: 6 }, (_, i) => {
      if (i < 3) return { range: String(i + 1), text: pick(C.wanderingSigns) };
      const enc = buildEncounter(pool, level, i < 5 ? 0 : 1, ctx.partySize);
      return {
        range: String(i + 1),
        text: enc ? enc.creatures.map(c => `${c.count} x ${c.name}`).join(' and ') : 'nothing, this time',
        creatures: enc?.creatures,
      };
    });
  }

  return {
    id: uid('el'),
    type: 'dungeon',
    kind: kind.id,
    title,
    subtitle: kind.label,
    summary: `${kind.label}, ${nodes.length} keyed areas. ${cap1(fill(pick(kind.origins), ctx.slots))}.`,
    // read-aloud for the approach, before the party is inside anything
    approach: kind.approaches?.length
      ? fill(pick(kind.approaches), ctx.slots)
        .replaceAll('{material}', material)
        .replaceAll('{motif}', motif)
      : null,
    hazard: chance(0.5) ? pick(C.hazards) : null,
    alerts: kind.alerts ? 'Once the site is alerted, surviving occupants regroup at the deepest defensible room and post watches on the approach.' : null,
    wandering,
    passages,
    map,
    nodes,
  };
}

function makeBeat(ctx, kindId, { level, pool, boss, items }) {
  const { C } = ctx;
  if (kindId === 'combat') {
    const diff = boss ? 3 : pick([1, 2, 2, 2, 3]);
    const enc = buildEncounter(pool, boss ? level + 1 : level, diff, ctx.partySize);
    if (!enc) return null;
    return {
      id: uid('beat'),
      kind: 'encounter',
      title: boss ? 'Lair confrontation' : 'Combat',
      creatures: enc.creatures,
      xp: enc.xp,
      difficulty: enc.difficulty,
      objective: fill(pick(C.encounterObjectives), ctx.slots),
      tactics: pick(C.encounterTactics),
      morale: pick(C.encounterMorale),
      ifAvoided: fill(pick(C.encounterIfAvoided), ctx.slots),
      treasure: chance(0.4) ? treasureFor(items, level, ctx) : [],
    };
  }
  if (kindId === 'trap') {
    const t = pick(C.traps);
    return { id: uid('beat'), kind: 'trap', title: t.name, ...t };
  }
  if (kindId === 'puzzle') {
    const p = pick(C.puzzles);
    return { id: uid('beat'), kind: 'puzzle', title: p.name, ...p };
  }
  if (kindId === 'treasure') {
    return { id: uid('beat'), kind: 'treasure', title: 'Cache', treasure: treasureFor(items, level, ctx, { major: chance(0.3) }) };
  }
  if (kindId === 'lore') {
    return { id: uid('beat'), kind: 'lore', title: 'What can be learned here', text: `The party can find ${fill(pick(C.loreObjects), ctx.slots)}.` };
  }
  if (kindId === 'hazard') {
    return { id: uid('beat'), kind: 'hazard', title: 'Hazard', text: pick(C.hazards) };
  }
  if (kindId === 'social') {
    return { id: uid('beat'), kind: 'social', title: 'Someone is already here', text: fill(pick(C.havenOccupants), ctx.slots) };
  }
  return null;
}

/* ---------- settlement, region, event, investigation ---------- */

function makeSettlement(ctx, { title, level, isHub }) {
  const { C, names, shops } = ctx;
  const size = isHub ? pick(C.settlement.sizes.slice(1, 3)) : pick(C.settlement.sizes.slice(0, 2));
  const roster = [];
  const roleIds = isHub
    ? ['patron', 'authority', 'quartermaster', 'broker', 'specialist', 'betrayer']
    : ['authority', 'witness', 'survivor'];
  for (const r of roleIds) {
    // the patron was created up front so clues could use a real name;
    // seat them in the hub roster instead of inventing a second one
    if (r === 'patron' && isHub && ctx.recurringPatron) roster.push(ctx.recurringPatron);
    else roster.push(makeNPC(ctx, r, title));
  }

  const shopTypes = Object.keys(shops.types);
  const services = some(shopTypes, Math.min(size.services, shopTypes.length));

  return {
    id: uid('el'),
    type: 'settlement',
    title,
    subtitle: `${size.label}, population ${int(size.population[0], size.population[1]).toLocaleString()}`,
    summary: `A ${size.label} where ${fill(pick(C.settlement.problems), ctx.slots)}.`,
    ruler: `${roster.find(n => n.roleId === 'authority').name}, ${roster.find(n => n.roleId === 'authority').occupation}`,
    services,
    tavern: `The ${pick(names.tavern.adjectives)} ${pick(names.tavern.nouns)}`,
    roster,
    locations: some(C.settlement.locations, 4),
    event: fill(pick(C.settlement.events), ctx.slots),
    rumors: [
      ...some(C.settlement.rumorsTrue, 3).map(t => ({ true: true, text: fill(t, ctx.slots) })),
      ...some(C.settlement.rumorsFalse, 2).map(t => ({ true: false, text: fill(t, ctx.slots) })),
    ],
    nodes: [],
    level,
  };
}

function makeRegion(ctx, { title, level, pool }) {
  const { C, region } = ctx;
  const legs = some(C.regionLegs, 2).map(l => ({ ...l, complication: fill(l.complication, ctx.slots) }));
  const table = Array.from({ length: 6 }, (_, i) => {
    const enc = buildEncounter(pool, level, i < 3 ? 0 : 1, ctx.partySize);
    return {
      range: `${i + 1}`,
      text: enc ? enc.creatures.map(c => `${c.count} x ${c.name}`).join(' and ') : 'no encounter',
      xp: enc?.xp || 0,
    };
  });
  return {
    id: uid('el'),
    type: 'region',
    title,
    subtitle: 'Travel leg',
    summary: `Crossing ${region.label}. ${legs.map(l => `${l.label} (${l.days} days)`).join(' or ')}.`,
    legs,
    features: some(region.features, 2),
    encounterTable: table,
    nodes: [],
  };
}

function makeEvent(ctx, { title, level, pool, kindId }) {
  const { C } = ctx;
  const def = kindId ? C.eventElements.find(e => e.kind === kindId) || pick(C.eventElements) : pick(C.eventElements);
  const enc = buildEncounter(pool, level, 3, ctx.partySize);
  return {
    id: uid('el'),
    type: 'event',
    kind: def.kind,
    title,
    subtitle: def.label,
    summary: cap1(fill(def.objective, ctx.slots)),
    phases: def.phases.map((p, i) => ({ n: i + 1, text: fill(p, ctx.slots) })),
    objective: cap1(fill(def.objective, ctx.slots)),
    failure: fill(def.failure, ctx.slots),
    // id so the DM can reroll this fight like any keyed-room encounter
    climaxEncounter: enc ? { id: uid('beat'), kind: 'encounter', ...enc } : null,
    nodes: [],
  };
}

function makeInvestigation(ctx, { title, level }) {
  const { C } = ctx;
  const conclusions = [
    fill('{villain} is behind it, and here is the proof that will stand up in front of {faction}.', ctx.slots),
    fill('The way into {next} is through the service tunnels, not the gate.', ctx.slots),
    fill('{object} was moved, deliberately, by someone the party already trusts.', ctx.slots),
  ];
  return {
    id: uid('el'),
    type: 'investigation',
    title,
    subtitle: 'Investigation web',
    summary: 'Three conclusions, three independent routes to each. No single failed roll closes a line of enquiry.',
    conclusions: conclusions.map(text => ({
      id: uid('conc'),
      text,
      clues: some(C.clueTemplates, 3).map(t => fill(t, ctx.slots)),
    })),
    nodes: [],
    level,
  };
}

/* ---------- chapters ---------- */

const CHAPTER_ROLES = {
  opening_ambush: { label: 'Opening', build: 'ambush' },
  opening_arrival: { label: 'Opening', build: 'arrival' },
  hub_town: { label: 'Hub', build: 'hub' },
  spoke_site: { label: 'Site', build: 'site' },
  branch_site: { label: 'Branch', build: 'site' },
  spoke_event: { label: 'Event', build: 'event' },
  reconverge_event: { label: 'Reconvergence', build: 'event' },
  region_leg: { label: 'Journey', build: 'region' },
  investigation_web: { label: 'Investigation', build: 'investigation' },
  downtime_interlude: { label: 'Downtime', build: 'downtime' },
  faction_board: { label: 'Mission board', build: 'board' },
  settlement_siege: { label: 'Siege', build: 'siege' },
  heist_job: { label: 'Heist', build: 'heist' },
  climax_dungeon: { label: 'Climax', build: 'climax' },
};

function makeChapter(ctx, { roleId, level, index }) {
  const { C, pools } = ctx;
  const roleDef = CHAPTER_ROLES[roleId] || CHAPTER_ROLES.spoke_site;
  const chapter = {
    id: uid('ch'),
    role: roleId,
    roleLabel: roleDef.label,
    levelGate: level,
    mandatory: ['opening_ambush', 'opening_arrival', 'hub_town', 'climax_dungeon', 'reconverge_event'].includes(roleId),
    elements: [],
    npcs: [],
  };

  switch (roleDef.build) {
    case 'ambush': {
      const place = siteName(C, true, ctx.usedPlaces);
      chapter.title = `Trouble on the ${place} Road`;
      chapter.summary = `A scripted ambush that introduces ${ctx.slots.villain}'s people, followed by the small site the survivors run back to.`;
      chapter.elements.push(makeEvent(ctx, { title: `Ambush on the ${place} Road`, level, pool: pools.faction, kindId: 'chase' }));
      chapter.elements.push(makeDungeon(ctx, { kindId: 'lair', level, title: `${place} Hideout`, pool: pools.faction }));
      break;
    }
    case 'arrival': {
      const place = siteName(C, false, ctx.usedPlaces);
      chapter.title = `Arrival at ${place}`;
      chapter.summary = `The party reaches ${ctx.slots.region} and finds the way behind them closed. First contact with what is wrong here.`;
      chapter.elements.push(makeEvent(ctx, { title: `The Road Closes`, level, pool: pools.wild, kindId: 'set_piece' }));
      chapter.elements.push(makeDungeon(ctx, { kindId: 'ruin', level, title: place, pool: pools.wild, sizeScale: 0.7 }));
      break;
    }
    case 'hub': {
      chapter.title = ctx.slots.hub;
      chapter.summary = `The base of operations: services, quest givers, a rumour table, and a small site underneath it that nobody talks about.`;
      const town = makeSettlement(ctx, { title: ctx.slots.hub, level, isHub: true });
      chapter.elements.push(town);
      chapter.elements.push(makeDungeon(ctx, { kindId: pick(['mine', 'ruin', 'temple']), level, title: `Under ${ctx.slots.hub}`, pool: pools.faction, sizeScale: 0.6 }));
      chapter.npcs = town.roster;
      break;
    }
    case 'site': {
      const place = siteName(C, false, ctx.usedPlaces);
      chapter.title = place;
      const kindId = pick(['tomb', 'ruin', 'stronghold', 'temple', 'mine', 'wreck', 'planar']);
      chapter.summary = `A self-contained site. ${ctx.slots.villain} has an interest here and has left people to protect it.`;
      chapter.elements.push(makeDungeon(ctx, { kindId, level, title: place, pool: pools.faction }));
      if (chance(0.5)) {
        const town = makeSettlement(ctx, { title: settlementName(ctx.names, ctx.usedPlaces), level, isHub: false });
        chapter.elements.push(town);
        chapter.npcs = town.roster; // so the appendix knows these people exist
      }
      break;
    }
    case 'event': {
      const place = chance(0.5) ? ctx.slots.hub : siteName(C, true, ctx.usedPlaces);
      const def = pick(C.eventElements);
      const title = fill(pick(def.titles), { ...ctx.slots, place });
      chapter.title = title;
      chapter.summary = `${def.label}. ${cap1(fill(def.objective, ctx.slots))}`;
      chapter.elements.push(makeEvent(ctx, { title, level, pool: pools.faction, kindId: def.kind }));
      break;
    }
    case 'region': {
      // hexcrawl patterns take two travel legs; give the second its own name
      ctx.regionLegs = (ctx.regionLegs || 0) + 1;
      const legTitle = ctx.regionLegs === 1 ? `Across ${ctx.slots.region}` : `Deeper into ${ctx.slots.region}`;
      chapter.title = legTitle;
      chapter.summary = 'Procedural travel: routes, days, checks, and a table that keeps the country dangerous.';
      chapter.elements.push(makeRegion(ctx, { title: legTitle, level, pool: pools.wild }));
      chapter.elements.push(makeDungeon(ctx, { kindId: pick(['lair', 'wreck', 'ruin']), level, title: siteName(C, false, ctx.usedPlaces), pool: pools.wild, sizeScale: 0.7 }));
      break;
    }
    case 'downtime': {
      const d = C.downtime;
      chapter.title = fill(pick(d.titles), ctx.slots);
      chapter.summary = d.summary;
      chapter.elements.push({
        id: uid('el'), type: 'downtime', title: chapter.title, subtitle: 'Downtime interlude',
        summary: fill(d.summary, ctx.slots),
        activities: d.activities.map(a => fill(a, ctx.slots)),
        complications: some(d.complications, 3).map(a => fill(a, ctx.slots)),
        worldMoves: fill(d.worldMoves, ctx.slots),
        nodes: [],
      });
      break;
    }
    case 'board': {
      const b = C.missionBoard;
      chapter.title = fill(pick(b.titles), ctx.slots);
      chapter.summary = b.summary;
      chapter.elements.push({
        id: uid('el'), type: 'board', title: chapter.title, subtitle: 'Mission board',
        summary: fill(b.summary, ctx.slots),
        jobs: some(b.jobs, 4).map(j => ({ ...j, twist: fill(j.twist, ctx.slots) })),
        note: fill(b.note, ctx.slots),
        nodes: [],
      });
      break;
    }
    case 'siege': {
      const g = C.siege;
      const place = chance(0.5) ? ctx.slots.hub : settlementName(ctx.names, ctx.usedPlaces);
      chapter.title = fill(pick(g.titles), { ...ctx.slots, place });
      chapter.summary = g.summary;
      chapter.elements.push({
        id: uid('el'), type: 'siege', title: chapter.title, subtitle: 'Siege',
        summary: fill(g.summary, { ...ctx.slots, place }),
        phases: g.phases.map((t, i) => ({ n: i + 1, text: fill(t, { ...ctx.slots, place }) })),
        assignments: g.assignments.map(a => fill(a, ctx.slots)),
        note: g.note,
        climaxEncounter: (() => {
          const enc = buildEncounter(pools.faction, level, 3, ctx.partySize);
          return enc ? { id: uid('beat'), kind: 'encounter', ...enc } : null;
        })(),
        nodes: [],
      });
      break;
    }
    case 'heist': {
      const h = C.heist;
      const place = siteName(C, false, ctx.usedPlaces);
      chapter.title = fill(pick(h.titles), { ...ctx.slots, place });
      chapter.summary = h.summary;
      chapter.elements.push({
        id: uid('el'), type: 'heist', title: chapter.title, subtitle: 'Heist',
        summary: fill(h.summary, { ...ctx.slots, place }),
        phases: h.phases.map((t, i) => ({ n: i + 1, text: fill(t, { ...ctx.slots, place }) })),
        waysIn: some(h.waysIn, 3),
        complications: some(h.complications, 2).map(c => fill(c, ctx.slots)),
        nodes: [],
      });
      break;
    }
    case 'investigation': {
      chapter.title = `Following It Back`;
      chapter.summary = 'A clue web rather than a place. Every conclusion has three independent routes to it.';
      chapter.elements.push(makeInvestigation(ctx, { title: 'The Web', level }));
      break;
    }
    case 'climax': {
      // Named before any chapter was built, so lore objects and treasure
      // maps could foreshadow the finale by its real name.
      const place = ctx.climaxName || siteName(C, false, ctx.usedPlaces);
      chapter.title = place;
      // The finale follows the campaign's verb. Only "recover the scattered"
      // ends in a hole in the ground; proving a case ends in a hearing,
      // breaking a plan ends mid-rite, holding a thing ends under assault.
      const climaxDef = (ctx.C.climaxKinds || {})[ctx.climaxKind] || { elementKinds: ['megadungeon', 'stronghold', 'temple'] };
      if (climaxDef.event) {
        chapter.summary = `The last confrontation. ${ctx.slots.villain} is here, and so is everything they have left.`;
        chapter.elements.push(makeEvent(ctx, { title: place, level, pool: pools.faction, kindId: climaxDef.event }));
        if (climaxDef.site) {
          chapter.elements.push(makeDungeon(ctx, {
            kindId: climaxDef.site, level, title: `Inside ${place}`,
            pool: pools.faction, boss: true, sizeScale: 0.7,
          }));
        }
      } else {
        chapter.summary = `The last site. ${ctx.slots.villain} is here, and so is everything they have left.`;
        chapter.elements.push(makeDungeon(ctx, {
          kindId: pick(climaxDef.elementKinds), level, title: place,
          pool: pools.faction, boss: true, sizeScale: 1,
        }));
      }
      break;
    }
  }

  // the opening chapter has no previous chapter for a hook to point back at
  const hookPool = index === 1 ? C.entryHooks.filter(h => !h.includes('previous chapter')) : C.entryHooks;
  chapter.entry = fill(pick(hookPool), ctx.slots);
  chapter.stakes = fill(pick(C.exitStakes), ctx.slots);

  // Every chapter opens with a player-facing scene and a goal stated in the
  // players' terms. Both use the villain's epithet, never the name, so they
  // stay sayable even when the premise keeps the villain hidden.
  const sceneSlots = { ...ctx.slots, place: chapter.title };
  chapter.scene = fill(pick(C.chapterScenes[roleDef.build] || C.chapterScenes.site), sceneSlots);
  chapter.playerGoal = fill(pick(C.chapterGoals[roleDef.build] || C.chapterGoals.site), sceneSlots);

  chapter.index = index;
  return chapter;
}

/* ---------- chaining ---------- */

// The connective tissue. Every chapter except the last gets three independent
// pointers onward, placed in different elements where possible, so a single
// missed roll or skipped room never strands the party.
//
// Where the pointers aim respects the structure instead of flattening it:
// - a mandatory chapter leads to whatever comes next;
// - an optional spoke leads to the next MANDATORY chapter, never to a
//   sibling spoke, so spokes stay order-free the way the pattern promises;
// - the hub's clues fan out, one per upcoming spoke, and the hub also gets a
//   job board listing every spoke hanging off it.
function chainChapters(ctx, chapters) {
  const { C } = ctx;

  const targetsFor = (i) => {
    const ch = chapters[i];
    if (ch.role === 'hub_town') {
      const spokes = [];
      for (let j = i + 1; j < chapters.length && spokes.length < 3; j++) {
        if (!chapters[j].mandatory) spokes.push(chapters[j]);
        else { if (!spokes.length) spokes.push(chapters[j]); break; }
      }
      return spokes;
    }
    if (!ch.mandatory) {
      const t = chapters.slice(i + 1).find(c => c.mandatory) || chapters[i + 1];
      return [t];
    }
    return [chapters[i + 1]];
  };

  chapters.forEach((ch, i) => {
    if (i === chapters.length - 1) { ch.link = null; return; }
    const targets = targetsFor(i).filter(Boolean);
    if (!targets.length) { ch.link = null; return; }

    // the hub's job board: every optional chapter hanging off it, with hooks
    if (ch.role === 'hub_town') {
      const board = [];
      for (let j = i + 1; j < chapters.length && !chapters[j].mandatory; j++) board.push(chapters[j]);
      ch.board = board.map(s => ({ id: s.id, title: s.title, role: s.roleLabel, entry: s.entry, level: s.levelGate }));
    }

    const placements = [];
    const nodes = ch.elements.flatMap(el => (el.nodes || []).map(n => ({ el, n })));
    const texts = some(C.clueTemplates, 3);
    texts.forEach((template, idx) => {
      const target = targets[idx % targets.length];
      const slots = { ...ctx.slots, next: target.title, place: ch.title };
      const text = fill(template, slots);
      const clue = { id: uid('clue'), text, pointsTo: target.id, pointsToTitle: target.title };
      if (nodes.length) {
        const spot = nodes[Math.floor((idx + 1) * nodes.length / (texts.length + 1))] || nodes[0];
        spot.n.beats.push({ id: uid('beat'), kind: 'clue', title: 'Clue onward', text, pointsToTitle: target.title });
        clue.placement = `${spot.el.title}, area ${spot.n.id}`;
      } else {
        const el = ch.elements[idx % ch.elements.length];
        (el.freeClues ||= []).push(text);
        clue.placement = `${el.title} (${el.subtitle})`;
      }
      placements.push(clue);
    });
    ch.link = {
      toId: targets[0].id,
      toTitle: targets[0].title,
      heading: targets.length > 1 ? 'Where the work leads' : `Leads to ${targets[0].title}`,
      summary: fill(pick(C.linkSummaries), { ...ctx.slots, next: targets[0].title, place: ch.title }),
      clues: placements,
    };
  });
}

/* ---------- shared assembly helpers (used by generate and reroll) ---------- */

// Milestone leveling, spelled out so nobody has to count XP unless they
// want to. Mandatory chapters gate the level; optional ones share credit.
function assignMilestones(chapters) {
  chapters.forEach((ch, i) => {
    const next = chapters[i + 1];
    if (!next) {
      ch.milestone = `Finishing this chapter ends the campaign at level ${ch.levelGate}.`;
    } else if (ch.mandatory) {
      ch.milestone = next.levelGate > ch.levelGate
        ? `Milestone: the party reaches level ${next.levelGate} when this chapter's business is resolved.`
        : 'No level change here; the next gate comes with the next mandatory chapter.';
    } else {
      ch.milestone = 'Optional: no level gate of its own. Completing any two optional chapters in this act advances the party one level.';
    }
  });
}

// How far each chapter sits from the hub, so the country has distances.
function assignTravel(ctx, ch, index) {
  if (ch.role === 'hub_town') { ch.travel = null; return; }
  if (index === 0) {
    ch.travel = `On the road into ${ctx.slots.region}, before ${ctx.slots.hub} is reached.`;
    return;
  }
  const leg = pick(ctx.C.regionLegs);
  const days = Math.max(1, Math.round(leg.days * (0.6 + Math.random() * 0.9)));
  ch.travel = `${days} day${days > 1 ? 's' : ''} from ${ctx.slots.hub}: ${leg.label.toLowerCase()}. ${leg.checks}.`;
}

// Remove everything chainChapters and objective placement wrote into other
// people's nodes, so both can be re-run after a chapter is replaced.
function stripChain(chapters) {
  for (const ch of chapters) {
    ch.board = undefined;
    ch.link = null;
    for (const el of ch.elements) {
      el.freeClues = undefined;
      for (const node of el.nodes || []) {
        node.beats = node.beats.filter(b => b.kind !== 'clue');
      }
    }
  }
}

// Drop an objective item into a chapter: last keyed area of its first mapped
// element, or the element itself when there are no nodes. The chapter's
// player-facing goal picks up a rumour-level hint that the item is here.
function placeObjectiveItem(ctx, item, ch) {
  item.chapterId = ch.id;
  item.chapterTitle = ch.title;
  ch.objective = item;
  const el = ch.elements.find(e => e.nodes?.length) || ch.elements[0];
  const node = el.nodes?.length ? el.nodes[el.nodes.length - 1] : null;
  if (node) node.beats.push({ id: uid('beat'), kind: 'objective', title: item.name, text: item.note });
  else (el.objectiveNote ||= []).push(`${item.name}: ${item.note}`);
  if (ch.playerGoal && !ch.playerGoal.includes(ctx.slots.object)) {
    ch.playerGoal += ` ${fill(pick(ctx.C.goalObjectiveHints), { ...ctx.slots, place: ch.title })}`;
  }
}

// The toughest fight in a chapter, preferring a boss chamber outright.
function leadBeatOf(ch) {
  let best = null;
  for (const el of ch.elements) {
    for (const node of el.nodes || []) {
      for (const b of node.beats) {
        if (b.kind === 'encounter' && (!best || (b.xp || 0) > (best.beat.xp || 0) || node.role === 'boss')) {
          best = { beat: b, el, node };
          if (node.role === 'boss') return best;
        }
      }
    }
  }
  return best;
}

// Appendix and totals walk. Travel and wandering tables are deliberately
// excluded from the XP figure: it counts fights the book actually places.
function computeTotals(chapters) {
  const creatures = new Map();
  const magicItems = new Map();
  let encounterCount = 0, nodeCount = 0, xpTotal = 0, gp = 0;
  const rarities = {};
  const takeTreasure = (list) => {
    for (const t of list || []) {
      if (t.kind === 'magic') { magicItems.set(t.slug, t); rarities[t.rarity] = (rarities[t.rarity] || 0) + 1; }
      if (t.kind === 'coin') gp += t.gp || 0;
    }
  };
  for (const ch of chapters) {
    for (const el of ch.elements) {
      nodeCount += el.nodes?.length || 0;
      for (const node of el.nodes || []) {
        for (const b of node.beats) {
          if (b.kind === 'encounter') {
            encounterCount++;
            xpTotal += b.xp || 0;
            for (const c of b.creatures) creatures.set(c.slug, { slug: c.slug, name: c.name, cr: c.cr });
          }
          takeTreasure(b.treasure);
        }
      }
      if (el.climaxEncounter) {
        encounterCount++;
        xpTotal += el.climaxEncounter.xp || 0;
        for (const c of el.climaxEncounter.creatures) creatures.set(c.slug, { slug: c.slug, name: c.name, cr: c.cr });
      }
    }
  }
  return {
    creatures: [...creatures.values()].sort((a, b) => parseFloat(a.cr) - parseFloat(b.cr)),
    magicItems: [...magicItems.values()],
    treasure: { gp, rarities },
    encounterCount, nodeCount, xpTotal,
  };
}

/* ---------- top level ---------- */

export async function generateCampaign(opts = {}) {
  const [monsters, items, C, names, npcTable, shops] = await Promise.all([
    loadMonsters(), loadItems(), loadTables('campaign'),
    loadTables('names'), loadTables('npc'), loadTables('shops'),
  ]);

  const premise = opts.premiseId ? C.premises.find(p => p.id === opts.premiseId) || pick(C.premises) : pick(C.premises);
  // A one-shot is a length, but it dictates the skeleton too: no six-chapter
  // shape fits in one sitting, so it overrides whatever shape was chosen.
  // The verb decides the shape of the campaign: recovering scattered things,
  // breaking the props under a plan, proving a case in public, holding one
  // thing against pressure, and so on. Each premise names the verbs its own
  // logline can carry; ten premises times three verbs is thirty shapes.
  const objKind = opts.objectiveKind && C.objectiveKinds.find(k => k.id === opts.objectiveKind)
    ? C.objectiveKinds.find(k => k.id === opts.objectiveKind)
    : C.objectiveKinds.find(k => k.id === pick(premise.objectiveKinds || ['collect'])) || C.objectiveKinds[0];

  const oneShot = opts.length === 'oneshot';
  const patternId = oneShot ? 'one_shot'
    : (opts.pattern && C.patterns[opts.pattern] ? opts.pattern : pick(premise.patterns));
  const pattern = C.patterns[patternId];
  const region = C.regionKinds[premise.regionKind];
  const villainKind = C.villainKinds[pick(premise.villainKinds)];

  // Level range and party size come from the table that will actually play
  // it: the start level defaults from the Party Tracker in the UI, and every
  // encounter budget in the campaign is computed against this party.
  const length = opts.length || 'standard';
  const span = oneShot ? 0 : length === 'short' ? 4 : length === 'epic' ? 14 : 9;
  const startLevel = Math.min(20, Math.max(1, Number(opts.startLevel) || 1));
  const endLevel = Math.min(20, startLevel + span);
  const partySize = Math.min(8, Math.max(1, Number(opts.partySize) || 4));

  const usedNames = new Set();
  const usedPlaces = new Set();
  const usedDilemmas = new Set();
  const regionName = `${pick(names.settlement.prefixes)}${pick(['march', 'reach', 'vale', 'hollow', 'moor', 'downs', 'weald'])}`;
  usedPlaces.add(regionName);
  const hubName = settlementName(names, usedPlaces);
  const villainPerson = personName(names, null, usedNames);
  const villainTitle = pick(villainKind.titles);

  const pools = buildPools(monsters, villainKind, region.terrain);

  const factionDefs = some(C.factions, 3).map(f => ({
    id: uid('fac'),
    name: f.name.replace('{settlement}', hubName),
    goal: f.goal, offers: f.offers, demands: f.demands, attitude: f.attitude,
  }));

  // The climax site is named before anything else exists, and {next} defaults
  // to it. Any lore object or treasure map generated mid-campaign that
  // mentions {next} therefore foreshadows the finale by its real name,
  // instead of reading "a map with the next site circled".
  const climaxName = siteName(C, false, usedPlaces);

  const slots = {
    villain: villainPerson.name,
    villainTitle,
    region: regionName,
    hub: hubName,
    faction: factionDefs[0].name,
    object: premise.objective.noun,
    objects: premise.objective.plural,
    npc: '',
    place: hubName,
    next: climaxName,
  };

  const ctx = { C, names, npcTable, shops, items, monsters, pools, region, slots, usedNames, usedPlaces, climaxName, partySize, climaxKind: objKind.climax };

  // The patron exists before anything else so that every {npc} slot resolves
  // to a person who is actually in the campaign, seated in the hub roster,
  // rather than a name that appears once in a clue and nowhere else.
  const patron = makeNPC(ctx, 'patron', hubName);
  ctx.recurringPatron = patron;
  slots.npc = patron.name;

  // Objective items: real named things the chapters can hold. The premise
  // supplies the noun and the stakes; the verb supplies the count, what the
  // party does with each one, and how the whole thing ends.
  const objCount = Math.max(1, objKind.count || premise.objective.count || 3);
  const objSlots = { ...slots, count: objCount };
  const objective = {
    ...premise.objective,
    count: objCount,
    kind: objKind.id,
    kindLabel: objKind.label,
    verb: objKind.tokenVerb,
    placement: objKind.placement,
    frame: fill(objKind.frame, objSlots),
    why: fill(premise.objective.why, objSlots),
    ifLost: fill(premise.objective.ifLost, objSlots),
    failure: fill(objKind.failure, objSlots),
    playerGoal: fill(objKind.playerGoal, objSlots),
    items: [],
  };

  // Build the spine.
  const acts = [];
  const allChapters = [];
  let level = startLevel;
  const totalChapters = pattern.acts.reduce((a, act) => a + act.chapters.length, 0);
  const step = Math.max(1, Math.round((endLevel - startLevel) / Math.max(1, totalChapters - 1)));

  for (const actDef of pattern.acts) {
    const act = { id: uid('act'), title: actDef.title, levelGate: level, chapters: [] };
    for (const roleId of actDef.chapters) {
      const ch = makeChapter(ctx, { roleId, level, index: allChapters.length + 1 });
      act.chapters.push(ch);
      allChapters.push(ch);
      level = Math.min(endLevel, level + step);
    }
    acts.push(act);
  }

  chainChapters(ctx, allChapters);
  assignMilestones(allChapters);
  allChapters.forEach((ch, i) => assignTravel(ctx, ch, i));

  // Scatter the campaign objects across non-hub chapters, back to front, so
  // the last one is always in the climax. Each is a real object at the
  // table: a use, a burden, and a villain reaction when it is claimed.
  const candidates = allChapters.filter(c => c.role !== 'hub_town');
  const climaxChapter = candidates[candidates.length - 1];

  const makeItem = (i, place) => ({
    id: uid('obj'),
    name: objective.count === 1
      ? `The ${objective.noun}`
      : `The ${['First', 'Second', 'Third', 'Fourth', 'Fifth'][i] || `${i + 1}th`} ${objective.noun}`,
    note: fill(pick(objKind.tokenNotes || C.objectiveNotes), { ...slots, place }),
    power: fill(pick(C.objectivePowers), slots),
    cost: fill(pick(C.objectiveCosts), slots),
    reaction: fill(pick(C.objectiveReactions), { ...slots, place }),
  });

  if (objective.placement === 'carried') {
    // Nothing to go and find: the party already has it, or is standing in
    // front of it, and every chapter is somebody trying to take it.
    const item = makeItem(0, hubName);
    item.chapterTitle = 'With the party';
    objective.items.push(item);
    allChapters.forEach((ch, i) => {
      if (i === 0) return;
      ch.wardThreat = fill(pick(C.wardThreats), { ...slots, place: ch.title });
    });
  } else {
    const holders = [
      ...some(candidates.slice(0, -1), Math.max(0, objective.count - 1)).sort((a, b) => a.index - b.index),
      climaxChapter,
    ].filter(Boolean);
    holders.forEach((ch, i) => {
      const item = makeItem(i, ch.title);
      objective.items.push(item);
      placeObjectiveItem(ctx, item, ch);
    });
  }

  // Villain, lieutenants, and a schedule that runs whether the party shows up.
  const villainBand = pools.faction.filter(m => m.cr >= endLevel - 3 && m.cr <= endLevel + 4);
  const villainStat = villainBand.length ? pick(villainBand) : null;
  const villain = {
    id: uid('vil'),
    name: villainPerson.name,
    title: villainTitle,
    ancestry: villainPerson.ancestry,
    kind: villainKind.label,
    goal: fill(pick(villainKind.goals), slots),
    method: pick(villainKind.methods),
    resources: some(villainKind.resources, 2).map(r => fill(r, slots)),
    weakness: pick(villainKind.weaknesses),
    statSuggestion: villainStat ? { slug: villainStat.slug, name: villainStat.name, cr: fmtCR(villainStat.cr) } : null,
    lieutenants: some(villainKind.lieutenants, 2).map(l => {
      const p = personName(names, null, usedNames);
      // strictly below the boss: a lieutenant outranking the villain reads
      // as a mistake at the table
      const cap = villainStat ? villainStat.cr : endLevel;
      let band = pools.faction.filter(m => m.cr >= Math.max(1, endLevel / 2) && m.cr < cap);
      if (!band.length) band = pools.faction.filter(m => m.cr >= 1 && m.cr < cap);
      const stat = band.length ? pick(band) : null;
      return {
        id: uid('lt'), name: p.name, ancestry: p.ancestry, note: fill(l, slots),
        statSuggestion: stat ? { slug: stat.slug, name: stat.name, cr: fmtCR(stat.cr) } : null,
      };
    }),
    timeline: allChapters.map((ch, i) => ({
      when: `While chapter ${i + 1} (${ch.title}) sits unresolved`,
      move: fill(pick(C.villainMoves), { ...slots, place: ch.title }),
    })),
  };

  // Dilemmas: one per act, in a chapter that is not the hub. The taxonomy
  // calls these out as an encounter type and nothing was generating them,
  // yet a choice with no right answer is what a table still argues about
  // months later. They are placed on the chapter rather than in a room,
  // because the DM should be able to spring one whenever the moment fits.
  const dilemmaSlots = { ...slots };
  for (const act of acts) {
    const candidates = act.chapters.filter(ch => ch.role !== 'hub_town');
    if (!candidates.length) continue;
    const host = pick(candidates);
    if (host.dilemma) continue;
    const def = pick(C.dilemmas.filter(d => !usedDilemmas.has(d.id)) || C.dilemmas);
    if (!def) continue;
    usedDilemmas.add(def.id);
    host.dilemma = {
      id: uid('dil'),
      situation: fill(def.situation, dilemmaSlots),
      options: [
        { label: def.optionA.label, cost: fill(def.optionA.cost, dilemmaSlots) },
        { label: def.optionB.label, cost: fill(def.optionB.cost, dilemmaSlots) },
      ],
      noGoodAnswer: fill(def.noGoodAnswer, dilemmaSlots),
      later: fill(def.later, dilemmaSlots),
      framing: pick(C.dilemmaFraming),
    };
  }

  // The second axis. One antagonist gives a campaign one shape: go there,
  // kill that. A rival with their own goal that crosses the villain's gives
  // the party a choice at every site, and an ending that depends on who they
  // decided to back. The rival is not evil, just inconvenient.
  const rivalKind = pick(C.rivalKinds);
  const rivalPerson = personName(names, null, usedNames);
  const rivalOrg = pick(rivalKind.orgForms)
    .replace('{adj}', pick(C.rivalAdjectives))
    .replace('{name}', rivalPerson.name.split(' ')[1] || rivalPerson.name.split(' ')[0]);
  const rivalSlots = { ...slots, rival: rivalOrg, name: rivalPerson.name };
  const rivalStatName = pick(rivalKind.stat);
  const rivalStat = monsters.find(m => m.name === rivalStatName);

  const rival = {
    id: uid('riv'),
    org: rivalOrg,
    leader: rivalPerson.name,
    ancestry: rivalPerson.ancestry,
    title: pick(rivalKind.titles),
    kind: rivalKind.label,
    wants: fill(rivalKind.wants, rivalSlots),
    method: fill(rivalKind.method, rivalSlots),
    crosses: fill(rivalKind.crosses, rivalSlots),
    offers: fill(rivalKind.offers, rivalSlots),
    demands: fill(rivalKind.demands, rivalSlots),
    ifAllied: fill(rivalKind.ifAllied, rivalSlots),
    ifCrossed: fill(rivalKind.ifCrossed, rivalSlots),
    leverage: fill(rivalKind.leverage, rivalSlots),
    firstMeeting: fill(pick(C.rivalFirstMeetings), rivalSlots),
    stances: C.rivalStances,
    defaultStance: 'wary',
    statSuggestion: rivalStat ? { slug: rivalStat.slug, name: rivalStat.name, cr: fmtCR(rivalStat.cr) } : null,
  };

  // They turn up in person across the middle of the campaign: first contact
  // early, then at roughly every other chapter, never in the hub (where the
  // party would simply corner them) and never before the party has met them.
  const rivalStops = allChapters.filter(ch => ch.role !== 'hub_town' && ch.index > 1);
  const cadence = Math.max(1, Math.round(rivalStops.length / 3));
  rival.appearances = rivalStops
    .filter((_, i) => i % cadence === 0)
    .slice(0, 3)
    .map((ch, i) => {
      const move = i === 0 ? rival.firstMeeting : fill(pick(C.rivalMoves), rivalSlots);
      ch.rival = { org: rivalOrg, move, first: i === 0 };
      return { chapterId: ch.id, chapterTitle: ch.title, move, first: i === 0 };
    });

  // Choices that bind. The campaign carries a short list of things the party
  // might do, and every chapter after the first holds one prepared sentence
  // per flag. Nothing fires automatically: the DM sets a flag when the table
  // earns it, and the chapters that follow start saying so.
  const flagSlots = { ...slots, rival: rivalOrg };
  const flags = C.campaignFlags.map(f => ({
    id: f.id,
    label: fill(f.label, flagSlots),
    prompt: fill(f.prompt, flagSlots),
  }));
  allChapters.forEach((ch, i) => {
    if (i === 0) return; // the opening has nothing behind it to react to
    ch.reactions = C.campaignFlags.map(f => ({
      flag: f.id,
      label: fill(f.label, flagSlots),
      text: fill(pick(f.reactions), flagSlots),
    }));
  });

  // Put the antagonist layer on the map instead of leaving it in an appendix:
  // the villain personally leads the climax boss fight, and each lieutenant
  // commands the toughest encounter of a mid-campaign chapter.
  const climaxCh = allChapters[allChapters.length - 1];
  const climaxSpot = leadBeatOf(climaxCh);
  if (climaxSpot) {
    climaxSpot.beat.leader = {
      name: `${villain.name}, ${villain.title}`,
      statSuggestion: villain.statSuggestion,
      note: `Exploit at the table: ${villain.weakness}`,
    };
    climaxSpot.beat.title = 'The final confrontation';
    villain.where = `${climaxCh.title}, area ${climaxSpot.node.id}`;
  }

  const ltChapters = allChapters.filter(ch =>
    ch !== climaxCh && ch.role !== 'hub_town' && ch.elements.some(e => e.nodes?.length));
  villain.lieutenants.forEach((lt, i) => {
    const ch = ltChapters.length ? ltChapters[Math.min(ltChapters.length - 1, Math.floor((i + 1) * ltChapters.length / (villain.lieutenants.length + 1)))] : null;
    const spot = ch && leadBeatOf(ch);
    if (spot) {
      spot.beat.leader = { name: lt.name, statSuggestion: lt.statSuggestion, note: lt.note };
      lt.where = `${ch.title}, area ${spot.node.id}`;
      ch.lieutenant = lt.name;
    }
  });

  // Roster: the hub NPCs plus a handful of travelling parts.
  const npcs = [];
  for (const ch of allChapters) npcs.push(...ch.npcs);
  for (const roleId of ['guide', 'rival', 'betrayer', 'witness']) {
    if (!npcs.some(n => n.roleId === roleId)) npcs.push(makeNPC(ctx, roleId, pick(allChapters).title));
  }
  npcs.forEach(n => { n.connection = fill(pick(C.npcConnections), { ...slots, npc: pick(npcs).name }); });

  // Every clock states what actually advances it; a clock without triggers
  // is scenery.
  const clocks = [
    { id: uid('clk'), label: fill(premise.clock.label, slots), segments: premise.clock.segments, onFill: fill(premise.clock.onFill, slots), global: true, advances: some(C.clockTriggers, 3).map(t => fill(t, slots)) },
    ...some(C.clocks, 2).map(c => ({ id: uid('clk'), label: fill(c.label, slots), segments: c.segments, onFill: fill(c.onFill, slots), global: false, advances: some(C.clockTriggers, 2).map(t => fill(t, slots)) })),
  ];

  // The turn. Published campaigns are remembered for the moment the ground
  // moves, and the generator already had the raw material sitting unused in
  // the appendix: a betrayer with a secret, a rival, a patron everyone
  // trusts. Placed around the campaign's midpoint, with foreshadowing put in
  // two earlier chapters so it lands as a reveal rather than a jump-scare.
  const reversalDef = pick(C.reversals);
  const reversalNpc = reversalDef.usesNpc
    ? npcs.find(n => n.roleId === reversalDef.usesNpc) || pick(npcs)
    : null;
  const revSlots = {
    ...slots,
    npc: reversalNpc ? reversalNpc.name : slots.npc,
    rival: rival.org,
    place: hubName,
  };

  const midIndex = Math.max(1, Math.min(allChapters.length - 2, Math.round(allChapters.length * 0.6) - 1));
  const turnChapter = allChapters[midIndex];
  const reversal = {
    id: uid('rev'),
    label: reversalDef.label,
    chapterId: turnChapter.id,
    chapterTitle: turnChapter.title,
    who: reversalNpc ? reversalNpc.name : (reversalDef.usesRival ? rival.org : null),
    setup: fill(reversalDef.setup, revSlots),
    turn: fill(reversalDef.turn, revSlots),
    fallout: fill(reversalDef.fallout, revSlots),
    ifMissed: fill(reversalDef.ifMissed, revSlots),
    foreshadow: [],
  };
  turnChapter.reversal = reversal;

  // two earlier chapters carry a line each, so the reveal has a past
  const before = allChapters.slice(0, midIndex);
  const seeds = some(reversalDef.foreshadow, Math.min(2, before.length));
  before.slice(-2).forEach((ch, i) => {
    if (!seeds[i]) return;
    const text = fill(seeds[i], revSlots);
    ch.foreshadow = text;
    reversal.foreshadow.push({ chapterId: ch.id, chapterTitle: ch.title, text });
  });

  // What the villain actually takes when the campaign clock runs on. The
  // schedule was advice; these are named losses, tied to segments of the
  // global clock, so "Too Late" is something the DM watches approaching.
  const globalClock = clocks.find(k => k.global) || clocks[0];
  const gainSlots = {
    ...slots,
    npc: pick(npcs).name,
    faction: pick(factionDefs).name,
    place: pick(allChapters.filter(ch => ch.role !== 'hub_town')).title,
    object: objective.noun,
  };
  villain.gains = some(C.villainGains, 3).map((text, i) => ({
    id: uid('gain'),
    at: Math.max(1, Math.round(globalClock.segments * (i + 1) / 4)),
    clockId: globalClock.id,
    clockLabel: globalClock.label,
    text: fill(text, gainSlots),
  })).sort((a, b) => a.at - b.at);
  villain.gains.push({
    id: uid('gain'),
    at: globalClock.segments,
    clockId: globalClock.id,
    clockLabel: globalClock.label,
    text: fill(objective.ifLost, slots),
    final: true,
  });

  const totals = computeTotals(allChapters);

  const title = chance(0.5)
    ? premise.title
    : `The ${pick(C.titleWords.adjectives)} ${pick(C.titleWords.nouns)}`;

  return {
    id: uid('camp'),
    created: Date.now(),
    title,
    logline: fill(premise.logline, slots),
    opening: fill(pick(C.openings), slots),
    playerHooks: some(C.characterHooks, 4).map(h => fill(h, slots)),
    premiseId: premise.id,
    tone: premise.tone,
    themes: premise.themes,
    pattern: { id: patternId, label: pattern.label, note: pattern.note },
    levelRange: { start: startLevel, end: endLevel },
    sessions: oneShot ? '1' : `${totalChapters * 2}-${totalChapters * 4}`,
    region: { name: regionName, kind: premise.regionKind, label: region.label, features: some(region.features, 3), terrain: region.terrain },
    hub: hubName,
    objective,
    objectiveKind: { id: objKind.id, label: objKind.label, verb: objKind.tokenVerb, climax: objKind.climax },
    villain,
    rival,
    reversal,
    flags,
    factions: factionDefs,
    clocks,
    acts,
    endings: C.endings.map(e => ({ label: e.label, text: fill(e.text, slots) })),
    appendices: {
      npcs,
      creatures: totals.creatures,
      magicItems: totals.magicItems,
    },
    treasure: totals.treasure,
    stats: {
      acts: acts.length,
      chapters: totalChapters,
      elements: allChapters.reduce((a, c) => a + c.elements.length, 0),
      nodes: totals.nodeCount,
      encounters: totals.encounterCount,
      npcs: npcs.length,
      xp: totals.xpTotal,
    },
    // everything a partial reroll needs to rebuild its generation context
    gen: {
      premiseId: premise.id,
      patternId,
      villainKindId: Object.keys(C.villainKinds).find(k => C.villainKinds[k] === villainKind),
      length, startLevel, endLevel, partySize,
    },
    slots: { ...slots },
  };
}

/* ---------- partial reroll ---------- */

// Replace one chapter with a fresh roll of the same role and level, keeping
// everything else: the chain is rebuilt, the objective item and any leader
// stationed there are re-seated, milestones and appendices recomputed.
export async function rerollChapter(campaign, chapterId) {
  const [monsters, items, C, names, npcTable, shops] = await Promise.all([
    loadMonsters(), loadItems(), loadTables('campaign'),
    loadTables('names'), loadTables('npc'), loadTables('shops'),
  ]);
  const gen = campaign.gen;
  if (!gen || !campaign.slots) throw new Error('This campaign predates rerolling; generate a new one.');

  const villainKind = C.villainKinds[gen.villainKindId] || pick(Object.values(C.villainKinds));
  const region = C.regionKinds[campaign.region.kind];
  const pools = buildPools(monsters, villainKind, campaign.region.terrain);
  const slots = { ...campaign.slots };

  const allChapters = campaign.acts.flatMap(a => a.chapters);
  const idx = allChapters.findIndex(c => c.id === chapterId);
  if (idx === -1) throw new Error('Chapter not found.');
  const old = allChapters[idx];
  const isClimax = idx === allChapters.length - 1;

  // seed the dedupe sets with everything that survives the reroll
  const usedNames = new Set(campaign.appendices.npcs.map(n => n.name));
  usedNames.add(campaign.villain.name);
  campaign.villain.lieutenants.forEach(l => usedNames.add(l.name));
  const usedPlaces = new Set([campaign.hub, campaign.region.name]);
  allChapters.forEach(c => { if (c !== old) { usedPlaces.add(c.title); c.elements.forEach(e => usedPlaces.add(e.title)); } });

  const ctx = { C, names, npcTable, shops, items, monsters, pools, region, slots, usedNames, usedPlaces, partySize: gen.partySize || 4 };
  ctx.recurringPatron = campaign.appendices.npcs.find(n => n.roleId === 'patron') || null;
  // the climax keeps its name: half the campaign's lore already points at it
  if (isClimax) ctx.climaxName = old.title;
  // travel legs are numbered by position, so a reroll keeps its own title
  // ("Across X" vs "Deeper into X") instead of duplicating its sibling's
  ctx.regionLegs = allChapters.slice(0, idx).filter(c => c.role === 'region_leg').length;

  const fresh = makeChapter(ctx, { roleId: old.role, level: old.levelGate, index: old.index });
  fresh.id = old.id; // progress marks and objective references survive

  for (const act of campaign.acts) {
    const i = act.chapters.indexOf(old);
    if (i !== -1) act.chapters[i] = fresh;
  }
  allChapters[idx] = fresh;

  // rebuild every cross-chapter layer against the new list
  stripChain(allChapters);
  chainChapters(ctx, allChapters);
  assignMilestones(allChapters);
  assignTravel(ctx, fresh, idx);

  const item = campaign.objective.items.find(it => it.chapterId === old.id);
  if (item) placeObjectiveItem(ctx, item, fresh);

  if (old.dilemma) fresh.dilemma = old.dilemma;
  if (old.reversal) {
    fresh.reversal = old.reversal;
    fresh.reversal.chapterTitle = fresh.title;
    if (campaign.reversal) campaign.reversal.chapterTitle = fresh.title;
  }
  if (old.foreshadow) fresh.foreshadow = old.foreshadow;
  if (old.reactions) fresh.reactions = old.reactions;
  // the rival was scheduled to show up here; a new site does not excuse them
  if (old.rival) {
    fresh.rival = old.rival;
    const appearance = campaign.rival?.appearances?.find(a => a.chapterId === old.id);
    if (appearance) appearance.chapterTitle = fresh.title;
  }

  if (isClimax) {
    const spot = leadBeatOf(fresh);
    if (spot) {
      spot.beat.leader = {
        name: `${campaign.villain.name}, ${campaign.villain.title}`,
        statSuggestion: campaign.villain.statSuggestion,
        note: `Exploit at the table: ${campaign.villain.weakness}`,
      };
      spot.beat.title = 'The final confrontation';
      campaign.villain.where = `${fresh.title}, area ${spot.node.id}`;
    }
  } else if (old.lieutenant) {
    const lt = campaign.villain.lieutenants.find(l => l.name === old.lieutenant);
    const spot = lt && leadBeatOf(fresh);
    if (spot) {
      spot.beat.leader = { name: lt.name, statSuggestion: lt.statSuggestion, note: lt.note };
      lt.where = `${fresh.title}, area ${spot.node.id}`;
      fresh.lieutenant = lt.name;
    }
  }

  // roster: swap the old chapter's people for the new chapter's people
  const oldIds = new Set(old.npcs.map(n => n.id));
  campaign.appendices.npcs = campaign.appendices.npcs.filter(n => !oldIds.has(n.id)).concat(fresh.npcs);
  fresh.npcs.forEach(n => { n.connection ||= fill(pick(C.npcConnections), { ...slots, npc: campaign.villain.name }); });

  const entry = campaign.villain.timeline[idx];
  if (entry) entry.when = `While chapter ${idx + 1} (${fresh.title}) sits unresolved`;

  const totals = computeTotals(allChapters);
  campaign.appendices.creatures = totals.creatures;
  campaign.appendices.magicItems = totals.magicItems;
  campaign.treasure = totals.treasure;
  Object.assign(campaign.stats, {
    elements: allChapters.reduce((a, c) => a + c.elements.length, 0),
    nodes: totals.nodeCount,
    encounters: totals.encounterCount,
    npcs: campaign.appendices.npcs.length,
    xp: totals.xpTotal,
  });
  return fresh;
}

/* ---------- which ending the campaign is heading for ---------- */

// The five endings were a list the DM read once. They are a scoreboard:
// given what the table has actually done, one of them is where this is
// pointing right now. Everything here reads state the DM already maintains
// (clock segments, flags, chapter ticks, rival stance), so nothing new has
// to be tracked to make it work.
export function endingOutlook(campaign, state = {}) {
  const { clockFill = {}, flags = {}, progress = {}, rivalStance = 'wary' } = state;
  const chapters = campaign.acts.flatMap(a => a.chapters);
  const done = chapters.filter(ch => progress[ch.id]).length;
  const mandatory = chapters.filter(ch => ch.mandatory);
  const mandatoryDone = mandatory.filter(ch => progress[ch.id]).length;
  const finished = mandatory.length > 0 && mandatoryDone === mandatory.length;

  const global = campaign.clocks.find(k => k.global) || campaign.clocks[0];
  const globalFilled = global ? (clockFill[global.id] || 0) >= global.segments : false;
  const globalPressure = global ? (clockFill[global.id] || 0) / global.segments : 0;
  const anyClockFull = campaign.clocks.some(k => (clockFill[k.id] || 0) >= k.segments);

  const why = [];
  let pick = 'Clean';

  if (globalFilled) {
    pick = 'Too Late';
    why.push(`${global.label} is full.`);
  } else if (rivalStance === 'allied' && finished) {
    pick = 'Inherited';
    why.push(`${campaign.rival.org} is allied and stands to collect once ${campaign.villain.name} is gone.`);
  } else if (rivalStance === 'allied') {
    pick = 'Bargained';
    why.push(`${campaign.rival.org} is allied, and their price is part of the settlement.`);
  } else if (flags.named_dead || flags.faction_burned || globalPressure >= 0.5 || anyClockFull) {
    pick = 'Costly';
    if (flags.named_dead) why.push('Someone under the party\'s protection is dead.');
    if (flags.faction_burned) why.push('A faction has written the party off.');
    if (globalPressure >= 0.5) why.push(`${global.label} is over half full.`);
    if (anyClockFull && !globalFilled) why.push('A regional clock has already filled.');
  } else {
    why.push('No clock is close, nobody the party was protecting has died, and no bridge is burned.');
  }

  // Things that colour the ending without changing which one it is.
  const notes = [];
  if (flags.kept_the_object) notes.push(`The party is still holding a ${campaign.objective.noun} rather than securing it, which the epilogue has to answer for.`);
  if (flags.public_win) notes.push('The party won in public, so whatever happens is credited to them by name.');
  if (flags.rival_crossed) notes.push(`${campaign.rival.org} was crossed and will be somewhere in the last act.`);
  if (finished && !globalFilled) notes.push('Every mandatory chapter is resolved; this is playable as an epilogue whenever the table is ready.');

  const ending = campaign.endings.find(e => e.label === pick) || campaign.endings[0];
  return {
    label: pick,
    text: ending.text,
    why,
    notes,
    progress: { done, total: chapters.length, mandatoryDone, mandatoryTotal: mandatory.length },
    pressure: Math.round(globalPressure * 100),
  };
}

/* ---------- targeted rerolls ---------- */

// Rebuild one encounter beat in place, keeping its position in the dungeon
// and the leader stationed there. The DM gets a different fight at the same
// budget instead of regenerating a chapter they otherwise liked.
export async function rerollEncounter(campaign, beatId) {
  const [monsters, items, C] = await Promise.all([loadMonsters(), loadItems(), loadTables('campaign')]);
  const gen = campaign.gen;
  if (!gen) throw new Error('This campaign predates rerolling; generate a new one.');

  const found = findBeat(campaign, beatId);
  if (!found) throw new Error('Encounter not found.');
  const { beat, chapter } = found;

  const villainKind = C.villainKinds[gen.villainKindId] || pick(Object.values(C.villainKinds));
  const pools = buildPools(monsters, villainKind, campaign.region.terrain);
  // wilderness travel keeps to local wildlife; everything else is the enemy
  const pool = chapter.role === 'region_leg' ? pools.wild : pools.faction;

  const DIFFS = ['easy', 'medium', 'hard', 'deadly'];
  const diff = Math.max(0, DIFFS.indexOf(beat.difficulty));
  const fresh = buildEncounter(pool, chapter.levelGate, diff === -1 ? 2 : diff, gen.partySize || 4);
  if (!fresh) throw new Error('No creatures fit that budget.');

  const ctx = { C, items, slots: campaign.slots || {} };
  beat.creatures = fresh.creatures;
  beat.xp = fresh.xp;
  beat.difficulty = fresh.difficulty;
  beat.tactics = pick(C.encounterTactics);
  beat.morale = pick(C.encounterMorale);
  refreshTotals(campaign);
  return beat;
}

// Swap a single creature line for a different creature of comparable weight,
// leaving the rest of the encounter alone.
export async function rerollCreature(campaign, beatId, slug) {
  const [monsters, C] = await Promise.all([loadMonsters(), loadTables('campaign')]);
  const gen = campaign.gen;
  if (!gen) throw new Error('This campaign predates rerolling; generate a new one.');

  const found = findBeat(campaign, beatId);
  if (!found) throw new Error('Encounter not found.');
  const { beat, chapter } = found;
  const line = beat.creatures.find(c => c.slug === slug);
  if (!line) throw new Error('Creature not found in that encounter.');

  const villainKind = C.villainKinds[gen.villainKindId] || pick(Object.values(C.villainKinds));
  const pools = buildPools(monsters, villainKind, campaign.region.terrain);
  const pool = chapter.role === 'region_leg' ? pools.wild : pools.faction;

  const current = monsters.find(m => m.slug === slug);
  const targetXP = monsterXP(current) || 100;
  const taken = new Set(beat.creatures.map(c => c.slug));
  // within half to double the XP of what it replaces, so the fight stays
  // roughly the weight it was budgeted at
  let band = pool.filter(m => !taken.has(m.slug) && monsterXP(m) >= targetXP / 2 && monsterXP(m) <= targetXP * 2);
  if (!band.length) band = pool.filter(m => !taken.has(m.slug) && inBand(m, chapter.levelGate));
  if (!band.length) throw new Error('No comparable creature available.');

  const swap = pick(band);
  line.slug = swap.slug;
  line.name = swap.name;
  line.cr = fmtCR(swap.cr);

  const size = Math.min(8, Math.max(1, gen.partySize || 4));
  const raw = beat.creatures.reduce((a, c) => {
    const m = monsters.find(x => x.slug === c.slug);
    return a + (monsterXP(m) || 0) * c.count;
  }, 0);
  const count = beat.creatures.reduce((a, c) => a + c.count, 0);
  beat.xp = Math.round(raw * encounterMultiplier(count, size));
  refreshTotals(campaign);
  return line;
}

/* ---------- targeted rerolls: people ---------- */

// A name is not only written on the card it came from. By the time a
// campaign exists it is in other people's connections, in the villain's
// schedule, in filled-in lines all over the book. Renaming sweeps the whole
// campaign so nothing goes on naming somebody who no longer exists.
function renameThroughout(campaign, oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  const rx = new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (typeof node[i] === 'string') node[i] = node[i].replace(rx, newName);
        else if (node[i] && typeof node[i] === 'object') walk(node[i]);
      }
      return;
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === 'string') node[k] = v.replace(rx, newName);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(campaign);
}

// One person can sit in more than one place: a settlement roster and the
// NPC appendix hold the same people, and they are the same objects until a
// save and reload turns them into separate copies. An edit has to reach
// every copy carrying the id or the two versions drift apart.
function eachById(campaign, id, fn) {
  let hits = 0;
  const walk = (node) => {
    if (Array.isArray(node)) { for (const v of node) if (v && typeof v === 'object') walk(v); return; }
    if (node.id === id) { fn(node); hits++; }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (v && typeof v === 'object') walk(v);
    }
  };
  walk(campaign);
  return hits;
}

// A fresh person in the same seat. The role and the place they are found in
// stay put, because that is what the rest of the book points at; everything
// that makes them who they are is rolled again.
export async function rerollNPC(campaign, npcId) {
  const [monsters, C, names, npcTable] = await Promise.all([
    loadMonsters(), loadTables('campaign'), loadTables('names'), loadTables('npc'),
  ]);
  const current = campaign.appendices?.npcs?.find(n => n.id === npcId);
  if (!current) throw new Error('NPC not found.');

  const usedNames = new Set(campaign.appendices.npcs.map(n => n.name));
  usedNames.add(campaign.villain?.name);
  (campaign.villain?.lieutenants || []).forEach(l => usedNames.add(l.name));
  usedNames.delete(current.name);

  const slots = campaign.slots || {};
  const ctx = { C, names, npcTable, monsters, usedNames, slots };
  const fresh = makeNPC(ctx, current.roleId, current.where);
  fresh.id = current.id;
  fresh.role = current.role;
  fresh.roleId = current.roleId;
  fresh.where = current.where;
  const others = campaign.appendices.npcs.filter(n => n.id !== npcId);
  fresh.connection = fill(pick(C.npcConnections), {
    ...slots,
    npc: others.length ? pick(others).name : (campaign.villain?.name || fresh.name),
  });

  const oldName = current.name;
  eachById(campaign, npcId, (n) => Object.assign(n, fresh));
  renameThroughout(campaign, oldName, fresh.name);
  return fresh;
}

// Lieutenants are the villain's, so their brief comes from the villain's own
// list and their stat block stays strictly under the boss's.
export async function rerollLieutenant(campaign, ltId) {
  const [monsters, C, names] = await Promise.all([
    loadMonsters(), loadTables('campaign'), loadTables('names'),
  ]);
  const gen = campaign.gen;
  if (!gen) throw new Error('This campaign predates rerolling; generate a new one.');
  const lt = (campaign.villain?.lieutenants || []).find(l => l.id === ltId);
  if (!lt) throw new Error('Lieutenant not found.');

  const villainKind = C.villainKinds[gen.villainKindId] || pick(Object.values(C.villainKinds));
  const pools = buildPools(monsters, villainKind, campaign.region.terrain);
  const usedNames = new Set(campaign.appendices.npcs.map(n => n.name));
  usedNames.add(campaign.villain.name);
  campaign.villain.lieutenants.forEach(l => usedNames.add(l.name));
  usedNames.delete(lt.name);

  const endLevel = campaign.levelRange?.end || 10;
  const bossSlug = campaign.villain.statSuggestion?.slug;
  const boss = bossSlug ? monsters.find(m => m.slug === bossSlug) : null;
  const cap = boss ? boss.cr : endLevel;
  let band = pools.faction.filter(m => m.cr >= Math.max(1, endLevel / 2) && m.cr < cap);
  if (!band.length) band = pools.faction.filter(m => m.cr >= 1 && m.cr < cap);
  const stat = band.length ? pick(band) : null;

  const p = personName(names, null, usedNames);
  const oldName = lt.name;
  const fresh = {
    ...lt,
    name: p.name,
    ancestry: p.ancestry,
    note: fill(pick(villainKind.lieutenants), campaign.slots || {}),
    statSuggestion: stat ? { slug: stat.slug, name: stat.name, cr: fmtCR(stat.cr) } : null,
  };
  eachById(campaign, ltId, (n) => Object.assign(n, fresh));
  renameThroughout(campaign, oldName, fresh.name);
  return fresh;
}

// The antagonist's plan is the campaign; only who they are is rerollable.
// Their goal, method and schedule are what every chapter was built around,
// so rolling those would leave a different book behind the same acts.
export async function renameVillain(campaign) {
  const names = await loadTables('names');
  if (!campaign.villain) throw new Error('No antagonist on this campaign.');
  const usedNames = new Set((campaign.appendices?.npcs || []).map(n => n.name));
  (campaign.villain.lieutenants || []).forEach(l => usedNames.add(l.name));
  const oldName = campaign.villain.name;
  const p = personName(names, null, usedNames);
  campaign.villain.name = p.name;
  campaign.villain.ancestry = p.ancestry;
  renameThroughout(campaign, oldName, p.name);
  return campaign.villain;
}

// Swap a stat block for a comparable one everywhere the campaign uses it.
// The appendix is a derived list, so there is nothing to edit there: the
// encounters holding it are what change, and the list recomputes.
export async function rerollAppendixCreature(campaign, slug) {
  const [monsters, C] = await Promise.all([loadMonsters(), loadTables('campaign')]);
  const gen = campaign.gen;
  if (!gen) throw new Error('This campaign predates rerolling; generate a new one.');

  const uses = [];
  for (const act of campaign.acts) {
    for (const chapter of act.chapters) {
      for (const el of chapter.elements) {
        const beats = [...(el.nodes || []).flatMap(n => n.beats || []), el.climaxEncounter].filter(Boolean);
        for (const beat of beats) {
          const line = (beat.creatures || []).find(c => c.slug === slug);
          if (line) uses.push({ beat, chapter, line });
        }
      }
    }
  }
  if (!uses.length) throw new Error('Nothing in the campaign uses that stat block.');

  const villainKind = C.villainKinds[gen.villainKindId] || pick(Object.values(C.villainKinds));
  const pools = buildPools(monsters, villainKind, campaign.region.terrain);
  // wilderness legs keep to local wildlife and everything else draws on the
  // villain's forces, so a block used in both has to suit both
  const needWild = uses.some(u => u.chapter.role === 'region_leg');
  const needFaction = uses.some(u => u.chapter.role !== 'region_leg');
  const wildSet = new Set(pools.wild.map(m => m.slug));
  const facSet = new Set(pools.faction.map(m => m.slug));
  const clash = (m) => uses.some(u => u.beat.creatures.some(c => c.slug === m.slug));
  const eligible = monsters.filter(m => m.slug !== slug && !clash(m)
    && (!needWild || wildSet.has(m.slug)) && (!needFaction || facSet.has(m.slug)));

  const current = monsters.find(m => m.slug === slug);
  const targetXP = monsterXP(current) || 100;
  let band = eligible.filter(m => monsterXP(m) >= targetXP / 2 && monsterXP(m) <= targetXP * 2);
  if (!band.length) band = eligible.filter(m => monsterXP(m) > 0);
  if (!band.length) throw new Error('No comparable creature available.');
  const swap = pick(band);
  const swapCR = fmtCR(swap.cr);

  const size = Math.min(8, Math.max(1, gen.partySize || 4));
  for (const { beat, line } of uses) {
    line.slug = swap.slug;
    line.name = swap.name;
    line.cr = swapCR;
    // a leader named as the old block would be pointing at a creature the
    // fight no longer contains
    if (beat.leader?.statSuggestion?.slug === slug) {
      beat.leader.statSuggestion = { slug: swap.slug, name: swap.name, cr: swapCR };
    }
    const raw = beat.creatures.reduce((a, c) =>
      a + (monsterXP(monsters.find(x => x.slug === c.slug)) || 0) * c.count, 0);
    const count = beat.creatures.reduce((a, c) => a + c.count, 0);
    beat.xp = Math.round(raw * encounterMultiplier(count, size));
  }
  refreshTotals(campaign);
  return { from: current?.name || slug, to: swap.name, fights: uses.length };
}

function findBeat(campaign, beatId) {
  for (const act of campaign.acts) {
    for (const chapter of act.chapters) {
      for (const el of chapter.elements) {
        for (const node of el.nodes || []) {
          const beat = node.beats.find(b => b.id === beatId);
          if (beat) return { beat, node, el, chapter };
        }
        if (el.climaxEncounter && el.climaxEncounter.id === beatId) {
          return { beat: el.climaxEncounter, node: null, el, chapter };
        }
      }
    }
  }
  return null;
}

// Appendices and stats are derived, so recompute them after any edit.
function refreshTotals(campaign) {
  const chapters = campaign.acts.flatMap(a => a.chapters);
  const totals = computeTotals(chapters);
  campaign.appendices.creatures = totals.creatures;
  campaign.appendices.magicItems = totals.magicItems;
  campaign.treasure = totals.treasure;
  Object.assign(campaign.stats, {
    nodes: totals.nodeCount,
    encounters: totals.encounterCount,
    xp: totals.xpTotal,
  });
}

/* ---------- player handout export ---------- */

// Only what the marking system calls player-facing: the pitch, the hooks,
// and every rumour text, with the true/false verdicts stripped. Safe to
// send to the table unread.
export function playerHandoutMarkdown(c) {
  const L = [];
  L.push(`# ${c.title}`, '', `*${c.logline}*`, '');
  L.push(`A ${c.tone.join(', ')} campaign set in ${c.region.name}, ${c.region.label}. Your base of operations is **${c.hub}**.`, '');
  // Hooks and rumours are player-facing, but a session-zero handout must not
  // name a villain the premise keeps hidden. Street talk uses the epithet.
  const veil = (text) => c.villain?.name
    ? cap1(text.replaceAll(c.villain.name, c.villain.title))
    : text;
  if (c.playerHooks?.length) {
    L.push('## Why you might be here', '', 'Pick one, adapt it, or bring your own:', '');
    c.playerHooks.forEach(h => L.push(`- ${veil(h)}`));
    L.push('');
  }
  const rumors = c.acts.flatMap(a => a.chapters).flatMap(ch => ch.elements)
    .filter(el => el.type === 'settlement').flatMap(el => el.rumors.map(r => veil(r.text)));
  if (rumors.length) {
    L.push('## What people are saying', '', 'Heard in taverns and market squares. Some of it is even true.', '');
    rumors.forEach(r => L.push(`- "${r}"`));
    L.push('');
  }
  L.push('---', '', '*A player handout generated by your DM. Everything on this page is known to your characters.*');
  return L.join('\n');
}

/* ---------- markdown export ---------- */

export function campaignMarkdown(c) {
  const L = [];
  L.push(`# ${c.title}`, '', `*${c.logline}*`, '');
  L.push(`**Tone** ${c.tone.join(', ')} | **Levels** ${c.levelRange.start}-${c.levelRange.end} (party of ${c.gen?.partySize || 4}) | **Sessions** ${c.sessions} | **Pattern** ${c.pattern.label}`, '');
  L.push(`**Region** ${c.region.name} (${c.region.label}). **Base** ${c.hub}.`, '');
  L.push(`> **How to read this book:** blockquoted or "quoted" text is player-facing, written to be read aloud or found. Everything else is for the DM, and lines marked *(DM only)* are spoilers even at a shared table.`, '');
  if (c.opening) L.push(`## Opening the campaign`, '', c.opening, '');
  if (c.playerHooks?.length) {
    L.push(`## Character hooks (hand these to the players)`, '');
    c.playerHooks.forEach(h => L.push(`- "${h}"`));
    L.push('');
  }
  L.push(`## The objective`, '', `**${c.objective.kindLabel || 'Recover the scattered'}.** ${c.objective.frame || ''}`, '');
  L.push(`${c.objective.count} x ${c.objective.plural}. ${c.objective.why}`, '');
  if (c.objective.playerGoal) L.push(`> **What the party is trying to do:** "${c.objective.playerGoal}"`, '');
  if (c.objective.failure) L.push(`**If they fail:** ${c.objective.failure}`, '');
  L.push(`**If ${c.villain.name} succeeds:** ${c.objective.ifLost}`, '');
  c.objective.items.forEach(i => {
    L.push(`- **${i.name}** - ${i.chapterTitle}. ${i.note}`);
    if (i.power) L.push(`  - While held (players learn on identify): "${i.power}"`);
    if (i.cost) L.push(`  - The catch (players learn on identify): "${i.cost}"`);
    if (i.reaction) L.push(`  - When claimed *(DM only)*: ${i.reaction}`);
  });
  L.push('', `## Antagonist`, '', `**${c.villain.name}, ${c.villain.title}** (${c.villain.kind})`, '');
  L.push(`- Goal: ${c.villain.goal}`, `- Method: ${c.villain.method}`, `- Weakness: ${c.villain.weakness}`);
  c.villain.resources.forEach(r => L.push(`- Resource: ${r}`));
  if (c.villain.statSuggestion) L.push(`- Stat block: ${c.villain.statSuggestion.name} (CR ${c.villain.statSuggestion.cr})`);
  if (c.villain.where) L.push(`- Found at: ${c.villain.where}`);
  L.push('', '### Lieutenants', '');
  c.villain.lieutenants.forEach(l => L.push(`- **${l.name}** - ${l.note}${l.statSuggestion ? ` (use ${l.statSuggestion.name}, CR ${l.statSuggestion.cr})` : ''}${l.where ? `. Found at ${l.where}` : ''}`));
  if (c.villain.gains?.length) {
    L.push('', '### What the villain takes if the clock runs', '');
    c.villain.gains.forEach(g => L.push(`- **${g.clockLabel} at ${g.at}${g.final ? ' (full)' : ''}:** ${g.text}`));
  }
  L.push('', '### Villain schedule', '');
  c.villain.timeline.forEach(t => L.push(`- ${t.when}: ${t.move}`));
  if (c.rival) {
    const r = c.rival;
    if (c.reversal) {
    const r = c.reversal;
    L.push('', '## The turn', '', `**${r.label}** - planned for ${r.chapterTitle}`, '');
    L.push(`*What everyone believes:* ${r.setup}`, '', `*What is actually true (DM only):* ${r.turn}`, '');
    if (r.foreshadow.length) {
      L.push('Plant these first:', '');
      r.foreshadow.forEach(f => L.push(`- ${f.chapterTitle}: ${f.text}`));
      L.push('');
    }
    L.push(`*Afterwards:* ${r.fallout}`, '', `*If they never work it out:* ${r.ifMissed}`, '');
  }
  L.push('', '## The rival', '', `**${r.org}**, led by ${r.leader} (${r.title}, ${r.kind})`, '');
    L.push(`- Wants: ${r.wants}`, `- Method: ${r.method}`, `- Why they cross ${c.villain.name}: ${r.crosses}`);
    L.push(`- Offers the party: ${r.offers}`, `- Demands in return: ${r.demands}`, `- Leverage over them: ${r.leverage}`);
    if (r.statSuggestion) L.push(`- Stat block: ${r.statSuggestion.name} (CR ${r.statSuggestion.cr})`);
    L.push('', `**First meeting:** ${r.firstMeeting}`, '');
    L.push(`**If the party allies with them:** ${r.ifAllied}`, '');
    L.push(`**If the party crosses them:** ${r.ifCrossed}`, '');
    if (r.appearances?.length) {
      L.push('**Where they turn up:**', '');
      r.appearances.forEach(a => L.push(`- ${a.chapterTitle}: ${a.move}`));
      L.push('');
    }
  }
  if (c.flags?.length) {
    L.push('', '## Choices that bind', '',
           'Set these as the party earns them; every chapter after carries a line for each.', '');
    c.flags.forEach(f => L.push(`- **${f.label}** - ${f.prompt}`));
  }
  L.push('', '## Factions', '');
  c.factions.forEach(f => L.push(`- **${f.name}** (${f.attitude}) - wants to ${f.goal}. Offers ${f.offers}. Demands ${f.demands}.`));
  L.push('', '## Clocks', '');
  c.clocks.forEach(k => {
    L.push(`- **${k.label}** [${k.segments}] - ${k.onFill}`);
    (k.advances || []).forEach(a => L.push(`  - Advance a segment when ${a}`));
  });

  for (const act of c.acts) {
    L.push('', `## ${act.title} (level ${act.levelGate}+)`, '');
    for (const ch of act.chapters) {
      L.push(`### ${ch.index}. ${ch.title}`, '', `*${ch.roleLabel}, level ${ch.levelGate}${ch.mandatory ? ', mandatory' : ', optional'}*`, '', ch.summary, '');
      if (ch.scene) L.push(`> **Setting the scene (read aloud):** ${ch.scene}`, '');
      if (ch.playerGoal) L.push(`> **The goal, as the party understands it:** "${ch.playerGoal}"`, '');
      L.push(`**Getting them here:** ${ch.entry}`, '', `**If they walk away:** ${ch.stakes}`, '');
      if (ch.travel) L.push(`**Getting there:** ${ch.travel}`, '');
      if (ch.reactions?.length) {
        L.push('**If the party has already...** *(read only the lines that apply)*', '');
        ch.reactions.forEach(r => L.push(`- *${r.label}:* ${r.text}`));
        L.push('');
      }
      if (ch.dilemma) {
        const d = ch.dilemma;
        L.push(`**The choice:** ${d.situation}`, '');
        d.options.forEach(o => L.push(`- **${o.label}** - ${o.cost}`));
        L.push('', `*No clean way out:* ${d.noGoodAnswer}`, '', `*It comes back:* ${d.later}`, '', `*Running it:* ${d.framing}`, '');
      }
      if (ch.foreshadow) L.push(`**Plant this (DM only):** ${ch.foreshadow}`, '');
      if (ch.reversal) L.push(`**THE TURN - ${ch.reversal.label}:** ${ch.reversal.turn}`, '', `*Afterwards:* ${ch.reversal.fallout}`, '');
      if (ch.wardThreat) L.push(`**They come for it here:** ${ch.wardThreat}`, '');
      if (ch.rival) L.push(`**${ch.rival.org} is here${ch.rival.first ? ' (first meeting)' : ''}:** ${ch.rival.move}`, '');
      if (ch.milestone) L.push(`**Leveling:** ${ch.milestone}`, '');
      if (ch.lieutenant) L.push(`**Lieutenant present:** ${ch.lieutenant}`, '');
      if (ch.objective) L.push(`**Holds:** ${ch.objective.name}. ${ch.objective.note}`, '');
      if (ch.board?.length) {
        L.push('**Work available from here:**', '');
        ch.board.forEach(b => L.push(`- ${b.title} (${b.role}, level ${b.level}) - ${b.entry}`));
        L.push('');
      }
      for (const el of ch.elements) {
        L.push(`#### ${el.title} (${el.subtitle})`, '', el.summary, '');
        if (el.objectiveNote?.length) el.objectiveNote.forEach(o => L.push(`**Holds:** ${o}`, ''));
        if (el.wandering) {
          L.push('Wandering (d6, roll each half hour of dawdling or after loud noise):', ...el.wandering.map(r => `- ${r.range}: ${r.text}`), '');
        }
        for (const n of el.nodes || []) {
          L.push(`**${n.id}. ${n.roleLabel}** (${n.light}${n.exits.length ? `, exits to ${n.exits.join(', ')}` : ''})`, '', `> ${n.description}${n.dressing ? ` ${n.dressing}` : ''}`, '');
          if (n.fixtures?.length) L.push(`Also here: ${n.fixtures.join(', ')}.`, '');
          if (n.secret) L.push(`*Hidden here (DM only)*: ${n.secret.name}, found on ${n.secret.find}; ${n.secret.open}. It holds ${n.secret.holds}.`, '');
          for (const b of n.beats) {
            if (b.kind === 'encounter') L.push(`- *${b.title === 'The final confrontation' ? b.title : 'Encounter'} (${b.difficulty}, ${b.xp.toLocaleString()} adj XP):* ${b.leader ? `Led by ${b.leader.name}${b.leader.statSuggestion ? ` (use ${b.leader.statSuggestion.name}, CR ${b.leader.statSuggestion.cr})` : ''}. ` : ''}${b.creatures.map(x => `${x.count} x ${x.name} (CR ${x.cr})`).join(', ')}. Objective: ${b.objective} Tactics: ${b.tactics} Morale: ${b.morale} If avoided: ${b.ifAvoided}`);
            else if (b.kind === 'trap') L.push(`- *Trap - ${b.name}:* players notice "${b.telegraph}". Detect ${b.detect}, disarm ${b.disarm}. ${b.effect}. ${b.consequence}`);
            else if (b.kind === 'puzzle') L.push(`- *Puzzle - ${b.name}:* players see "${b.premise}" Solution *(DM only)*: ${b.solution}. Alternate: ${b.alternate}. Failure: ${b.failure}`);
            else if (b.kind === 'treasure') L.push(`- *Treasure:* ${b.treasure.map(t => t.name).join('; ')}`);
            else if (b.kind === 'clue') L.push(`- *Clue (players find):* "${b.text}" (points to ${b.pointsToTitle})`);
            else L.push(`- *${b.title}:* ${b.text || ''}`);
          }
          L.push('');
        }
        if (el.type === 'settlement') {
          L.push(`Ruler: ${el.ruler}. Tavern: ${el.tavern}.`, '', 'Locations:', ...el.locations.map(x => `- ${x}`), '', 'Rumours (text is player-facing; true/false is DM only):', ...el.rumors.map(r => `- "${r.text}" *(${r.true ? 'true' : 'false'})*`), '');
        }
        if (el.type === 'region') {
          L.push('Routes:', ...el.legs.map(l => `- ${l.label}, ${l.days} days. ${l.checks}. Complication: ${l.complication}`), '', 'Encounters (d6):', ...el.encounterTable.map(r => `- ${r.range}: ${r.text}`), '');
        }
        if (el.type === 'event') {
          L.push(...el.phases.map(p => `${p.n}. ${p.text}`), '', `Failure: ${el.failure}`, '');
        }
        if (el.type === 'downtime') {
          L.push('Activities:', ...el.activities.map(a => `- ${a}`), '', 'Complications:', ...el.complications.map(a => `- ${a}`), '',
                 `*Meanwhile (DM only):* ${el.worldMoves}`, '');
        }
        if (el.type === 'board') {
          for (const j of el.jobs) {
            L.push(`**${j.name}** - "${j.ask}" Pay: ${j.pay}`, `  - *What it really is (DM only):* ${j.twist}`);
          }
          L.push('', el.note, '');
        }
        if (el.type === 'siege') {
          L.push(...el.phases.map(x => `${x.n}. ${x.text}`), '', 'Assignments:', ...el.assignments.map(a => `- ${a}`), '', el.note, '');
        }
        if (el.type === 'heist') {
          L.push(...el.phases.map(x => `${x.n}. ${x.text}`), '', 'Ways in:',
                 ...el.waysIn.map(w => `- ${w.route} (costs: ${w.cost})`), '',
                 'What goes wrong *(DM only)*:', ...el.complications.map(c => `- ${c}`), '');
        }
        if (el.type === 'investigation') {
          for (const c2 of el.conclusions) L.push(`Conclusion: ${c2.text}`, ...c2.clues.map(x => `- ${x}`), '');
        }
      }
      if (ch.link) {
        L.push(`**${ch.link.heading}:** ${ch.link.summary}`, '');
        ch.link.clues.forEach(cl => L.push(`- "${cl.text}" *(${cl.placement}, points to ${cl.pointsToTitle})*`));
        L.push('');
      }
    }
  }

  L.push('', '## Appendix: NPCs', '');
  c.appendices.npcs.forEach(n => L.push(`- **${n.name}** (${n.ancestry} ${n.occupation}) - ${n.personality}; ${n.quirk}. *(DM only: ${n.role}${n.statSuggestion ? `, use ${n.statSuggestion.name} if it comes to blows` : ''}. Wants ${n.wants}. Secret: ${n.secret}. ${n.connection})*`));
  L.push('', '## Appendix: Creatures', '', c.appendices.creatures.map(m => `${m.name} (CR ${m.cr})`).join(', '), '');
  if (c.appendices.magicItems.length) L.push('## Appendix: Magic items', '', c.appendices.magicItems.map(i => `${i.name} (${i.rarity})`).join(', '), '');
  if (c.treasure) {
    const rar = Object.entries(c.treasure.rarities || {}).map(([r, n]) => `${n} ${r}`).join(', ');
    L.push('', '## Appendix: Treasure totals', '', `${c.treasure.gp.toLocaleString()} gp in placed coin and valuables${rar ? `, plus magic items: ${rar}` : ''}.`, '');
  }
  L.push('', '## Endings', '');
  c.endings.forEach(e => L.push(`- **${e.label}:** ${e.text}`));
  return L.join('\n');
}
