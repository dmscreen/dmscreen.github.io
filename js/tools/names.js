// Name Generator: people, taverns, shops, ships, settlements.
import { loadTables } from '../srd.js';
import { el, esc, toggleRow } from '../components/ui.js';
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
        <div id="n-kind-row"></div>
        <div id="n-anc-row"></div>
        <button class="btn primary" id="n-gen">Generate 10</button>
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

    const ancRow = container.querySelector('#n-anc-row');
    const syncAncestry = () => {
      const k = kind.get();
      ancRow.style.display = k === 'person' || k === 'shop' ? '' : 'none';
    };

    const kind = toggleRow('Kind', [
      { value: 'person', label: 'Person' }, { value: 'tavern', label: 'Tavern' },
      { value: 'shop', label: 'Shop' }, { value: 'ship', label: 'Ship' },
      { value: 'settlement', label: 'Settlement' },
    ], 'person', () => syncAncestry());
    container.querySelector('#n-kind-row').append(kind.el);

    const ancestry = toggleRow('Ancestry', [{ value: '', label: 'Any' }, ...ancestries], '', null);
    ancRow.append(ancestry.el);

    container.querySelector('#n-gen').addEventListener('click', () => {
      const k = kind.get();
      const anc = ancestry.get();
      const names = Array.from({ length: 10 }, () => {
        switch (k) {
          case 'person': return personName(data, anc || pick(ancestries));
          case 'tavern': return tavernName(data);
          case 'shop': return shopName(data, anc || 'Human');
          case 'ship': return `The ${pick(data.ship.adjectives)} ${pick(data.ship.nouns)}`;
          case 'settlement': return settlementName(data);
        }
      });
      history.add({ kind: k, ancestry: k === 'person' || k === 'shop' ? anc : '', names });
    });
    syncAncestry();
  },
};
