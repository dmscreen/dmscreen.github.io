// Unified Reference: quick-filter chips across every reference type.
// "All" searches everything at once; a specific chip opens that type's full browser.
import { getPrefs, setPref } from '../store.js';
import { el, esc, searchInput, randomButton, showStatBlock, attachHoverSwitch } from '../components/ui.js';
import { loadMonsters, loadSpells, loadItems, loadRules, loadConditions, loadFeats, loadBackgrounds, fmtCR } from '../srd.js';
import monsters from './monsters.js';
import spells, { spellDetail } from './spells.js';
import items, { itemDetail } from './items.js';
import rules, { ruleDetail } from './rules.js';
import conditions, { conditionDetail } from './conditions.js';
import characterOptions, { featDetail, backgroundDetail } from './character-options.js';

export const REF_TYPES = [
  { id: 'monsters', label: 'Bestiary', tool: monsters },
  { id: 'spells', label: 'Spells', tool: spells },
  { id: 'items', label: 'Items', tool: items },
  { id: 'rules', label: 'Rules', tool: rules },
  { id: 'conditions', label: 'Conditions', tool: conditions },
  { id: 'character-options', label: 'Character Options', tool: characterOptions },
];

async function renderAll(body) {
  body.innerHTML = `
    <div class="card"><div class="row">
      <div class="grow" id="ra-search"></div><span id="ra-random"></span>
    </div></div>
    <div id="ra-results"></div>`;
  const [monstersD, spellsD, itemsD, rulesD, condD, featsD, bgD] = await Promise.all([
    loadMonsters(), loadSpells(), loadItems(), loadRules(), loadConditions(), loadFeats(), loadBackgrounds(),
  ]);
  const ruleEntries = rulesD.flatMap(sec => sec.entries.map(e => ({ section: sec.title, ...e })));
  const resultsEl = body.querySelector('#ra-results');

  const summary = () => {
    resultsEl.innerHTML = `<p class="muted center" style="padding:30px 10px">
      Search across <b>${monstersD.length.toLocaleString()}</b> monsters, <b>${spellsD.length.toLocaleString()}</b> spells,
      <b>${itemsD.length.toLocaleString()}</b> items, <b>${ruleEntries.length}</b> rules, <b>${condD.length}</b> conditions,
      <b>${featsD.length}</b> feats, and <b>${bgD.length}</b> backgrounds,<br>or pick a type above to browse with full filters.</p>`;
  };

  const grouped = (q) => [
    { label: 'Monsters', rows: monstersD.filter(m => m.name.toLowerCase().includes(q)), open: showStatBlock,
      meta: (m) => `CR ${fmtCR(m.cr)}, ${esc(m.type)} &middot; ${esc(m.source)}` },
    { label: 'Spells', rows: spellsD.filter(s => s.name.toLowerCase().includes(q)), open: spellDetail,
      meta: (s) => `${s.level === 0 ? 'Cantrip' : `Level ${s.level}`} ${esc(s.school)} &middot; ${esc(s.source)}` },
    { label: 'Items', rows: itemsD.filter(i => i.name.toLowerCase().includes(q)), open: itemDetail,
      meta: (i) => `${esc(i.category)}${i.rarity ? `, ${esc(i.rarity)}` : ''} &middot; ${esc(i.source)}` },
    { label: 'Rules', rows: ruleEntries.filter(r => (r.name + ' ' + r.text).toLowerCase().includes(q)), open: ruleDetail,
      meta: (r) => esc(r.section) },
    { label: 'Conditions', rows: condD.filter(c => c.name.toLowerCase().includes(q)), open: conditionDetail,
      meta: () => 'Condition' },
    { label: 'Feats', rows: featsD.filter(f => f.name.toLowerCase().includes(q)), open: featDetail,
      meta: (f) => esc(f.source) },
    { label: 'Backgrounds', rows: bgD.filter(b => b.name.toLowerCase().includes(q)), open: backgroundDetail,
      meta: (b) => esc(b.source) },
  ].filter(g => g.rows.length);

  // Everything the search has left, across every type, each remembering how
  // to open itself. With the box empty that is the whole reference, which is
  // what a bare Random should draw from.
  const pool = () => grouped(searchBox.value.trim().toLowerCase())
    .flatMap(g => g.rows.map(r => ({ r, open: g.open })));

  const draw = (q) => {
    if (!q) { summary(); return; }
    const PER = 15;
    const groups = grouped(q);

    if (!groups.length) {
      resultsEl.innerHTML = '<p class="faint center" style="padding:30px 10px">No matches anywhere.</p>';
      return;
    }
    resultsEl.innerHTML = '';
    for (const g of groups) {
      const card = el(`<div class="card">
        <h2>${g.label} <span class="muted small" style="font-weight:normal">${g.rows.length.toLocaleString()}${g.rows.length > PER ? `, showing ${PER}` : ''}</span></h2>
        <div data-rows></div>
      </div>`);
      const rowsEl = card.querySelector('[data-rows]');
      for (const r of g.rows.slice(0, PER)) {
        const row = el(`<div class="row" style="align-items:center;padding:3px 0">
          <a href="javascript:void 0"><b>${esc(r.name)}</b></a>
          <span class="muted small">${g.meta(r)}</span>
        </div>`);
        row.querySelector('a').addEventListener('click', () => g.open(r));
        rowsEl.append(row);
      }
      resultsEl.append(card);
    }
  };

  const searchBox = searchInput('Search everything: monsters, spells, items, rules...', draw);
  body.querySelector('#ra-search').append(searchBox);
  body.querySelector('#ra-random').append(randomButton(pool, ({ r, open }) => open(r), 'entries'));
  summary();
}

