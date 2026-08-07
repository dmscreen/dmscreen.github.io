// Unified Reference: one browser with a Type selector.
import { getPrefs, setPref } from '../store.js';
import { esc } from '../components/ui.js';
import monsters from './monsters.js';
import spells from './spells.js';
import items from './items.js';
import rules from './rules.js';
import conditions from './conditions.js';
import characterOptions from './character-options.js';

export const REF_TYPES = [
  { id: 'monsters', label: 'Bestiary', tool: monsters },
  { id: 'spells', label: 'Spells', tool: spells },
  { id: 'items', label: 'Items', tool: items },
  { id: 'rules', label: 'Rules', tool: rules },
  { id: 'conditions', label: 'Conditions', tool: conditions },
  { id: 'character-options', label: 'Character Options', tool: characterOptions },
];

export default {
  id: 'reference', title: 'Reference', shortTitle: 'Reference', group: 'Reference', icon: 'book',
  subtitle: 'Bestiary, spells, items, rules, conditions, and character options',

  async render(container) {
    let typeId = getPrefs().refType;
    if (!REF_TYPES.some(t => t.id === typeId)) typeId = 'monsters';

    container.innerHTML = `
      <div class="row mb">
        <label class="field"><span>Type</span>
          <select id="ref-type">${REF_TYPES.map(t => `<option value="${t.id}" ${t.id === typeId ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
        </label>
        <span class="muted small" id="ref-sub" style="align-self:end;padding-bottom:8px"></span>
      </div>
      <div id="ref-body"></div>`;

    const body = container.querySelector('#ref-body');
    const subEl = container.querySelector('#ref-sub');

    const draw = async () => {
      const type = REF_TYPES.find(t => t.id === typeId);
      subEl.textContent = type.tool.subtitle || '';
      body.innerHTML = '';
      try {
        await type.tool.render(body);
      } catch (err) {
        console.error(err);
        body.innerHTML = `<div class="card"><p class="muted">Failed to load: ${esc(err.message)}</p></div>`;
      }
    };

    container.querySelector('#ref-type').addEventListener('change', (e) => {
      typeId = e.target.value;
      setPref('refType', typeId);
      draw();
    });

    await draw();
  },
};
