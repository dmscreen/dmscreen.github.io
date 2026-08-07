// Rules Quick Reference: searchable SRD rule cards.
import { loadRules } from '../srd.js';
import { esc, searchInput } from '../components/ui.js';

export default {
  id: 'rules', title: 'Rules Quick Reference', shortTitle: 'Rules', group: 'Reference', icon: 'book',
  subtitle: 'The rulings you need mid-session, without page flipping',

  async render(container) {
    const rules = await loadRules();

    const searchBox = document.createElement('div');
    searchBox.className = 'mb';
    const listEl = document.createElement('div');
    container.append(searchBox, listEl);

    const draw = (q = '') => {
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

    searchBox.append(searchInput('Search rules (e.g. grapple, falling, cover)...', draw));
    draw();
  },
};
