// Random Encounter Engine: terrain + party level -> a balanced surprise.
import { loadMonsters, monsterXP, encounterMultiplier, fmtCR } from '../srd.js';
import { dbAll, activeCampaignId } from '../store.js';
import { el, esc, toast, showStatBlock } from '../components/ui.js';
import { historyList, timeStamp } from '../components/history.js';
import { roll, pick, rollTable } from '../dice.js';
import { getParty } from './party.js';
import { difficultyFor, launchCombat } from './encounters.js';

export default {
  id: 'random-encounters', title: 'Random Encounters', shortTitle: 'Random', group: 'Travel', icon: 'compass',
  subtitle: 'Check for trouble, then roll trouble worth having',

  async render(container) {
    const monsters = await loadMonsters();
    const party = await getParty();
    const customTables = (await dbAll('customTables', activeCampaignId()));
    const envs = [...new Set(monsters.flatMap(m => m.environments))].sort();
    const avgLevel = party.length ? Math.round(party.reduce((a, p) => a + (p.level || 1), 0) / party.length) : 3;
    let lastEncounter = null;

    container.innerHTML = `
      <div class="grid-2">
        <div class="card">
          <h2>Roll an encounter</h2>
          <div class="row">
            <label class="field grow"><span>Terrain</span><select id="re-env"><option value="">Any terrain</option>${envs.map(e => `<option>${esc(e)}</option>`).join('')}</select></label>
            <label class="field"><span>Party level</span><input type="number" id="re-level" value="${avgLevel}" min="1" max="20" style="width:70px"></label>
            <label class="field"><span>Difficulty</span><select id="re-diff">
              <option value="1">Easy</option><option value="2" selected>Medium</option><option value="3">Hard</option>
            </select></label>
            <button class="btn primary" id="re-roll">Roll</button>
          </div>
          ${customTables.length ? `<div class="row mt">
            <label class="field grow"><span>...or roll on a custom table</span><select id="re-custom">${customTables.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
            <button class="btn" id="re-roll-custom">Roll table</button>
          </div>` : ''}
        </div>
        <div class="card">
          <h2>Encounter check</h2>
          <div class="row">
            <label class="field"><span>Encounter on (d20)</span><input type="number" id="re-threshold" value="18" min="1" max="20" style="width:70px"></label>
            <button class="btn primary" id="re-check">Check for encounter</button>
          </div>
          <div id="re-check-out" class="mt center muted"></div>
          <p class="small faint mt">A common rhythm: check once per watch (4 hours) while traveling, and once per night's rest. Raise or lower the threshold for wilder or safer lands.</p>
        </div>
      </div>
      <div id="re-result"></div>
      <div id="re-history"></div>`;

    const resultEl = container.querySelector('#re-result');
    const bySlug = new Map(monsters.map(m => [m.slug, m]));

    const history = await historyList({
      container: container.querySelector('#re-history'),
      key: 'history:randomEncounters',
      title: 'Rolled encounters',
      renderEntry: (e, body) => {
        if (e.kind === 'table') {
          body.innerHTML = `<span class="pill">${esc(e.table)}</span> ${esc(e.text)} <span class="small faint">${timeStamp(e.ts)}</span>`;
          return;
        }
        body.innerHTML = `
          <b>${e.count} x <a href="javascript:void 0">${esc(e.name)}</a></b>
          <span class="pill">CR ${esc(e.cr)}</span> <span class="pill">${esc(e.label)}</span>
          ${e.env ? `<span class="pill">${esc(e.env)}</span>` : ''}
          <span class="small faint">${timeStamp(e.ts)}</span>
          <button class="btn small" style="margin-left:6px" data-run>Run</button>`;
        const m = bySlug.get(e.slug);
        body.querySelector('a').addEventListener('click', () => m ? showStatBlock(m) : toast('Monster not found', 'danger'));
        body.querySelector('[data-run]').addEventListener('click', () => m ? launchCombat([{ monster: m, count: e.count }]) : toast('Monster not found', 'danger'));
      },
    });

    container.querySelector('#re-check').addEventListener('click', () => {
      const threshold = Number(container.querySelector('#re-threshold').value) || 18;
      const r = roll('1d20').total;
      const hit = r >= threshold;
      container.querySelector('#re-check-out').innerHTML =
        `<span class="roll-result-big" style="font-size:2rem">${r}</span><br>` +
        (hit ? '<span class="pill danger" style="font-size:1rem">Encounter!</span>' : '<span class="pill success" style="font-size:1rem">All quiet</span>');
      if (hit) rollEncounter();
    });

    const rollEncounter = () => {
      const env = container.querySelector('#re-env').value;
      const level = Math.min(20, Math.max(1, Number(container.querySelector('#re-level').value) || 3));
      const diffIdx = Number(container.querySelector('#re-diff').value);
      const partyForMath = party.length ? party : Array.from({ length: 4 }, () => ({ level }));

      const { thresholds } = difficultyFor(partyForMath, 0);
      const budget = thresholds[diffIdx]; // medium/hard target adjusted XP

      const pool = monsters.filter(m =>
        (!env || m.environments.includes(env)) &&
        monsterXP(m) > 0 &&
        monsterXP(m) <= budget
      );
      if (!pool.length) { toast('No monsters fit that terrain and budget', 'danger'); return; }

      // Weight toward CRs that matter at this level
      const m = pick(pool.filter(x => monsterXP(x) >= budget / 12) .length ? pool.filter(x => monsterXP(x) >= budget / 12) : pool);
      const xp = monsterXP(m) || 10;
      let count = 1;
      for (let c = 8; c >= 1; c--) {
        if (xp * c * encounterMultiplier(c, partyForMath.length) <= budget * 1.15) { count = c; break; }
      }
      const adjusted = Math.round(xp * count * encounterMultiplier(count, partyForMath.length));
      const { label } = difficultyFor(partyForMath, adjusted);
      lastEncounter = { monster: m, count };
      history.add({ slug: m.slug, name: m.name, count, cr: fmtCR(m.cr), label, env });

      resultEl.innerHTML = '';
      const card = el(`<div class="card">
        <h2>${count} x <a href="javascript:void 0" id="re-mon">${esc(m.name)}</a></h2>
        <p class="muted">CR ${fmtCR(m.cr)} each. ${adjusted.toLocaleString()} adjusted XP: <b>${label}</b> for a party of ${partyForMath.length} (level ${level}).</p>
        <div class="row mt">
          <button class="btn primary" id="re-run">Run it in the initiative tracker</button>
          <button class="btn" id="re-reroll">Re-roll</button>
        </div>
      </div>`);
      card.querySelector('#re-mon').addEventListener('click', () => showStatBlock(m));
      card.querySelector('#re-run').addEventListener('click', () => launchCombat([{ monster: m, count }]));
      card.querySelector('#re-reroll').addEventListener('click', rollEncounter);
      resultEl.append(card);
    };

    container.querySelector('#re-roll').addEventListener('click', rollEncounter);

    container.querySelector('#re-roll-custom')?.addEventListener('click', () => {
      const id = container.querySelector('#re-custom').value;
      const table = customTables.find(t => t.id === id);
      if (!table || !table.rows?.length) return toast('That table is empty', 'danger');
      const row = rollTable(table.rows);
      history.add({ kind: 'table', table: table.name, text: row.text });
      resultEl.innerHTML = '';
      resultEl.append(el(`<div class="card"><h2>${esc(table.name)}</h2><p style="font-size:1.15rem">${esc(row.text)}</p></div>`));
    });
  },
};
