// App shell: registry, router, nav, campaign switcher.
import { getPrefs, setPref, onCampaignChange, requestPersistence } from './store.js';
import { autosaveInit } from './autosave.js';
import { preloadAll } from './srd.js';
import { el, esc, enhanceNumberInputs, attachHoverSwitch } from './components/ui.js';
import { icon } from './components/icons.js';
import { categoryTool } from './components/category.js';
import { campaignSelect, campaignCard } from './components/campaign.js';

import initiative from './tools/initiative.js';
import encounters from './tools/encounters.js';
import dice from './tools/dice-roller.js';
import party from './tools/party.js';
import story from './tools/story.js';
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
const storyPage = categoryTool({
  id: 'story', title: 'Story', icon: 'book',
  subtitle: 'The campaign, the travel between its chapters, and the table notes you keep while running it',
  tabs: [story, travelCalc, randomEnc, calendar, notes, timer],
});
const generators = categoryTool({
  id: 'generators', title: 'Generators', icon: 'sparkle',
  subtitle: 'NPCs, names, loot, shops, quests, weather, and custom tables',
  tabs: [npcs, names, loot, shops, quests, weather, customTables],
});
const more = categoryTool({
  id: 'more', title: 'More', icon: 'grid',
  subtitle: 'Tools from around the community',
  // the sidebar switcher is hidden on mobile, so surface it here instead
  header: () => campaignCard(),
  // Every chip here is mobile-only: on desktop the sidebar already reaches
  // Settings and About, and Tools is the only content the page has, so the
  // chip row would be a one-option choice. The page renders Tools directly.
  tabs: [
    { ...linked, chipLabel: 'Tools', mobileOnly: true },
    { ...settings, mobileOnly: true },
    { ...about, mobileOnly: true },
  ],
});

// Settings and About are top-level sidebar entries on desktop/tablet;
// the mobile tab bar reaches them through More instead.
const TOOLS = [storyPage, combat, generators, reference, more, settings, about];
const byId = new Map(TOOLS.map(t => [t.id, t]));
const DEFAULT_TABS = ['story', 'combat', 'generators', 'reference', 'more'];

// old per-tool routes land on their category page with the right chip active
const SUB_REDIRECTS = {
  initiative: ['combat', 'initiative'], encounters: ['combat', 'encounters'],
  dice: ['combat', 'dice'], party: ['combat', 'party'],
  // Travel was its own page before the Story generator moved in above it
  'travel-page': ['story', 'travel'],
  travel: ['story', 'travel'], 'random-encounters': ['story', 'random-encounters'],
  calendar: ['story', 'calendar'], campaign: ['story', 'campaign'],
  npcs: ['generators', 'npcs'], names: ['generators', 'names'], loot: ['generators', 'loot'],
  shops: ['generators', 'shops'], quests: ['generators', 'quests'],
  weather: ['generators', 'weather'], tables: ['generators', 'tables'],
  // Session was folded into Story; its routes still resolve
  session: ['story', 'notes'],
  notes: ['story', 'notes'], timer: ['story', 'timer'],
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
  return byId.has(h) ? h : 'story';
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
    <span class="sep">|</span> report issues at <a href="https://github.com/dmscreen/dmscreen.github.io/issues" target="_blank" rel="noopener">github</a>
    <span class="sep">|</span> <a href="#/about">sources &amp; attribution</a>
  </footer>`));
}

// Settings is pinned to the bottom of the sidebar instead of the main list
const navItemHTML = (t) =>
  `<a class="nav-item" href="#/${t.id}" data-tool="${t.id}" style="margin-top:2px">${icon(t.icon)}<span>${esc(t.title)}</span></a>`;

// Companion sites, linked straight from the sidebar. `logo` is that site's own
// mark copied into assets/; `icon` falls back to our inline icon set.
const EXTERNAL_LINKS = [
  { name: 'Auto Roll Tables', url: 'https://autorolltables.github.io', logo: 'assets/art-logo.png' },
  { name: 'Character Generator', url: 'https://charactergenerator.github.io', icon: 'cghex' },
];

function navHTML() {
  const items = TOOLS.filter(t => t.id !== 'settings').map(navItemHTML).join('');
  const links = EXTERNAL_LINKS.map(l => {
    // the logo is masked rather than drawn, so it takes the nav's own colour
    const mark = l.logo
      ? `<span class="nav-logo" style="-webkit-mask-image:url('${esc(l.logo)}');mask-image:url('${esc(l.logo)}')"></span>`
      : icon(l.icon);
    return `<a class="nav-item" href="${esc(l.url)}" target="_blank" rel="noopener" style="margin-top:2px">${mark}<span>${esc(l.name)}</span>${icon('external', 'ext')}</a>`;
  }).join('');
  return `${items}<div class="nav-group-label">More</div>${links}`;
}

function renderTabbar() {
  const bar = $('#tabbar');
  bar.innerHTML = DEFAULT_TABS.filter(id => byId.has(id)).map(id => {
    const t = byId.get(id);
    return `<a class="tab-item" href="#/${t.id}" data-tool="${t.id}">${icon(t.icon)}<span>${esc(t.shortTitle || t.title)}</span></a>`;
  }).join('');
}

async function renderCampaignBar() {
  const bar = $('#campaign-bar');
  bar.innerHTML = '';
  bar.append(await campaignSelect());
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
  $('#sidebar-foot').innerHTML = navItemHTML(byId.get('settings'));
  renderTabbar();
  await renderCampaignBar();

  // hover navigation for the sidebar (default on; Settings can switch to click)
  for (const region of [$('#nav'), $('#sidebar-foot')]) {
    attachHoverSwitch(region, '.nav-item', (item) => {
      const id = item.dataset.tool;
      if (id && routeId() !== id) location.hash = `#/${id}`;
    });
  }

  // sidebar collapse
  const app = $('#app');
  const collapseBtn = $('#collapse-btn');
  const sayCollapse = (collapsed) => {
    const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    collapseBtn.title = label;
    collapseBtn.setAttribute('aria-label', label);
    collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  };
  if (getPrefs().sidebarCollapsed) app.classList.add('sidebar-collapsed');
  sayCollapse(app.classList.contains('sidebar-collapsed'));
  collapseBtn.addEventListener('click', () => {
    const collapsed = app.classList.toggle('sidebar-collapsed');
    setPref('sidebarCollapsed', collapsed);
    sayCollapse(collapsed);
  });

  onCampaignChange(async () => { await renderCampaignBar(); route(); });
  window.addEventListener('hashchange', route);
  await route();

  // ask the browser not to evict the campaign data under storage pressure
  requestPersistence();

  // reconnect the auto-save file handle, if one was ever picked
  autosaveInit();

  // warm all reference data in the background so later page switches are instant
  setTimeout(preloadAll, 400);

  // stamped at deploy time; Settings compares it against the served build
  window.__build = 'v103';

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // A tablet tab can sit in the background for weeks and never make a
      // navigation, so it keeps running whatever build it loaded last, long
      // after a fix has shipped. Ask for a newer build each time the tab
      // comes back to the front, and when one takes over, step onto it.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
      if (navigator.serviceWorker.controller) {
        let stepped = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (stepped) return;
          stepped = true;
          location.reload();
        });
      }
    }).catch(() => {});
  }
}

boot();
