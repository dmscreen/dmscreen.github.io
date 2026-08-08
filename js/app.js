// App shell: registry, router, nav, campaign switcher.
import { getPrefs, setPref, ensureCampaign, activeCampaignId, setActiveCampaign, dbPut, onCampaignChange } from './store.js';
import { preloadAll } from './srd.js';
import { el, esc, toast, promptDialog, enhanceNumberInputs } from './components/ui.js';
import { icon } from './components/icons.js';
import { categoryTool } from './components/category.js';

import initiative from './tools/initiative.js';
import encounters from './tools/encounters.js';
import dice from './tools/dice-roller.js';
import party from './tools/party.js';
import travelCalc from './tools/travel.js';
import randomEnc from './tools/random-encounters.js';
import weather from './tools/weather.js';
import calendar from './tools/calendar.js';
import npcs from './tools/npcs.js';
import names from './tools/names.js';
import loot from './tools/loot.js';
import shops from './tools/shops.js';
import quests from './tools/quests.js';
import customTables from './tools/custom-tables.js';
import reference from './tools/reference.js';
import notes from './tools/notes.js';
import timer from './tools/timer.js';
import linked from './tools/linked.js';
import settings from './tools/settings.js';
import about from './tools/about.js';

const combat = categoryTool({
  id: 'combat', title: 'Combat', icon: 'swords',
  subtitle: 'Initiative, encounters, dice, and the party',
  tabs: [initiative, encounters, dice, party],
});
const travel = categoryTool({
  id: 'travel-page', title: 'Travel', icon: 'map',
  subtitle: 'Journeys, random encounters, and the in-world calendar',
  tabs: [travelCalc, randomEnc, calendar],
});
const generators = categoryTool({
  id: 'generators', title: 'Generators', icon: 'sparkle',
  subtitle: 'NPCs, names, loot, shops, quests, weather, and custom tables',
  tabs: [npcs, names, loot, shops, quests, weather, customTables],
});
const session = categoryTool({
  id: 'session', title: 'Session', icon: 'note',
  subtitle: 'Notes and the session timer',
  tabs: [notes, timer],
});
const more = categoryTool({
  id: 'more', title: 'More', icon: 'grid',
  subtitle: 'Tools from around the community',
  tabs: [
    { ...linked, chipLabel: 'Tools' },
    // on desktop these live in the sidebar; the chips only show on mobile
    { ...settings, mobileOnly: true },
    { ...about, mobileOnly: true },
  ],
});

// Settings and About are top-level sidebar entries on desktop/tablet;
// the mobile tab bar reaches them through More instead.
const TOOLS = [combat, travel, generators, reference, session, more, settings, about];
const byId = new Map(TOOLS.map(t => [t.id, t]));
const DEFAULT_TABS = ['combat', 'travel-page', 'generators', 'reference', 'session', 'more'];

// old per-tool routes land on their category page with the right chip active
const SUB_REDIRECTS = {
  initiative: ['combat', 'initiative'], encounters: ['combat', 'encounters'],
  dice: ['combat', 'dice'], party: ['combat', 'party'],
  travel: ['travel-page', 'travel'], 'random-encounters': ['travel-page', 'random-encounters'],
  calendar: ['travel-page', 'calendar'],
  npcs: ['generators', 'npcs'], names: ['generators', 'names'], loot: ['generators', 'loot'],
  shops: ['generators', 'shops'], quests: ['generators', 'quests'],
  weather: ['generators', 'weather'], tables: ['generators', 'tables'],
  notes: ['session', 'notes'], timer: ['session', 'timer'],
  linked: ['more', 'linked'],
};
const REF_REDIRECTS = new Set(['monsters', 'spells', 'items', 'rules', 'conditions', 'character-options']);

const $ = (sel) => document.querySelector(sel);
let currentTool = null;

