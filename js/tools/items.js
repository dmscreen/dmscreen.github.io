// Item Reference: everyday gear through legendary magic items, all sources.
import { loadItems } from '../srd.js';
import { el, esc, md, modal, searchInput, randomButton, cap } from '../components/ui.js';

export function itemDetail(i) {
  const meta = [];
  if (i.kind === 'magic') {
    meta.push(`<i>${esc(i.category)}, ${esc(i.rarity || 'unknown rarity')}${i.attunement ? ` (${esc(i.attunement)})` : ''}</i>`);
  } else {
    meta.push(`<i>${esc(i.category)}</i>`);
    const bits = [i.cost && `Cost: ${esc(i.cost)}`, i.weight && `Weight: ${esc(i.weight)}`].filter(Boolean);
    if (bits.length) meta.push(bits.join(' &middot; '));
    if (i.details) meta.push(esc(i.details));
  }
  const body = el(`<div>
    <p class="muted">${meta.join('<br>')} <span class="pill">${esc(i.source)}</span></p>
    ${i.desc ? md(i.desc) : '<p class="faint small">No description beyond the summary above.</p>'}
  </div>`);
  modal(i.name, body, { wide: true });
}

export default {
  id: 'items', title: 'Item Reference', shortTitle: 'Items', group: 'Reference', icon: 'coins',
  subtitle: 'Everyday gear through legendary magic, all sources',

  async render(container) {
    const items = await loadItems();
    const categories = [...new Set(items.map(i => i.category))].sort();
    const rarities = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact'];
    const raritySet = new Set(items.map(i => i.rarity));
    const sources = [...new Set(items.map(i => i.source))].sort();

    container.innerHTML = `
      <div class="card">
        <div class="row">
          <div class="grow" id="it-search"></div>
          <span id="it-random"></span>
          <label class="field"><span>Kind</span><select id="f-kind">
            <option value="">All</option><option value="gear">Mundane gear</option><option value="magic">Magic items</option>
          </select></label>
          <label class="field"><span>Category</span><select id="f-cat"><option value="">Any</option>${categories.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
          <label class="field"><span>Rarity</span><select id="f-rarity"><option value="">Any</option>${rarities.filter(r => raritySet.has(r)).map(r => `<option value="${r}">${cap(r)}</option>`).join('')}</select></label>
          <label class="field"><span>Source</span><select id="f-source"><option value="">All</option>${sources.map(s => `<option>${esc(s)}</option>`).join('')}</select></label>
        </div>
      </div>
      <p class="muted small" id="it-count"></p>
      <div class="table-scroll"><table class="data">
        <thead><tr><th>Name</th><th>Category</th><th>Rarity / Cost</th><th>Source</th></tr></thead>
        <tbody id="it-rows"></tbody>
      </table></div>`;

    let query = '';
    let filteredNow = [];      // what is on screen, for the Random button
    const draw = () => {
      const kind = container.querySelector('#f-kind').value;
      const cat = container.querySelector('#f-cat').value;
      const rarity = container.querySelector('#f-rarity').value;
      const source = container.querySelector('#f-source').value;
      const filtered = items.filter(i =>
        (!query || i.name.toLowerCase().includes(query)) &&
        (!kind || i.kind === kind) &&
        (!cat || i.category === cat) &&
        (!rarity || i.rarity === rarity) &&
        (!source || i.source === source)
      );
      filteredNow = filtered;

      const shown = filtered.slice(0, 500);
      container.querySelector('#it-count').textContent =
        `${filtered.length.toLocaleString()} items${filtered.length > shown.length ? ` (showing first ${shown.length}; narrow the filters or search)` : ''}`;
      const tbody = container.querySelector('#it-rows');
      tbody.innerHTML = shown.map((i, idx) =>
        `<tr class="clickable" data-i="${idx}">
          <td><b>${esc(i.name)}</b>${i.attunement ? ' <span class="pill accent" title="Requires attunement">A</span>' : ''}</td>
          <td class="muted">${esc(i.category)}</td>
          <td class="muted">${i.kind === 'magic' ? esc(cap(i.rarity || '')) : esc(i.cost || '')}</td>
          <td class="muted small">${esc(i.source)}</td>
        </tr>`).join('');
      tbody.querySelectorAll('tr').forEach(tr =>
        tr.addEventListener('click', () => itemDetail(shown[Number(tr.dataset.i)])));
    };

    container.querySelector('#it-search').append(searchInput('Search 2,000+ items...', q => { query = q; draw(); }));
    container.querySelector('#it-random').append(randomButton(() => filteredNow, itemDetail, 'items'));
    container.querySelectorAll('select').forEach(s => s.addEventListener('change', draw));
    draw();
  },
};
