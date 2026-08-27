// Encounter Builder: XP budget math + saved encounters + send to initiative.
import { loadMonsters, fmtCR, monsterXP, XP_THRESHOLDS, encounterMultiplier, abilityMod, sourceTag } from '../srd.js';
import { dbAll, dbPut, dbDelete, activeCampaignId, setState, getState } from '../store.js';
import { el, esc, toast, confirmDialog, showStatBlock, searchInput, promptDialog } from '../components/ui.js';
import { roll, pick } from '../dice.js';
import { getParty } from './party.js';

export async function launchCombat(monsterEntries) {
  // monsterEntries: [{monster, count}]
  const party = await getParty();
  const combatants = [];
  for (const pc of party) {
    combatants.push({
      id: crypto.randomUUID(), type: 'pc', name: pc.name, ac: pc.ac,
      hp: pc.maxHp, maxHp: pc.maxHp, initMod: pc.initMod, init: null,
      conditions: [], concentration: false, deathSaves: { s: 0, f: 0 },
    });
  }
  for (const { monster, count } of monsterEntries) {
    for (let i = 0; i < count; i++) {
      const initMod = abilityMod(monster.dex);
      combatants.push({
        id: crypto.randomUUID(), type: 'monster', slug: monster.slug,
        name: count > 1 ? `${monster.name} ${i + 1}` : monster.name,
        ac: monster.ac, hp: monster.hp, maxHp: monster.hp, initMod,
        init: roll(`1d20${initMod >= 0 ? '+' : ''}${initMod}`).total,
        conditions: [], concentration: false,
      });
    }
  }
  await setState('combat', { combatants, round: 0, turnIndex: 0, started: false });
  location.hash = '#/initiative';
}

// Join whatever is already on the tracker rather than starting over: an NPC
// who walks into a fight joins it, and launchCombat's replace-everything is
// the wrong move for one person. An empty tracker gets the party first, so
// the DM lands on something they can run instead of a lone combatant.
//
// entries: [{ monster, count, name }] - monster is optional, so somebody
// with no suggested stat block still gets a row to roll initiative on.
export async function addToCombat(entries) {
  const state = (await getState('combat')) || { combatants: [], round: 0, turnIndex: 0, started: false };
  state.combatants ||= [];
  if (!state.combatants.length) {
    for (const pc of await getParty()) {
      state.combatants.push({
        id: crypto.randomUUID(), type: 'pc', name: pc.name, ac: pc.ac,
        hp: pc.maxHp, maxHp: pc.maxHp, initMod: pc.initMod, init: null,
        conditions: [], concentration: false, deathSaves: { s: 0, f: 0 },
      });
    }
  }
  let added = 0;
  for (const { monster, count = 1, name } of entries) {
    const m = monster || {};
    const label = name || m.name || 'Combatant';
    const initMod = monster ? abilityMod(m.dex) : 0;
    for (let i = 0; i < Math.max(1, count); i++) {
      // number them off whatever is on the tracker already, so a second
      // wave of guards carries on from the first rather than restarting
      const same = state.combatants.filter(c => c.name === label || String(c.name).startsWith(`${label} `)).length;
      state.combatants.push({
        id: crypto.randomUUID(), type: 'monster', slug: m.slug,
        name: same ? `${label} ${same + 1}` : label,
        ac: m.ac ?? 12, hp: m.hp ?? 20, maxHp: m.hp ?? 20, initMod,
        init: roll(`1d20${initMod >= 0 ? '+' : ''}${initMod}`).total,
        conditions: [], concentration: false,
      });
      added++;
    }
  }
  await setState('combat', state);
  return added;
}

export function difficultyFor(party, adjustedXP) {
  // party: [{level}] - returns {label, thresholds:[e,m,h,d], totalXP}
  const t = [0, 0, 0, 0];
  for (const pc of party) {
    const row = XP_THRESHOLDS[Math.min(20, Math.max(1, pc.level || 1))];
    for (let i = 0; i < 4; i++) t[i] += row[i];
  }
  let label = 'Trivial';
  if (adjustedXP >= t[3]) label = 'Deadly';
  else if (adjustedXP >= t[2]) label = 'Hard';
  else if (adjustedXP >= t[1]) label = 'Medium';
  else if (adjustedXP >= t[0]) label = 'Easy';
  return { label, thresholds: t };
}

