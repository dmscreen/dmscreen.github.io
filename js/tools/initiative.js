// Initiative / Combat Tracker.
import { getState, setState } from '../store.js';
import { loadMonsters, loadConditions, abilityMod, fmtCR, sourceTag } from '../srd.js';
import { el, esc, toast, confirmDialog, modal, promptDialog, showStatBlock, searchInput } from '../components/ui.js';
import { roll } from '../dice.js';
import { getParty } from './party.js';
import { rollRandomEncounter } from './encounters.js';

const EMPTY = () => ({ combatants: [], round: 0, turnIndex: 0, started: false });

// Five static rows behind the empty-state message: a hint at the shape the
// tracker takes once it has combatants. Deliberately not animated, since
// nothing is actually loading.
const SKELETON = () => el(`<div class="init-skeleton">
  ${Array.from({ length: 5 }, () => `<div class="skel-row">
    <span class="skel skel-init"></span>
    <span class="skel skel-name"></span>
    <span class="skel skel-hp"></span>
  </div>`).join('')}
  <div class="empty-state"><p>No combatants. Add your party and monsters, or build an encounter in the Encounter Builder and hit "Run".</p></div>
</div>`);

export default {
  id: 'initiative', title: 'Initiative Tracker', shortTitle: 'Initiative', group: 'Combat', icon: 'shield',
  subtitle: 'Run the fight: turns, HP, conditions, death saves',

  async render(container) {
    let state = (await getState('combat')) || EMPTY();
    let monsters = null; // lazy
    const save = () => setState('combat', state);

    container.innerHTML = '<div id="i-encounter"></div><div id="i-body"></div>';
    const body = container.querySelector('#i-body');

    const sortCombatants = () => {
      state.combatants.sort((a, b) => (b.init ?? -99) - (a.init ?? -99) || (b.initMod ?? 0) - (a.initMod ?? 0));
    };

    const current = () => state.combatants[state.turnIndex];

    const nextTurn = () => {
      if (!state.combatants.length) return;
      if (!state.started) { state.started = true; state.round = 1; state.turnIndex = 0; }
      else {
        state.turnIndex++;
        if (state.turnIndex >= state.combatants.length) {
          state.turnIndex = 0;
          state.round++;
          // tick down timed conditions at the top of the round
          for (const c of state.combatants) {
            c.conditions = c.conditions.filter(cond => {
              if (cond.rounds == null) return true;
              cond.rounds--;
              if (cond.rounds <= 0) { toast(`${c.name}: ${cond.name} ended`); return false; }
              return true;
            });
          }
        }
      }
      // skip dead monsters
      let guard = 0;
      while (current() && current().type === 'monster' && current().hp <= 0 && guard++ < state.combatants.length) {
        state.turnIndex = (state.turnIndex + 1) % state.combatants.length;
        if (state.turnIndex === 0) state.round++;
      }
      save(); draw();
    };

    const draw = () => {
      // keep the current-turn marker on the same combatant across re-sorts
      const curId = state.combatants[state.turnIndex]?.id;
      sortCombatants();
      if (state.started && curId) {
        const idx = state.combatants.findIndex(c => c.id === curId);
        if (idx !== -1) state.turnIndex = idx;
        else if (state.turnIndex >= state.combatants.length) state.turnIndex = 0;
      }
      body.innerHTML = '';

      const controls = el(`<div class="row mb" style="align-items:center">
        <button class="btn primary" id="i-next">${state.started ? 'Next turn' : 'Start combat'}</button>
        <span class="pill accent" style="font-size:0.9rem">${state.started ? `Round ${state.round}` : 'Not started'}</span>
        <span style="margin-left:auto"></span>
        <button class="btn" id="i-add-pc">+ Party</button>
        <button class="btn" id="i-add-mon">+ Monster</button>
        <button class="btn" id="i-add-custom">+ Custom</button>
        <button class="btn" id="i-roll-init" title="Roll (or re-roll) initiative for every monster and NPC">Roll NPCs</button>
        <button class="btn danger" id="i-end">End combat</button>
      </div>`);
      body.append(controls);

      if (!state.combatants.length) body.append(SKELETON());

      state.combatants.forEach((c, idx) => {
        const isCurrent = state.started && idx === state.turnIndex;
        const dead = c.hp <= 0;
        const hpPct = Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100));
        const row = el(`<div class="init-row ${isCurrent ? 'current' : ''} ${dead && c.type === 'monster' ? 'dead' : ''}">
          <input type="number" class="init-num" value="${c.init ?? ''}" placeholder="--" title="Initiative">
          <span class="name">${c.type === 'monster' && c.slug ? `<a href="javascript:void 0" data-statblock>${esc(c.name)}</a>` : esc(c.name)}
            ${c.type === 'pc' ? '<span class="pill info">PC</span>' : ''}
            ${c.concentration ? '<span class="pill accent" title="Concentrating">conc</span>' : ''}
          </span>
          <span class="cond-pills">${c.conditions.map((cond, ci) => `<button class="pill danger" data-cond="${ci}" title="Click to remove">${esc(cond.name)}${cond.rounds != null ? ` (${cond.rounds})` : ''}</button>`).join('')}</span>
          <span class="hp-ctrl">
            <button class="btn small" data-dmg>Dmg</button>
            <input type="number" data-hp value="${c.hp}" title="Current HP">
            <span class="muted small">/ ${c.maxHp}</span>
            <button class="btn small" data-heal>Heal</button>
            <span class="muted small" title="Armor Class">AC ${c.ac ?? '?'}</span>
            <button class="btn small icon-btn" data-menu title="More">&#8942;</button>
          </span>
          <div class="hp-bar ${hpPct < 34 ? 'low' : ''}"><div style="width:${hpPct}%"></div></div>
        </div>`);

        row.querySelector('.init-num').addEventListener('change', (e) => {
          c.init = e.target.value === '' ? null : Number(e.target.value);
          save(); draw();
        });
        row.querySelector('[data-hp]').addEventListener('change', (e) => {
          c.hp = Number(e.target.value); save(); draw();
        });
        row.querySelector('[data-dmg]').addEventListener('click', () => hpDialog(c, -1));
        row.querySelector('[data-heal]').addEventListener('click', () => hpDialog(c, 1));
        row.querySelector('[data-statblock]')?.addEventListener('click', async () => {
          monsters ??= await loadMonsters();
          const m = monsters.find(x => x.slug === c.slug);
          if (m) showStatBlock(m);
        });
        row.querySelectorAll('[data-cond]').forEach(b => b.addEventListener('click', () => {
          c.conditions.splice(Number(b.dataset.cond), 1); save(); draw();
        }));
        row.querySelector('[data-menu]').addEventListener('click', () => combatantMenu(c));
        body.append(row);
      });

      const hpDialog = (c, sign) => {
        promptDialog(sign < 0 ? `Damage ${c.name}` : `Heal ${c.name}`,
          [{ key: 'amt', label: 'Amount', type: 'number', value: '' }],
          ({ amt }) => {
            if (!amt) return false;
            c.hp = sign < 0 ? c.hp - amt : Math.min(c.maxHp, c.hp + amt);
            if (sign < 0 && c.concentration) toast(`${c.name}: concentration check DC ${Math.max(10, Math.floor(amt / 2))}`);
            if (c.hp <= 0 && c.type === 'pc') toast(`${c.name} is down! Track death saves from the menu.`, 'danger');
            save(); draw();
          }, { submitLabel: sign < 0 ? 'Apply damage' : 'Heal' });
      };

      const combatantMenu = async (c) => {
        const conditions = await loadConditions();
        const body = el(`<div>
          <div class="row mb">
            <label class="field grow"><span>Add condition</span>
              <select id="cm-cond"><option value="">Choose...</option>${conditions.map(x => `<option>${esc(x.name)}</option>`).join('')}<option>Concentrating</option></select>
            </label>
            <label class="field"><span>Rounds (blank = until removed)</span><input type="number" id="cm-rounds" style="width:80px"></label>
          </div>
          ${c.type === 'pc' && c.hp <= 0 ? `<div class="mb"><h3>Death saves</h3>
            <div class="row"><span>Successes: <b id="cm-ds-s">${c.deathSaves?.s || 0}</b> <button class="btn small" id="cm-ds-sb">+</button></span>
            <span>Failures: <b id="cm-ds-f">${c.deathSaves?.f || 0}</b> <button class="btn small" id="cm-ds-fb">+</button></span>
            <button class="btn small" id="cm-ds-r">Reset</button></div></div>` : ''}
          <div class="row">
            <button class="btn danger" id="cm-remove">Remove from combat</button>
          </div>
        </div>`);
        const d = modal(c.name, body);
        body.querySelector('#cm-cond').addEventListener('change', (e) => {
          const name = e.target.value;
          if (!name) return;
          if (name === 'Concentrating') { c.concentration = true; }
          else {
            const rounds = body.querySelector('#cm-rounds').value;
            c.conditions.push({ name, rounds: rounds === '' ? null : Number(rounds) });
          }
          save(); draw(); d.close();
        });
        body.querySelector('#cm-ds-sb')?.addEventListener('click', () => {
          c.deathSaves.s++; body.querySelector('#cm-ds-s').textContent = c.deathSaves.s;
          if (c.deathSaves.s >= 3) toast(`${c.name} is stable!`);
          save(); draw();
        });
        body.querySelector('#cm-ds-fb')?.addEventListener('click', () => {
          c.deathSaves.f++; body.querySelector('#cm-ds-f').textContent = c.deathSaves.f;
          if (c.deathSaves.f >= 3) toast(`${c.name} has died.`, 'danger');
          save(); draw();
        });
        body.querySelector('#cm-ds-r')?.addEventListener('click', () => {
          c.deathSaves = { s: 0, f: 0 }; save(); draw(); d.close();
        });
        if (c.concentration) {
          const drop = el('<button class="btn small mt">Drop concentration</button>');
          drop.addEventListener('click', () => { c.concentration = false; save(); draw(); d.close(); });
          body.append(drop);
        }
        body.querySelector('#cm-remove').addEventListener('click', () => {
          state.combatants = state.combatants.filter(x => x !== c);
          if (state.turnIndex >= state.combatants.length) state.turnIndex = 0;
          save(); draw(); d.close();
        });
      };

      /* control handlers */
      controls.querySelector('#i-next').addEventListener('click', nextTurn);
      controls.querySelector('#i-end').addEventListener('click', () =>
        confirmDialog('End combat and clear the tracker?', () => { state = EMPTY(); save(); draw(); }, { label: 'End combat' }));

      controls.querySelector('#i-add-pc').addEventListener('click', async () => {
        const party = await getParty();
        if (!party.length) return toast('No PCs in the Party Tracker yet', 'danger');
        const existing = new Set(state.combatants.filter(c => c.type === 'pc').map(c => c.name));
        let added = 0;
        for (const pc of party) {
          if (existing.has(pc.name)) continue;
          state.combatants.push({
            id: crypto.randomUUID(), type: 'pc', name: pc.name, ac: pc.ac,
            hp: pc.maxHp, maxHp: pc.maxHp, initMod: pc.initMod, init: null,
            conditions: [], concentration: false, deathSaves: { s: 0, f: 0 },
          });
          added++;
        }
        toast(added ? `Added ${added} PCs; enter their initiative rolls` : 'Party already in combat');
        save(); draw();
      });

      controls.querySelector('#i-add-mon').addEventListener('click', async () => {
        monsters ??= await loadMonsters();
        const body = el('<div><div id="am-search"></div><div id="am-results" class="mt"></div></div>');
        const results = body.querySelector('#am-results');
        const d = modal('Add monster', body);
        body.querySelector('#am-search').append(searchInput('Search monsters...', (q) => {
          results.innerHTML = '';
          if (!q) return;
          for (const m of monsters.filter(x => x.name.toLowerCase().includes(q)).slice(0, 10)) {
            const row = el(`<div class="row" style="align-items:center;padding:3px 0">
              <span>${esc(m.name)}</span><span class="pill">AC ${m.ac} HP ${m.hp}</span>${sourceTag(m.source) ? `<span class="pill accent" title="${esc(m.source)}">${esc(sourceTag(m.source))}</span>` : ''}
              <button class="btn small" style="margin-left:auto">Add</button></div>`);
            row.querySelector('button').addEventListener('click', () => {
              const initMod = abilityMod(m.dex);
              const same = state.combatants.filter(c => c.slug === m.slug).length;
              state.combatants.push({
                id: crypto.randomUUID(), type: 'monster', slug: m.slug,
                name: same ? `${m.name} ${same + 1}` : m.name,
                ac: m.ac, hp: m.hp, maxHp: m.hp, initMod,
                init: roll(`1d20${initMod >= 0 ? '+' : ''}${initMod}`).total,
                conditions: [], concentration: false,
              });
              save(); draw(); d.close();
            });
            results.append(row);
          }
        }));
      });

      controls.querySelector('#i-add-custom').addEventListener('click', () => {
        promptDialog('Add custom combatant', [
          { key: 'name', label: 'Name' },
          { key: 'ac', label: 'AC', type: 'number', value: 12 },
          { key: 'hp', label: 'Max HP', type: 'number', value: 20 },
          { key: 'init', label: 'Initiative (blank to roll later)', type: 'number', value: '' },
        ], (out) => {
          if (!out.name.trim()) return false;
          state.combatants.push({
            id: crypto.randomUUID(), type: 'monster', name: out.name.trim(), ac: out.ac,
            hp: out.hp, maxHp: out.hp, initMod: 0, init: out.init === 0 || out.init ? out.init : null,
            conditions: [], concentration: false,
          });
          save(); draw();
        });
      });

      // Rolls every non-PC combatant, including ones that already have a
      // number: monsters are added with initiative pre-rolled, so a
      // blanks-only pass looked like a dead button.
      controls.querySelector('#i-roll-init').addEventListener('click', () => {
        const npcs = state.combatants.filter(c => c.type !== 'pc');
        if (!npcs.length) return toast('No monsters or NPCs to roll for', 'danger');
        for (const c of npcs) {
          const mod = Number(c.initMod) || 0;
          c.init = roll(`1d20${mod >= 0 ? '+' : ''}${mod}`).total;
        }
        save(); draw();
        toast(`Rolled initiative for ${npcs.length} ${npcs.length === 1 ? 'NPC' : 'NPCs'}`);
      });
    };

    /* ---------- encounter tile ---------- */

    // The same roller as Travel > Random, but here the result is added to the
    // tracker rather than replacing whatever fight is already running.
    const drawEncounterTile = async () => {
      const host = container.querySelector('#i-encounter');
      const party = await getParty();
      const level = party.length
        ? Math.round(party.reduce((a, p) => a + (p.level || 1), 0) / party.length)
        : 3;

      host.innerHTML = `<div class="card">
        <h2>Roll an encounter</h2>
        <div class="row">
          <label class="field grow"><span>Terrain</span>
            <select id="ie-env"><option value="">Any terrain</option></select></label>
          <label class="field"><span>Party level</span>
            <input type="number" id="ie-level" value="${level}" min="1" max="20" style="width:70px"></label>
          <label class="field"><span>Difficulty</span><select id="ie-diff">
            <option value="1">Easy</option><option value="2" selected>Medium</option><option value="3">Hard</option>
          </select></label>
          <button class="btn primary" id="ie-roll">Roll</button>
        </div>
        <div id="ie-out"></div>
      </div>`;

      const out = host.querySelector('#ie-out');
      const envSel = host.querySelector('#ie-env');

      // fill terrains once the monster list is in memory; the button works
      // before then, it just defaults to any terrain
      monsters ??= await loadMonsters();
      const envs = [...new Set(monsters.flatMap(m => m.environments))].sort();
      envSel.insertAdjacentHTML('beforeend', envs.map(e => `<option>${esc(e)}</option>`).join(''));

      const rollOne = () => {
        const enc = rollRandomEncounter(monsters, party, {
          env: envSel.value,
          level: Math.min(20, Math.max(1, Number(host.querySelector('#ie-level').value) || 3)),
          diffIdx: Number(host.querySelector('#ie-diff').value),
        });
        if (!enc) return toast('No monsters fit that terrain and budget', 'danger');
        const { monster: m, count, adjusted, label, partySize } = enc;

        out.innerHTML = '';
        const res = el(`<div class="mt">
          <p><b>${count} x <a href="javascript:void 0" data-sb>${esc(m.name)}</a></b>
            <span class="pill">CR ${fmtCR(m.cr)}</span> <span class="pill">${esc(label)}</span></p>
          <p class="small muted">${adjusted.toLocaleString()} adjusted XP for a party of ${partySize}.</p>
          <div class="row">
            <button class="btn primary" data-add>Add to initiative</button>
            <button class="btn" data-reroll>Re-roll</button>
          </div>
        </div>`);
        res.querySelector('[data-sb]').addEventListener('click', () => showStatBlock(m));
        res.querySelector('[data-reroll]').addEventListener('click', rollOne);
        res.querySelector('[data-add]').addEventListener('click', () => {
          addMonsters(m, count);
          toast(`Added ${count} x ${m.name} to the tracker`);
        });
        out.append(res);
      };

      host.querySelector('#ie-roll').addEventListener('click', rollOne);
    };

    // Append to the tracker instead of starting over, so an encounter can
    // reinforce a fight that is already under way.
    const addMonsters = (monster, count) => {
      const initMod = abilityMod(monster.dex);
      let n = state.combatants.filter(c => c.slug === monster.slug).length;
      for (let i = 0; i < count; i++) {
        n++;
        state.combatants.push({
          id: crypto.randomUUID(), type: 'monster', slug: monster.slug,
          name: n > 1 || count > 1 ? `${monster.name} ${n}` : monster.name,
          ac: monster.ac, hp: monster.hp, maxHp: monster.hp, initMod,
          init: roll(`1d20${initMod >= 0 ? '+' : ''}${initMod}`).total,
          conditions: [], concentration: false,
        });
      }
      save(); draw();
    };

    draw();
    drawEncounterTile();
  },
};
