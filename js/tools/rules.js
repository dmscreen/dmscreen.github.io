// Rules Quick Reference: searchable SRD rule cards.
import { loadRules } from '../srd.js';
import { el, esc, modal, searchInput, randomButton } from '../components/ui.js';

// One rule on its own, for the Random button and for the All tab's results.
export function ruleDetail(entry) {
  modal(entry.name, el(`<div><p class="muted"><i>${esc(entry.section)}</i></p><p>${esc(entry.text)}</p></div>`));
}

export default {
  id: 'rules', title: 'Rules Quick Reference', shortTitle: 'Rules', group: 'Reference', icon: 'book',
  subtitle: 'The rulings you need mid-session, without page flipping',

  async render(container) {
    const rules = await loadRules();

    const searchBox = el('<div class="row mb"><div class="grow" data-search></div></div>');
    const listEl = document.createElement('div');
    container.append(searchBox, listEl);

    // what the search has left, flattened, so Random can draw from it
    let query = '';
    const matching = () => rules.flatMap(section => (query
      ? section.entries.filter(e => (e.name + ' ' + e.text + ' ' + section.title).toLowerCase().includes(query))
      : section.entries).map(e => ({ section: section.title, ...e })));

    const draw = (q = '') => {
      query = q;
      const cards = rules.map(section => {
        const entries = q
          ? section.entries.filter(e => (e.name + ' ' + e.text + ' ' + section.title).toLowerCase().includes(q))
          : section.entries;
        if (!entries.length) return '';
        return `<div class="card">
          <h2>${esc(section.title)} <span class="pill">${esc(section.category)}</span></h2>
          ${entries.map(e => `<p><b>${esc(e.name)}.</b> <span class="muted">${esc(e.text)}</span></p>`).join('')}
        </div>`;
      }).join('');
      listEl.innerHTML = cards || '<p class="faint center">No rules match.</p>';
    };

    searchBox.querySelector('[data-search]').append(searchInput('Search rules (e.g. grapple, falling, cover)...', draw));
    searchBox.append(randomButton(matching, ruleDetail, 'rules'));
    draw();
  },
};
