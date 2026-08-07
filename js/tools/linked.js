// Linked Tools: curated external DM resources.
import { esc } from '../components/ui.js';
import { icon } from '../components/icons.js';

export default {
  id: 'linked', title: 'Linked Tools', shortTitle: 'Links', group: 'More', icon: 'link',
  subtitle: 'Excellent free tools from around the community',

  async render(container) {
    const data = await fetch('data/linked-tools.json').then(r => r.json());

    const toolHTML = (t, featured = false) => `
      <a class="card" href="${esc(t.url)}" target="_blank" rel="noopener" style="display:block;text-decoration:none;color:inherit${featured ? ';border-color:var(--accent)' : ''}">
        <h2 style="display:flex;align-items:center;gap:8px">${esc(t.name)} ${icon('external', 'ext')}${featured ? '<span class="pill accent">featured</span>' : ''}</h2>
        <p class="muted small">${esc(t.desc)}</p>
      </a>`;

    container.innerHTML = `
      ${data.featured.map(t => toolHTML(t, true)).join('')}
      ${data.categories.map(cat => `
        <div class="nav-group-label" style="font-size:0.85rem;padding-left:0">${esc(cat.title)}</div>
        <div class="grid-2">${cat.tools.map(t => toolHTML(t)).join('')}</div>
      `).join('')}
      <p class="small faint mt">These are independent projects with no affiliation to DM Screen; they're linked because DMs on Reddit and elsewhere consistently recommend them.</p>`;

    container.querySelectorAll('svg.ext').forEach(s => { s.style.width = '15px'; s.style.height = '15px'; s.style.color = 'var(--text-faint)'; });
  },
};
