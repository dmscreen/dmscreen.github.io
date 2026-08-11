// Campaign generator: builds a whole published-module-shaped campaign in one
// pass. The shape follows the taxonomy: campaign > acts > chapters > elements
// > nodes > beats, with NPCs, factions, clocks and clues as cross-cutting
// layers. Everything is generated against a single context object so the
// pieces refer to each other by name and the chapters chain logically.
import { loadMonsters, loadItems, loadTables, XP_THRESHOLDS, encounterMultiplier, monsterXP, fmtCR } from './srd.js';
import { pick, roll } from './dice.js';

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

function settlementName(names) {
  return `${pick(names.settlement.prefixes)}${pick(names.settlement.suffixes)}`;
}

// `short` keeps to one-word place names, for cases where the name gets
// embedded in a longer chapter title.
function siteName(C, short = false) {
  const s = C.siteNames;
  const form = short ? '{prefix}{suffix}' : pick(s.forms);
  const name = form
    .replace('{prefix}', pick(s.prefixes))
    .replace('{suffix}', pick(s.suffixes))
    .replace('{adj}', pick(s.adjectives))
    .replace('{noun}', pick(s.nouns));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function personName(names, ancestry) {
  const a = ancestry || pick(Object.keys(names.people));
  const set = names.people[a];
  return { name: `${pick(set.first)} ${pick(set.last)}`, ancestry: a };
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

// One combat encounter budgeted against a party of four at this level.
function buildEncounter(pool, level, difficulty = 2) {
  const lvl = Math.min(20, Math.max(1, level));
  const budget = XP_THRESHOLDS[lvl][difficulty] * 4;
  let band = pool.filter(m => inBand(m, lvl) && monsterXP(m) <= budget);
  if (!band.length) band = pool.filter(m => monsterXP(m) <= budget);
  if (!band.length) return null;

  const meaty = band.filter(m => monsterXP(m) >= budget / 10);
  const lead = pick(meaty.length ? meaty : band);
  const leadXP = monsterXP(lead) || 10;
  let count = 1;
  for (let c = 8; c >= 1; c--) {
    if (leadXP * c * encounterMultiplier(c, 4) <= budget * 1.1) { count = c; break; }
  }

  const creatures = [{ slug: lead.slug, name: lead.name, cr: fmtCR(lead.cr), count }];
  let raw = leadXP * count;

  // Spend leftover budget on a smaller supporting group, which reads more like
  // a published encounter than one block of identical monsters.
  const spent = () => Math.round(raw * encounterMultiplier(creatures.reduce((a, c) => a + c.count, 0), 4));
  if (chance(0.45)) {
    const minions = band.filter(m => m.slug !== lead.slug && monsterXP(m) <= Math.max(25, leadXP / 3));
    if (minions.length) {
      const minion = pick(minions);
      const mXP = monsterXP(minion) || 10;
      for (let n = int(2, 5); n >= 2; n--) {
        const total = raw + mXP * n;
        const adj = Math.round(total * encounterMultiplier(count + n, 4));
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
  out.push({ kind: 'coin', name: `${coin.toLocaleString()} gp in coin and portable valuables` });
  if (chance(0.4)) out.push({ kind: 'goods', name: fill(pick(ctx.C.treasureGoods), ctx) });
  return out;
}

/* ---------- NPCs ---------- */

function makeNPC(ctx, roleId, where) {
  const { C, names, npcTable } = ctx;
  const role = C.npcRoles.find(r => r.id === roleId) || pick(C.npcRoles);
  const { name, ancestry } = personName(names);
  return {
    id: uid('npc'),
    name,
    ancestry,
    role: role.label,
    roleId: role.id,
    roleNote: role.desc,
    occupation: pick(npcTable.occupations),
    personality: pick(npcTable.personalities),
    quirk: pick(npcTable.quirks),
    ideal: pick(npcTable.ideals),
    bond: pick(npcTable.bonds),
    flaw: pick(npcTable.flaws),
    wants: fill(pick(C.npcWants), ctx.slots),
    secret: fill(pick(C.npcSecrets), ctx.slots),
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
  const count = Math.max(4, Math.round(int(kind.size[0], kind.size[1]) * sizeScale));

  const roles = C.nodeRoles.filter(r => r.weight > 0);
  const nodes = [];
  for (let i = 0; i < count; i++) {
    const roleDef = i === 0 ? C.nodeRoles.find(r => r.id === 'threshold')
      : (boss && i === count - 1) ? C.nodeRoles.find(r => r.id === 'boss')
        : weightedRole(kind.trapHeavy ? roles : roles.filter(r => r.id !== 'trap' || chance(0.5)));
    const templates = C.roomTemplates[roleDef.id] || C.roomTemplates.empty;
    const node = {
      id: `${String.fromCharCode(97 + Math.floor(i / 26))}${i + 1}`,
      role: roleDef.id,
      roleLabel: roleDef.label,
      description: pick(templates).replaceAll('{material}', material).replaceAll('{motif}', motif),
      dressing: chance(0.6) ? pick(C.dressings) : null,
      light: pick(C.lightLevels),
      exits: [],
      beats: [],
    };
    nodes.push(node);
  }

  // Mostly a spine with loops hung off it: readable to run, not a corridor.
  nodes.forEach((n, i) => {
    if (i < nodes.length - 1) n.exits.push(nodes[i + 1].id);
    if (i > 1 && chance(0.3)) n.exits.push(nodes[int(0, i - 2)].id);
    if (n.role === 'shortcut') n.exits.push(nodes[0].id);
  });

  // Beats. Encounter density is deliberately below one per room; the empty and
  // junction rooms are the pacing.
  for (const node of nodes) {
    const roleDef = C.nodeRoles.find(r => r.id === node.role);
    for (const beatKind of roleDef.beats) {
      const beat = makeBeat(ctx, beatKind, { level, pool, node, boss: boss && node.role === 'boss', items });
      if (beat) node.beats.push(beat);
    }
  }

  return {
    id: uid('el'),
    type: 'dungeon',
    kind: kind.id,
    title,
    subtitle: kind.label,
    summary: `${kind.label}, ${nodes.length} keyed areas. ${cap1(fill(pick(kind.origins), ctx.slots))}.`,
    hazard: chance(0.5) ? pick(C.hazards) : null,
    alerts: kind.alerts ? 'Once the site is alerted, surviving occupants regroup at the deepest defensible room and post watches on the approach.' : null,
    nodes,
  };
}

function makeBeat(ctx, kindId, { level, pool, boss, items }) {
  const { C } = ctx;
  if (kindId === 'combat') {
    const diff = boss ? 3 : pick([1, 2, 2, 2, 3]);
    const enc = buildEncounter(pool, boss ? level + 1 : level, diff);
    if (!enc) return null;
    return {
      id: uid('beat'),
      kind: 'encounter',
      encounterType: 'combat',
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
  for (const r of roleIds) roster.push(makeNPC(ctx, r, title));

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
    const enc = buildEncounter(pool, level, i < 3 ? 0 : 1);
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
  const enc = buildEncounter(pool, level, 3);
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
    climaxEncounter: enc,
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
    clues: [],
  };

  switch (roleDef.build) {
    case 'ambush': {
      const place = siteName(C, true);
      chapter.title = `Trouble on the ${place} Road`;
      chapter.summary = `A scripted ambush that introduces ${ctx.slots.villain}'s people, followed by the small site the survivors run back to.`;
      chapter.elements.push(makeEvent(ctx, { title: `Ambush on the ${place} Road`, level, pool: pools.faction, kindId: 'chase' }));
      chapter.elements.push(makeDungeon(ctx, { kindId: 'lair', level, title: `${place} Hideout`, pool: pools.faction }));
      break;
    }
    case 'arrival': {
      const place = siteName(C);
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
      const place = siteName(C);
      chapter.title = place;
      const kindId = pick(['tomb', 'ruin', 'stronghold', 'temple', 'mine', 'wreck', 'planar']);
      chapter.summary = `A self-contained site. ${ctx.slots.villain} has an interest here and has left people to protect it.`;
      chapter.elements.push(makeDungeon(ctx, { kindId, level, title: place, pool: pools.faction }));
      if (chance(0.5)) chapter.elements.push(makeSettlement(ctx, { title: settlementName(ctx.names), level, isHub: false }));
      break;
    }
    case 'event': {
      const place = chance(0.5) ? ctx.slots.hub : siteName(C, true);
      const def = pick(C.eventElements);
      const title = fill(pick(def.titles), { ...ctx.slots, place });
      chapter.title = title;
      chapter.summary = `${def.label}. ${cap1(fill(def.objective, ctx.slots))}`;
      chapter.elements.push(makeEvent(ctx, { title, level, pool: pools.faction, kindId: def.kind }));
      break;
    }
    case 'region': {
      chapter.title = `Across ${ctx.slots.region}`;
      chapter.summary = 'Procedural travel: routes, days, checks, and a table that keeps the country dangerous.';
      chapter.elements.push(makeRegion(ctx, { title: `Across ${ctx.slots.region}`, level, pool: pools.wild }));
      chapter.elements.push(makeDungeon(ctx, { kindId: pick(['lair', 'wreck', 'ruin']), level, title: siteName(C), pool: pools.wild, sizeScale: 0.7 }));
      break;
    }
    case 'investigation': {
      chapter.title = `Following It Back`;
      chapter.summary = 'A clue web rather than a place. Every conclusion has three independent routes to it.';
      chapter.elements.push(makeInvestigation(ctx, { title: 'The Web', level }));
      break;
    }
    case 'climax': {
      const place = siteName(C);
      chapter.title = place;
      chapter.summary = `The last site. ${ctx.slots.villain} is here, and so is everything they have left.`;
      chapter.elements.push(makeDungeon(ctx, {
        kindId: pick(['megadungeon', 'stronghold', 'temple']), level, title: place,
        pool: pools.faction, boss: true, sizeScale: 1,
      }));
      break;
    }
  }

  chapter.entry = fill(pick(C.entryHooks), ctx.slots);
  chapter.stakes = fill(pick(C.exitStakes), ctx.slots);
  chapter.index = index;
  return chapter;
}

/* ---------- chaining ---------- */

// The connective tissue. Every chapter except the last gets three independent
// pointers to the next one, placed in different elements where possible, so a
// single missed roll or skipped room never strands the party.
function chainChapters(ctx, chapters) {
  const { C } = ctx;
  chapters.forEach((ch, i) => {
    const next = chapters[i + 1];
    if (!next) {
      ch.link = null;
      return;
    }
    const slots = { ...ctx.slots, next: next.title, place: ch.title };
    const texts = some(C.clueTemplates, 3).map(t => fill(t, slots));
    const placements = [];
    const nodes = ch.elements.flatMap(el => (el.nodes || []).map(n => ({ el, n })));
    texts.forEach((text, idx) => {
      const clue = { id: uid('clue'), text, pointsTo: next.id, pointsToTitle: next.title };
      if (nodes.length) {
        const spot = nodes[Math.floor((idx + 1) * nodes.length / (texts.length + 1))] || nodes[0];
        spot.n.beats.push({ id: uid('beat'), kind: 'clue', title: 'Clue to the next chapter', text, pointsToTitle: next.title });
        clue.placement = `${spot.el.title}, area ${spot.n.id}`;
      } else {
        const el = ch.elements[idx % ch.elements.length];
        (el.freeClues ||= []).push(text);
        clue.placement = `${el.title} (${el.subtitle})`;
      }
      placements.push(clue);
    });
    ch.clues = placements;
    ch.link = {
      toId: next.id,
      toTitle: next.title,
      summary: fill(pick(C.linkSummaries), slots),
      clues: placements,
    };
  });
}

/* ---------- top level ---------- */

export async function generateCampaign(opts = {}) {
  const [monsters, items, C, names, npcTable, quests, shops] = await Promise.all([
    loadMonsters(), loadItems(), loadTables('campaign'),
    loadTables('names'), loadTables('npc'), loadTables('quests'), loadTables('shops'),
  ]);

  const premise = opts.premiseId ? C.premises.find(p => p.id === opts.premiseId) || pick(C.premises) : pick(C.premises);
  const patternId = opts.pattern && C.patterns[opts.pattern] ? opts.pattern : pick(premise.patterns);
  const pattern = C.patterns[patternId];
  const region = C.regionKinds[premise.regionKind];
  const villainKind = C.villainKinds[pick(premise.villainKinds)];

  const length = opts.length || 'standard';
  const startLevel = opts.startLevel || (length === 'short' ? 1 : 1);
  const endLevel = length === 'short' ? 5 : length === 'epic' ? 15 : 10;

  const regionName = `${pick(names.settlement.prefixes)}${pick(['march', 'reach', 'vale', 'hollow', 'moor', 'downs', 'weald'])}`;
  const hubName = settlementName(names);
  const villainPerson = personName(names);
  const villainTitle = pick(villainKind.titles);

  const pools = buildPools(monsters, villainKind, region.terrain);

  const factionDefs = some(C.factions, 3).map(f => ({
    id: uid('fac'),
    name: f.name.replace('{settlement}', hubName),
    goal: f.goal, offers: f.offers, demands: f.demands, attitude: f.attitude,
  }));

  const slots = {
    villain: villainPerson.name,
    villainTitle,
    region: regionName,
    hub: hubName,
    faction: factionDefs[0].name,
    object: premise.objective.noun,
    objects: premise.objective.plural,
    npc: personName(names).name,
    place: hubName,
    next: 'the next site',
  };

  const ctx = { C, names, npcTable, quests, shops, items, monsters, pools, region, slots };

  // Objective items: real named things the chapters can hold.
  const objective = {
    ...premise.objective,
    why: fill(premise.objective.why, slots),
    ifLost: fill(premise.objective.ifLost, slots),
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

  // Scatter the campaign objects across non-hub chapters, back to front, so
  // the last one is always in the climax.
  const candidates = allChapters.filter(c => c.role !== 'hub_town');
  const climaxChapter = candidates[candidates.length - 1];
  const holders = [
    ...some(candidates.slice(0, -1), Math.max(0, objective.count - 1)).sort((a, b) => a.index - b.index),
    climaxChapter,
  ].filter(Boolean);
  holders.forEach((ch, i) => {
    const item = {
      id: uid('obj'),
      name: `The ${['First', 'Second', 'Third', 'Fourth', 'Fifth'][i] || `${i + 1}th`} ${objective.noun}`,
      chapterId: ch.id,
      chapterTitle: ch.title,
      note: fill(pick(C.objectiveNotes), { ...slots, place: ch.title }),
    };
    objective.items.push(item);
    ch.objective = item;
    const el = ch.elements.find(e => e.nodes?.length) || ch.elements[0];
    const node = el.nodes?.length ? el.nodes[el.nodes.length - 1] : null;
    if (node) node.beats.push({ id: uid('beat'), kind: 'objective', title: item.name, text: item.note });
    else (el.freeClues ||= []).push(`${item.name}: ${item.note}`);
  });

  // Villain, lieutenants, and a schedule that runs whether the party shows up.
  const villainStat = pools.faction.filter(m => m.cr >= endLevel - 3 && m.cr <= endLevel + 4);
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
    statSuggestion: villainStat.length ? (() => { const m = pick(villainStat); return { slug: m.slug, name: m.name, cr: fmtCR(m.cr) }; })() : null,
    lieutenants: some(villainKind.lieutenants, 2).map(l => {
      const p = personName(names);
      const band = pools.faction.filter(m => m.cr >= Math.max(1, endLevel / 2) && m.cr <= endLevel);
      const stat = band.length ? pick(band) : null;
      return {
        id: uid('lt'), name: p.name, ancestry: p.ancestry, note: fill(l, slots),
        statSuggestion: stat ? { slug: stat.slug, name: stat.name, cr: fmtCR(stat.cr) } : null,
      };
    }),
    timeline: allChapters.map((ch, i) => ({
      when: `If the party has not reached ${ch.title} by week ${(i + 1) * 2}`,
      move: fill(pick(C.villainMoves), { ...slots, place: ch.title }),
    })),
  };

  // Roster: the hub NPCs plus a handful of travelling parts.
  const npcs = [];
  for (const ch of allChapters) npcs.push(...ch.npcs);
  for (const roleId of ['guide', 'rival', 'betrayer', 'witness']) {
    if (!npcs.some(n => n.roleId === roleId)) npcs.push(makeNPC(ctx, roleId, pick(allChapters).title));
  }
  npcs.forEach(n => { n.connection = fill(pick(C.npcConnections), { ...slots, npc: pick(npcs).name }); });

  const clocks = [
    { id: uid('clk'), label: fill(premise.clock.label, slots), segments: premise.clock.segments, onFill: fill(premise.clock.onFill, slots), global: true },
    ...some(C.clocks, 2).map(c => ({ id: uid('clk'), label: fill(c.label, slots), segments: c.segments, onFill: fill(c.onFill, slots), global: false })),
  ];

  // Appendices and totals.
  const creatures = new Map();
  const magicItems = new Map();
  let encounterCount = 0;
  let nodeCount = 0;
  let xpTotal = 0;
  for (const ch of allChapters) {
    for (const el of ch.elements) {
      nodeCount += el.nodes?.length || 0;
      for (const node of el.nodes || []) {
        for (const b of node.beats) {
          if (b.kind === 'encounter') {
            encounterCount++;
            xpTotal += b.xp || 0;
            for (const c of b.creatures) creatures.set(c.slug, { slug: c.slug, name: c.name, cr: c.cr });
          }
          for (const t of b.treasure || []) if (t.kind === 'magic') magicItems.set(t.slug, t);
        }
      }
      if (el.climaxEncounter) {
        encounterCount++;
        xpTotal += el.climaxEncounter.xp || 0;
        for (const c of el.climaxEncounter.creatures) creatures.set(c.slug, { slug: c.slug, name: c.name, cr: c.cr });
      }
      for (const row of el.encounterTable || []) xpTotal += row.xp || 0;
    }
  }

  const title = chance(0.5)
    ? premise.title
    : `The ${pick(C.titleWords.adjectives)} ${pick(C.titleWords.nouns)}`;

  return {
    id: uid('camp'),
    created: Date.now(),
    title,
    logline: fill(premise.logline, slots),
    premiseId: premise.id,
    tone: premise.tone,
    themes: premise.themes,
    pattern: { id: patternId, label: pattern.label, note: pattern.note },
    levelRange: { start: startLevel, end: endLevel },
    sessions: `${totalChapters * 2}-${totalChapters * 4}`,
    region: { name: regionName, kind: premise.regionKind, label: region.label, features: some(region.features, 3), terrain: region.terrain },
    hub: hubName,
    objective,
    villain,
    factions: factionDefs,
    clocks,
    acts,
    endings: C.endings.map(e => ({ label: e.label, text: fill(e.text, slots) })),
    appendices: {
      npcs,
      creatures: [...creatures.values()].sort((a, b) => parseFloat(a.cr) - parseFloat(b.cr)),
      magicItems: [...magicItems.values()],
    },
    stats: {
      acts: acts.length,
      chapters: totalChapters,
      elements: allChapters.reduce((a, c) => a + c.elements.length, 0),
      nodes: nodeCount,
      encounters: encounterCount,
      npcs: npcs.length,
      xp: xpTotal,
    },
  };
}

/* ---------- markdown export ---------- */

export function campaignMarkdown(c) {
  const L = [];
  L.push(`# ${c.title}`, '', `*${c.logline}*`, '');
  L.push(`**Tone** ${c.tone.join(', ')} | **Levels** ${c.levelRange.start}-${c.levelRange.end} | **Sessions** ${c.sessions} | **Pattern** ${c.pattern.label}`, '');
  L.push(`**Region** ${c.region.name} (${c.region.label}). **Base** ${c.hub}.`, '');
  L.push(`## The objective`, '', `${c.objective.count} x ${c.objective.plural}. ${c.objective.why}`, '', `If ${c.villain.name} succeeds: ${c.objective.ifLost}`, '');
  c.objective.items.forEach(i => L.push(`- **${i.name}** - ${i.chapterTitle}. ${i.note}`));
  L.push('', `## Antagonist`, '', `**${c.villain.name}, ${c.villain.title}** (${c.villain.kind})`, '');
  L.push(`- Goal: ${c.villain.goal}`, `- Method: ${c.villain.method}`, `- Weakness: ${c.villain.weakness}`);
  c.villain.resources.forEach(r => L.push(`- Resource: ${r}`));
  if (c.villain.statSuggestion) L.push(`- Stat block: ${c.villain.statSuggestion.name} (CR ${c.villain.statSuggestion.cr})`);
  L.push('', '### Lieutenants', '');
  c.villain.lieutenants.forEach(l => L.push(`- **${l.name}** - ${l.note}${l.statSuggestion ? ` (use ${l.statSuggestion.name}, CR ${l.statSuggestion.cr})` : ''}`));
  L.push('', '### Villain schedule', '');
  c.villain.timeline.forEach(t => L.push(`- ${t.when}: ${t.move}`));
  L.push('', '## Factions', '');
  c.factions.forEach(f => L.push(`- **${f.name}** (${f.attitude}) - wants to ${f.goal}. Offers ${f.offers}. Demands ${f.demands}.`));
  L.push('', '## Clocks', '');
  c.clocks.forEach(k => L.push(`- **${k.label}** [${k.segments}] - ${k.onFill}`));

  for (const act of c.acts) {
    L.push('', `## ${act.title} (level ${act.levelGate}+)`, '');
    for (const ch of act.chapters) {
      L.push(`### ${ch.index}. ${ch.title}`, '', `*${ch.roleLabel}, level ${ch.levelGate}${ch.mandatory ? ', mandatory' : ', optional'}*`, '', ch.summary, '');
      L.push(`**Getting them here:** ${ch.entry}`, '', `**If they walk away:** ${ch.stakes}`, '');
      if (ch.objective) L.push(`**Holds:** ${ch.objective.name}. ${ch.objective.note}`, '');
      for (const el of ch.elements) {
        L.push(`#### ${el.title} (${el.subtitle})`, '', el.summary, '');
        for (const n of el.nodes || []) {
          L.push(`**${n.id}. ${n.roleLabel}** (${n.light}${n.exits.length ? `, exits to ${n.exits.join(', ')}` : ''})`, '', n.description, '');
          for (const b of n.beats) {
            if (b.kind === 'encounter') L.push(`- *Encounter (${b.difficulty}, ${b.xp.toLocaleString()} adj XP):* ${b.creatures.map(x => `${x.count} x ${x.name} (CR ${x.cr})`).join(', ')}. Objective: ${b.objective} Tactics: ${b.tactics} Morale: ${b.morale} If avoided: ${b.ifAvoided}`);
            else if (b.kind === 'trap') L.push(`- *Trap - ${b.name}:* ${b.telegraph}. Detect ${b.detect}, disarm ${b.disarm}. ${b.effect}. ${b.consequence}`);
            else if (b.kind === 'puzzle') L.push(`- *Puzzle - ${b.name}:* ${b.premise} Solution: ${b.solution}. Alternate: ${b.alternate}. Failure: ${b.failure}`);
            else if (b.kind === 'treasure') L.push(`- *Treasure:* ${b.treasure.map(t => t.name).join('; ')}`);
            else L.push(`- *${b.title}:* ${b.text || ''}`);
          }
          L.push('');
        }
        if (el.type === 'settlement') {
          L.push(`Ruler: ${el.ruler}. Tavern: ${el.tavern}.`, '', 'Locations:', ...el.locations.map(x => `- ${x}`), '', 'Rumours:', ...el.rumors.map(r => `- ${r.text} (${r.true ? 'true' : 'false'})`), '');
        }
        if (el.type === 'region') {
          L.push('Routes:', ...el.legs.map(l => `- ${l.label}, ${l.days} days. ${l.checks}. Complication: ${l.complication}`), '', 'Encounters (d6):', ...el.encounterTable.map(r => `- ${r.range}: ${r.text}`), '');
        }
        if (el.type === 'event') {
          L.push(...el.phases.map(p => `${p.n}. ${p.text}`), '', `Objective: ${el.objective}`, `Failure: ${el.failure}`, '');
        }
        if (el.type === 'investigation') {
          for (const c2 of el.conclusions) L.push(`Conclusion: ${c2.text}`, ...c2.clues.map(x => `- ${x}`), '');
        }
      }
      if (ch.link) {
        L.push(`**Leads to ${ch.link.toTitle}:** ${ch.link.summary}`, '');
        ch.link.clues.forEach(cl => L.push(`- ${cl.text} *(${cl.placement})*`));
        L.push('');
      }
    }
  }

  L.push('', '## Appendix: NPCs', '');
  c.appendices.npcs.forEach(n => L.push(`- **${n.name}** (${n.ancestry} ${n.occupation}, ${n.role}) - ${n.personality}; ${n.quirk}. Wants ${n.wants}. Secret: ${n.secret}. ${n.connection}`));
  L.push('', '## Appendix: Creatures', '', c.appendices.creatures.map(m => `${m.name} (CR ${m.cr})`).join(', '), '');
  if (c.appendices.magicItems.length) L.push('## Appendix: Magic items', '', c.appendices.magicItems.map(i => `${i.name} (${i.rarity})`).join(', '), '');
  L.push('', '## Endings', '');
  c.endings.forEach(e => L.push(`- **${e.label}:** ${e.text}`));
  return L.join('\n');
}
