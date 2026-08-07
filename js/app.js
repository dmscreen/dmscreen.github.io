// App shell: registry, router, nav, campaign switcher.
import { getPrefs, setPref, ensureCampaign, activeCampaignId, setActiveCampaign, dbPut, onCampaignChange } from './store.js';
import { el, esc, toast, promptDialog } from './components/ui.js';
import { icon } from './components/icons.js';

import initiative from './tools/initiative.js';
import encounters from './tools/encounters.js';
import dice from './tools/dice-roller.js';
import party from './tools/party.js';
import travel from './tools/travel.js';
import randomEnc from './tools/random-encounters.js';
import weather from './tools/weather.js';
import calendar from './tools/calendar.js';
import npcs from './tools/npcs.js';
import names from './tools/names.js';
import loot from './tools/loot.js';
import shops from './tools/shops.js';
import quests from './tools/quests.js';
import customTables from './tools/custom-tables.js';
import monsters from './tools/monsters.js';
import spells from './tools/spells.js';
import rules from './tools/rules.js';
import conditions from './tools/conditions.js';
import notes from './tools/notes.js';
import timer from './tools/timer.js';
import linked from './tools/linked.js';
import settings from './tools/settings.js';
import about from './tools/about.js';

const TOOLS = [
  initiative, encounters, dice, party,
  travel, randomEnc, weather, calendar,
  npcs, names, loot, shops, quests, customTables,
  monsters, spells, rules, conditions,
  notes, timer,
  linked, settings, about,
];
const byId = new Map(TOOLS.map(t => [t.id, t]));
const GROUP_ORDER = ['Combat', 'Travel', 'Generators', 'Reference', 'Session', 'More'];
const DEFAULT_TABS = ['initiative', 'dice', 'notes', 'monsters'];

const $ = (sel) => document.querySelector(sel);
let currentTool = null;

function routeId() {
  const h = location.hash.replace(/^#\/?/, '');
  return byId.has(h) ? h : 'initiative';
}

async function route() {
  const id = routeId();
  const tool = byId.get(id);
  if (currentTool?.onExit) currentTool.onExit();
  currentTool = tool;

  document.title = `${tool.title} - DM Screen Kit`;
  document.querySelectorAll('.nav-item, .tab-item').forEach(n => n.classList.toggle('active', n.dataset.tool === id));
  $('#more-sheet').classList.remove('open');
  const moreTab = document.querySelector('.tab-item[data-more]');
  if (moreTab) moreTab.classList.toggle('active', !DEFAULT_TABS.includes(id));

  const main = $('#main');
  main.innerHTML = '';
  main.scrollTop = 0;
  const header = el(`<div class="tool-header"><h1>${esc(tool.title)}</h1>${tool.subtitle ? `<div class="sub">${esc(tool.subtitle)}</div>` : ''}</div>`);
  if (!tool.noHeader) main.append(header);
  const container = el('<div></div>');
  main.append(container);
  try {
    await tool.render(container);
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="card"><p class="muted">This tool failed to load: ${esc(err.message)}</p></div>`;
  }
}

function navHTML() {
  const groups = new Map();
  for (const t of TOOLS) {
    if (!groups.has(t.group)) groups.set(t.group, []);
    groups.get(t.group).push(t);
  }
  let html = '';
  for (const g of GROUP_ORDER) {
    if (!groups.has(g)) continue;
    html += `<div class="nav-group-label">${g}</div>`;
    for (const t of groups.get(g)) {
      html += `<a class="nav-item" href="#/${t.id}" data-tool="${t.id}">${icon(t.icon)}<span>${esc(t.title)}</span></a>`;
    }
  }
  return html;
}

function renderTabbar() {
  const bar = $('#tabbar');
  const tabs = getPrefs().tabs || DEFAULT_TABS;
  bar.innerHTML = tabs.filter(id => byId.has(id)).map(id => {
    const t = byId.get(id);
    return `<a class="tab-item" href="#/${t.id}" data-tool="${t.id}">${icon(t.icon)}<span>${esc(t.shortTitle || t.title)}</span></a>`;
  }).join('') + `<button class="tab-item" data-more>${icon('grid')}<span>More</span></button>`;
  bar.querySelector('[data-more]').addEventListener('click', () => {
    $('#more-sheet').classList.toggle('open');
  });
}

function renderMoreSheet() {
  const sheet = $('#more-sheet');
  const groups = new Map();
  for (const t of TOOLS) {
    if (!groups.has(t.group)) groups.set(t.group, []);
    groups.get(t.group).push(t);
  }
  let html = '';
  for (const g of GROUP_ORDER) {
    if (!groups.has(g)) continue;
    html += `<div class="nav-group-label">${g}</div><div class="more-grid">`;
    html += groups.get(g).map(t =>
      `<a class="more-tile" href="#/${t.id}" data-tool="${t.id}">${icon(t.icon)}<span>${esc(t.shortTitle || t.title)}</span></a>`
    ).join('');
    html += '</div>';
  }
  sheet.innerHTML = html;
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
  $('#nav').innerHTML = navHTML();
  renderTabbar();
  renderMoreSheet();
  await renderCampaignBar();

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

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
