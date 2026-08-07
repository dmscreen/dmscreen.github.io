// Name Generator: people, taverns, shops, ships, settlements.
import { loadTables } from '../srd.js';
import { el, esc } from '../components/ui.js';
import { historyList, timeStamp } from '../components/history.js';
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
      </div>
      <div id="n-history"></div>`;

    const history = await historyList({
      container: container.querySelector('#n-history'),
      key: 'history:names',
      title: 'Generated names',
      renderEntry: (e, body) => {
        body.innerHTML = `
          <div><span class="pill accent">${esc(e.kind)}</span>${e.ancestry ? ` <span class="pill">${esc(e.ancestry)}</span>` : ''} <span class="small faint">${timeStamp(e.ts)}</span></div>
          <div class="mt" style="margin-top:6px">${e.names.map(n => `<span style="display:inline-block;margin:2px 10px 2px 0">${esc(n)}</span>`).join('')}</div>`;
      },
    });

    const kindSel = container.querySelector('#n-kind');
    const ancWrap = container.querySelector('#n-anc-wrap');
    const syncAncestry = () => {
      const kind = kindSel.value;
      ancWrap.style.display = kind === 'person' || kind === 'shop' ? '' : 'none';
    };

    container.querySelector('#n-gen').addEventListener('click', () => {
      const kind = kindSel.value;
      const anc = container.querySelector('#n-ancestry').value;
      const names = Array.from({ length: 10 }, () => {
        switch (kind) {
          case 'person': return personName(data, anc || pick(ancestries));
          case 'tavern': return tavernName(data);
          case 'shop': return shopName(data, anc || 'Human');
          case 'ship': return `The ${pick(data.ship.adjectives)} ${pick(data.ship.nouns)}`;
          case 'settlement': return settlementName(data);
        }
      });
      history.add({ kind, ancestry: kind === 'person' || kind === 'shop' ? anc : '', names });
    });
    kindSel.addEventListener('change', syncAncestry);
    syncAncestry();
  },
};
