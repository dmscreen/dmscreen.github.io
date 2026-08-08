// Category page factory: one nav entry per major category, with a chip row
// switching between the sub-tools (same pattern as the Reference page).
import { getPrefs, setPref } from '../store.js';
import { el, esc } from './ui.js';

export function categoryTool({ id, title, shortTitle, icon, subtitle, tabs }) {
  let active = null;
  return {
    id, title, shortTitle: shortTitle || title, icon, subtitle, group: title,
    onExit() { active?.onExit?.(); active = null; },

    async render(container) {
      let tabId = getPrefs()[`cat:${id}`];
      if (!tabs.some(t => t.id === tabId)) tabId = tabs[0].id;

      container.innerHTML = `
        <div class="row mb" data-chips style="gap:6px"></div>
        <div class="sub muted small mb" data-sub></div>
        <div data-body></div>`;
      const chipsEl = container.querySelector('[data-chips]');
      const subEl = container.querySelector('[data-sub]');
      const body = container.querySelector('[data-body]');

      const draw = async () => {
        active?.onExit?.();
        chipsEl.innerHTML = '';
        for (const t of tabs) {
          const chip = el(`<button class="btn small ${t.id === tabId ? 'primary' : ''}">${esc(t.chipLabel || t.shortTitle || t.title)}</button>`);
          chip.addEventListener('click', () => {
            if (tabId === t.id) return;
            tabId = t.id;
            setPref(`cat:${id}`, tabId);
            draw();
          });
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
