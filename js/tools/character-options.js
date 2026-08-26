// Character Options: feats and backgrounds from the Level Up A5E books.
import { loadFeats, loadBackgrounds } from '../srd.js';
import { el, esc, md, modal, searchInput, randomButton } from '../components/ui.js';

export function featDetail(f) {
  const body = el(`<div>
    <p class="muted"><span class="pill">${esc(f.source)}</span>${f.prerequisite ? ` <i>Prerequisite: ${esc(f.prerequisite)}</i>` : ''}</p>
    ${f.desc ? md(f.desc) : ''}
    ${f.benefits.length ? `<ul style="padding-left:20px">${f.benefits.map(b => `<li class="muted">${md(b)}</li>`).join('')}</ul>` : ''}
  </div>`);
  modal(f.name, body, { wide: true });
}

export function backgroundDetail(b) {
  const body = el(`<div>
    <p class="muted"><span class="pill">${esc(b.source)}</span></p>
    ${b.desc ? md(b.desc) : ''}
    ${b.benefits.map(x => `<h3 style="margin:10px 0 4px">${esc(x.name)}</h3><div class="muted small">${md(x.desc)}</div>`).join('')}
  </div>`);
  modal(b.name, body, { wide: true });
}

export default {
  id: 'character-options', title: 'Character Options', shortTitle: 'Char. Opts', group: 'Reference', icon: 'scroll',
  subtitle: "Feats and backgrounds from Level Up: Advanced 5th Edition",

  async render(container) {
    const [feats, backgrounds] = await Promise.all([loadFeats(), loadBackgrounds()]);

    container.innerHTML = `
      <div class="card">
        <div class="row">
          <label class="field"><span>Show</span><select id="co-kind">
            <option value="feats">Feats (${feats.length})</option>
            <option value="backgrounds">Backgrounds (${backgrounds.length})</option>
          </select></label>
          <div class="grow" id="co-search"></div>
          <span id="co-random"></span>
        </div>
      </div>
      <div id="co-list"></div>
      <p class="small faint">A5E content is designed for Level Up: Advanced 5th Edition but most of it drops into a standard 5e game with little adjustment. "Expertise die" means an extra d4 added to the roll (d6/d8 as it upgrades).</p>`;

    const listEl = container.querySelector('#co-list');
    let query = '';
    // whichever of the two lists is on show, filtered, and how to open one
    let pickFrom = () => [];
    let openOne = featDetail;

    const draw = () => {
      const kind = container.querySelector('#co-kind').value;
      if (kind === 'feats') {
        const rows = feats.filter(f => !query || f.name.toLowerCase().includes(query))
          .sort((a, b) => a.name.localeCompare(b.name));
        listEl.innerHTML = `<div class="table-scroll"><table class="data">
          <thead><tr><th>Feat</th><th>Prerequisite</th><th>Source</th></tr></thead>
          <tbody>${rows.map((f, i) => `<tr class="clickable" data-i="${i}">
            <td><b>${esc(f.name)}</b></td><td class="muted">${esc(f.prerequisite || '-')}</td>
            <td class="muted small">${esc(f.source)}</td></tr>`).join('')}</tbody></table></div>`;
        listEl.querySelectorAll('tr[data-i]').forEach(tr =>
          tr.addEventListener('click', () => featDetail(rows[Number(tr.dataset.i)])));
        pickFrom = () => rows; openOne = featDetail;
      } else {
        const rows = backgrounds.filter(b => !query || b.name.toLowerCase().includes(query))
          .sort((a, b) => a.name.localeCompare(b.name));
        listEl.innerHTML = `<div class="table-scroll"><table class="data">
          <thead><tr><th>Background</th><th>Source</th></tr></thead>
          <tbody>${rows.map((b, i) => `<tr class="clickable" data-i="${i}">
            <td><b>${esc(b.name)}</b></td><td class="muted small">${esc(b.source)}</td></tr>`).join('')}</tbody></table></div>`;
        listEl.querySelectorAll('tr[data-i]').forEach(tr =>
          tr.addEventListener('click', () => backgroundDetail(rows[Number(tr.dataset.i)])));
        pickFrom = () => rows; openOne = backgroundDetail;
      }
    };

    container.querySelector('#co-search').append(searchInput('Search...', q => { query = q; draw(); }));
    container.querySelector('#co-random').append(randomButton(() => pickFrom(), (x) => openOne(x), 'entries'));
    container.querySelector('#co-kind').addEventListener('change', draw);
    draw();
  },
};