function routeId() {
  const h = location.hash.replace(/^#\/?/, '');
  if (SUB_REDIRECTS[h]) {
    const [page, chip] = SUB_REDIRECTS[h];
    setPref(`cat:${page}`, chip);
    return page;
  }
  if (REF_REDIRECTS.has(h)) {
    setPref('refType', h);
    return 'reference';
  }
  return byId.has(h) ? h : 'combat';
}

async function route() {
  const id = routeId();
  const tool = byId.get(id);
  if (currentTool?.onExit) currentTool.onExit();
  currentTool = tool;

  document.title = 'dmscreen.github.io';
  document.querySelectorAll('.nav-item, .tab-item').forEach(n => n.classList.toggle('active', n.dataset.tool === id));

  const main = $('#main');
  main.innerHTML = '';
  main.scrollTop = 0;
  const header = el(`<div class="tool-header"><h1>${esc(tool.title)}</h1></div>`);
  main.append(header);
  const container = el('<div></div>');
  main.append(container);
  try {
    await tool.render(container);
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="card"><p class="muted">This tool failed to load: ${esc(err.message)}</p></div>`;
  }

  main.append(el(`<footer class="page-foot">
    Created by <a href="https://github.com/dangeratio" target="_blank" rel="noopener">dangeratio</a>
    | <a href="https://github.com/dmscreen/dmscreen.github.io/issues" target="_blank" rel="noopener">report issues at GitHub</a>
    | <a href="#/about">sources &amp; attribution</a>
  </footer>`));
}

function navHTML() {
  return TOOLS.map(t =>
    `<a class="nav-item" href="#/${t.id}" data-tool="${t.id}" style="margin-top:2px">${icon(t.icon)}<span>${esc(t.title)}</span></a>`
  ).join('');
}

function renderTabbar() {
  const bar = $('#tabbar');
  bar.innerHTML = DEFAULT_TABS.filter(id => byId.has(id)).map(id => {
    const t = byId.get(id);
    return `<a class="tab-item" href="#/${t.id}" data-tool="${t.id}">${icon(t.icon)}<span>${esc(t.shortTitle || t.title)}</span></a>`;
  }).join('');
}

async function renderCampaignBar() {
  const all = await ensureCampaign();
  const active = activeCampaignId();
  const bar = $('#campaign-bar');
  bar.innerHTML = '';
  const select = el(`<select aria-label="Campaign">${
    all.map(c => `<option value="${c.id}" ${c.id === active ? 'selected' : ''}>${esc(c.name)}</option>`).join('')
  }<option value="__new">+ New campaign...</option></select>`);
  select.addEventListener('change', async () => {
    if (select.value === '__new') {
      promptDialog('New campaign', [{ key: 'name', label: 'Campaign name', value: '' }], async ({ name }) => {
        if (!name.trim()) return false;
        const c = await dbPut('campaigns', { name: name.trim(), created: Date.now() });
        await setActiveCampaign(c.id);
        toast(`Campaign "${name.trim()}" created`);
      });
      select.value = active;
    } else {
      await setActiveCampaign(select.value);
    }
  });
  bar.append(select);
}

function applyTheme() {
  const theme = getPrefs().theme || 'dark';
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#191512' : '#f3eee5';
}

async function boot() {
  applyTheme();

  // Upgrade every number input (present and future) to a [- value +] stepper.
  new MutationObserver(() => enhanceNumberInputs()).observe(document.body, { childList: true, subtree: true });
  enhanceNumberInputs();

  $('#nav').innerHTML = navHTML();
  renderTabbar();
  await renderCampaignBar();

  // hover navigation for the sidebar (default on; Settings can switch to click)
  const nav = $('#nav');
  let hoverTimer = null;
  nav.addEventListener('mouseover', (e) => {
    if (getPrefs().navHover === false) return;
    const item = e.target.closest('.nav-item');
    if (!item) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      const id = item.dataset.tool;
      if (id && routeId() !== id) location.hash = `#/${id}`;
    }, 60);
  });
  nav.addEventListener('mouseleave', () => clearTimeout(hoverTimer));

  // sidebar collapse
  const app = $('#app');
  if (getPrefs().sidebarCollapsed) app.classList.add('sidebar-collapsed');
  $('#collapse-btn').addEventListener('click', () => {
    const collapsed = app.classList.toggle('sidebar-collapsed');
    setPref('sidebarCollapsed', collapsed);
  });

  onCampaignChange(async () => { await renderCampaignBar(); route(); });
  window.addEventListener('hashchange', route);
  await route();

  // warm all reference data in the background so later page switches are instant
  setTimeout(preloadAll, 400);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