// Roll one random encounter sized to the party's XP budget. Shared by
// Travel > Random and the Initiative tracker's encounter tile, so both build
// fights the same way. Returns null when nothing fits the terrain and budget.
export function rollRandomEncounter(monsters, party, { env = '', level = 3, diffIdx = 2 } = {}) {
  const partyForMath = party.length ? party : Array.from({ length: 4 }, () => ({ level }));
  const budget = difficultyFor(partyForMath, 0).thresholds[diffIdx];

  const pool = monsters.filter(m =>
    (!env || m.environments.includes(env)) && monsterXP(m) > 0 && monsterXP(m) <= budget);
  if (!pool.length) return null;

  // Weight toward CRs that matter at this level rather than a swarm of rats
  const meaty = pool.filter(x => monsterXP(x) >= budget / 12);
  const monster = pick(meaty.length ? meaty : pool);
  const xp = monsterXP(monster) || 10;
  let count = 1;
  for (let c = 8; c >= 1; c--) {
    if (xp * c * encounterMultiplier(c, partyForMath.length) <= budget * 1.15) { count = c; break; }
  }
  const adjusted = Math.round(xp * count * encounterMultiplier(count, partyForMath.length));
  const { label } = difficultyFor(partyForMath, adjusted);
  return { monster, count, adjusted, label, partySize: partyForMath.length, level, env };
}

const DIFF_PILL = { Trivial: '', Easy: 'success', Medium: 'info', Hard: 'accent', Deadly: 'danger' };

