// NPC Generator: instant character with a hook, savable to the campaign.
import { loadTables } from '../srd.js';
import { dbAll, dbPut, dbDelete, activeCampaignId } from '../store.js';
import { el, esc, toast, confirmDialog, promptDialog, modal } from '../components/ui.js';
import { pick, roll } from '../dice.js';

function generateNPC(names, npcData, ancestry) {
  const ancestries = Object.keys(names.people);
  const anc = ancestry || pick(ancestries);
  const person = names.people[anc];
  const statLine = () => 10 + roll('1d6').total - 3;
  return {
    name: `${pick(person.first)} ${pick(person.last)}`,
    ancestry: anc,
    occupation: pick(npcData.occupations),
    personality: pick(npcData.personalities),
    quirk: pick(npcData.quirks),
    ideal: pick(npcData.ideals),
    bond: pick(npcData.bonds),
    flaw: pick(npcData.flaws),
    hook: pick(npcData.hooks),
    stats: { str: statLine(), dex: statLine(), con: statLine(), int: statLine(), wis: statLine(), cha: statLine() },
    notes: '',
  };
}

function npcCardHTML(n, saved = false) {
  return `
    <h2>${esc(n.name)} <span class="pill">${esc(n.ancestry)}</span> <span class="pill accent">${esc(n.occupation)}</span></h2>
    <p><b>Personality.</b> <span class="muted">${esc(n.personality)}; ${esc(n.quirk)}.</span></p>
    <p><b>Ideal.</b> <span class="muted">${esc(n.ideal)}.</span> <b>Bond.</b> <span class="muted">${esc(n.bond)}.</span></p>
    <p><b>Flaw.</b> <span class="muted">${esc(n.flaw)}.</span></p>
    <p><b>Hook.</b> <span class="muted">${esc(n.hook)}.</span></p>
    <p class="small faint">STR ${n.stats.str} DEX ${n.stats.dex} CON ${n.stats.con} INT ${n.stats.int} WIS ${n.stats.wis} CHA ${n.stats.cha}</p>
    ${n.notes ? `<p class="small"><b>Notes.</b> ${esc(n.notes)}</p>` : ''}`;
}

export default {
  id: 'npcs', title: 'NPC Generator', shortTitle: 'NPCs', group: 'Generators', icon: 'mask',
  subtitle: 'A whole person in one click',

  async render(container) {
    const [names, npcData] = await Promise.all([loadTables('names'), loadTables('npc')]);
    const ancestries = Object.keys(names.people);
    let current = null;

    container.innerHTML = `
      <div class="grid-2">
        <div>
          <div class="card">
            <div class="row">
              <label class="field"><span>Ancestry</span><select id="np-anc"><option value="">Any</option>${ancestries.map(a => `<option>${a}</option>`).join('')}</select></label>
              <button class="btn primary" id="np-gen">Generate NPC</button>
              <button class="btn" id="np-save" disabled>Save to campaign</button>
            </div>
            <div id="np-current" class="mt"></div>
          </div>
        </div>
        <div class="card">
          <h2>Saved NPCs</h2>
          <div id="np-saved"></div>
        </div>
      </div>`;

    const currentEl = container.querySelector('#np-current');
    const saveBtn = container.querySelector('#np-save');

    const gen = () => {
      current = generateNPC(names, npcData, container.querySelector('#np-anc').value);
      currentEl.innerHTML = npcCardHTML(current);
      saveBtn.disabled = false;
    };

    const drawSaved = async () => {
      const saved = await dbAll('npcs', activeCampaignId());
      const box = container.querySelector('#np-saved');
      box.innerHTML = saved.length ? '' : '<p class="faint small">No saved NPCs yet.</p>';
      for (const n of saved.sort((a, b) => b.updated - a.updated)) {
        const row = el(`<div style="border-bottom:1px solid var(--border);padding:8px 0">
          <div class="row" style="align-items:center">
            <b>${esc(n.name)}</b><span class="pill">${esc(n.occupation)}</span>
            <span style="margin-left:auto;white-space:nowrap">
              <button class="btn small" data-view>View</button>
              <button class="btn small" data-note>Notes</button>
              <button class="btn small danger" data-del>Del</button>
            </span>
          </div>
        </div>`);
        row.querySelector('[data-view]').addEventListener('click', () => {
          modal(n.name, el(`<div>${npcCardHTML(n, true)}</div>`));
        });
        row.querySelector('[data-note]').addEventListener('click', () => {
          promptDialog(`Notes: ${n.name}`, [{ key: 'notes', label: 'DM notes', type: 'textarea', value: n.notes || '' }], async ({ notes }) => {
            n.notes = notes;
            await dbPut('npcs', n);
            drawSaved();
          });
        });
        row.querySelector('[data-del]').addEventListener('click', () =>
          confirmDialog(`Delete ${n.name}?`, async () => { await dbDelete('npcs', n.id); drawSaved(); }));
        box.append(row);
      }
    };

    container.querySelector('#np-gen').addEventListener('click', gen);
    saveBtn.addEventListener('click', async () => {
      if (!current) return;
      await dbPut('npcs', { ...current, campaignId: activeCampaignId() });
      toast(`${current.name} saved`);
      drawSaved();
    });

    gen();
    drawSaved();
  },
};
