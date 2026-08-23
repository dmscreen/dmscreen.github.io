// Spell Reference: SRD spell browser.
import { loadSpells } from '../srd.js';
import { el, esc, md, modal, searchInput } from '../components/ui.js';

const SCHOOLS = ['Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation', 'Illusion', 'Necromancy', 'Transmutation'];
const CLASSES = ['Bard', 'Cleric', 'Druid', 'Paladin', 'Ranger', 'Sorcerer', 'Warlock', 'Wizard'];

export function spellDetail(s) {
  const lvl = s.level === 0 ? 'Cantrip' : `Level ${s.level}`;
  const body = el(`<div>
    <p class="muted"><i>${lvl} ${esc(s.school)}${s.ritual ? ' (ritual)' : ''}</i>${s.source ? ` <span class="pill">${esc(s.source)}</span>` : ''}</p>
    <p><b>Casting time:</b> ${esc(s.castingTime)}<br>
    <b>Range:</b> ${esc(s.range)}<br>
    <b>Components:</b> ${esc(s.components)}${s.material ? ` (${esc(s.material)})` : ''}<br>
    <b>Duration:</b> ${s.concentration ? 'Concentration, ' : ''}${esc(s.duration)}</p>
    <div>${md(s.desc)}</div>
    ${s.higherLevel ? `<p><b>At higher levels.</b> ${esc(s.higherLevel)}</p>` : ''}
    <p class="small faint">${s.classes.length ? s.classes.map(esc).join(', ') : 'No class list published for this spell in its source.'}</p>
  </div>`);
  modal(s.name, body, { wide: true });
}

export default {
  id: 'spells', title: 'Spell Reference', shortTitle: 'Spells', group: 'Reference', icon: 'sparkle',
  subtitle: "SRD 5.1, the Adventurer's Guide, Deep Magic and more, filterable and searchable",

  async render(container) {
    const spells = await loadSpells();
    const sources = [...new Set(spells.map(s => s.source).filter(Boolean))].sort();

    container.innerHTML = `
      <div class="card">
        <div class="row">
          <div class="grow" id="s-search"></div>
          <label class="field"><span>Level</span><select id="f-level"><option value="">Any</option><option value="0">Cantrip</option>${Array.from({ length: 9 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}</select></label>
          <label class="field"><span>School</span><select id="f-school"><option value="">Any</option>${SCHOOLS.map(s => `<option>${s}</option>`).join('')}</select></label>
          <label class="field"><span>Class</span><select id="f-class"><option value="">Any</option>${CLASSES.map(c => `<option>${c}</option>`).join('')}</select></label>
          <label class="field"><span>Source</span><select id="f-source"><option value="">All</option>${sources.map(s => `<option>${esc(s)}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" id="f-conc"> Conc.</label>
          <label class="check"><input type="checkbox" id="f-ritual"> Ritual</label>
        </div>
      </div>
      <p class="muted small" id="s-count"></p>
      <div class="table-scroll"><table class="data">
        <thead><tr><th>Name</th><th>Lvl</th><th>School</th><th>Time</th><th>Range</th><th>Duration</th></tr></thead>
        <tbody id="s-rows"></tbody>
      </table></div>`;

    let query = '';
    const draw = () => {
      const level = container.querySelector('#f-level').value;
      const school = container.querySelector('#f-school').value;
      const cls = container.querySelector('#f-class').value;
      const conc = container.querySelector('#f-conc').checked;
      const ritual = container.querySelector('#f-ritual').checked;
      const source = container.querySelector('#f-source').value;
      const filtered = spells.filter(s =>
        (!query || s.name.toLowerCase().includes(query)) &&
        (level === '' || s.level === Number(level)) &&
        (!school || s.school === school) &&
        (!cls || s.classes.includes(cls)) &&
        (!conc || s.concentration) &&
        (!ritual || s.ritual) &&
        (!source || s.source === source)
      ).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

      // Several third-party books publish no class list at all, so a class
      // filter necessarily hides them. Say so rather than losing them quietly.
      const unlisted = cls ? spells.filter(s => !s.classes.length).length : 0;
      container.querySelector('#s-count').textContent =
        `${filtered.length} spells${unlisted ? ` (${unlisted} more have no class list published and cannot be filtered by class)` : ''}`;
      const tbody = container.querySelector('#s-rows');
      tbody.innerHTML = filtered.map((s, i) =>
        `<tr class="clickable" data-i="${i}">
          <td><b>${esc(s.name)}</b>${s.concentration ? ' <span class="pill">C</span>' : ''}${s.ritual ? ' <span class="pill">R</span>' : ''}</td>
          <td>${s.level === 0 ? 'C' : s.level}</td><td class="muted">${esc(s.school)}</td>
          <td class="muted">${esc(s.castingTime)}</td><td class="muted">${esc(s.range)}</td><td class="muted">${esc(s.duration)}</td>
        </tr>`).join('');
      tbody.querySelectorAll('tr').forEach(tr =>
        tr.addEventListener('click', () => spellDetail(filtered[Number(tr.dataset.i)])));
    };

    container.querySelector('#s-search').append(searchInput('Search spells...', q => { query = q; draw(); }));
    container.querySelectorAll('select,input[type=checkbox]').forEach(x => x.addEventListener('change', draw));
    draw();
  },
};
