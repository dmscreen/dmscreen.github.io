// Category page factory: one nav entry per major category, with a chip row
// switching between the sub-tools (same pattern as the Reference page).
import { getPrefs, setPref } from '../store.js';
import { el, esc, attachHoverSwitch } from './ui.js';

export function categoryTool({ id, title, shortTitle, icon, subtitle, tabs, header }) {
  let active = null;
  return {
    id, title, shortTitle: shortTitle || title, icon, subtitle, group: title,
    onExit() { active?.onExit?.(); active = null; },

    async render(container) {
      let tabId = getPrefs()[`cat:${id}`];
      const usable = (t) => t && !(t.mobileOnly && window.matchMedia('(min-width: 900px)').matches);
      if (!usable(tabs.find(t => t.id === tabId))) tabId = tabs.find(usable)?.id || tabs[0].id;

      container.innerHTML = `
        <div data-header></div>
        <div class="row mb" data-chips style="gap:6px"></div>
        <div class="sub muted small mb" data-sub></div>
        <div data-body></div>`;
      // optional content above the chips (used for the mobile campaign switcher)
      if (header) {
        try {
          const node = await header();
          if (node) container.querySelector('[data-header]').append(node);
        } catch (err) {
          console.error(err);
        }
      }
      const chipsEl = container.querySelector('[data-chips]');
      const subEl = container.querySelector('[data-sub]');
      const body = container.querySelector('[data-body]');

      const select = (chipTabId) => {
        if (!chipTabId || tabId === chipTabId) return;
        tabId = chipTabId;
        setPref(`cat:${id}`, tabId);
        draw();
      };
      attachHoverSwitch(chipsEl, '.btn', (chip) => select(chip.dataset.tab));

      const draw = async () => {
        active?.onExit?.();
        chipsEl.innerHTML = '';
        for (const t of tabs) {
          const chip = el(`<button class="btn small ${t.id === tabId ? 'primary' : ''} ${t.mobileOnly ? 'mobile-only' : ''}" data-tab="${esc(t.id)}">${esc(t.chipLabel || t.shortTitle || t.title)}</button>`);
          chip.addEventListener('click', () => select(t.id));
          chipsEl.append(chip);
        }
        const tool = tabs.find(t => t.id === tabId);
        active = tool;
        subEl.textContent = tool.subtitle || '';
        body.innerHTML = '';
        try {
          await tool.render(body);
        } catch (err) {
          console.error(err);
          body.innerHTML = `<div class="card"><p class="muted">Failed to load: ${esc(err.message)}</p></div>`;
        }
      };

      await draw();
    },
  };
}
