// Name Generator: people, taverns, shops, ships, settlements.
import { loadTables } from '../srd.js';
import { el, esc } from '../components/ui.js';
import { pick } from '../dice.js';

export function personName(data, ancestry) {
  const a = data.people[ancestry] || data.people[pick(Object.keys(data.people))];
  return `${pick(a.first)} ${pick(a.last)}`;
}

export function tavernName(data) {
  return `The ${pick(data.tavern.adjectives)} ${pick(data.tavern.nouns)}`;
}

export function settlementName(data) {
  return pick(data.settlement.prefixes) + pick(data.settlement.suffixes);
}

export function shopName(data, ancestry = 'Human') {
  const p = pick(data.shop.patterns);
  const people = data.people[ancestry] || data.people.Human;
  return p
    .replace('{last2}', pick(people.last))
    .replace('{last}', pick(people.last))
    .replace('{first}', pick(people.first))
    .replace('{adj}', pick(data.shop.adjectives))
    .replace('{goods}', pick(data.shop.goods));
}

export default {
  id: 'names', title: 'Name Generator', shortTitle: 'Names', group: 'Generators', icon: 'tag',
  subtitle: 'People, taverns, shops, ships, and settlements',

  async render(container) {
    const data = await loadTables('names');
    const ancestries = Object.keys(data.people);

    container.innerHTML = `
      <div class="card">
        <div class="row">
          <label class="field"><span>Kind</span><select id="n-kind">
            <option value="person">Person</option><option value="tavern">Tavern</option>
            <option value="shop">Shop</option><option value="ship">Ship</option>
            <option value="settlement">Settlement</option>
          </select></label>
          <label class="field" id="n-anc-wrap"><span>Ancestry</span><select id="n-ancestry">
            <option value="">Any</option>${ancestries.map(a => `<option>${a}</option>`).join('')}
          </select></label>
          <button class="btn primary" id="n-gen">Generate 10</button>
        </div>
        <div id="n-out" class="mt"></div>
      </div>`;

    const out = container.querySelector('#n-out');
    const gen = () => {
      const kind = container.querySelector('#n-kind').value;
      const anc = container.querySelector('#n-ancestry').value;
      container.querySelector('#n-anc-wrap').style.display = kind === 'person' || kind === 'shop' ? '' : 'none';
      const names = Array.from({ length: 10 }, () => {
        switch (kind) {
          case 'person': return personName(data, anc || pick(ancestries));
          case 'tavern': return tavernName(data);
          case 'shop': return shopName(data, anc || 'Human');
          case 'ship': return `The ${pick(data.ship.adjectives)} ${pick(data.ship.nouns)}`;
          case 'settlement': return settlementName(data);
        }
      });
      out.innerHTML = names.map(n => `<p style="font-size:1.1rem">${esc(n)}</p>`).join('');
    };

    container.querySelector('#n-gen').addEventListener('click', gen);
    container.querySelector('#n-kind').addEventListener('change', gen);
    gen();
  },
};
