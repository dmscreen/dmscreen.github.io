// Tools: the DM's own bookmarks first, then curated external resources.
import { dbAll, dbPut, dbDelete } from '../store.js';
import { el, esc, toast, confirmDialog, promptDialog } from '../components/ui.js';
import { icon } from '../components/icons.js';

// Anything that looks like a link in a drag payload. Browsers hand over
// text/uri-list when a tab or link is dragged; plain text covers a pasted URL.
function urlFromDrop(dt) {
  const candidates = [dt.getData('text/uri-list'), dt.getData('text/plain'), dt.getData('URL')];
  for (const raw of candidates) {
    const line = String(raw || '').split(/[\r\n]+/).find(l => l && !l.startsWith('#'));
    if (!line) continue;
    try {
      const u = new URL(line.trim());
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    } catch { /* not a URL, try the next flavour */ }
  }
  return null;
}

const titleFromURL = (href) => {
  try {
    const u = new URL(href);
    const path = u.pathname.replace(/\/+$/, '').split('/').pop() || '';
    const pretty = path.replace(/[-_]+/g, ' ').replace(/\.\w+$/, '').trim();
    return pretty ? `${u.hostname.replace(/^www\./, '')} - ${pretty}` : u.hostname.replace(/^www\./, '');
  } catch { return href; }
};

export default {
  id: 'linked', title: 'Tools', shortTitle: 'Tools', group: 'More', icon: 'link',
  subtitle: 'Excellent free tools from around the community',

  async render(container) {
    const data = await fetch('data/linked-tools.json').then(r => r.json());

    const toolHTML = (t, featured = false) => `
      <a class="card" href="${esc(t.url)}" target="_blank" rel="noopener" style="display:block;text-decoration:none;color:inherit${featured ? ';border-color:var(--accent)' : ''}">
        <h2 style="display:flex;align-items:center;gap:8px">${esc(t.name)} ${icon('external', 'ext')}${featured ? '<span class="pill accent">featured</span>' : ''}</h2>
        <p class="muted small">${esc(t.desc)}</p>
      </a>`;

    container.innerHTML = `
      <div id="lt-mine"></div>
      <div class="nav-group-label" style="font-size:0.85rem;padding-left:0">Featured</div>
      <div class="grid-2">${data.featured.map(t => toolHTML(t, true)).join('')}</div>
      ${data.categories.map(cat => `
        <div class="nav-group-label" style="font-size:0.85rem;padding-left:0">${esc(cat.title)}</div>
        <div class="grid-2">${cat.tools.map(t => toolHTML(t)).join('')}</div>
      `).join('')}
      <p class="small faint mt">These are independent projects with no affiliation to DM Screen; they're linked because DMs on Reddit and elsewhere consistently recommend them.</p>`;

    /* ---------- the DM's own links ---------- */

    const mine = container.querySelector('#lt-mine');

    const editLink = (rec) => {
      promptDialog(rec.id ? 'Edit link' : 'Add a link', [
        { key: 'name', label: 'Title', value: rec.name || '' },
        { key: 'url', label: 'URL', value: rec.url || '' },
        { key: 'desc', label: 'Description', type: 'textarea', value: rec.desc || '' },
      ], async ({ name, url, desc }) => {
        const href = String(url || '').trim();
        if (!href) { toast('A link needs a URL', 'danger'); return false; }
        let normalised;
        try { normalised = new URL(/^https?:\/\//i.test(href) ? href : `https://${href}`).href; }
        catch { toast('That does not look like a URL', 'danger'); return false; }
        await dbPut('links', { ...rec, name: (name || '').trim() || titleFromURL(normalised), url: normalised, desc: (desc || '').trim() });
        drawMine();
        toast('Link saved');
      }, { submitLabel: 'Save link' });
    };

    const drawMine = async () => {
      const links = (await dbAll('links')).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      mine.innerHTML = `
        <div class="nav-group-label" style="font-size:0.85rem;padding-left:0">My links</div>
        <div class="grid-2" id="lt-mine-grid"></div>
        <div class="dropzone" id="lt-drop">
          <b>Drag a link or a browser tab here to add it</b>
          <span class="small faint">Or <button class="btn small" id="lt-add">add one manually</button>. Your links are saved in this browser and travel with a full backup.</span>
        </div>`;
      const grid = mine.querySelector('#lt-mine-grid');
      if (!links.length) {
        grid.innerHTML = '<p class="small faint">No links of your own yet.</p>';
      } else {
        for (const l of links) {
          const card = el(`<div class="card link-tile">
            <h2 style="display:flex;align-items:center;gap:8px">
              <a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)}</a>${icon('external', 'ext')}</h2>
            ${l.desc ? `<p class="muted small">${esc(l.desc)}</p>` : ''}
            <p class="small faint" style="word-break:break-all">${esc(l.url)}</p>
            <div class="row">
              <button class="btn small" data-edit>Edit</button>
              <button class="btn small danger" data-del>Remove</button>
            </div>
          </div>`);
          card.querySelector('[data-edit]').addEventListener('click', () => editLink(l));
          card.querySelector('[data-del]').addEventListener('click', () =>
            confirmDialog(`Remove "${l.name}" from your links?`, async () => { await dbDelete('links', l.id); drawMine(); }, { label: 'Remove' }));
          grid.append(card);
        }
      }

      mine.querySelector('#lt-add').addEventListener('click', () => editLink({}));

      const zone = mine.querySelector('#lt-drop');
      const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
      zone.addEventListener('dragover', (e) => { stop(e); e.dataTransfer.dropEffect = 'copy'; zone.classList.add('over'); });
      zone.addEventListener('dragenter', (e) => { stop(e); zone.classList.add('over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('over'));
      zone.addEventListener('drop', async (e) => {
        stop(e);
        zone.classList.remove('over');
        const url = urlFromDrop(e.dataTransfer);
        if (!url) return toast('That drop had no web link in it', 'danger');
        const existing = (await dbAll('links')).find(l => l.url === url);
        if (existing) return toast(`Already saved as "${existing.name}"`);
        await dbPut('links', { name: titleFromURL(url), url, desc: '' });
        drawMine();
        toast('Link added; use Edit to give it a better title');
      });

      container.querySelectorAll('svg.ext').forEach(x => { x.style.width = '15px'; x.style.height = '15px'; x.style.color = 'var(--text-faint)'; });
    };

    await drawMine();

    container.querySelectorAll('svg.ext').forEach(s => { s.style.width = '15px'; s.style.height = '15px'; s.style.color = 'var(--text-faint)'; });
  },
};
