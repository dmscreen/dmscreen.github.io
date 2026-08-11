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
  out.push({ kind: 'coin', gp: coin, name: `${coin.toLocaleString()} gp in coin and portable valuables` });
  if (chance(0.4)) out.push({ kind: 'goods', name: fill(pick(ctx.C.treasureGoods), ctx) });
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

  // Larger and alert-capable sites get a wandering table: a layer on the
  // element, per the taxonomy, not more rooms. Half the entries are sign
  // rather than contact, which is what keeps a dungeon feeling inhabited.
  let wandering = null;
  if (kind.alerts || nodes.length >= 10) {
    wandering = Array.from({ length: 6 }, (_, i) => {
      if (i < 3) return { range: String(i + 1), text: pick(C.wanderingSigns) };
      const enc = buildEncounter(pool, level, i < 5 ? 0 : 1);
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
    hazard: chance(0.5) ? pick(C.hazards) : null,
    alerts: kind.alerts ? 'Once the site is alerted, surviving occupants regroup at the deepest defensible room and post watches on the approach.' : null,
    wandering,
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
      chapter.summary = `The last site. ${ctx.slots.villain} is here, and so is everything they have left.`;
      chapter.elements.push(makeDungeon(ctx, {
        kindId: pick(['megadungeon', 'stronghold', 'temple']), level, title: place,
        pool: pools.faction, boss: true, sizeScale: 1,
      }));
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
    ch.clues = placements;
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
    ch.clues = [];
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
  const patternId = opts.pattern && C.patterns[opts.pattern] ? opts.pattern : pick(premise.patterns);
  const pattern = C.patterns[patternId];
  const region = C.regionKinds[premise.regionKind];
  const villainKind = C.villainKinds[pick(premise.villainKinds)];

  const length = opts.length || 'standard';
  const startLevel = opts.startLevel || (length === 'short' ? 1 : 1);
  const endLevel = length === 'short' ? 5 : length === 'epic' ? 15 : 10;

  const usedNames = new Set();
  const usedPlaces = new Set();
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

  const ctx = { C, names, npcTable, shops, items, monsters, pools, region, slots, usedNames, usedPlaces, climaxName };

  // The patron exists before anything else so that every {npc} slot resolves
  // to a person who is actually in the campaign, seated in the hub roster,
  // rather than a name that appears once in a clue and nowhere else.
  const patron = makeNPC(ctx, 'patron', hubName);
  ctx.recurringPatron = patron;
  slots.npc = patron.name;

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
  assignMilestones(allChapters);
  allChapters.forEach((ch, i) => assignTravel(ctx, ch, i));

  // Scatter the campaign objects across non-hub chapters, back to front, so
  // the last one is always in the climax. Each is a real object at the
  // table: a use, a burden, and a villain reaction when it is claimed.
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
      note: fill(pick(C.objectiveNotes), { ...slots, place: ch.title }),
      power: fill(pick(C.objectivePowers), slots),
      cost: fill(pick(C.objectiveCosts), slots),
      reaction: fill(pick(C.objectiveReactions), { ...slots, place: ch.title }),
    };
    objective.items.push(item);
    placeObjectiveItem(ctx, item, ch);
  });

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
      length, startLevel, endLevel,
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

  const ctx = { C, names, npcTable, shops, items, monsters, pools, region, slots, usedNames, usedPlaces };
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
  L.push(`**Tone** ${c.tone.join(', ')} | **Levels** ${c.levelRange.start}-${c.levelRange.end} | **Sessions** ${c.sessions} | **Pattern** ${c.pattern.label}`, '');
  L.push(`**Region** ${c.region.name} (${c.region.label}). **Base** ${c.hub}.`, '');
  L.push(`> **How to read this book:** blockquoted or "quoted" text is player-facing, written to be read aloud or found. Everything else is for the DM, and lines marked *(DM only)* are spoilers even at a shared table.`, '');
  if (c.opening) L.push(`## Opening the campaign`, '', c.opening, '');
  if (c.playerHooks?.length) {
    L.push(`## Character hooks (hand these to the players)`, '');
    c.playerHooks.forEach(h => L.push(`- "${h}"`));
    L.push('');
  }
  L.push(`## The objective`, '', `${c.objective.count} x ${c.objective.plural}. ${c.objective.why}`, '', `If ${c.villain.name} succeeds: ${c.objective.ifLost}`, '');
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
  L.push('', '### Villain schedule', '');
  c.villain.timeline.forEach(t => L.push(`- ${t.when}: ${t.move}`));
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
