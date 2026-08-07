// Monster Reference: SRD bestiary browser.
import { loadMonsters, fmtCR, CR_LIST, CR_XP } from '../srd.js';
import { el, esc, showStatBlock, searchInput, cap } from '../components/ui.js';

const TYPES = ['aberration', 'beast', 'celestial', 'construct', 'dragon', 'elemental', 'fey', 'fiend', 'giant', 'humanoid', 'monstrosity', 'ooze', 'plant', 'undead'];
const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];

export default {
  id: 'monsters', title: 'Monster Reference', shortTitle: 'Monsters', group: 'Reference', icon: 'eye',
  subtitle: 'The full SRD bestiary; click any monster for its stat block',

  async render(container) {
    const monsters = await loadMonsters();
    const envs = [...new Set(monsters.flatMap(m => m.environments))].sort();

    container.innerHTML = `
      <div class="card">
        <div class="row">
          <div class="grow" id="m-search"></div>
          <label class="field"><span>Type</span><select id="f-type"><option value="">Any</option>${TYPES.map(t => `<option>${t}</option>`).join('')}</select></label>
          <label class="field"><span>Size</span><select id="f-size"><option value="">Any</option>${SIZES.map(t => `<option>${t}</option>`).join('')}</select></label>
          <label class="field"><span>Min CR</span><select id="f-crmin"><option value="">-</option>${CR_LIST.map(c => `<option value="${c}">${fmtCR(c)}</option>`).join('')}</select></label>
          <label class="field"><span>Max CR</span><select id="f-crmax"><option value="">-</option>${CR_LIST.map(c => `<option value="${c}">${fmtCR(c)}</option>`).join('')}</select></label>
          <label class="field"><span>Environment</span><select id="f-env"><option value="">Any</option>${envs.map(e => `<option>${esc(e)}</option>`).join('')}</select></label>
        </div>
      </div>
      <p class="muted small" id="m-count"></p>
      <div class="table-scroll"><table class="data">
        <thead><tr><th>Name</th><th>CR</th><th>XP</th><th>Type</th><th>Size</th><th>AC</th><th>HP</th></tr></thead>
        <tbody id="m-rows"></tbody>
      </table></div>`;

    let query = '';
    const draw = () => {
      const type = container.querySelector('#f-type').value;
      const size = container.querySelector('#f-size').value;
      const crMin = container.querySelector('#f-crmin').value;
      const crMax = container.querySelector('#f-crmax').value;
      const env = container.querySelector('#f-env').value;
      const filtered = monsters.filter(m =>
        (!query || m.name.toLowerCase().includes(query)) &&
        (!type || m.type === type) &&
        (!size || m.size === size) &&
        (crMin === '' || m.cr >= Number(crMin)) &&
        (crMax === '' || m.cr <= Number(crMax)) &&
        (!env || m.environments.includes(env))
      ).sort((a, b) => a.cr - b.cr || a.name.localeCompare(b.name));

      container.querySelector('#m-count').textContent = `${filtered.length} monsters`;
      const tbody = container.querySelector('#m-rows');
      tbody.innerHTML = filtered.slice(0, 400).map((m, i) =>
        `<tr class="clickable" data-i="${i}">
          <td><b>${esc(m.name)}</b></td><td>${fmtCR(m.cr)}</td><td class="muted">${(CR_XP[m.cr] ?? 0).toLocaleString()}</td>
          <td class="muted">${esc(m.type)}</td><td class="muted">${esc(m.size)}</td><td>${m.ac}</td><td>${m.hp}</td>
        </tr>`).join('');
      tbody.querySelectorAll('tr').forEach(tr =>
        tr.addEventListener('click', () => showStatBlock(filtered[Number(tr.dataset.i)])));
    };

    container.querySelector('#m-search').append(searchInput('Search monsters...', q => { query = q; draw(); }));
    container.querySelectorAll('select').forEach(s => s.addEventListener('change', draw));
    draw();
  },
};
