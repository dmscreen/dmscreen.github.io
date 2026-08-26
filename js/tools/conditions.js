// Conditions cheatsheet: every condition on one screen.
import { loadConditions } from '../srd.js';
import { el, esc, md, modal, searchInput, randomButton } from '../components/ui.js';

// One condition on its own, for the Random button and for the All tab.
export function conditionDetail(c) {
  modal(c.name, el(`<div class="muted">${md(c.desc)}</div>`), { wide: true });
}

export default {
  id: 'conditions', title: 'Conditions', shortTitle: 'Conditions', group: 'Reference', icon: 'tag',
  subtitle: 'All conditions on one screen for fast rulings',

  async render(container) {
    const conditions = await loadConditions();
    container.innerHTML = `<div class="row mb"><div class="grow" id="cd-search"></div></div><div id="cd-list"></div>`;

    let query = '';
    const matching = () => conditions.filter(c => !query || (c.name + ' ' + c.desc).toLowerCase().includes(query));

    const listEl = container.querySelector('#cd-list');
    const draw = (q = '') => {
      query = q;
      const rows = matching();
      listEl.innerHTML = rows.length
        ? `<div class="grid-2">${rows.map(c => `
            <div class="card" style="margin-bottom:0">
              <h2>${esc(c.name)}</h2>
              <div class="muted small">${md(c.desc)}</div>
            </div>`).join('')}</div>`
        : '<p class="faint center" style="padding:30px 10px">No conditions match.</p>';
    };

    const bar = container.querySelector('.row');
    bar.querySelector('#cd-search').append(searchInput('Search conditions...', draw));
    bar.append(randomButton(matching, conditionDetail, 'conditions'));
    draw();
  },
};
