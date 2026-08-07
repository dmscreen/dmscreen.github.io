// Session Notes: per-campaign notes with autosave and search.
import { dbAll, dbPut, dbDelete, activeCampaignId } from '../store.js';
import { el, esc, confirmDialog, searchInput } from '../components/ui.js';

export default {
  id: 'notes', title: 'Session Notes', shortTitle: 'Notes', group: 'Session', icon: 'note',
  subtitle: 'Autosaved as you type; pin a recap for next session',

  async render(container) {
    let selected = null;
    let query = '';

    container.innerHTML = `
      <div class="grid-2" style="grid-template-columns:280px 1fr">
        <div>
          <div class="row mb"><button class="btn primary grow" id="nt-new">+ New note</button></div>
          <div class="mb" id="nt-search"></div>
          <div id="nt-list"></div>
        </div>
        <div class="card" id="nt-editor" style="display:none">
          <input type="text" id="nt-title" placeholder="Title" style="width:100%;font-size:1.1rem;font-weight:600">
          <textarea id="nt-body" rows="18" style="width:100%;margin-top:10px;resize:vertical" placeholder="What happened this session..."></textarea>
          <div class="row mt" style="align-items:center">
            <span class="small faint" id="nt-status"></span>
            <span style="margin-left:auto"></span>
            <button class="btn small" id="nt-pin">Pin as recap</button>
            <button class="btn small danger" id="nt-del">Delete</button>
          </div>
        </div>
      </div>`;

    const listEl = container.querySelector('#nt-list');
    const editor = container.querySelector('#nt-editor');
    const titleIn = container.querySelector('#nt-title');
    const bodyIn = container.querySelector('#nt-body');
    const statusEl = container.querySelector('#nt-status');

    let saveTimer = null;
    const scheduleSave = () => {
      if (!selected) return;
      statusEl.textContent = 'typing...';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        selected.title = titleIn.value;
        selected.body = bodyIn.value;
        await dbPut('notes', selected);
        statusEl.textContent = `saved ${new Date().toLocaleTimeString()}`;
        drawList();
      }, 500);
    };

    const openNote = (note) => {
      selected = note;
      editor.style.display = '';
      titleIn.value = note.title || '';
      bodyIn.value = note.body || '';
      statusEl.textContent = '';
      drawList();
    };

    const drawList = async () => {
      const notes = await dbAll('notes', activeCampaignId());
      const filtered = notes.filter(n => !query || (n.title + ' ' + n.body).toLowerCase().includes(query))
        .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updated - a.updated);
      listEl.innerHTML = filtered.length ? '' : '<p class="faint small">No notes yet.</p>';
      for (const n of filtered) {
        const row = el(`<div class="nav-item ${selected?.id === n.id ? 'active' : ''}" style="display:block">
          <div style="display:flex;gap:6px;align-items:center">${n.pinned ? '<span class="pill accent">recap</span>' : ''}<b style="overflow:hidden;text-overflow:ellipsis">${esc(n.title || 'Untitled')}</b></div>
          <div class="small faint">${new Date(n.updated).toLocaleDateString()} - ${esc((n.body || '').slice(0, 60))}</div>
        </div>`);
        row.addEventListener('click', () => openNote(n));
        listEl.append(row);
      }
    };

    container.querySelector('#nt-new').addEventListener('click', async () => {
      const note = await dbPut('notes', {
        campaignId: activeCampaignId(),
        title: `Session ${new Date().toLocaleDateString()}`,
        body: '', pinned: false,
      });
      openNote(note);
      titleIn.focus();
    });
    titleIn.addEventListener('input', scheduleSave);
    bodyIn.addEventListener('input', scheduleSave);
    container.querySelector('#nt-pin').addEventListener('click', async () => {
      if (!selected) return;
      selected.pinned = !selected.pinned;
      await dbPut('notes', selected);
      drawList();
    });
    container.querySelector('#nt-del').addEventListener('click', () => {
      if (!selected) return;
      confirmDialog(`Delete "${selected.title || 'Untitled'}"?`, async () => {
        await dbDelete('notes', selected.id);
        selected = null;
        editor.style.display = 'none';
        drawList();
      });
    });
    container.querySelector('#nt-search').append(searchInput('Search notes...', q => { query = q; drawList(); }));

    await drawList();
  },
};
