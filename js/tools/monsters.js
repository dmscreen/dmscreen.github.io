// Monster Reference: SRD bestiary browser.
import { loadMonsters, fmtCR, monsterXP, sourceTag } from '../srd.js';
import { el, esc, showStatBlock, searchInput, randomButton, cap } from '../components/ui.js';

const TYPES = ['aberration', 'beast', 'celestial', 'construct', 'dragon', 'elemental', 'fey', 'fiend', 'giant', 'humanoid', 'monstrosity', 'ooze', 'plant', 'undead'];
const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];

export default {
  id: 'monsters', title: 'Monster Reference', shortTitle: 'Monsters', group: 'Reference', icon: 'eye',
  subtitle: 'SRD 5.1, Monstrous Menagerie, the Tomes of Beasts and Creature Codex; click any monster for its stat block',

  async render(container) {
    const monsters = await loadMonsters();
    const envs = [...new Set(monsters.flatMap(m => m.environments))].sort();
    const sources = [...new Set(monsters.map(m => m.source).filter(Boolean))].sort();

    container.innerHTML = `
      <div class="card">
        <div class="row">
          <div class="grow" id="m-search"></div>
          <span id="m-random"></span>
          <label class="field"><span>Type</span><select id="f-type"><option value="">Any</option>${TYPES.map(t => `<option>${t}</option>`).join('')}</select></label>
          <label class="field"><span>Size</span><select id="f-size"><option value="">Any</option>${SIZES.map(t => `<option>${t}</option>`).join('')}</select></label>
          <label class="field"><span>Environment</span><select id="f-env"><option value="">Any</option>${envs.map(e => `<option>${esc(e)}</option>`).join('')}</select></label>
          <label class="field"><span>Source</span><select id="f-source"><option value="">All</option>${sources.map(s => `<option>${esc(s)}</option>`).join('')}</select></label>
        </div>
      </div>
      <p class="muted small" id="m-count"></p>
      <div class="table-scroll"><table class="data">
        <thead><tr><th>Name</th><th>CR</th><th>XP</th><th>Type</th><th>Size</th><th>AC</th><th>HP</th></tr></thead>
        <tbody id="m-rows"></tbody>
      </table></div>`;

    let query = '';
    // The filtered list as the draw sees it, so Random picks from what is on
    // screen rather than from the whole bestiary.
    let filteredNow = [];
    const draw = () => {
      const type = container.querySelector('#f-type').value;
      const size = container.querySelector('#f-size').value;
      const env = container.querySelector('#f-env').value;
      const source = container.querySelector('#f-source').value;
      const filtered = monsters.filter(m =>
        (!query || m.name.toLowerCase().includes(query)) &&
        // sources disagree on capitalisation ("Beast" vs "beast"), so compare
        // case-insensitively rather than losing most of the bestiary
        (!type || String(m.type).toLowerCase() === type) &&
        (!size || m.size === size) &&
        (!env || m.environments.includes(env)) &&
        (!source || m.source === source)
      ).sort((a, b) => a.name.localeCompare(b.name));
      filteredNow = filtered;

      const CAP = 400;
      container.querySelector('#m-count').textContent = filtered.length > CAP
        ? `Showing the first ${CAP} of ${filtered.length} monsters; narrow the filters or search to see the rest`
        : `${filtered.length} monsters`;
      const tbody = container.querySelector('#m-rows');
      tbody.innerHTML = filtered.slice(0, CAP).map((m, i) => {
        const tag = sourceTag(m.source);
        return `<tr class="clickable" data-i="${i}">
          <td><b>${esc(m.name)}</b>${tag ? ` <span class="pill" title="${esc(m.source)}">${esc(tag)}</span>` : ''}</td>
          <td>${fmtCR(m.cr)}</td><td class="muted">${monsterXP(m).toLocaleString()}</td>
          <td class="muted">${esc(m.type)}</td><td class="muted">${esc(m.size)}</td><td>${m.ac}</td><td>${m.hp}</td>
        </tr>`;
      }).join('');
      tbody.querySelectorAll('tr').forEach(tr =>
        tr.addEventListener('click', () => showStatBlock(filtered[Number(tr.dataset.i)])));
    };

    container.querySelector('#m-search').append(searchInput('Search monsters...', q => { query = q; draw(); }));
    container.querySelector('#m-random').append(randomButton(() => filteredNow, showStatBlock, 'monsters'));
    container.querySelectorAll('select').forEach(s => s.addEventListener('change', draw));
    draw();
  },
};