export default {
  id: 'encounters', title: 'Encounter Builder', shortTitle: 'Build', group: 'Combat', icon: 'swords',
  subtitle: 'Build and balance encounters against your party',

  async render(container) {
    const monsters = await loadMonsters();
    const bySlug = new Map(monsters.map(m => [m.slug, m]));
    // the working encounter persists per campaign so tab switches don't lose it
    let current = ((await getState('encounterCurrent', [])) || []).filter(e => bySlug.has(e.slug));
    let query = '';
    const persist = () => setState('encounterCurrent', current);

    container.innerHTML = `
      <div class="grid-2">
        <div>
          <div class="card">
            <h2>Add monsters</h2>
            <div id="e-search"></div>
            <div id="e-results" class="mt"></div>
          </div>
          <div class="card">
            <h2>Saved encounters</h2>
            <div id="e-saved"></div>
          </div>
        </div>
        <div>
          <div class="card">
            <h2>Current encounter</h2>
            <div id="e-current"></div>
            <div id="e-budget" class="mt"></div>
            <div class="row mt">
              <button class="btn primary" id="e-run">Run in initiative tracker</button>
              <button class="btn" id="e-save">Save encounter</button>
              <button class="btn danger" id="e-clear">Clear</button>
            </div>
          </div>
        </div>
      </div>`;

    const resultsEl = container.querySelector('#e-results');
    const currentEl = container.querySelector('#e-current');
    const budgetEl = container.querySelector('#e-budget');

    const drawResults = () => {
      if (!query) { resultsEl.innerHTML = '<p class="faint small">Type to search 900+ monsters.</p>'; return; }
      const found = monsters.filter(m => m.name.toLowerCase().includes(query)).slice(0, 12);
      resultsEl.innerHTML = found.length ? '' : '<p class="faint small">No matches.</p>';
      for (const m of found) {
        const row = el(`<div class="row" style="align-items:center;padding:4px 0">
          <a href="javascript:void 0" style="min-width:0">${esc(m.name)}</a>
          <span class="pill">CR ${fmtCR(m.cr)}</span>${sourceTag(m.source) ? `<span class="pill accent" title="${esc(m.source)}">${esc(sourceTag(m.source))}</span>` : ''}
          <button class="btn small" style="margin-left:auto">+ Add</button>
        </div>`);
        row.querySelector('a').addEventListener('click', () => showStatBlock(m));
        row.querySelector('button').addEventListener('click', () => addMonster(m.slug));
        resultsEl.append(row);
      }
    };

    const addMonster = (slug) => {
      const e = current.find(x => x.slug === slug);
      if (e) e.count++;
      else current.push({ slug, count: 1 });
      persist();
      drawCurrent();
    };

    const drawCurrent = async () => {
      if (!current.length) {
        currentEl.innerHTML = '<p class="faint">Empty. Add monsters from the left.</p>';
        budgetEl.innerHTML = '';
        return;
      }
      currentEl.innerHTML = '';
      for (const entry of current) {
        const m = bySlug.get(entry.slug);
        const row = el(`<div class="row" style="align-items:center;padding:4px 0">
          <a href="javascript:void 0">${esc(m.name)}</a>
          <span class="pill">CR ${fmtCR(m.cr)}</span>
          <span class="muted small">${monsterXP(m).toLocaleString()} XP each</span>
          <span class="hp-ctrl" style="margin-left:auto">
            <button class="btn small" data-dec>-</button>
            <b style="min-width:22px;text-align:center">${entry.count}</b>
            <button class="btn small" data-inc>+</button>
          </span>
        </div>`);
        row.querySelector('a').addEventListener('click', () => showStatBlock(m));
        row.querySelector('[data-inc]').addEventListener('click', () => { entry.count++; persist(); drawCurrent(); });
        row.querySelector('[data-dec]').addEventListener('click', () => {
          entry.count--;
          if (entry.count <= 0) current = current.filter(x => x !== entry);
          persist();
          drawCurrent();
        });
        currentEl.append(row);
      }

      const party = await getParty();
      const count = current.reduce((a, e) => a + e.count, 0);
      const totalXP = current.reduce((a, e) => a + monsterXP(bySlug.get(e.slug)) * e.count, 0);
      const mult = encounterMultiplier(count, party.length || 4);
      const adjusted = Math.round(totalXP * mult);

      if (!party.length) {
        budgetEl.innerHTML = `<p class="muted small">Total ${totalXP.toLocaleString()} XP, x${mult} for ${count} monsters = <b>${adjusted.toLocaleString()} adjusted XP</b>.<br>Add PCs in the Party Tracker to see difficulty thresholds.</p>`;
        return;
      }
      const { label, thresholds } = difficultyFor(party, adjusted);
      budgetEl.innerHTML = `
        <p><span class="pill ${DIFF_PILL[label]}" style="font-size:0.95rem">${label}</span>
        <b>${adjusted.toLocaleString()}</b> adjusted XP (${totalXP.toLocaleString()} base x${mult})</p>
        <table class="data mt"><thead><tr><th>Easy</th><th>Medium</th><th>Hard</th><th>Deadly</th></tr></thead>
        <tbody><tr>${thresholds.map(t => `<td>${t.toLocaleString()}</td>`).join('')}</tr></tbody></table>
        <p class="small muted mt">Party of ${party.length}: ${party.map(p => `${esc(p.name)} (${p.level})`).join(', ')}.
        XP on completion: <b>${Math.floor(totalXP / party.length).toLocaleString()}</b> each.</p>`;
    };

    const drawSaved = async () => {
      const saved = await dbAll('encounters', activeCampaignId());
      const box = container.querySelector('#e-saved');
      box.innerHTML = saved.length ? '' : '<p class="faint small">Nothing saved yet.</p>';
      for (const s of saved.sort((a, b) => b.updated - a.updated)) {
        const row = el(`<div class="row" style="align-items:center;padding:4px 0">
          <b>${esc(s.name)}</b>
          <span class="muted small">${s.monsters.map(e => `${e.count}x ${esc(bySlug.get(e.slug)?.name || e.slug)}`).join(', ')}</span>
          <span style="margin-left:auto;white-space:nowrap">
            <button class="btn small" data-load>Load</button>
            <button class="btn small danger" data-del>Del</button>
          </span>
        </div>`);
        row.querySelector('[data-load]').addEventListener('click', () => { current = s.monsters.map(m => ({ ...m })); drawCurrent(); });
        row.querySelector('[data-del]').addEventListener('click', () =>
          confirmDialog(`Delete encounter "${s.name}"?`, async () => { await dbDelete('encounters', s.id); drawSaved(); }));
        box.append(row);
      }
    };

    container.querySelector('#e-search').append(searchInput('Search monsters...', q => { query = q; drawResults(); }));
    container.querySelector('#e-run').addEventListener('click', async () => {
      if (!current.length) return toast('Add some monsters first', 'danger');
      await launchCombat(current.map(e => ({ monster: bySlug.get(e.slug), count: e.count })));
    });
    container.querySelector('#e-save').addEventListener('click', () => {
      if (!current.length) return toast('Nothing to save', 'danger');
      promptDialog('Save encounter', [{ key: 'name', label: 'Encounter name' }], async ({ name }) => {
        if (!name.trim()) return false;
        await dbPut('encounters', { name: name.trim(), monsters: current.map(m => ({ ...m })), campaignId: activeCampaignId() });
        toast('Encounter saved');
        drawSaved();
      });
    });
    container.querySelector('#e-clear').addEventListener('click', () => { current = []; persist(); drawCurrent(); });

    drawResults();
    drawCurrent();
    drawSaved();
  },
};
