// Party Tracker: PC roster feeding the encounter builder and initiative tracker.
import { dbAll, dbPut, dbDelete, activeCampaignId } from '../store.js';
import { el, esc, toast, confirmDialog, promptDialog, modal } from '../components/ui.js';
import { roll } from '../dice.js';

const FIELDS = [
  { key: 'name', label: 'Character name' },
  { key: 'player', label: 'Player' },
  { key: 'level', label: 'Level', type: 'number', value: 1 },
  { key: 'ac', label: 'Armor Class', type: 'number', value: 10 },
  { key: 'maxHp', label: 'Max HP', type: 'number', value: 10 },
  { key: 'initMod', label: 'Initiative modifier', type: 'number', value: 0 },
  { key: 'pp', label: 'Passive Perception', type: 'number', value: 10 },
  { key: 'pinv', label: 'Passive Investigation', type: 'number', value: 10 },
  { key: 'pins', label: 'Passive Insight', type: 'number', value: 10 },
  { key: 'notes', label: 'Notes (saves, languages, senses...)', type: 'textarea' },
];

export async function getParty() {
  const pcs = await dbAll('party', activeCampaignId());
  return pcs.sort((a, b) => a.name.localeCompare(b.name));
}

export default {
  id: 'party', title: 'Party Tracker', shortTitle: 'Party', group: 'Combat', icon: 'users',
  subtitle: 'Your PCs: stats the DM actually needs at the table',

  async render(container) {
    const draw = async () => {
      const pcs = await getParty();
      container.innerHTML = '';
      const addBtn = el('<button class="btn primary">+ Add character</button>');
      addBtn.addEventListener('click', () => editPC(null, draw));
      const bar = el('<div class="row mb"></div>');
      bar.append(addBtn);
      if (pcs.length) {
        const groupCheck = el('<button class="btn">Group check</button>');
        groupCheck.addEventListener('click', () => groupCheckDialog(pcs));
        bar.append(groupCheck);
      }
      container.append(bar);

      if (!pcs.length) {
        container.append(el(`<div class="empty-state"><p>No characters yet. Add your party to power the encounter builder and initiative tracker.</p></div>`));
        return;
      }

      const table = el(`<div class="table-scroll"><table class="data">
        <thead><tr><th>Name</th><th>Player</th><th>Lvl</th><th>AC</th><th>HP</th><th>Init</th><th>PP</th><th>PInv</th><th>PIns</th><th></th></tr></thead>
        <tbody></tbody></table></div>`);
      const tbody = table.querySelector('tbody');
      for (const pc of pcs) {
        const tr = el(`<tr>
          <td><b>${esc(pc.name)}</b>${pc.notes ? `<div class="small faint">${esc(pc.notes)}</div>` : ''}</td>
          <td class="muted">${esc(pc.player || '')}</td>
          <td>${pc.level}</td><td>${pc.ac}</td><td>${pc.maxHp}</td>
          <td>${pc.initMod >= 0 ? '+' : ''}${pc.initMod}</td>
          <td>${pc.pp}</td><td>${pc.pinv}</td><td>${pc.pins}</td>
          <td style="white-space:nowrap">
            <button class="btn small" data-edit>Edit</button>
            <button class="btn small danger" data-del>Del</button>
          </td></tr>`);
        tr.querySelector('[data-edit]').addEventListener('click', () => editPC(pc, draw));
        tr.querySelector('[data-del]').addEventListener('click', () =>
          confirmDialog(`Remove ${pc.name} from the party?`, async () => { await dbDelete('party', pc.id); draw(); }));
        tbody.append(tr);
      }
      container.append(table);
    };
    await draw();
  },
};

function editPC(pc, done) {
  const fields = FIELDS.map(f => ({ ...f, value: pc ? pc[f.key] : f.value }));
  promptDialog(pc ? `Edit ${pc.name}` : 'Add character', fields, async (out) => {
    if (!out.name.trim()) { toast('Name is required', 'danger'); return false; }
    await dbPut('party', { ...(pc || {}), ...out, campaignId: activeCampaignId() });
    done();
  });
}

function groupCheckDialog(pcs) {
  const body = el(`<div>
    <div class="row">
      <label class="field grow"><span>Check DC</span><input type="number" id="gc-dc" value="15"></label>
      <label class="field grow"><span>Modifier applies?</span><input type="number" id="gc-mod" value="0" title="Flat modifier for the whole party"></label>
      <button class="btn primary" id="gc-roll">Roll d20 for all</button>
    </div>
    <div id="gc-out" class="mt"></div>
  </div>`);
  body.querySelector('#gc-roll').addEventListener('click', () => {
    const dc = Number(body.querySelector('#gc-dc').value) || 10;
    const mod = Number(body.querySelector('#gc-mod').value) || 0;
    const rows = pcs.map(pc => {
      const r = roll(`1d20${mod >= 0 ? '+' : ''}${mod}`);
      return `<tr><td>${esc(pc.name)}</td><td style="font-family:var(--font-mono)">${r.total}</td><td>${r.total >= dc ? '<span class="pill success">pass</span>' : '<span class="pill danger">fail</span>'}</td></tr>`;
    }).join('');
    body.querySelector('#gc-out').innerHTML = `<table class="data"><thead><tr><th>PC</th><th>Roll</th><th>vs DC</th></tr></thead><tbody>${rows}</tbody></table>`;
  });
  modal('Group check', body);
}