export default {
  id: 'reference', title: 'Reference', shortTitle: 'Reference', group: 'Reference', icon: 'book',
  subtitle: 'Bestiary, spells, items, rules, conditions, and character options across every bundled source',

  async render(container) {
    let typeId = getPrefs().refType || 'all';
    if (typeId !== 'all' && !REF_TYPES.some(t => t.id === typeId)) typeId = 'all';

    container.innerHTML = `
      <div class="row mb" id="ref-chips" style="gap:6px"></div>
      <div id="ref-body"></div>`;

    const chipsEl = container.querySelector('#ref-chips');
    const body = container.querySelector('#ref-body');

    // entry counts shown on each chip; filled in once the data is loaded
    let counts = null;
    const loadCounts = async () => {
      const [m, s, i, r, c, f, b] = await Promise.all([
        loadMonsters(), loadSpells(), loadItems(), loadRules(), loadConditions(), loadFeats(), loadBackgrounds(),
      ]);
      counts = {
        monsters: m.length, spells: s.length, items: i.length,
        rules: r.reduce((n, sec) => n + sec.entries.length, 0),
        conditions: c.length, 'character-options': f.length + b.length,
      };
      counts.all = Object.values(counts).reduce((a, n) => a + n, 0);
      return counts;
    };

    const select = (id) => {
      if (!id || typeId === id) return;
      typeId = id;
      setPref('refType', typeId);
      draw();
    };
    attachHoverSwitch(chipsEl, '.btn', (chip) => select(chip.dataset.tab));

    const chipLabel = (t) => {
      const n = counts?.[t.id];
      return `${esc(t.label)}${n != null ? ` <span class="chip-count">(${n.toLocaleString()})</span>` : ''}`;
    };

    const draw = async () => {
      chipsEl.innerHTML = '';
      const tabs = [{ id: 'all', label: 'All' }, ...REF_TYPES];
      for (const t of tabs) {
        const chip = el(`<button class="btn small ${t.id === typeId ? 'primary' : ''}" data-tab="${esc(t.id)}">${chipLabel(t)}</button>`);
        chip.addEventListener('click', () => select(t.id));
        chipsEl.append(chip);
      }
      if (!counts) {
        // fill the counts in as soon as the data lands, without blocking the view
        loadCounts().then(() => {
          chipsEl.querySelectorAll('.btn').forEach(btn => {
            const t = tabs.find(x => x.id === btn.dataset.tab);
            if (t) btn.innerHTML = chipLabel(t);
          });
        }).catch(() => {});
      }
      body.innerHTML = '';
      try {
        if (typeId === 'all') await renderAll(body);
        else await REF_TYPES.find(t => t.id === typeId).tool.render(body);
      } catch (err) {
        console.error(err);
        body.innerHTML = `<div class="card"><p class="muted">Failed to load: ${esc(err.message)}</p></div>`;
      }
    };

    await draw();
  },
};
