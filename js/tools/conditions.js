// Conditions cheatsheet: every condition on one screen.
import { loadConditions } from '../srd.js';
import { esc, md } from '../components/ui.js';

export default {
  id: 'conditions', title: 'Conditions', shortTitle: 'Conditions', group: 'Reference', icon: 'tag',
  subtitle: 'All conditions on one screen for fast rulings',

  async render(container) {
    const conditions = await loadConditions();
    container.innerHTML = `<div class="grid-2">${conditions.map(c => `
      <div class="card" style="margin-bottom:0">
        <h2>${esc(c.name)}</h2>
        <div class="muted small">${md(c.desc)}</div>
      </div>`).join('')}</div>`;
  },
};
