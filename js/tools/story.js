// Story: one-button campaign generator plus a browser for what it produced.
// The left column is the whole campaign at a glance; the right column is
// whatever the DM drilled into.
import { dbAll, dbPut, dbDelete, activeCampaignId, getState, setState, getPrefs, setPref } from '../store.js';
import { loadMonsters, loadItems } from '../srd.js';
import { el, esc, md, toast, confirmDialog, modal, toggleRow, showStatBlock } from '../components/ui.js';
import { renderTownSVG } from '../town-map.js';
import { generateCampaign, campaignMarkdown, playerHandoutMarkdown, rerollChapter, rerollEncounter, rerollCreature,
  rerollNPC, rerollLieutenant, renameVillain, rerollAppendixCreature, endingOutlook } from '../campaign-gen.js';
import { icon } from '../components/icons.js';
import { launchCombat, addToCombat } from './encounters.js';
import { getParty } from './party.js';

const PATTERNS = [
  ['', 'Shape: let the premise decide'],
  ['funnel_to_hub', 'Funnel to hub'],
  ['gated_sandbox', 'Gated sandbox'],
  ['hub_and_spoke', 'Hub and spoke'],
  ['branch_reconverge', 'Branch and reconverge'],
  ['hexcrawl_mega', 'Hexcrawl plus megadungeon'],
  ['act_structure', 'Act structure'],
  ['node_investigation', 'Node investigation'],
  ['linear', 'Linear'],
];

export default {
  id: 'campaign', title: 'Campaign Generator', shortTitle: 'Story', group: 'Story', icon: 'book',
  subtitle: 'Generate a whole campaign: acts, chapters, dungeons, NPCs, and what links them',

  async render(container) {
    const monsters = await loadMonsters();
    const bySlug = new Map(monsters.map(m => [m.slug, m]));
    let items = null; // lazy, only needed when a magic item is clicked

    // Encounters are budgeted for the real table, so read it from the Party
    // Tracker: average level and head count, both overridable.
    const party = await getParty();
    const partyLevel = party.length ? Math.round(party.reduce((a, p) => a + (p.level || 1), 0) / party.length) : 1;
    const partySize = party.length || 4;

    let record = null;   // the saved dbAll('stories') row: { id, data, progress }
    let campaign = null; // record.data
    let selection = { kind: 'overview' };
    const persistRecord = () => record && dbPut('stories', record);
    const isDone = (ch) => !!record?.progress?.[ch.id];

    container.innerHTML = `
      <div class="card">
        <h2>Generate a campaign</h2>
        <p class="small muted">One press builds the whole book: a premise, an antagonist with a schedule, factions, clocks, acts and chapters, keyed dungeons with encounters and treasure, settlements with rosters and rumours, and three separate clues in every chapter pointing at the next one.</p>
        <div class="gen-controls mt">
          <div id="sg-length"></div>
          <label class="field" title="Defaults from your Party Tracker"><span>Starting level</span><input type="number" id="sg-level" min="1" max="20" value="${partyLevel}"></label>
          <label class="field" title="Defaults from your Party Tracker"><span>Party size</span><input type="number" id="sg-size" min="1" max="8" value="${partySize}"></label>
          <label class="field"><span>Shape <button type="button" class="info-btn" id="sg-info-shape" aria-label="What the shapes mean">${icon('info')}</button></span>
            <select id="sg-pattern">${PATTERNS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
          <label class="field"><span>Premise <button type="button" class="info-btn" id="sg-info-premise" aria-label="What the premises are">${icon('info')}</button></span>
            <select id="sg-premise"><option value="">Surprise me</option></select></label>
          <button class="btn primary" id="sg-go">Generate campaign</button>
        </div>
        <p class="small faint" style="margin-top:10px">Level and size default from your Party Tracker; every encounter in the campaign is budgeted against them.</p>
      </div>
      <div class="card" id="sg-saved-card">
        <h2>Saved campaigns</h2>
        <div id="sg-saved"></div>
      </div>
      <div id="sg-out"></div>`;

    const out = container.querySelector('#sg-out');

    const length = toggleRow('Length', [
      { value: 'oneshot', label: 'One shot' },
      { value: 'short', label: 'Short (5 levels)' },
      { value: 'standard', label: 'Standard (10 levels)' },
      { value: 'epic', label: 'Epic (15 levels)' },
    ], (await getState('storyLength')) || 'standard', (v) => setState('storyLength', v), { segmented: true });
    container.querySelector('#sg-length').append(length.el);

    // The premise list and both info popups read the same table the generator
    // does, so the explanations can never drift from what actually generates.
    let lore = null;
    fetch('data/tables/campaign.json').then(r => r.json()).then(t => {
      lore = t;
      const sel = container.querySelector('#sg-premise');
      for (const p of t.premises) sel.insertAdjacentHTML('beforeend', `<option value="${esc(p.id)}">${esc(p.title)}</option>`);
    }).catch(() => {});

    // Template slots read as noise in a reference list; swap them for the
    // generic nouns they stand in for.
    const deslot = (text, objects) => String(text || '')
      .replace(/\{villain\}/g, 'the antagonist')
      .replace(/\{villainTitle\}/g, 'the antagonist')
      .replace(/\{region\}/g, 'the region')
      .replace(/\{hub\}/g, 'the home base')
      .replace(/\{faction\}/g, 'a faction')
      .replace(/\{objects\}/g, objects || 'the objectives')
      .replace(/\{object\}/g, objects || 'the objective')
      .replace(/\{place\}/g, 'the site')
      .replace(/\{next\}/g, 'the next chapter')
      // a slot that opened a sentence leaves a lowercase word behind it
      .replace(/(^|[.!?]\s+)([a-z])/g, (m, lead, ch) => lead + ch.toUpperCase());

    const infoModal = (title, intro, rows) => {
      const body = el(`<div>
        <p class="small muted">${esc(intro)}</p>
        ${rows.map(r => `<div class="info-entry">
          <h3>${esc(r.name)}</h3>
          <p class="small">${esc(r.desc)}</p>
          ${r.meta ? `<p class="small faint">${esc(r.meta)}</p>` : ''}
        </div>`).join('')}
      </div>`);
      modal(title, body, { wide: true });
    };

    container.querySelector('#sg-info-shape').addEventListener('click', () => {
      if (!lore) return toast('Still loading the campaign tables', 'danger');
      const rows = PATTERNS.filter(([v]) => v).map(([key, label]) => {
        const pat = lore.patterns[key] || {};
        const acts = (pat.acts || []).map(a => `${a.title} (${a.chapters.length})`).join(' -> ');
        return { name: pat.label || label, desc: pat.note || '', meta: acts ? `Acts: ${acts}` : '' };
      });
      rows.unshift({
        name: 'Shape: let the premise decide',
        desc: 'The default. Each premise names the shapes that suit it, and one of those is picked at random.',
        meta: '',
      });
      infoModal('Campaign shapes', 'The shape decides the act and chapter skeleton: how many chapters, which are mandatory, and whether the middle is a straight line, a hub with spokes, or an open region.', rows);
    });

    container.querySelector('#sg-info-premise').addEventListener('click', () => {
      if (!lore) return toast('Still loading the campaign tables', 'danger');
      const rows = lore.premises.map(p => ({
        name: p.title,
        desc: deslot(p.logline, p.objective?.plural),
        meta: [
          p.tone?.length ? `Tone: ${p.tone.join(', ')}` : '',
          p.themes?.length ? `Themes: ${p.themes.join('; ')}` : '',
          p.objective ? `Objective: ${p.objective.count} x ${p.objective.plural}` : '',
          p.patterns?.length ? `Usual shapes: ${p.patterns.map(x => (lore.patterns[x] || {}).label || x).join(', ')}` : '',
        ].filter(Boolean).join(' · '),
      }));
      rows.unshift({
        name: 'Surprise me',
        desc: 'The default. One of the premises below is picked at random each time you generate.',
        meta: '',
      });
      infoModal('Campaign premises', 'The premise sets the pitch, the tone, the kind of antagonist, the region, and what the party is ultimately chasing.', rows);
    });

    /* ---------- persistence ---------- */

    const drawSaved = async () => {
      const saved = (await dbAll('stories', activeCampaignId())).sort((a, b) => b.updated - a.updated);
      const box = container.querySelector('#sg-saved');
      if (!saved.length) { box.innerHTML = '<p class="small faint">No campaigns generated yet.</p>'; return; }
      box.innerHTML = '';
      for (const s of saved) {
        const row = el(`<div class="row" style="align-items:center;padding:3px 0">
          <b>${esc(s.data.title)}</b>
          <span class="pill">${esc(s.data.pattern.label)}</span>
          <span class="pill">levels ${s.data.levelRange.start}-${s.data.levelRange.end}</span>
          <span class="small faint">${new Date(s.created).toLocaleDateString()}</span>
          <span style="margin-left:auto;white-space:nowrap">
            <button class="btn small" data-load>Open</button>
            <button class="btn small" data-md>Export .md</button>
            <button class="btn small danger" data-del>Delete</button>
          </span></div>`);
        row.querySelector('[data-load]').addEventListener('click', () => { show(s); });
        row.querySelector('[data-md]').addEventListener('click', () => downloadMarkdown(s.data));
        row.querySelector('[data-del]').addEventListener('click', () => {
          confirmDialog(`Delete "${s.data.title}"?`, async () => {
            await dbDelete('stories', s.id);
            if (campaign?.id === s.data.id) { campaign = null; record = null; out.innerHTML = ''; }
            drawSaved();
          });
        });
        box.append(row);
      }
    };

    const downloadMarkdown = (c) => {
      const blob = new Blob([campaignMarkdown(c)], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${c.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
      a.click();
      URL.revokeObjectURL(a.href);
    };

    container.querySelector('#sg-go').addEventListener('click', async () => {
      const btn = container.querySelector('#sg-go');
      btn.disabled = true;
      btn.textContent = 'Generating...';
      try {
        const c = await generateCampaign({
          length: length.get(),
          startLevel: Number(container.querySelector('#sg-level').value) || 1,
          partySize: Number(container.querySelector('#sg-size').value) || 4,
          pattern: container.querySelector('#sg-pattern').value || undefined,
          premiseId: container.querySelector('#sg-premise').value || undefined,
        });
        const rec = await dbPut('stories', { campaignId: activeCampaignId(), created: Date.now(), data: c, progress: {} });
        show(rec);
        drawSaved();
        toast(`"${c.title}" generated: ${c.stats.chapters} chapters, ${c.stats.encounters} encounters`);
      } catch (err) {
        console.error(err);
        toast(`Generation failed: ${err.message}`, 'danger');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Generate campaign';
      }
    });

    /* ---------- structure tree ---------- */

    const treeRows = () => {
      const rows = [
        { kind: 'overview', label: campaign.title, sub: 'Overview', depth: 0 },
        { kind: 'villain', label: campaign.villain.name, sub: 'Antagonist', depth: 0 },
        ...(campaign.rival ? [{ kind: 'rival', label: campaign.rival.org, sub: 'Rival', depth: 0 }] : []),
        ...(campaign.reversal ? [{ kind: 'reversal', label: campaign.reversal.label, sub: `The turn, ${campaign.reversal.chapterTitle}`, depth: 0 }] : []),
        { kind: 'world', label: 'Factions, clocks & region', depth: 0 },
      ];
      campaign.acts.forEach((act, ai) => {
        rows.push({ kind: 'act', ref: act, label: act.title, sub: `Act ${ai + 1}, level ${act.levelGate}+`, depth: 0 });
        for (const ch of act.chapters) {
          rows.push({ kind: 'chapter', ref: ch, label: `${ch.index}. ${ch.title}`, sub: `${ch.roleLabel}, level ${ch.levelGate}`, depth: 1, done: isDone(ch) });
          for (const elt of ch.elements) {
            rows.push({ kind: 'element', ref: elt, chapter: ch, label: elt.title, sub: elt.subtitle, depth: 2 });
          }
        }
      });
      rows.push({ kind: 'npcs', label: 'NPCs', sub: `${campaign.appendices.npcs.length} in the roster`, depth: 0 });
      rows.push({ kind: 'creatures', label: 'Creatures', sub: `${campaign.appendices.creatures.length} stat blocks used`, depth: 0 });
      rows.push({ kind: 'items', label: 'Treasure & items', sub: `${campaign.appendices.magicItems.length} magic items, ${(campaign.treasure?.gp || 0).toLocaleString()} gp`, depth: 0 });
      rows.push({ kind: 'endings', label: 'Endings', sub: `on course: ${outlook().label}`, depth: 0 });
      return rows;
    };

    const sameSelection = (row) =>
      row.kind === selection.kind && (!row.ref || row.ref === selection.ref);

    const drawTree = () => {
      const box = out.querySelector('#sg-tree');
      // the collapsed rail shows the one step you are on
      const where = out.querySelector('#sg-tree-where');
      if (where) {
        const cur = treeRows().find(sameSelection);
        where.textContent = cur ? cur.label : 'Overview';
      }
      box.innerHTML = '';
      for (const row of treeRows()) {
        const node = el(`<button class="story-node d${row.depth} ${sameSelection(row) ? 'active' : ''} ${row.done ? 'done' : ''}">
          <span class="sn-label">${esc(row.label)}</span>
          ${row.sub ? `<span class="sn-sub">${esc(row.sub)}</span>` : ''}
        </button>`);
        node.addEventListener('click', () => {
          selection = { kind: row.kind, ref: row.ref, chapter: row.chapter };
          drawTree();
          drawDetail();
          if (!window.matchMedia('(min-width: 900px)').matches) {
            out.querySelector('#sg-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
        box.append(node);
      }
    };

    /* ---------- detail renderers ---------- */

    const creatureLink = (c) => `<a href="javascript:void 0" data-mon="${esc(c.slug)}">${esc(c.name)}</a>`;

    // Swap one creature for a comparable one without touching the rest of
    // the fight; the encounter-level reroll rebuilds the whole thing.
    const creatureLineHTML = (b, c) => `<span class="creature-line">${c.count} x ${creatureLink(c)}
      <span class="small faint">CR ${esc(c.cr)}</span>
      <button class="mini-reroll" data-swap="${esc(b.id)}|${esc(c.slug)}" title="Swap ${esc(c.name)} for something comparable">&#8635;</button></span>`;

    // The player/DM boundary, made visible. Boxed blue text is safe to say or
    // show; fenced amber blocks are spoilers. Everything unmarked is ordinary
    // DM working material.
    // { eltId, nodeId } for the one dungeon room left open
    let openArea = null;

    const playerBox = (html, tag = 'Read aloud') =>
      `<div class="player-text"><span class="facing player">${esc(tag)}</span>${html}</div>`;
    const dmBox = (html) =>
      `<div class="dm-note"><span class="facing dm">DM only</span>${html}</div>`;

    // The real dungeon map: rooms and corridors as geometry on a 5-ft grid,
    // ink-and-hatch in the style of hand-drawn dungeon maps, themable for
    // light and dark. Rooms are clickable and jump to their key.
    // Which written entry a drawn passage glyph belongs to. New campaigns
    // stamp the id on both sides; older saves are paired by position, which
    // is the order the generator wrote them in.
    const passageKey = (x, i) => x?.id || `p${i + 1}`;

    // A drawn level is pure output of the stored geometry: nothing on it
    // changes after generation, so it is rendered once per campaign and
    // kept. Rerolling a chapter replaces its elements under new ids, which
    // simply leaves the old entries behind.
    const mapCache = new Map();
    const levelCache = new Map();
    const dungeonMapSVG = (elt, player = false) => {
      const key = `${campaign?.id}|${elt.id}|${player ? 'p' : 'dm'}`;
      let html = mapCache.get(key);
      if (html === undefined) {
        html = buildDungeonMapSVG(elt, player);
        mapCache.set(key, html);
      }
      return html;
    };
    // build just one level of one element into the level cache: the unit of
    // background work, small enough that yielding between units keeps the
    // page responsive
    const warmLevel = (elt, li) => buildDungeonMapSVG(elt, false, li);

    // Drawing every dungeon takes long enough to feel, so the moment a
    // campaign is on screen the rest of its maps render quietly in the
    // background: by the time the sidebar is clicked the drawing is already
    // in the cache. The work is chunked one LEVEL at a time and each chunk
    // waits for the browser to report itself idle, so opening the tab paints
    // first and nothing the user does has to queue behind a map. A newly
    // shown campaign abandons the previous campaign's queue.
    let preloadToken = 0;
    const idle = () => new Promise(res => {
      if (window.requestIdleCallback) requestIdleCallback(() => res(), { timeout: 2000 });
      else setTimeout(res, 120);
    });
    const preloadMaps = async () => {
      const token = ++preloadToken;
      if (!campaign) return;
      const elts = campaign.acts.flatMap(a => a.chapters).flatMap(ch => ch.elements)
        .filter(e => e.type === 'dungeon' && (e.map?.rooms?.length || e.map?.levels?.length));
      // two frames first, so the tab switch is on screen before any work;
      // raced with a timer because a hidden tab paints no frames at all
      await new Promise(r => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 300); });
      for (const elt of elts) {
        const n = (elt.map.levels || [elt.map]).length;
        for (let li = 0; li < n; li++) {
          await idle();
          if (token !== preloadToken) return;
          warmLevel(elt, li);
        }
        await idle();
        if (token !== preloadToken) return;
        dungeonMapSVG(elt);        // assembly over cached levels: cheap
      }
    };

    const buildDungeonMapSVG = (elt, player = false, onlyLevel = null) => {
      const top = elt.map;
      if (!top || !(top.rooms?.length || top.levels?.length)) return legacyMapSVG(elt);
      const written = elt.passages || [];
      const levelOffset = new Map();
      {
        let k = 0;
        for (const mm of (top.levels || [top])) { levelOffset.set(mm, k); k += (mm.corridorFeatures || []).length; }
      }
      const passageIdOf = (mm, f, fi) => {
        if (f.pid) return written.some(x => x.id === f.pid) ? f.pid : null;
        const at = (levelOffset.get(mm) || 0) + fi;
        return written[at] ? passageKey(written[at], at) : null;
      };
      const passageTitleOf = (pid) => {
        const x = written.find((w, i) => passageKey(w, i) === pid);
        return x ? `${x.name} (between ${x.between[0]} and ${x.between[1]})` : '';
      };
      const maps = top.levels || [top];
      const multi = maps.length > 1;
      const C = 12; // px per 5-ft square
      const WALL = 2.6;      // the stroke the rooms are drawn with
      const PASSAGE = C;     // a passage fills its square, edge to edge
      const roleOf = new Map((elt.nodes || []).map(n => [n.id, n]));

      // Each level draws as its own map; def ids carry the level index so
      // two levels can share one page without their defs colliding.
      const renderLevel = (m, li) => {
      const W = m.bounds.w * C, H = m.bounds.h * C;
      const cave = m.style === 'cave';

      // For the player's copy, anything sealed behind a secret door stays off
      // the page: walk the map from the entrance refusing secret edges, and
      // draw only the rooms and corridors that walk can reach.
      let rooms = m.rooms, corridors = m.corridors, doors = m.doors;
      if (player) {
        const sealed = new Set(m.doors.filter(d => d.type === 'secret').map(d => d.between.join('|')));
        const seen = new Set([m.entrance.room]); const queue = [m.entrance.room];
        while (queue.length) {
          const id = queue.pop();
          for (const nb of (m.adjacency?.[id] || [])) {
            if (!seen.has(nb) && !sealed.has(id + '|' + nb)) { seen.add(nb); queue.push(nb); }
          }
        }
        rooms = m.rooms.filter(r => seen.has(r.id));
        corridors = m.corridors.filter(co => seen.has(co.a) && seen.has(co.b) && !sealed.has(co.a + '|' + co.b));
        doors = m.doors.filter(d => d.type !== 'secret' && seen.has(d.between[0]) && seen.has(d.between[1]));
      }

      // stable pseudo-random from coordinates, so redraws do not shimmer
      const jig = (x, y, k = 0) => {
        const t = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453;
        return t - Math.floor(t);
      };

      const roomPath = (r) => {
        if (r.poly) {
          return 'M' + r.poly.map(([px, py]) => `${(px * C).toFixed(1)},${(py * C).toFixed(1)}`).join('L') + 'Z';
        }
        const x = r.x * C, y = r.y * C, w = r.w * C, h = r.h * C;
        if (r.shape === 'round') {
          return `M${x + w / 2},${y} a${w / 2},${h / 2} 0 1,0 0.01,0 Z`;
        }
        if (r.shape === 'octagon') {
          const c1 = Math.min(w, h) * 0.28;
          return `M${x + c1},${y} H${x + w - c1} L${x + w},${y + c1} V${y + h - c1} L${x + w - c1},${y + h} H${x + c1} L${x},${y + h - c1} V${y + c1} Z`;
        }
        return `M${x},${y} h${w} v${h} h${-w} Z`;
      };

      const inPoly = (poly, x, y) => {
        let hit = false;
        for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
          const [xi, yi] = poly[i], [xk, yk] = poly[k];
          if ((yi > y) !== (yk > y) && x < ((xk - xi) * (y - yi)) / (yk - yi) + xi) hit = !hit;
        }
        return hit;
      };

      // The outline the walls are actually drawn with: one merged trace of
      // every room shape and every corridor run, plus a point test for
      // whether a spot lies on drawn floor. The hatching used to grow from a
      // whole-cell rasterisation of the floor with its vertices jittered,
      // both leftovers from the fuzzy band it once was; fine while a wide
      // blurred band hid the difference, but strokes rooted on it followed
      // the cells while the walls followed the geometry, so on an octagon or
      // a carved cavern the rock drifted clear of its own wall. This follows
      // the same shapes roomPath and corridorPts draw.
      const drawnEdge = () => {
        const tests = rooms.map(r => {
          const x = r.x * C, y = r.y * C, w = r.w * C, h = r.h * C;
          if (r.poly) {
            const pp = r.poly.map(([a, b]) => [a * C, b * C]);
            return (px, py) => inPoly(pp, px, py);
          }
          if (r.shape === 'round') {
            const cx = x + w / 2, cy = y + h / 2;
            return (px, py) => ((px - cx) / (w / 2)) ** 2 + ((py - cy) / (h / 2)) ** 2 <= 1;
          }
          if (r.shape === 'octagon') {
            const c1 = Math.min(w, h) * 0.28;
            const pp = [[x + c1, y], [x + w - c1, y], [x + w, y + c1], [x + w, y + h - c1],
              [x + w - c1, y + h], [x + c1, y + h], [x, y + h - c1], [x, y + c1]];
            return (px, py) => inPoly(pp, px, py);
          }
          return (px, py) => px >= x && px <= x + w && py >= y && py <= y + h;
        });
        const runs = corridors.map(co => corridorXY(co.cells));
        const half = PASSAGE / 2;
        const inside = (px, py) => {
          for (const t of tests) if (t(px, py)) return true;
          for (const pts of runs) {
            for (let i = 0; i < pts.length - 1; i++) {
              const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
              const dx = bx - ax, dy = by - ay;
              const L2 = dx * dx + dy * dy || 1;
              let t = ((px - ax) * dx + (py - ay) * dy) / L2;
              t = t < 0 ? 0 : t > 1 ? 1 : t;
              const qx = ax + dx * t - px, qy = ay + dy * t - py;
              if (qx * qx + qy * qy <= half * half) return true;
            }
          }
          return false;
        };

        // trace it with marching squares on a fine grid, then pull every
        // vertex onto the true edge, so neither the grid's staircase nor
        // its quarter-cell offset ever reaches the page
        const step = 3;
        const gw = Math.ceil(W / step) + 2, gh = Math.ceil(H / step) + 2;
        const grid = new Uint8Array(gw * gh);
        for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
          if (inside((i + 0.5) * step, (j + 0.5) * step)) grid[j * gw + i] = 1;
        }
        const has = (i, j) => i >= 0 && j >= 0 && i < gw && j < gh && grid[j * gw + i] === 1;
        const segs = [];
        for (let i = 0; i < gw; i++) for (let j = 0; j < gh; j++) {
          if (!has(i, j)) continue;
          if (!has(i, j - 1)) segs.push([[i, j], [i + 1, j]]);
          if (!has(i, j + 1)) segs.push([[i + 1, j + 1], [i, j + 1]]);
          if (!has(i - 1, j)) segs.push([[i, j + 1], [i, j]]);
          if (!has(i + 1, j)) segs.push([[i + 1, j], [i + 1, j + 1]]);
        }
        const byStart = new Map();
        for (const sg of segs) {
          const k = sg[0][0] + ',' + sg[0][1];
          if (!byStart.has(k)) byStart.set(k, []);
          byStart.get(k).push(sg);
        }
        const used = new Set(), loops = [];
        for (const sg of segs) {
          if (used.has(sg[0] + '>' + sg[1])) continue;
          const loop = [sg[0]];
          let cur = sg;
          for (let guard = 0; guard < 200000; guard++) {
            used.add(cur[0] + '>' + cur[1]);
            const nexts = (byStart.get(cur[1][0] + ',' + cur[1][1]) || []).filter(z => !used.has(z[0] + '>' + z[1]));
            if (!nexts.length) break;
            cur = nexts[0];
            loop.push(cur[0]);
            if (cur[1][0] === sg[0][0] && cur[1][1] === sg[0][1]) break;
          }
          if (loop.length > 6) loops.push(loop.map(([i, j]) => [i * step, j * step]));
        }
        for (const loop of loops) {
          const n = loop.length;
          for (let i = 0; i < n; i++) {
            const a = loop[(i - 2 + n) % n], b = loop[(i + 2) % n];
            const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
            let nx = -ty / tl, ny = tx / tl;
            const [px, py] = loop[i];
            if (inside(px + nx * step, py + ny * step)) { nx = -nx; ny = -ny; }
            let lo = -step * 1.5, hi = step * 1.5;   // lo toward the floor, hi toward the page
            if (inside(px + nx * hi, py + ny * hi) || !inside(px + nx * lo, py + ny * lo)) continue;
            for (let k = 0; k < 6; k++) {
              const mid = (lo + hi) / 2;
              if (inside(px + nx * mid, py + ny * mid)) lo = mid; else hi = mid;
            }
            loop[i] = [px + nx * ((lo + hi) / 2), py + ny * ((lo + hi) / 2)];
          }
        }
        // exact where it matters, O(1) where it is called in bulk
        const insideGrid = (px, py) => has(Math.floor(px / step), Math.floor(py / step));
        // clearance: how far a point stands from the nearest drawn floor, in
        // px, by chamfer flood over the same fine grid. The hatching's fill
        // pass uses it to know what counts as band and what is open page.
        const dfArr = new Float32Array(gw * gh).fill(1e9);
        {
          const q = [];
          for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
            if (grid[j * gw + i]) { dfArr[j * gw + i] = 0; q.push(i, j); }
          }
          for (let h2 = 0; h2 < q.length; h2 += 2) {
            const i = q[h2], j = q[h2 + 1], base = dfArr[j * gw + i];
            for (const [di, dj, c] of [[1, 0, 3], [-1, 0, 3], [0, 1, 3], [0, -1, 3], [1, 1, 4.24], [1, -1, 4.24], [-1, 1, 4.24], [-1, -1, 4.24]]) {
              const ni = i + di, nj = j + dj;
              if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
              if (dfArr[nj * gw + ni] > base + c + 0.001) { dfArr[nj * gw + ni] = base + c; q.push(ni, nj); }
            }
          }
        }
        const clear = (px, py) => {
          const i = Math.max(0, Math.min(gw - 1, Math.floor(px / step)));
          const j = Math.max(0, Math.min(gh - 1, Math.floor(py / step)));
          return dfArr[j * gw + i];
        };
        return { loops, inside: insideGrid, clear, w: gw * step, h: gh * step };
      };

      // Dyson hatching. The atom is a cluster of three strokes of slightly
      // different lengths (sometimes four), gently curved, ends ragged, and
      // the clusters are laid along the wall in a chain: each one turned 35
      // to 60 degrees off the one before it so their ends mesh, with a
      // second rank sitting in the first rank's gaps.
      //
      // Two additions keep a flat wall's density everywhere else. The chain
      // runs through an occupancy cap, one cluster per 7px cell, so where
      // several walls share a pocket or an inside corner folds the band over
      // itself, the extras simply do not land. And a fill pass then walks
      // the whole band - everywhere within a hatch's reach of a floor - and
      // drops a cluster into any bare patch the chain missed, which is what
      // an outside corner's fanned-open gap is. All the randomness comes
      // from jig(), so the DM's copy and the player's export of the same
      // level hatch identically.
      const hatchMarks = (loops, inside, clear, w, h) => {
        const STEP = 1.0;                 // px between boundary samples
        const SMOOTH = 5;                 // samples either side, for the tangent
        const CELL = 7;                   // occupancy: one cluster per cell
        const clusters = [];
        const cells = new Set();
        const ckey = (x, y) => Math.floor(x / CELL) + ',' + Math.floor(y / CELL);
        const allSamples = [];

        loops.forEach((loop, li2) => {
          if (loop.length < 4) return;

          // Walk the outline at a fixed spacing first. The outline is a
          // staircase of whole cells, so taking the direction from a single
          // edge would give every stroke one of four angles; sampling evenly
          // and reading the direction across several samples turns the
          // staircase back into the line it stands for.
          const pts = [];
          let carry = 0;
          for (let i = 0; i < loop.length; i++) {
            const a = loop[i], b = loop[(i + 1) % loop.length];
            const dx = b[0] - a[0], dy = b[1] - a[1];
            const len = Math.hypot(dx, dy);
            if (len < 0.001) continue;
            for (let t = carry; t < len; t += STEP) pts.push([a[0] + (dx / len) * t, a[1] + (dy / len) * t]);
            carry = (carry + Math.ceil((len - carry) / STEP) * STEP) - len;
          }
          const n = pts.length;
          if (n < SMOOTH * 2 + 2) return;
          const norms = [];
          for (let i = 0; i < n; i++) {
            const a = pts[(i - SMOOTH + n) % n], b = pts[(i + SMOOTH) % n];
            const tx = b[0] - a[0], ty = b[1] - a[1];
            const tl = Math.hypot(tx, ty) || 1;
            let nx = -ty / tl, ny = tx / tl;
            if (inside(pts[i][0] + nx * 3, pts[i][1] + ny * 3)) { nx = -nx; ny = -ny; }
            norms.push([nx, ny]);
            if (i % 4 === 0) allSamples.push({ x: pts[i][0], y: pts[i][1], tx: tx / tl, ty: ty / tl });
          }

          // the chain: each cluster's angle is the last one's, pushed 35-60
          // degrees round, so neighbouring clusters mesh instead of matching
          let ang = jig(li2, 1) * Math.PI;
          const turn = (x) => {
            ang += (jig(x, li2, 2) < 0.5 ? 1 : -1) * (Math.PI * 0.19 + jig(x, li2, 3) * Math.PI * 0.14);
          };
          const cluster = (i, dist, len, seed) => {
            const [px2, py2] = pts[i], [nx, ny] = norms[i];
            const cx = px2 + nx * dist, cy = py2 + ny * dist;
            // a cluster whose heart is on someone's floor would poke out the
            // far side of it, and one in a taken cell is a pile-up
            if (inside(cx, cy)) return;
            const k = ckey(cx, cy);
            if (cells.has(k)) return;
            cells.add(k);
            clusters.push({ x: cx, y: cy, a: ang, len, li: li2, i, seed });
          };
          for (let i = 0; i < n; i += 9) { turn(i); cluster(i, 5.5, 13, 10); }
          ang += Math.PI / 3;
          for (let i = 4; i < n; i += 9) { turn(i + 7919); cluster(i, 11.5, 12, 20); }
        });

        // the fill: any bare patch of band gets the cluster the chain never
        // brought there, leaning off the nearest wall's own direction
        const bw = Math.max(1, Math.ceil((w || 600) / 24)), bh = Math.max(1, Math.ceil((h || 600) / 24));
        const buckets = new Map();
        for (const sm of allSamples) {
          const bkey = Math.floor(sm.x / 24) + ',' + Math.floor(sm.y / 24);
          if (!buckets.has(bkey)) buckets.set(bkey, []);
          buckets.get(bkey).push(sm);
        }
        const nearestTangent = (x, y) => {
          let best = null, bd = 1e9;
          const bx = Math.floor(x / 24), by = Math.floor(y / 24);
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            for (const sm of (buckets.get((bx + di) + ',' + (by + dj)) || [])) {
              const d2 = (sm.x - x) ** 2 + (sm.y - y) ** 2;
              if (d2 < bd) { bd = d2; best = sm; }
            }
          }
          return best;
        };
        const cbuckets = new Map();
        const cput = (c) => {
          const k = Math.floor(c.x / 12) + ',' + Math.floor(c.y / 12);
          if (!cbuckets.has(k)) cbuckets.set(k, []);
          cbuckets.get(k).push(c);
        };
        for (const c of clusters) cput(c);
        const crowded = (x, y) => {
          const bx = Math.floor(x / 12), by = Math.floor(y / 12);
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            for (const c of (cbuckets.get((bx + di) + ',' + (by + dj)) || [])) {
              if ((c.x - x) ** 2 + (c.y - y) ** 2 < 72) return true;
            }
          }
          return false;
        };
        for (let y = 4; y < (h || 600); y += 5) {
          for (let x = 4; x < (w || 600); x += 5) {
            const cl = clear(x, y);
            if (cl < 4 || cl > 14) continue;
            const k = ckey(x, y);
            if (cells.has(k) || crowded(x, y)) continue;
            const sm = nearestTangent(x, y);
            if (!sm) continue;
            const wall = Math.atan2(sm.ty, sm.tx);
            const lean = (jig(x, y, 46) < 0.5 ? 1 : -1) * (0.55 + jig(x, y, 47) * 0.5);
            const c = { x, y, a: wall + lean, len: 12, li: 999, i: Math.round(x + y * 7), seed: 50 };
            cells.add(k);
            clusters.push(c);
            cput(c);
          }
        }

        // ink at last: the same cluster of three whichever pass placed it
        const marks = [];
        for (const c of clusters) {
          const dx = Math.cos(c.a), dy = Math.sin(c.a);
          const qx = -dy, qy = dx;
          const nl = jig(c.i, c.li, c.seed) < 0.15 ? 4 : 3;
          for (let k = 0; k < nl; k++) {
            const off = (k - (nl - 1) / 2) * 2.4 + (jig(c.i + k, c.li, c.seed + 1) - 0.5) * 0.5;
            const L = c.len * (0.8 + jig(c.i, k + c.li, c.seed + 2) * 0.28);
            const slide = (jig(k, c.i, c.seed + 3) - 0.5) * 0.24 * c.len;
            const x0 = c.x + qx * off - dx * (L / 2 - slide);
            const y0 = c.y + qy * off - dy * (L / 2 - slide);
            const bend = (jig(c.i, k, c.seed + 4) - 0.5) * 0.14 * L;
            const mx = x0 + dx * L / 2 + qx * bend, my = y0 + dy * L / 2 + qy * bend;
            marks.push(`M${x0.toFixed(1)},${y0.toFixed(1)}Q${mx.toFixed(1)},${my.toFixed(1)} ${(x0 + dx * L).toFixed(1)},${(y0 + dy * L).toFixed(1)}`);
          }
        }
        return `<path d="${marks.join('')}"/>`;
      };

      const corridorPath = (cells, carry = true) => {
        // simplify the cell path to bend points, then optionally wobble
        const pts = [cells[0]];
        for (let i = 1; i < cells.length - 1; i++) {
          const [ax, ay] = cells[i - 1], [bx, by] = cells[i], [cx2, cy2] = cells[i + 1];
          if ((bx - ax) !== (cx2 - bx) || (by - ay) !== (cy2 - by)) pts.push(cells[i]);
        }
        if (cells.length > 1) pts.push(cells[cells.length - 1]);

        // Add a step at each end that carries the passage a cell in under
        // the room it serves, so the room, drawn over the top, ends it
        // exactly at its own wall rather than a hair short of the doorway.
        //
        // Added, not substituted for the cell outside the wall: that cell is
        // what makes the passage leave the doorway square-on, and about a
        // third of them turn immediately, so dropping it sent those across
        // the wall at an angle while the opening cut for them stayed square,
        // which is what left the junctions looking hacked about.
        const ends = [];
        if (carry && pts.length > 1) {
          const doorAt = (cell) => doors.find(dd => dd.outside[0] === cell[0] && dd.outside[1] === cell[1]);
          const first = cells[0], last = cells[cells.length - 1];
          // Both points of the first and last segment are pinned, not just the
          // outermost: a crossing is only square if both ends of it are, and
          // wobbling the second point would tilt the passage in its doorway.
          const dA = doorAt(first);
          if (dA) { pts.unshift([first[0] + (dA.x - dA.outside[0]), first[1] + (dA.y - dA.outside[1])]); ends.push(0, 1); }
          const dB = doorAt(last);
          if (dB) { pts.push([last[0] + (dB.x - dB.outside[0]), last[1] + (dB.y - dB.outside[1])]); ends.push(pts.length - 1, pts.length - 2); }
        }

        // A cave's passages wander, but not through their own doorways: the
        // two structural ends stay put so the crossing keeps its right angle.
        return pts.map(([x, y], i) => {
          const wobble = cave && !ends.includes(i);
          const wx = wobble ? (jig(x, y) - 0.5) * 0.5 : 0;
          const wy = wobble ? (jig(y, x, 7) - 0.5) * 0.5 : 0;
          return [(x + 0.5 + wx) * C, (y + 0.5 + wy) * C];
        });
      };
      // the same run as coordinates for the hatching, and as the string a
      // polyline wants for drawing
      const corridorXY = (cells, carry = true) => corridorPath(cells, carry);
      const corridorPts = (cells, carry = true) =>
        corridorPath(cells, carry).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

      // The hatching grows from the walls as they are actually drawn, so it
      // starts against the wall the way it does on a drawn map.
      const edge = drawnEdge();
      const crag = hatchMarks(edge.loops, edge.inside, edge.clear, edge.w, edge.h);

      // A passage is exactly one square wide. At 0.95 of one it sat a fraction
      // inside the grid lines on both sides, so it never lined up with the
      // squares it runs through nor with the wall it arrives at, and every
      // opening cut for it had to guess. Its walls carry the same weight the
      // rooms are drawn with, so the two meet flush at a doorway instead of
      // stepping.
      const corridorInk = corridors.map(co =>
        `<polyline points="${corridorPts(co.cells)}" fill="none" stroke="var(--map-ink)" stroke-width="${(PASSAGE + WALL * 2).toFixed(1)}" stroke-linecap="butt" stroke-linejoin="round"/>`).join('');
      // Two copies of the floor, because the hallways are drawn twice: once
      // under the rooms and again over the openings, masked to what lies
      // outside them. Only the second copy is the one anyone sees out on the
      // passages, so that is the one that carries the click target and the
      // hover tint; the first stays plain.
      const floorLine = (co) =>
        `<polyline points="${corridorPts(co.cells)}" fill="none" stroke="var(--map-floor)" stroke-width="${PASSAGE.toFixed(1)}" stroke-linecap="butt" stroke-linejoin="round"/>`;
      const corridorFloor = corridors.map(floorLine).join('');
      const corridorFloorTop = corridors.map(co => {
        // a hallway that is something in particular opens its own entry
        const ch = !player && co.character ? co.character : null;
        if (!ch) return floorLine(co);
        // The glow is both the hover tint and the click target, and it stops
        // at the doorways: the drawn floor runs a cell in under each room it
        // serves, and a masked group is still hit-tested where it is masked
        // out, so a hallway drawn that way would take the clicks meant for
        // the two rooms it joins.
        return `<g class="map-hall" data-goto="${esc(ch.id)}"><title>${esc(ch.name)} (between ${esc(co.a)} and ${esc(co.b)})</title>
          ${floorLine(co)}
          <polyline class="map-hall-glow" points="${corridorPts(co.cells, false)}" fill="none" stroke-width="${PASSAGE.toFixed(1)}" stroke-linecap="butt" stroke-linejoin="round"/></g>`;
      }).join('');

      // What lines a hallway, drawn along the run of it. Only the treatments
      // a plan view can actually show: the rest are for the DM to read out.
      const hallDressing = player ? '' : corridors.map(co => {
        const kind2 = co.character?.draw;
        if (!kind2) return '';
        const cells = co.cells;
        let out = '';
        for (let i = 1; i < cells.length - 1; i++) {
          const [x, y] = cells[i];
          const [ax, ay] = cells[i - 1], [bx, by] = cells[i + 1];
          const dx = bx - ax, dy = by - ay;
          if (dx && dy) continue;                       // a turn: leave the corner clear
          const ux = dx ? Math.sign(dx) : 0, uy = dy ? Math.sign(dy) : 0;
          const nx = -uy, ny = ux;                      // across the passage
          const cx3 = (x + 0.5) * C, cy3 = (y + 0.5) * C;
          const side = (t) => [cx3 + nx * t, cy3 + ny * t];
          const both = (t, mk) => mk(...side(t)) + mk(...side(-t));
          if (kind2 === 'pillars') out += both(3.9, (px2, py2) => `<circle cx="${px2.toFixed(1)}" cy="${py2.toFixed(1)}" r="1.7" class="map-column"/>`);
          else if (kind2 === 'statues') out += (i % 2 ? both(3.8, (px2, py2) => `<circle cx="${px2.toFixed(1)}" cy="${py2.toFixed(1)}" r="2.1" class="map-furn"/>`) : '');
          else if (['bones', 'niches', 'shelves', 'racks', 'cells', 'crates'].includes(kind2)) {
            out += both(4.1, (px2, py2) => `<rect x="${(px2 - 1.8).toFixed(1)}" y="${(py2 - 1.8).toFixed(1)}" width="3.6" height="3.6" class="map-furn"/>`);
          } else if (kind2 === 'sconces') {
            if (i % 2) out += both(5.4, (px2, py2) => `<circle cx="${px2.toFixed(1)}" cy="${py2.toFixed(1)}" r="1.2" class="map-column"/>`);
          } else if (kind2 === 'grate') {
            const [g1x, g1y] = side(5), [g2x, g2y] = side(-5);
            out += `<line x1="${g1x.toFixed(1)}" y1="${g1y.toFixed(1)}" x2="${g2x.toFixed(1)}" y2="${g2y.toFixed(1)}" class="map-furn-line"/>`;
          } else if (kind2 === 'rubble' || kind2 === 'roots' || kind2 === 'fungus') {
            for (let k = 0; k < 3; k++) {
              const t = (jig(x + k, y, k + 2) - 0.5) * 9, u = (jig(y, x + k, k + 5) - 0.5) * 8;
              const px2 = cx3 + nx * t + ux * u, py2 = cy3 + ny * t + uy * u;
              out += `<circle cx="${px2.toFixed(1)}" cy="${py2.toFixed(1)}" r="${(0.9 + jig(k, x) * 0.8).toFixed(1)}" class="${kind2 === 'rubble' ? 'map-rubble' : 'map-stipple'}"/>`;
            }
          }
        }
        if (kind2 === 'water') {
          out += `<polyline points="${corridorPts(co.cells)}" fill="none" stroke="var(--map-water)" stroke-width="9" stroke-linecap="butt" stroke-linejoin="round" opacity="0.5"/>`;
        }
        return out;
      }).join('');

      const ROLE_TINT = { encounter: 'var(--danger)', boss: 'var(--accent)', treasure: 'var(--success)', trap: 'var(--info)', puzzle: 'var(--info)', threshold: 'var(--map-ink)' };
      const featSvg = (r) => (r.features || []).map(f => {
        if (player && f.t === 'chest') return '';
        if (f.t === 'stair') {
          // a boxed stair well: treads that shorten toward the deep end
          let treads = '';
          for (let i = 0; i < 5; i++) {
            const t3 = (i + 0.5) / 5;
            const deep = f.dir === 'down' ? t3 : 1 - t3;
            const half = (f.orient === 'h' ? f.h : f.w) * C * 0.5 * (1 - deep * 0.45);
            if (f.orient === 'h') {
              const tx = (f.x + f.w * t3) * C, tyc = (f.y + f.h / 2) * C;
              treads += `<line x1="${tx.toFixed(1)}" y1="${(tyc - half).toFixed(1)}" x2="${tx.toFixed(1)}" y2="${(tyc + half).toFixed(1)}"/>`;
            } else {
              const ty = (f.y + f.h * t3) * C, txc = (f.x + f.w / 2) * C;
              treads += `<line x1="${(txc - half).toFixed(1)}" y1="${ty.toFixed(1)}" x2="${(txc + half).toFixed(1)}" y2="${ty.toFixed(1)}"/>`;
            }
          }
          return `<rect x="${(f.x * C).toFixed(1)}" y="${(f.y * C).toFixed(1)}" width="${(f.w * C).toFixed(1)}" height="${(f.h * C).toFixed(1)}" class="map-furn"/><g class="map-stair">${treads}</g>`;
        }
        if (f.t === 'column') return `<circle cx="${(f.x * C).toFixed(1)}" cy="${(f.y * C).toFixed(1)}" r="${(C * 0.3).toFixed(1)}" class="map-column"/>`;
        if (f.t === 'dais') return `<rect x="${(f.x * C).toFixed(1)}" y="${(f.y * C).toFixed(1)}" width="${(f.w * C).toFixed(1)}" height="${(f.h * C).toFixed(1)}" class="map-furn"/>
          <rect x="${((f.x + 0.35) * C).toFixed(1)}" y="${((f.y + 0.3) * C).toFixed(1)}" width="${((f.w - 0.7) * C).toFixed(1)}" height="${((f.h - 0.55) * C).toFixed(1)}" class="map-furn"/>`;
        if (f.t === 'chest') return `<rect x="${((f.x - 0.35) * C).toFixed(1)}" y="${((f.y - 0.25) * C).toFixed(1)}" width="${(C * 0.7).toFixed(1)}" height="${(C * 0.5).toFixed(1)}" class="map-furn"/>
          <line x1="${((f.x - 0.35) * C).toFixed(1)}" y1="${(f.y * C).toFixed(1)}" x2="${((f.x + 0.35) * C).toFixed(1)}" y2="${(f.y * C).toFixed(1)}" class="map-furn-line"/>`;
        if (f.t === 'table') return `<rect x="${(f.x * C).toFixed(1)}" y="${(f.y * C).toFixed(1)}" width="${(f.w * C).toFixed(1)}" height="${(f.h * C).toFixed(1)}" class="map-furn"/>`;
        if (f.t === 'pool') {
          const pts = [];
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            const rr = f.r * (0.7 + jig(f.x + i, f.y, 9) * 0.5);
            pts.push(`${((f.x + Math.cos(a) * rr) * C).toFixed(1)},${((f.y + Math.sin(a) * rr) * C).toFixed(1)}`);
          }
          return `<path d="M${pts.join('L')}Z" class="map-pool"/>`;
        }
        if (f.t === 'rubble') {
          let dots = '';
          for (let i = 0; i < 5; i++) {
            dots += `<circle cx="${((f.x + (jig(f.x, f.y, i) - 0.5) * 1.6) * C).toFixed(1)}" cy="${((f.y + (jig(f.y, f.x, i + 3) - 0.5) * 1.6) * C).toFixed(1)}" r="${(C * (0.06 + jig(i, f.x) * 0.07)).toFixed(1)}" class="map-rubble"/>`;
          }
          return dots;
        }
        return '';
      }).join('');

      // stipple gives cave floors their texture without any stored data
      const stipple = (r) => {
        if (r.shape !== 'cave') return '';
        let out = '';
        const n2 = Math.round(r.w * r.h * 0.25);
        for (let i = 0; i < n2; i++) {
          const x = r.x + jig(r.x + i, r.y, 11) * r.w, y = r.y + jig(r.y + i, r.x, 13) * r.h;
          out += `<circle cx="${(x * C).toFixed(1)}" cy="${(y * C).toFixed(1)}" r="0.8" class="map-stipple"/>`;
        }
        return out;
      };

      const roomsSvg = rooms.map(r => {
        const node = roleOf.get(r.id) || {};
        return `<g class="map-room"${player ? '' : ` data-goto="${esc(r.id)}"`}>
          ${player ? '' : `<title>${esc(r.id)}: ${esc(node.roleLabel || r.role)}</title>`}
          <path class="map-floor" d="${roomPath(r)}"/>
          ${stipple(r)}${featSvg(r)}
        </g>`;
      }).join('');

      // what waits in the passages, on the DM's copy only: a trap the party
      // can read off the map is not a trap, and neither is a hidden way in.
      // Each glyph carries the id of the entry that describes it, so it
      // opens that entry the way a room does.
      const passageSvg = player ? '' : (m.corridorFeatures || []).map((f, fi) => {
        const px = (f.x + 0.5) * C, py = (f.y + 0.5) * C;
        const pid = passageIdOf(m, f, fi);
        const goto = pid ? ` data-goto="${esc(pid)}"` : '';
        if (f.t === 'trap') {
          const r2 = C * 0.34;
          return `<g class="map-hazard"${goto}><title>${esc(passageTitleOf(pid) || 'A trap in the passage')}</title>
            <path d="M${px},${(py - r2).toFixed(1)} L${(px + r2).toFixed(1)},${py} L${px},${(py + r2).toFixed(1)} L${(px - r2).toFixed(1)},${py} Z"/>
            <circle cx="${px}" cy="${py}" r="1.4"/></g>`;
        }
        return `<g class="map-hazard is-secret"${goto}><title>${esc(passageTitleOf(pid) || 'A way that is not obvious')}</title>
          <circle cx="${px}" cy="${py}" r="${(C * 0.34).toFixed(1)}"/>
          <text x="${px}" y="${(py + 3).toFixed(1)}" class="map-secret">S</text></g>`;
      }).join('');

      // the waterway: visible only where it crosses open floor (the room
      // clip does that), with plank bridges where a corridor passes over it
      let waterSvg = '', bridgeSvg = '';
      if (m.water) {
        const wpts = m.water.cells.map(([x, y]) =>
          `${((x + 0.5 + (jig(x, y, 21) - 0.5) * 0.6) * C).toFixed(1)},${((y + 0.5 + (jig(y, x, 23) - 0.5) * 0.6) * C).toFixed(1)}`).join(' ');
        const inner = m.water.kind === 'stream' ? 'var(--map-water)' : 'var(--map-page)';
        waterSvg = `<g clip-path="url(#dmrooms${li})" class="map-waterway">
          <polyline points="${wpts}" fill="none" stroke="var(--map-ink)" stroke-width="${(C * 1.0).toFixed(1)}" stroke-linejoin="round"/>
          <polyline points="${wpts}" fill="none" stroke="${inner}" stroke-width="${(C * 0.72).toFixed(1)}" stroke-linejoin="round"/>
        </g>`;
        // on the player's copy, a bridge over a hidden corridor would give
        // the corridor away, so only bridge what is drawn
        const drawn = player ? new Set(corridors.flatMap(co => co.cells.map(c2 => c2.join(',')))) : null;
        bridgeSvg = (m.water.bridges || []).filter(b => !drawn || drawn.has(b.join(','))).map(([bx2, by2]) => {
          let planks = '';
          for (let i = -1; i <= 1; i++) {
            const ox = (bx2 + 0.5) * C + (m.water.horiz ? 0 : i * C * 0.3);
            const oy = (by2 + 0.5) * C + (m.water.horiz ? i * C * 0.3 : 0);
            planks += m.water.horiz
              ? `<line x1="${(ox - C * 0.55).toFixed(1)}" y1="${oy.toFixed(1)}" x2="${(ox + C * 0.55).toFixed(1)}" y2="${oy.toFixed(1)}"/>`
              : `<line x1="${ox.toFixed(1)}" y1="${(oy - C * 0.55).toFixed(1)}" x2="${ox.toFixed(1)}" y2="${(oy + C * 0.55).toFixed(1)}"/>`;
          }
          return `<g class="map-bridge">${planks}</g>`;
        }).join('');
      }

      // grid inside rooms only
      let grid = '';
      for (let gx = 0; gx <= m.bounds.w; gx++) grid += `<line x1="${gx * C}" y1="0" x2="${gx * C}" y2="${H}"/>`;
      for (let gy = 0; gy <= m.bounds.h; gy++) grid += `<line x1="0" y1="${gy * C}" x2="${W}" y2="${gy * C}"/>`;
      const clip = rooms.map(r => `<path d="${roomPath(r)}"/>`).join('');

      // An opening is cut out of the room's own wall and nothing else, and
      // it is cut to the shape that wall actually has.
      //
      // A rectangle could only ever be right where the wall happened to run
      // straight and square to the passage. Instead, take the piece of the
      // room's own outline that spans the passage's inner width -- from the
      // inside face of one hallway wall to the inside face of the other --
      // and thicken it into a ribbon as deep as the wall is drawn. Whatever
      // the wall is doing at that point, the opening is that shape: it can
      // never bite a corner off the wall beside it, and it stops at the skin
      // of the room rather than carrying on down the hallway.
      const IN = WALL / 2 + 0.9;   // through the wall and a shade past it
      const OUT = 3.2 / 2;         // the wall's outer edge, hover weight included
      const roomById = new Map(rooms.map(r => [r.id, r]));

      const outlinePx = (r) => (r.poly
        ? r.poly.map(([x, y]) => [x * C, y * C])
        : [[r.x * C, r.y * C], [(r.x + r.w) * C, r.y * C], [(r.x + r.w) * C, (r.y + r.h) * C], [r.x * C, (r.y + r.h) * C]]);

      // The piece of the room's own outline that spans the way through, as
      // (along the wall, across it) pairs in order.
      //
      // It has to be a connected walk of the outline, not every edge that
      // happens to pass nearby: a room whose far side loops back within a
      // few pixels of this wall would otherwise contribute its edges too,
      // and the opening came out as a zigzag across half the room.
      const wallChain = (r, wall, mid, vert) => {
        const lo = mid - PASSAGE / 2, hi = mid + PASSAGE / 2;
        const pts = outlinePx(r);
        const n = pts.length;
        const at = (i) => pts[((i % n) + n) % n];
        const lat = (q) => (vert ? q[1] : q[0]);
        const per = (q) => (vert ? q[0] : q[1]);

        // the edge carrying the doorway: it spans the middle of the way
        // through and lies on the wall being opened
        let seed = -1, best = 4;
        for (let i = 0; i < n; i++) {
          const a = at(i), b = at(i + 1);
          const l0 = lat(a), l1 = lat(b);
          if (l0 === l1) continue;
          const t = (mid - l0) / (l1 - l0);
          if (t < 0 || t > 1) continue;
          const d = Math.abs(per(a) + (per(b) - per(a)) * t - wall);
          if (d < best) { best = d; seed = i; }
        }
        if (seed < 0) return null;

        // follow the outline out of the doorway in both directions until it
        // leaves the width of the way through
        const chain = [at(seed), at(seed + 1)];
        for (let i = seed + 1; chain.length < n; i++) {
          const l = lat(chain[chain.length - 1]);
          if (l <= lo || l >= hi) break;
          chain.push(at(i + 1));
        }
        for (let i = seed; chain.length < n; i--) {
          const l = lat(chain[0]);
          if (l <= lo || l >= hi) break;
          chain.unshift(at(i - 1));
        }
        if (chain.length < 2) return null;

        const cut = (a, b, target) => {
          const l0 = lat(a), l1 = lat(b);
          if (l0 === l1) return b.slice();
          const t = (target - l0) / (l1 - l0);
          return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        };
        const trim = (edgeIn, edgeOut) => {
          const l = lat(edgeIn);
          if (l < lo) return cut(edgeIn, edgeOut, lo);
          if (l > hi) return cut(edgeIn, edgeOut, hi);
          return edgeIn.slice();
        };
        chain[0] = trim(chain[0], chain[1]);
        chain[chain.length - 1] = trim(chain[chain.length - 1], chain[chain.length - 2]);

        // a wall that wanders this far from the doorway is not the wall the
        // hallway arrives at; better a plain opening than a wild shape
        if (chain.some(q => Math.abs(per(q) - wall) > 7)) return null;
        return chain.map(q => [lat(q), per(q)]);
      };

      const opening = (r, cx, cy, ndx, ndy) => {
        const vert = ndx !== 0;                  // the wall runs north-south
        const wall = vert ? cx : cy;             // where the way through crosses it
        const mid = vert ? cy : cx;              // the middle of the way through
        const away = -(vert ? ndx : ndy);        // out of the room
        const chain = r ? wallChain(r, wall, mid, vert) : null;
        if (!chain) {
          // no outline to follow: fall back to a square opening on the line
          return vert
            ? `<rect x="${cx - (ndx > 0 ? OUT : IN)}" y="${cy - PASSAGE / 2}" width="${IN + OUT}" height="${PASSAGE}" class="map-eraser"/>`
            : `<rect x="${cx - PASSAGE / 2}" y="${cy - (ndy > 0 ? OUT : IN)}" width="${PASSAGE}" height="${IN + OUT}" class="map-eraser"/>`;
        }
        const xy = (l, q) => (vert ? `${q.toFixed(1)},${l.toFixed(1)}` : `${l.toFixed(1)},${q.toFixed(1)}`);
        const outer = chain.map(([l, q]) => xy(l, q + away * OUT));
        const inner = chain.map(([l, q]) => xy(l, q - away * IN)).reverse();
        return `<polygon points="${[...outer, ...inner].join(' ')}" class="map-eraser"/>`;
      };

      const doorErasers = doors.map(d => {
        const bx = ((d.x + d.outside[0]) / 2 + 0.5) * C;
        const by = ((d.y + d.outside[1]) / 2 + 0.5) * C;
        return opening(roomById.get(d.between[0]), bx, by,
          Math.sign(d.x - d.outside[0]), Math.sign(d.y - d.outside[1]));
      }).join('');

      const doorGlyphs = doors.filter(d => d.type !== 'arch').map(d => {
        const bx = ((d.x + d.outside[0]) / 2 + 0.5) * C;
        const by = ((d.y + d.outside[1]) / 2 + 0.5) * C;
        const along = d.orient === 'h' ? 'v' : 'h';
        const glyph = along === 'h'
          ? `<rect x="${bx - C * 0.42}" y="${by - C * 0.18}" width="${C * 0.84}" height="${C * 0.36}" class="map-door"/>`
          : `<rect x="${bx - C * 0.18}" y="${by - C * 0.42}" width="${C * 0.36}" height="${C * 0.84}" class="map-door"/>`;
        return glyph + (d.type === 'secret' ? `<text x="${bx}" y="${by + 3}" class="map-secret">S</text>` : '');
      }).join('');

      // the way in: an opening plus an arrow pointing into the first room
      const e = m.entrance;
      let entranceSvg = '', entranceEraser = '';
      if (e && !e.internal) {
      const ex = ((e.x + e.outside[0]) / 2 + 0.5) * C, ey = ((e.y + e.outside[1]) / 2 + 0.5) * C;
      const dx = (e.x - e.outside[0]) * C * 0.9, dy = (e.y - e.outside[1]) * C * 0.9;
      // stairs descending through the opening: rungs that shorten with depth
      const ux = dx / (Math.hypot(dx, dy) || 1), uy = dy / (Math.hypot(dx, dy) || 1);
      const px2 = -uy, py2 = ux; // perpendicular
      let rungs = '';
      for (let i = 0; i < 4; i++) {
        const t = (i - 2.1) * C * 0.34;
        const half = C * (0.52 - i * 0.07);
        const rx0 = ex + ux * t, ry0 = ey + uy * t;
        rungs += `<line x1="${(rx0 - px2 * half).toFixed(1)}" y1="${(ry0 - py2 * half).toFixed(1)}" x2="${(rx0 + px2 * half).toFixed(1)}" y2="${(ry0 + py2 * half).toFixed(1)}"/>`;
      }
      entranceEraser = opening(roomById.get(e.room), ex, ey,
        Math.sign(e.x - e.outside[0]), Math.sign(e.y - e.outside[1]));
      entranceSvg = `<g class="map-entrance">${rungs}</g>`;
      }

      return `<svg class="dungeon-map ${cave ? 'is-cave' : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Dungeon map">
        <defs>
          <clipPath id="dmrooms${li}">${clip}</clipPath>
          <!-- everything that is not a room or a room's wall -->
          <mask id="dmouter${li}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
            <rect width="${W}" height="${H}" fill="#fff"/>
            <g fill="#000" stroke="#000" stroke-width="${WALL}" stroke-linejoin="round">${clip}</g>
          </mask>
        </defs>
        <rect width="${W}" height="${H}" fill="var(--map-page)"/>
        <g class="map-crag">${crag}</g>
        ${corridorInk}${corridorFloor}
        ${roomsSvg}${waterSvg}
        <g clip-path="url(#dmrooms${li})" class="map-grid">${grid}</g>
        <g class="map-labels-over">${player ? '' : rooms.map(r => {
          const tint = ROLE_TINT[r.role];
          const lx = (r.x + r.w / 2) * C, ly = (r.y + r.h / 2) * C;
          const rr = r.id.length > 2 ? 8.5 : 7;
          return `<circle cx="${lx}" cy="${ly}" r="${rr}" class="map-badge" ${tint ? `style="stroke:${tint}"` : ''}/>
            <text x="${lx}" y="${(ly + 3).toFixed(1)}" class="map-label">${esc(r.id)}</text>`;
        }).join('')}</g>
        ${doorErasers}${entranceEraser}
        <!-- The hallways draw themselves again, over the openings but masked
             to what lies outside the rooms, so an opening can only ever take
             something off the room it belongs to. Whatever it reaches past
             the room's skin the hallway simply puts back. -->
        <g mask="url(#dmouter${li})">${corridorInk}${corridorFloorTop}</g>
        ${hallDressing}
        ${doorGlyphs}${bridgeSvg}${passageSvg}${entranceSvg}
      </svg>`;
      };

      // a level renders once per campaign, wherever it is first wanted:
      // background warm-up, DM view and player export all share the copy
      const levelHTML = (mm, li) => {
        const k = `${campaign?.id}|${elt.id}|${li}|${player ? 'p' : 'dm'}`;
        let h = levelCache.get(k);
        if (h === undefined) { h = renderLevel(mm, li); levelCache.set(k, h); }
        return h;
      };
      if (onlyLevel != null) { if (maps[onlyLevel]) levelHTML(maps[onlyLevel], onlyLevel); return ''; }

      const lvlName = (li) => `Level ${li + 1}`;
      const wtr = maps.find(mm => mm.water)?.water;
      const legend = player ? '' : `<p class="small faint">1 square = ${maps[0].grid} ft. The stairs are the way in; S is a secret door. Click a room to jump to its key. Badge rings: red = fight, gold = the lair, green = treasure, blue = trap or puzzle.${wtr ? (wtr.kind === 'stream' ? ' The shaded band is a stream; planks mark bridges.' : ' The dark crack is a chasm; planks mark bridges.') : ''}${multi ? ' The boxed stair on each level is the same stair: down on one, up on the other.' : ''}</p>`;
      // The player's sheet stacks the levels, since paper has no tabs.
      if (player) return maps.map((mm, li) => levelHTML(mm, li)).join('');

      const panels = maps.map((mm, li) => {
        const drawn = levelHTML(mm, li);
        return `<div class="map-panel" data-level="${li}"${li ? ' hidden' : ''}>
          <div class="map-wrap">${drawn}
            <div class="map-side">
              ${mapKeyPanel(drawn, mm.grid || 5)}
              <div class="map-zoom">
                <button class="btn small" data-zoom="in" title="Zoom in" aria-label="Zoom in">+</button>
                <button class="btn small" data-zoom="out" title="Zoom out" aria-label="Zoom out">&minus;</button>
                <button class="btn small" data-zoom="reset" title="Fit the whole level" aria-label="Fit the whole level">Fit</button>
              </div>
            </div>
          </div>
        </div>`;
      }).join('');

      // The wandering table rides along as one more tab: it belongs to the
      // dungeon the way a level does, and the tab row is where the eye
      // already looks for what the map has to say.
      const wanderPanel = !elt.wandering ? '' : `
        <div class="map-panel" data-level="${maps.length}" hidden>
          <div class="wander-panel">
            <h3>Wandering (d6, each half hour of dawdling or after loud noise)</h3>
            <table class="data"><tbody>${elt.wandering.map(r =>
              `<tr><td>${esc(r.range)}</td><td>${esc(r.text)}</td></tr>`).join('')}</tbody></table>
          </div>
        </div>`;

      // One level at a time, starting at the top. Walking a stair switches
      // the tab for you, so the map keeps up with where the party is.
      const tabs = (multi || elt.wandering) ? `<div class="map-tabs" role="tablist">${maps.map((mm, li) =>
        `<button class="btn small map-tab${li ? '' : ' is-active'}" data-level="${li}" role="tab" aria-selected="${li ? 'false' : 'true'}">${lvlName(li)}</button>`).join('')}${
        elt.wandering ? `<button class="btn small map-tab" data-level="${maps.length}" role="tab" aria-selected="false">Wandering</button>` : ''}</div>` : '';

      return `<div class="map-levels">${tabs}${panels}${wanderPanel}</div>${legend}`;
    };

    // The player's copy as a standalone file: parchment ink whatever the app
    // theme, styles inlined so it opens anywhere, nothing on it a player
    // should not see.
    const PLAYER_MAP_CSS = `
      .map-crag path { fill: none; stroke: var(--map-hatch); stroke-width: 1.2; stroke-linecap: round; }
      .map-floor { fill: var(--map-floor); stroke: var(--map-ink); stroke-width: 2.6; stroke-linejoin: round; }
      .map-grid line { stroke: var(--map-grid); stroke-width: 1; }
      .is-cave .map-grid line { stroke-width: 0.6; }
      .map-eraser { fill: var(--map-floor); }
      .map-door { fill: var(--map-floor); stroke: var(--map-ink); stroke-width: 1.6; }
      .map-entrance line { stroke: var(--map-ink); stroke-width: 2; fill: none; stroke-linecap: round; }
      .map-column { fill: var(--map-ink); }
      .map-furn { fill: var(--map-floor); stroke: var(--map-ink); stroke-width: 1.4; }
      .map-furn-line { stroke: var(--map-ink); stroke-width: 1.2; }
      .map-rubble { fill: var(--map-ink); opacity: 0.75; }
      .map-stipple { fill: var(--map-ink); opacity: 0.35; }
      .map-pool { fill: var(--map-water); stroke: var(--map-ink); stroke-width: 1.3; }
      .map-bridge line { stroke: var(--map-ink); stroke-width: 1.7; stroke-linecap: round; }
      .map-stair line { stroke: var(--map-ink); stroke-width: 1.5; }`;
    // The DM's copy carries everything the player's leaves off, so it needs
    // the ink for the parts that only exist on this one.
    const DM_MAP_CSS = `${PLAYER_MAP_CSS}
      .map-badge { fill: var(--map-floor); stroke: var(--map-ink); stroke-width: 1.4; }
      .map-label { fill: var(--map-ink); font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 9px;
        font-weight: 700; text-anchor: middle; }
      .map-secret { fill: var(--map-ink); font-family: ui-monospace, Menlo, Consolas, monospace;
        font-size: 8px; font-weight: 700; text-anchor: middle; }
      .map-hazard path, .map-hazard circle { fill: var(--map-floor); stroke: var(--map-ink); stroke-width: 1.5; }
      .map-hazard circle:last-of-type { fill: var(--map-ink); stroke: none; }
      .map-hazard.is-secret circle { fill: var(--map-floor); stroke: var(--map-ink); }`;

    // The key. Every entry is drawn with the same markup and the same
    // classes as the thing it stands for, so a symbol on the key cannot
    // drift away from the symbol on the map. Which entries appear is read
    // back off the finished drawing rather than guessed from the data: the
    // player's copy leaves out everything behind a secret door, so its key
    // has to leave that out too, and the only thing that knows for certain
    // what survived is the markup itself.
    const KEY_ROWS = [
      { id: 'room', find: (t) => t.includes('class="map-floor"'), label: 'Room or chamber',
        art: '<rect x="3" y="3" width="18" height="12" class="map-floor"/>' },
      { id: 'passage', find: (t) => t.includes('<polyline'), label: 'Passage',
        art: '<line x1="0" y1="9" x2="24" y2="9" stroke="var(--map-ink)" stroke-width="14"/>'
           + '<line x1="0" y1="9" x2="24" y2="9" stroke="var(--map-floor)" stroke-width="10"/>' },
      { id: 'door', find: (t) => t.includes('class="map-door"'), label: 'Door',
        art: '<line x1="0" y1="9" x2="24" y2="9" stroke="var(--map-ink)" stroke-width="2.6"/>'
           + '<rect x="7" y="5.5" width="10" height="7" class="map-door"/>' },
      { id: 'secret', dm: true, label: 'Secret door',
        find: (t) => (t.match(/class="map-secret"/g) || []).length > (t.match(/class="map-hazard is-secret"/g) || []).length,
        art: '<line x1="0" y1="9" x2="24" y2="9" stroke="var(--map-ink)" stroke-width="2.6"/>'
           + '<rect x="7" y="5.5" width="10" height="7" class="map-door"/><text x="12" y="11.6" class="map-secret">S</text>' },
      { id: 'wayin', find: (t) => t.includes('class="map-entrance"'), label: 'The way in, stairs down',
        art: `<g class="map-entrance">${[0, 1, 2, 3].map(i2 => {
          const x = 5 + i2 * 4.6, h = 6.4 - i2 * 1.1;
          return `<line x1="${x}" y1="${(9 - h).toFixed(1)}" x2="${x}" y2="${(9 + h).toFixed(1)}"/>`;
        }).join('')}</g>` },
      { id: 'stair', find: (t) => t.includes('class="map-stair"'), label: 'Stair to another level',
        art: '<rect x="4" y="3" width="16" height="12" class="map-furn"/>'
           + '<g class="map-stair"><line x1="8" y1="3" x2="8" y2="15"/><line x1="12" y1="3" x2="12" y2="15"/><line x1="16" y1="3" x2="16" y2="15"/></g>' },
      { id: 'stream', find: (t) => t.includes('class="map-waterway"') && t.includes('stroke="var(--map-water)"'), label: 'Stream',
        art: '<line x1="0" y1="9" x2="24" y2="9" stroke="var(--map-ink)" stroke-width="12"/>'
           + '<line x1="0" y1="9" x2="24" y2="9" stroke="var(--map-water)" stroke-width="8.6"/>' },
      { id: 'chasm', find: (t) => t.includes('class="map-waterway"') && t.includes('stroke="var(--map-page)"'), label: 'Chasm',
        art: '<line x1="0" y1="9" x2="24" y2="9" stroke="var(--map-ink)" stroke-width="12"/>'
           + '<line x1="0" y1="9" x2="24" y2="9" stroke="var(--map-page)" stroke-width="8.6"/>' },
      { id: 'bridge', find: (t) => t.includes('class="map-bridge"'), label: 'Plank bridge',
        art: '<line x1="0" y1="9" x2="24" y2="9" stroke="var(--map-floor)" stroke-width="10"/>'
           + '<g class="map-bridge"><line x1="7" y1="4" x2="7" y2="14"/><line x1="12" y1="4" x2="12" y2="14"/><line x1="17" y1="4" x2="17" y2="14"/></g>' },
      { id: 'column', find: (t) => t.includes('class="map-column"'), label: 'Column',
        art: '<circle cx="12" cy="9" r="3.6" class="map-column"/>' },
      { id: 'furn', find: (t) => t.includes('class="map-furn"'), label: 'Furniture: altar, table, chest or dais',
        art: '<rect x="5" y="4" width="14" height="10" class="map-furn"/>' },
      { id: 'pool', find: (t) => t.includes('class="map-pool"'), label: 'Pool or basin',
        art: '<path d="M4,9 C4,4.5 20,4.5 20,9 C20,13.5 4,13.5 4,9 Z" class="map-pool"/>' },
      { id: 'rubble', find: (t) => t.includes('class="map-rubble"'), label: 'Rubble and debris',
        art: [[7, 6, 1.5], [12, 10, 1.9], [17, 7, 1.3], [10, 13, 1.2], [16, 12, 1.6]]
          .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" class="map-rubble"/>`).join('') },
      { id: 'badge', dm: true, find: (t) => t.includes('class="map-badge"'), label: 'Room number, keyed in the notes',
        art: '<circle cx="12" cy="9" r="7" class="map-badge"/><text x="12" y="12.2" class="map-label">1</text>' },
      { id: 'trap', dm: true, find: (t) => t.includes('class="map-hazard"'), label: 'Trap in the passage',
        art: '<g class="map-hazard"><path d="M12,3.4 L17.6,9 L12,14.6 L6.4,9 Z"/><circle cx="12" cy="9" r="1.4"/></g>' },
      { id: 'hidden', dm: true, find: (t) => t.includes('class="map-hazard is-secret"'), label: 'Way that is not obvious',
        art: '<g class="map-hazard is-secret"><circle cx="12" cy="9" r="6"/><text x="12" y="12" class="map-secret">S</text></g>' },
    ];

    // The same key, beside the drawing rather than under it. Read off the
    // level actually on show, so a two-level site does not claim a stair on
    // the level that has none.
    const mapKeyPanel = (src, gridFt) => {
      const rows = KEY_ROWS.filter(r => r.find(src));
      if (!rows.length) return '';
      return `<details class="map-key" open>
        <summary>Key <span class="faint">1 sq = ${gridFt} ft</span></summary>
        <div class="map-key-rows">${rows.map(r => `<div class="map-key-row">
          <svg class="dungeon-map map-swatch" viewBox="0 0 24 18" width="24" height="18" aria-hidden="true">${r.art}</svg>
          <span>${esc(r.label)}</span></div>`).join('')}</div>
      </details>`;
    };

    const mapKeySVG = (src, W, top, player, gridFt) => {
      const rows = KEY_ROWS.filter(r => (!r.dm || !player) && r.find(src));
      // small: the key is a reference, not the point of the sheet
      const SC = 0.66, ROW = 16;
      const cols = Math.max(1, Math.min(4, Math.floor(W / 156)));
      const colW = W / cols;
      const lines = Math.ceil(rows.length / cols);
      const body = rows.map((r, i) => {
        const x = 9 + (i % cols) * colW, y = top + 19 + Math.floor(i / cols) * ROW;
        return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
          <g transform="scale(${SC})">${r.art}</g>
          <text x="${(24 * SC + 5).toFixed(1)}" y="${(9 * SC + 3).toFixed(1)}" style="font:400 8.5px Georgia, serif; fill: var(--map-ink)">${esc(r.label)}</text></g>`;
      }).join('');
      const h = 19 + lines * ROW + 9;
      return {
        h,
        svg: `<line x1="9" y1="${top}" x2="${W - 9}" y2="${top}" stroke="var(--map-ink)" stroke-width="0.7" opacity="0.4"/>
          <text x="9" y="${top + 12}" style="font:600 9.5px Georgia, serif; fill: var(--map-ink)">Key
            <tspan style="font:400 8.5px Georgia, serif" opacity="0.75">&#8212; 1 square = ${gridFt} ft</tspan></text>
          ${body}`,
      };
    };

    const downloadMap = (elt, player) => {
      const src = dungeonMapSVG(elt, player);
      // Only the drawn levels. The DM view's markup also holds the key
      // panel, whose swatches are little svgs of their own: sweeping every
      // svg into the sheet stacked the swatches as extra levels, and
      // injecting a width into tags that already carry one made the file
      // invalid XML.
      const parts = (src.match(/<svg[\s\S]*?<\/svg>/g) || []).filter(p2 => !p2.includes('map-swatch'));
      if (!parts.length) return toast('There is no drawn map to export', 'danger');
      const VARS = '--map-page:#e4dccb;--map-floor:#f7f2e7;--map-ink:#191309;--map-hatch:#2b2214;--map-grid:rgba(25,19,9,.13);--map-water:#b9cdd2';
      const CSS = player ? PLAYER_MAP_CSS : DM_MAP_CSS;
      const dims = parts.map(p2 => {
        const m2 = p2.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
        return { w: +m2[1], h: +m2[2] };
      });
      // wide enough for the key to sit under the drawing without crowding
      const W2 = Math.max(360, ...dims.map(d2 => d2.w));
      const multi = parts.length > 1;
      let y2 = 8;
      // levels stack into one sheet, each under its name
      const inner = parts.map((p2, i2) => {
        let out = '';
        if (multi) {
          out += `<text x="${W2 / 2}" y="${y2 + 14}" text-anchor="middle" style="font:600 13px Georgia, serif; fill: var(--map-ink)">Level ${i2 + 1}</text>`;
          y2 += 22;
        }
        out += p2.replace('<svg ', `<svg x="${((W2 - dims[i2].w) / 2).toFixed(1)}" y="${y2}" width="${dims[i2].w}" height="${dims[i2].h}" `);
        y2 += dims[i2].h + (multi ? 24 : 0);
        return out;
      }).join('');

      const grid = (elt.map?.levels?.[0] || elt.map)?.grid || 5;
      const key = mapKeySVG(src, W2, y2 + 14, player, grid);
      const H2 = y2 + 14 + key.h;
      // a real size as well as a viewBox: a file with only a viewBox opens at
      // whatever default size the viewer feels like
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" style="${VARS}" class="dungeon-map"`
        + ` width="${W2}" height="${H2.toFixed(1)}" viewBox="0 0 ${W2} ${H2.toFixed(1)}">`
        + `<style>${CSS}</style><rect width="${W2}" height="${H2.toFixed(1)}" fill="var(--map-page)"/>${inner}${key.svg}</svg>`;

      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${elt.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${player ? 'player' : 'dm'}-map.svg`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(player ? 'Player map downloaded; safe to share as-is' : 'DM map downloaded; keys, secrets and traps included');
    };

    // The town on paper: the same page, ink and floor as the dungeon maps,
    // so a campaign's sites read as one hand's work. The DM's copy numbers
    // the spots where the campaign's own locations live; the player's shows
    // the town and nothing it should not.
    const townMapSVG = (elt, player = false) => {
      const t = elt.townMap;
      if (!t) return '';
      // v2 towns come from the shared renderer in town-map.js, so the app
      // and the exports can never disagree; the v1 path below stays for the
      // campaigns saved while towns were still rings and rays.
      if (t.v === 2) {
        const legend2 = player || !elt.townSpots?.length ? '' : `<ol class="small town-legend">${
          elt.townSpots.map(x => `<li>${esc(x)}</li>`).join('')}</ol>`;
        return renderTownSVG(t, { player }) + legend2;
      }
      const poly = (pts) => pts.map(([x, y]) => `${x},${y}`).join(' ');
      const roads = t.roads.map(r => `<polyline points="${poly(r)}" fill="none" stroke="var(--map-ink)" stroke-width="9.5" stroke-linecap="round" stroke-linejoin="round"/>`).join('')
        + t.roads.map(r => `<polyline points="${poly(r)}" fill="none" stroke="var(--map-floor)" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
      const plaza = `<polygon points="${poly(t.plaza)}" fill="var(--map-floor)" stroke="var(--map-ink)" stroke-width="1.6"/>`;
      const houses = t.buildings.map(b =>
        `<polygon points="${poly(b.pts)}" fill="var(--map-floor)" stroke="var(--map-ink)" stroke-width="1.4"/>`).join('');
      const wall = !t.wall ? '' : `<polygon points="${poly(t.wall)}" fill="none" stroke="var(--map-ink)" stroke-width="3.6" stroke-linejoin="round"/>`
        + t.gates.map(([gx, gy]) => `<rect x="${gx - 4.5}" y="${gy - 4.5}" width="9" height="9" fill="var(--map-floor)" stroke="var(--map-ink)" stroke-width="1.6"/>`).join('');
      const trees = t.trees.map(([tx, ty, tr]) =>
        `<circle cx="${tx}" cy="${ty}" r="${tr}" fill="none" stroke="var(--map-hatch)" stroke-width="1.1"/>`).join('');
      const spots = player ? '' : (t.spots || []).map(sp =>
        `<g><circle cx="${sp.x}" cy="${sp.y}" r="7" class="map-badge"/><text x="${sp.x}" y="${sp.y + 3}" class="map-label">${sp.n}</text></g>`).join('');
      const svg = `<svg class="dungeon-map is-town" viewBox="0 0 ${t.w} ${t.h}" role="img" aria-label="Town map">
        <rect width="${t.w}" height="${t.h}" fill="var(--map-page)"/>
        ${trees}${roads}${plaza}${wall}${houses}${spots}
      </svg>`;
      const legend = player || !elt.townSpots?.length ? '' : `<ol class="small town-legend">${
        elt.townSpots.map(x => `<li>${esc(x)}</li>`).join('')}</ol>`;
      return svg + legend;
    };

    const downloadTownMap = (elt, player) => {
      const t = elt.townMap;
      if (!t) return toast('This settlement predates town maps; generate a new campaign for one', 'danger');
      const body = townMapSVG(elt, player);
      const svgOnly = (body.match(/<svg[\s\S]*?<\/svg>/) || [''])[0];
      const VARS = '--map-page:#e4dccb;--map-floor:#f7f2e7;--map-ink:#191309;--map-hatch:#2b2214;--map-water:#b9cdd2';
      const legendRows = player ? [] : (elt.townSpots || []);
      const legendH = legendRows.length ? 22 + legendRows.length * 15 : 0;
      const W2 = Math.max(t.w, 340), H2 = t.h + legendH;
      const legend = legendRows.map((x, i) =>
        `<text x="12" y="${t.h + 18 + i * 15}" style="font:400 11px Georgia, serif; fill: var(--map-ink)">${i + 1}. ${esc(x)}</text>`).join('');
      const inner = svgOnly.replace('<svg class="dungeon-map is-town"',
        `<svg x="${((W2 - t.w) / 2).toFixed(1)}" width="${t.w}" height="${t.h}"`);
      const CSS = '.map-badge { fill: var(--map-floor); stroke: var(--map-ink); stroke-width: 1.4; }'
        + '.map-label { fill: var(--map-ink); font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 9px; font-weight: 700; text-anchor: middle; }';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" style="${VARS}" width="${W2}" height="${H2}" viewBox="0 0 ${W2} ${H2}">`
        + `<style>${CSS}</style><rect width="${W2}" height="${H2}" fill="var(--map-page)"/>${inner}${legend}</svg>`;
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${elt.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${player ? 'player' : 'dm'}-town.svg`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(player ? 'Player town map downloaded; safe to share as-is' : 'DM town map downloaded; numbered spots included');
    };

    // The old dot-graph plan, kept for campaigns saved before rooms had
    // real geometry.
    const legacyMapSVG = (elt) => {
      const ns = elt.nodes || [];
      if (ns.length < 3) return '';
      const cols = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(ns.length * 1.6))));
      const pos = ns.map((n, i) => ({
        x: 50 + (i % cols) * 100 + ((Math.floor(i / cols) % 2) ? 50 : 0),
        y: 45 + Math.floor(i / cols) * 85,
      }));
      const idx = new Map(ns.map((n, i) => [n.id, i]));
      const w = 100 + cols * 100;
      const h = 45 + Math.ceil(ns.length / cols) * 85;
      // exits are symmetric, so draw each connection once rather than twice
      const lines = ns.flatMap((n, i) => n.exits.map(e => {
        const j = idx.get(e);
        return (j == null || j < i) ? '' : `<line x1="${pos[i].x}" y1="${pos[i].y}" x2="${pos[j].x}" y2="${pos[j].y}"/>`;
      })).join('');
      const dots = ns.map((n, i) => `<g class="mn ${esc(n.role)}">
        <circle cx="${pos[i].x}" cy="${pos[i].y}" r="17"/>
        <text x="${pos[i].x}" y="${pos[i].y + 4}">${esc(n.id)}</text>
        <title>${esc(n.id)}: ${esc(n.roleLabel)}</title></g>`).join('');
      return `<svg class="story-map" viewBox="0 0 ${w} ${h}" role="img" aria-label="Site plan">${lines}${dots}</svg>
        <p class="small faint">Site plan: the dashed ring is the way in; red rings are encounters, gold is the lair, green is treasure, blue is a trap or puzzle. Hover an area for its role.</p>`;
    };

    const leaderHTML = (b) => !b.leader ? '' : `<p class="small"><b>Led by</b> ${esc(b.leader.name)}${b.leader.statSuggestion ? `, use <a href="javascript:void 0" data-mon="${esc(b.leader.statSuggestion.slug)}">${esc(b.leader.statSuggestion.name)}</a> (CR ${esc(b.leader.statSuggestion.cr)})` : ''}${b.leader.note ? `. ${esc(b.leader.note)}` : ''}</p>`;

    const encounterHTML = (b) => `
      <div class="beat encounter">
        <div class="beat-head"><b>${esc(b.title)}</b>
          <span class="pill ${b.difficulty === 'deadly' ? 'danger' : b.difficulty === 'hard' ? 'accent' : 'info'}">${esc(b.difficulty)}</span>
          <span class="pill">${b.xp.toLocaleString()} adj XP</span>
          <button class="btn small" data-run="${esc(JSON.stringify(b.creatures))}">Run</button>
          ${b.id ? `<button class="btn small" data-reroll-enc="${esc(b.id)}" title="Build a different fight at the same budget">Reroll fight</button>` : ''}
        </div>
        <p>${b.creatures.map(c => creatureLineHTML(b, c)).join(' ')}</p>
        ${leaderHTML(b)}
        <p class="small"><b>Objective</b> ${esc(b.objective)}<br>
          <b>Tactics</b> ${esc(b.tactics)}<br>
          <b>Morale</b> ${esc(b.morale)}<br>
          <b>If avoided</b> ${esc(b.ifAvoided)}</p>
        ${b.treasure?.length ? `<p class="small"><b>Treasure</b> ${treasureHTML(b.treasure)}</p>` : ''}
      </div>`;

    const treasureHTML = (list) => list.map(t => t.kind === 'magic'
      ? `<a href="javascript:void 0" data-item="${esc(t.slug)}">${esc(t.name)}</a> <span class="pill">${esc(t.rarity)}</span>`
      : esc(t.name)).join('; ');

    const beatHTML = (b) => {
      if (b.kind === 'encounter') return encounterHTML(b);
      if (b.kind === 'trap') return `<div class="beat trap"><b>Trap: ${esc(b.name)}</b>
        ${playerBox(`They notice: ${esc(b.telegraph)}.`, 'Players perceive')}
        <p class="small"><b>Detect</b> ${esc(b.detect)}. <b>Disarm</b> ${esc(b.disarm)}.<br>
        <b>Effect</b> ${esc(b.effect)}<br><b>Consequence</b> ${esc(b.consequence)}</p></div>`;
      if (b.kind === 'puzzle') return `<div class="beat puzzle"><b>Puzzle: ${esc(b.name)}</b>
        ${playerBox(esc(b.premise), 'Players perceive')}
        <p class="small"><b>Solution</b> ${esc(b.solution)}<br>
        <b>Alternate route</b> ${esc(b.alternate)}<br><b>On failure</b> ${esc(b.failure)}</p></div>`;
      if (b.kind === 'treasure') return `<div class="beat treasure"><b>Treasure</b> <span class="small">${treasureHTML(b.treasure)}</span></div>`;
      if (b.kind === 'clue') return `<div class="beat clue"><b>Clue &rarr; ${esc(b.pointsToTitle)}</b> ${playerBox(esc(b.text), 'Players find')}</div>`;
      if (b.kind === 'objective') return `<div class="beat objective"><b>${esc(b.title)}</b> <span class="small">${esc(b.text)}</span></div>`;
      return `<div class="beat"><b>${esc(b.title)}</b> <span class="small">${esc(b.text || '')}</span></div>`;
    };

    // Every way out of a room, as a button that opens the room it leads to.
    // Exits are symmetric in the data, so this is the full list, not just
    // the ones pointing deeper in.
    const exitsHTML = (elt, n) => {
      if (!n.exits.length) return '<p class="small faint">No other way out of this room.</p>';
      const byId = new Map((elt.nodes || []).map(x => [x.id, x]));
      return `<p class="small exit-row"><b>Ways out:</b> ${n.exits.map(id => {
        // the doorway the party came in by, which is also the way back out
        if (id === 'outside') {
          return `<button class="exit-link is-outside" data-goto-approach="1" title="Back out the way they came in">outside <span class="faint">the way in</span></button>`;
        }
        const dest = byId.get(id);
        return `<button class="exit-link" data-goto="${esc(id)}" title="${esc(dest ? dest.roleLabel : 'elsewhere')}">${esc(id)}${
          dest ? ` <span class="faint">${esc(dest.roleLabel)}</span>` : ''}</button>`;
      }).join('')}</p>`;
    };

    // Which room is open survives a redraw, so rerolling a fight inside a
    // room leaves you looking at that room rather than back at the top.
    const nodesHTML = (elt) => {
      const remembered = openArea && openArea.eltId === elt.id ? openArea.nodeId : null;
      return (elt.nodes || []).map((n, i) => `
      <details class="story-area" id="area-${esc(n.id)}" data-elt="${esc(elt.id)}" data-node="${esc(n.id)}" ${(remembered ? n.id === remembered : i === 0) ? 'open' : ''}>
        <summary><b>${esc(n.id)}</b> ${esc(n.roleLabel)}
          <span class="small faint">${esc(n.light)}${n.exits.length ? ` &middot; ${n.exits.length} way${n.exits.length === 1 ? '' : 's'} out: ${esc(n.exits.join(', '))}` : ' &middot; dead end'}</span>
          ${n.beats.map(b => `<span class="pill ${b.kind === 'encounter' ? 'danger' : ''}">${esc(b.kind)}</span>`).join('')}
        </summary>
        ${playerBox(`${esc(n.description)}${n.dressing ? ` ${esc(n.dressing)}` : ''}`)}
        ${n.fixtures?.length ? `<p class="small"><b>Also here</b> ${n.fixtures.map(esc).join(', ')}</p>` : ''}
        ${n.secret ? dmBox(`<p class="small"><b>Hidden here</b> ${esc(n.secret.name)}, found on ${esc(n.secret.find)}; ${esc(n.secret.open)}. It holds ${esc(n.secret.holds)}.</p>`) : ''}
        ${exitsHTML(elt, n)}
        ${n.beats.map(beatHTML).join('')}
      </details>`).join('');
    };

    /* ---- panning and zooming a drawn level ------------------------------
       The SVG's viewBox is the camera: narrowing it magnifies, moving it
       pans. Every move is eased over a few frames so the map slides rather
       than jumping, which matters most when a click reframes a room. Plain
       wheel scrolling is left to the page; zooming asks for Ctrl or the
       buttons, so the map cannot swallow a scroll on the way past. */
    const MAX_ZOOM = 6;
    const camOf = (wrap) => {
      const svg = wrap?.querySelector('svg.dungeon-map');
      return svg && svg.__cam ? svg.__cam : null;
    };

    const frameRoom = (wrap, target, minSpan = 0) => {
      const cam = camOf(wrap);
      if (!cam || !target) return;
      let bb;
      try { bb = target.getBBox(); } catch { return; }
      if (!bb.width || !bb.height) return;
      // the room should sit in the middle and own a good share of the frame
      const fill = 0.42;
      const ratio = cam.home.w / cam.home.h;
      const bw = Math.max(bb.width, minSpan), bh = Math.max(bb.height, minSpan);
      let w = Math.max(bw / fill, (bh / fill) * ratio);
      w = Math.min(cam.home.w, Math.max(cam.home.w / MAX_ZOOM, w));
      cam.to({ x: bb.x + bb.width / 2 - w / 2, y: bb.y + bb.height / 2 - (w / ratio) / 2, w });
    };

    const wireMaps = (box) => {
      box.querySelectorAll('.map-wrap').forEach(wrap => {
        const svg = wrap.querySelector('svg.dungeon-map');
        if (!svg || svg.__cam) return;
        const [hx, hy, hw, hh] = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
        if (!hw || !hh) return;
        const home = { x: hx, y: hy, w: hw, h: hh };
        const ratio = hw / hh;
        let cur = { ...home };
        let raf = 0;

        const clamp = (v) => {
          const w = Math.min(home.w, Math.max(home.w / MAX_ZOOM, v.w));
          const h = w / ratio;
          // keep the drawing in view: never scroll the page off the edge
          const x = Math.min(home.x + home.w - w, Math.max(home.x, v.x));
          const y = Math.min(home.y + home.h - h, Math.max(home.y, v.y));
          return { x, y, w, h };
        };
        const paint = () => svg.setAttribute('viewBox', `${cur.x.toFixed(2)} ${cur.y.toFixed(2)} ${cur.w.toFixed(2)} ${cur.h.toFixed(2)}`);
        const set = (v) => { cur = clamp(v); paint(); };
        const to = (v) => {
          const goal = clamp({ ...cur, ...v });
          cancelAnimationFrame(raf);
          // Nothing to ease towards on a tab nobody is looking at, and easing
          // is exactly what someone asking for reduced motion does not want:
          // in both cases go straight there.
          if (document.hidden || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            cur = goal; paint();
            wrap.classList.toggle('is-zoomed', cur.w < home.w - 0.5);
            return;
          }
          const from = { ...cur };
          const t0 = performance.now();
          const step = (now) => {
            const k = Math.min(1, (now - t0) / 260);
            const e = 1 - Math.pow(1 - k, 3);
            cur = { x: from.x + (goal.x - from.x) * e, y: from.y + (goal.y - from.y) * e, w: from.w + (goal.w - from.w) * e, h: from.h + (goal.h - from.h) * e };
            paint();
            if (k < 1) raf = requestAnimationFrame(step);
            else wrap.classList.toggle('is-zoomed', cur.w < home.w - 0.5);
          };
          raf = requestAnimationFrame(step);
        };
        // zoom about a point given in viewBox units
        const zoomAt = (factor, px, py) => {
          const w = Math.min(home.w, Math.max(home.w / MAX_ZOOM, cur.w * factor));
          const k = w / cur.w;
          to({ x: px - (px - cur.x) * k, y: py - (py - cur.y) * k, w });
        };
        svg.__cam = { home, to, set, zoomAt, get cur() { return cur; } };

        const atClient = (ev) => {
          const r = svg.getBoundingClientRect();
          return [cur.x + ((ev.clientX - r.left) / r.width) * cur.w, cur.y + ((ev.clientY - r.top) / r.height) * cur.h];
        };

        wrap.querySelector('[data-zoom="in"]')?.addEventListener('click', () => zoomAt(1 / 1.5, cur.x + cur.w / 2, cur.y + cur.h / 2));
        wrap.querySelector('[data-zoom="out"]')?.addEventListener('click', () => zoomAt(1.5, cur.x + cur.w / 2, cur.y + cur.h / 2));
        wrap.querySelector('[data-zoom="reset"]')?.addEventListener('click', () => to(home));

        wrap.addEventListener('wheel', (ev) => {
          if (!ev.ctrlKey && !ev.metaKey) return;   // the page keeps plain scrolling
          ev.preventDefault();
          const [px, py] = atClient(ev);
          zoomAt(ev.deltaY > 0 ? 1.22 : 1 / 1.22, px, py);
        }, { passive: false });

        // drag to pan once there is somewhere to pan to
        let drag = null;
        svg.addEventListener('pointerdown', (ev) => {
          if (cur.w >= home.w - 0.5 || ev.button !== 0) return;
          // Deliberately no pointer capture yet. Capturing here would make the
          // browser retarget the click that follows to this <svg>, so it would
          // never reach the room's own handler and a zoomed-in map would stop
          // being clickable. Capture belongs to a drag, and there is no drag
          // until the pointer has actually moved.
          drag = { x: ev.clientX, y: ev.clientY, ox: cur.x, oy: cur.y, moved: false, id: ev.pointerId };
        });
        svg.addEventListener('pointermove', (ev) => {
          if (!drag) return;
          if (!drag.moved) {
            if (Math.abs(ev.clientX - drag.x) + Math.abs(ev.clientY - drag.y) <= 3) return;
            drag.moved = true;
            wrap.classList.add('is-dragging');
            try { svg.setPointerCapture(drag.id); } catch { /* pointer already gone */ }
          }
          const r = svg.getBoundingClientRect();
          const dx = ((ev.clientX - drag.x) / r.width) * cur.w;
          const dy = ((ev.clientY - drag.y) / r.height) * cur.h;
          cancelAnimationFrame(raf);
          set({ ...cur, x: drag.ox - dx, y: drag.oy - dy });
        });
        const endDrag = (ev) => {
          wrap.classList.remove('is-dragging');
          if (!drag) return;
          // a drag should not also count as clicking the room underneath
          if (drag.moved) {
            svg.__suppressClick = true;
            setTimeout(() => { svg.__suppressClick = false; }, 0);
            try { svg.releasePointerCapture(drag.id); } catch { /* already gone */ }
          }
          drag = null;
        };
        svg.addEventListener('pointerup', endDrag);
        svg.addEventListener('pointercancel', endDrag);
        svg.addEventListener('click', (ev) => { if (svg.__suppressClick) { ev.stopPropagation(); ev.preventDefault(); } }, true);
        svg.addEventListener('dblclick', () => to(home));
      });
    };

    const elementHTML = (elt) => {
      const head = `<h2>${esc(elt.title)}</h2>
        <p class="muted">${esc(elt.subtitle)}. ${esc(elt.summary)}</p>
        ${elt.hazard ? `<p class="small"><b>Site hazard</b> ${esc(elt.hazard)}</p>` : ''}
        ${elt.alerts ? `<p class="small"><b>Alert state</b> ${esc(elt.alerts)}</p>` : ''}
        ${elt.objectiveNote?.length ? `<p class="small"><b>Holds</b> ${elt.objectiveNote.map(esc).join(' / ')}</p>` : ''}
        ${elt.freeClues?.length ? `<p class="small"><b>Clues placed here</b> ${elt.freeClues.map(esc).join(' / ')}</p>` : ''}`;

      // Wandering lives in a tab on the map for drawn dungeons; only the
      // old dot-plan campaigns still get it as a section of its own.
      const wanderingHTML = (elt.map?.rooms?.length || elt.map?.levels?.length) || !elt.wandering ? '' : `
        <h3 class="mt">Wandering (d6, each half hour of dawdling or after loud noise)</h3>
        <table class="data"><tbody>${elt.wandering.map(r =>
          `<tr><td>${esc(r.range)}</td><td>${esc(r.text)}</td></tr>`).join('')}</tbody></table>`;

      // What is between the rooms opens and closes like a room does, and is
      // reached the same way: from its own glyph or run on the map. No
      // header over them: each entry announces itself as a passage instead.
      const passagesHTML = !elt.passages?.length ? '' : `
        ${elt.passages.map((x, i) => {
          const pid = passageKey(x, i);
          const open = openArea && openArea.eltId === elt.id && openArea.nodeId === pid;
          return `<details class="story-area" id="area-${esc(pid)}" data-elt="${esc(elt.id)}" data-node="${esc(pid)}"${open ? ' open' : ''}>
            <summary><b>Passage: ${esc(x.name)}</b>
              <span class="small faint">between ${esc(x.between[0])} and ${esc(x.between[1])}</span>
              <span class="pill ${x.kind === 'trap' ? 'danger' : ''}">${esc(x.kind === 'trap' ? 'trap' : x.kind === 'hallway' ? 'passage' : 'hidden')}</span>
            </summary>
            ${x.kind === 'trap'
              ? `${playerBox(`They notice ${esc(x.telegraph)}.`, 'Players perceive')}
                 <p class="small"><b>Detect</b> ${esc(x.detect)}. <b>Disarm</b> ${esc(x.disarm)}.<br><b>Effect</b> ${esc(x.effect)}</p>`
              : x.kind === 'hallway'
                ? playerBox(esc(x.desc), 'Read aloud as they walk it')
                : dmBox(`<p class="small">Found on ${esc(x.find)}; ${esc(x.open)}. It holds ${esc(x.holds)}.</p>`)}
          </details>`;
        }).join('')}`;

      if (elt.type === 'dungeon') return `${head}
        ${elt.approach ? `<div id="dm-approach">${playerBox(esc(elt.approach), 'Read aloud outside, before they go in')}</div>` : ''}
        ${dungeonMapSVG(elt)}
        ${(elt.map?.rooms?.length || elt.map?.levels?.length) ? `<div class="row">
          <button class="btn small" id="dm-playermap" title="A standalone image with no keys or badges; secret doors and everything behind them are left off">Player map (SVG)</button>
          <button class="btn small" id="dm-dmmap" title="The same drawing as on screen: room numbers, secret doors, traps and furniture, as a standalone file">DM map (SVG)</button>
        </div>` : ''}
        ${wanderingHTML}<div class="mt">${nodesHTML(elt)}${passagesHTML}</div>`;

      if (elt.type === 'settlement') return `${head}
        ${elt.townMap ? `${townMapSVG(elt)}
        <div class="row"><button class="btn small" id="tm-playermap" title="The town with no numbered spots; safe to put in front of players">Player map (SVG)</button>
        <button class="btn small" id="tm-dmmap" title="The town with every campaign location numbered and keyed">DM map (SVG)</button></div>` : ''}
        <div class="grid-2 mt">
          <div><h3>Who runs it</h3><p class="small">${esc(elt.ruler)}</p>
            <h3>Services</h3><p class="small">${elt.services.map(esc).join(', ')}. The tavern is ${esc(elt.tavern)}.</p>
            <h3>Locations of interest</h3><ul class="small">${elt.locations.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
            <h3>While they are here</h3><p class="small">${esc(elt.event)}</p></div>
          <div><h3>Rumours</h3>
            <p class="small faint">The rumour text is player-facing; the true/false tags are yours alone.</p>
            <ul class="small">${elt.rumors.map(r => `<li><span class="player-inline">${esc(r.text)}</span> <span class="pill ${r.true ? 'success' : 'danger'}" title="DM only">${r.true ? 'true' : 'false'}</span></li>`).join('')}</ul>
            <h3>Roster</h3>${elt.roster.map(npcCardHTML).join('')}</div>
        </div>`;

      if (elt.type === 'region') return `${head}
        <h3 class="mt">Routes</h3>
        ${elt.legs.map(l => `<p class="small"><b>${esc(l.label)}</b>, ${l.days} days. ${esc(l.checks)}.<br>Complication: ${esc(l.complication)}</p>`).join('')}
        <h3>What the country looks like</h3><ul class="small">${elt.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
        <h3>Travel encounters (d6)</h3>
        <table class="data"><thead><tr><th>d6</th><th>Encounter</th><th>XP</th></tr></thead><tbody>
        ${elt.encounterTable.map(r => `<tr><td>${esc(r.range)}</td><td>${esc(r.text)}</td><td>${r.xp.toLocaleString()}</td></tr>`).join('')}
        </tbody></table>`;

      if (elt.type === 'event') return `${head}
        <h3 class="mt">Phases</h3>
        <ol>${elt.phases.map(p => `<li>${esc(p.text)}</li>`).join('')}</ol>
        <p><b>If it goes wrong</b> ${esc(elt.failure)}</p>
        ${elt.climaxEncounter ? `<h3>The fight, if it comes to one</h3>${encounterHTML({ ...elt.climaxEncounter, title: 'Climax encounter', objective: elt.objective, tactics: 'The event drives the tactics; terrain and the clock matter more than the numbers.', morale: 'Withdraws the moment the objective is out of reach.', ifAvoided: 'The event resolves without a fight, which is a legitimate outcome.' })}` : ''}`;

      if (elt.type === 'downtime') return `${head}
        <div class="card"><h3>What the party can do with the weeks</h3>
          <ul class="small">${elt.activities.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>
        <div class="card"><h3>Something to interrupt the quiet</h3>
          <ul class="small">${elt.complications.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>
        ${dmBox(`<p class="small"><b>Meanwhile</b> ${esc(elt.worldMoves)}</p>`)}`;

      if (elt.type === 'board') return `${head}
        ${elt.jobs.map(j => `<div class="card"><h3>${esc(j.name)}</h3>
          ${playerBox(`<b>The ask:</b> ${esc(j.ask)}<br><b>Pay:</b> ${esc(j.pay)}`, 'On the board')}
          ${dmBox(`<p class="small"><b>What it really is</b> ${esc(j.twist)}</p>`)}</div>`).join('')}
        <p class="small faint">${esc(elt.note)}</p>`;

      if (elt.type === 'siege') return `${head}
        <h3 class="mt">How the days go</h3>
        <ol>${elt.phases.map(x => `<li>${esc(x.text)}</li>`).join('')}</ol>
        <div class="card"><h3>Where they can be needed</h3>
          <ul class="small">${elt.assignments.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
          <p class="small faint">${esc(elt.note)}</p></div>
        ${elt.climaxEncounter ? `<h3>The breach</h3>${encounterHTML({ ...elt.climaxEncounter, title: 'The breach',
          objective: 'Hold the gap, or buy the time somebody else needs.',
          tactics: 'They come in waves and do not care about casualties; the terrain and the clock matter more than the numbers.',
          morale: 'They withdraw at dawn whatever happens, and count this as reconnaissance.',
          ifAvoided: 'The wall falls and the fight moves into the streets, which is worse for everyone but the attackers.' })}` : ''}`;

      if (elt.type === 'heist') return `${head}
        <h3 class="mt">How it runs</h3>
        <ol>${elt.phases.map(x => `<li>${esc(x.text)}</li>`).join('')}</ol>
        <div class="card"><h3>Ways in</h3>
          ${elt.waysIn.map(w => `<p class="small"><b>${esc(w.route)}</b><br><span class="muted">Costs: ${esc(w.cost)}</span></p>`).join('')}</div>
        ${dmBox(`<h3>What goes wrong</h3><ul class="small">${elt.complications.map(c => `<li>${esc(c)}</li>`).join('')}</ul>`)}`;

      if (elt.type === 'investigation') return `${head}
        ${elt.conclusions.map(c => `<div class="mt"><b>Conclusion</b> <span class="faint small">(DM only until earned)</span><br>${esc(c.text)}
          <ul class="small">${c.clues.map(x => `<li><span class="player-inline">${esc(x)}</span></li>`).join('')}</ul></div>`).join('')}`;

      return head;
    };

    // Two buttons every person on the page carries: drop them into the fight
    // that is running, or roll a different person into the same seat.
    const personActions = (kind, id, { reroll = true, rerollLabel = 'Reroll', rerollTip = '' } = {}) => `
      <div class="row person-actions">
        <button class="btn small" data-add-init="${esc(kind)}|${esc(id)}" title="Add them to the initiative tracker without disturbing the fight already on it">Add to initiative</button>
        ${reroll ? `<button class="btn small" data-person-reroll="${esc(kind)}|${esc(id)}" title="${esc(rerollTip)}">${esc(rerollLabel)}</button>` : ''}
      </div>`;

    // Top half is safe on a shared screen; the fenced block is where the role
    // tag lives too, since "Betrayer" next to a name is itself a spoiler.
    const npcCardHTML = (n) => `<div class="npc-card">
      <b>${esc(n.name)}</b>
      <span class="small faint">${esc(n.ancestry)} ${esc(n.occupation)}${n.where ? `, ${esc(n.where)}` : ''}</span>
      <p class="small">${esc(n.personality)}; ${esc(n.quirk)}.</p>
      ${dmBox(`<p class="small"><span class="pill">${esc(n.role)}</span><br>
        <b>Wants</b> ${esc(n.wants)}<br>
        <b>Secret</b> ${esc(n.secret)}${n.connection ? `<br><b>Connection</b> ${esc(n.connection)}` : ''}${n.statSuggestion ? `<br><b>If it comes to blows</b> use <a href="javascript:void 0" data-mon="${esc(n.statSuggestion.slug)}">${esc(n.statSuggestion.name)}</a>` : ''}</p>`)}
      ${personActions('npc', n.id, { rerollTip: 'Roll a different person into the same seat: new name, ancestry, wants and secret. Their role and where they are found stay put, and the new name replaces the old one everywhere the campaign mentions it.' })}</div>`;

    // The antagonist and their lieutenants belong on the cast list too: they
    // are the people the party spends the campaign chasing.
    const villainCardHTML = (v) => `<div class="npc-card">
      <b>${esc(v.name)}</b>, ${esc(v.title)}
      <span class="small faint">${esc(v.ancestry)} ${esc(v.kind)}${v.where ? `, ${esc(v.where)}` : ''}</span>
      <p class="small"><span class="pill danger">Antagonist</span></p>
      ${dmBox(`<p class="small"><b>Goal</b> ${esc(v.goal)}<br>
        <b>Method</b> ${esc(v.method)}<br>
        <b>Weakness</b> ${esc(v.weakness)}${v.statSuggestion ? `<br><b>Run them with</b> <a href="javascript:void 0" data-mon="${esc(v.statSuggestion.slug)}">${esc(v.statSuggestion.name)}</a> (CR ${esc(v.statSuggestion.cr)})` : ''}</p>`)}
      ${personActions('villain', v.id || 'villain', { rerollLabel: 'Reroll name', rerollTip: 'A new name and ancestry, changed everywhere the campaign names them. Their goal, method and schedule are what every chapter was built around, so those stay.' })}</div>`;

    const lieutenantCardHTML = (l) => `<div class="npc-card">
      <b>${esc(l.name)}</b>
      <span class="small faint">${esc(l.ancestry)}${l.where ? `, ${esc(l.where)}` : ''}</span>
      <p class="small"><span class="pill">Lieutenant</span></p>
      ${dmBox(`<p class="small">${esc(l.note)}${l.statSuggestion ? `<br><b>Run them with</b> <a href="javascript:void 0" data-mon="${esc(l.statSuggestion.slug)}">${esc(l.statSuggestion.name)}</a> (CR ${esc(l.statSuggestion.cr)})` : ''}</p>`)}
      ${personActions('lieutenant', l.id, { rerollTip: 'A different lieutenant in the same post: new name, brief and stat block, renamed everywhere the campaign mentions them.' })}</div>`;

    // Walk the story in order without going back to the tree.
    const chapterNavHTML = (ch) => {
      const chs = campaign.acts.flatMap(a => a.chapters);
      const i = chs.findIndex(x => x.id === ch.id);
      const prev = chs[i - 1], next = chs[i + 1];
      return `<div class="row" style="margin-top:14px">
        ${prev ? `<button class="btn small" data-ch="${esc(prev.id)}">&larr; ${ch.index - 1}. ${esc(prev.title)}</button>` : ''}
        <span style="margin-left:auto"></span>
        ${next ? `<button class="btn small" data-ch="${esc(next.id)}">${ch.index + 1}. ${esc(next.title)} &rarr;</button>` : ''}
      </div>`;
    };

    const chapterHTML = (ch) => `
      <h2>${ch.index}. ${esc(ch.title)}</h2>
      <p class="muted">${esc(ch.roleLabel)}, level ${ch.levelGate}, ${ch.mandatory ? 'mandatory' : 'optional'}. ${esc(ch.summary)}</p>
      <div class="row mb">
        <button class="btn small ${isDone(ch) ? 'primary' : ''}" data-done="${esc(ch.id)}">${isDone(ch) ? 'Completed &#10003; (click to unmark)' : 'Mark chapter complete'}</button>
        <button class="btn small" data-reroll="${esc(ch.id)}" title="Replace this chapter with a fresh roll; clues, objectives and leaders re-seat themselves">Reroll this chapter</button>
      </div>
      ${ch.scene ? playerBox(esc(ch.scene), 'Read aloud, setting the scene') : ''}
      ${ch.playerGoal ? playerBox(`<b>The goal, as the party understands it:</b> ${esc(ch.playerGoal)}`, 'Players know') : ''}
      ${ch.travel ? `<p class="small"><b>Getting there</b> ${esc(ch.travel)}</p>` : ''}
      ${(() => {
        const live = (ch.reactions || []).filter(r => flagOn(r.flag));
        return live.length ? `<div class="card"><h3>Because of what the party already did</h3>
          ${live.map(r => `<p class="small"><span class="pill">${esc(r.label)}</span><br>${esc(r.text)}</p>`).join('')}</div>` : '';
      })()}
      ${ch.dilemma ? `<div class="card dilemma-card"><h3>The choice</h3>
        ${playerBox(esc(ch.dilemma.situation), 'Put to the players')}
        <div class="grid-2">
          ${ch.dilemma.options.map(o => `<div class="dilemma-horn"><b>${esc(o.label)}</b><p class="small">${esc(o.cost)}</p></div>`).join('')}
        </div>
        ${dmBox(`<p class="small"><b>No clean way out</b> ${esc(ch.dilemma.noGoodAnswer)}<br>
          <b>It comes back</b> ${esc(ch.dilemma.later)}<br>
          <b>Running it</b> ${esc(ch.dilemma.framing)}</p>`)}</div>` : ''}
      ${ch.reversal ? `<div class="card outlook-card"><h3>The turn happens here: ${esc(ch.reversal.label)}</h3>
        ${dmBox(`<p class="small">${esc(ch.reversal.turn)}</p><p class="small"><b>Afterwards</b> ${esc(ch.reversal.fallout)}</p>`)}
        <p class="small faint">See the turn's own page for what to plant beforehand.</p></div>` : ''}
      ${ch.foreshadow ? dmBox(`<p class="small"><b>Plant this in passing</b> ${esc(ch.foreshadow)}</p>`) : ''}
      ${ch.wardThreat ? `<div class="card"><h3>They come for it here</h3><p class="small">${esc(ch.wardThreat)}</p></div>` : ''}
      ${ch.rival ? `<div class="card"><h3>${esc(ch.rival.org)} is here${ch.rival.first ? ', for the first time' : ''}</h3>
        <p class="small">${esc(ch.rival.move)}</p>
        <p class="small faint">They are <b>${esc((campaign.rival.stances.find(x => x.id === rivalStance()) || {}).label || 'wary')}</b> toward the party; see the Rival page for what that means here.</p></div>` : ''}
      ${ch.lieutenant ? `<p class="small"><span class="pill danger">lieutenant</span> ${esc(ch.lieutenant)} commands here; see the boss encounter below.</p>` : ''}
      <div class="grid-2 mt">
        <div class="card"><h3>Getting them here</h3><p class="small">${esc(ch.entry)}</p></div>
        <div class="card"><h3>If they walk away</h3><p class="small">${esc(ch.stakes)}</p></div>
      </div>
      ${ch.milestone ? `<p class="small"><b>Leveling</b> ${esc(ch.milestone)}</p>` : ''}
      ${ch.objective ? `<div class="card"><h3>${esc(ch.objective.name)}</h3><p class="small">${esc(ch.objective.note)}</p>
        ${ch.objective.power ? playerBox(`<b>While held</b> ${esc(ch.objective.power)}<br><b>The catch</b> ${esc(ch.objective.cost)}`, 'Players learn on identify') : ''}
        ${ch.objective.reaction ? dmBox(`<p class="small"><b>When claimed</b> ${esc(ch.objective.reaction)}</p>`) : ''}</div>` : ''}
      ${ch.board?.length ? `<div class="card"><h3>Work available from here</h3>
        <p class="small faint">These are optional and order-free; let the players pick.</p>
        ${ch.board.map(b => `<p class="small"><a href="javascript:void 0" data-ch="${esc(b.id)}"><b>${esc(b.title)}</b></a> <span class="pill">${esc(b.role)}, level ${b.level}</span><br>${esc(b.entry)}</p>`).join('')}</div>` : ''}
      <h3>Elements</h3>
      ${ch.elements.map(e => `<p><a href="javascript:void 0" data-el="${esc(e.id)}"><b>${esc(e.title)}</b></a> <span class="pill">${esc(e.subtitle)}</span><br><span class="small muted">${esc(e.summary)}</span></p>`).join('')}
      <label class="field mt"><span>Your notes on this chapter (autosaved, DM only)</span>
        <textarea data-chnote="${esc(ch.id)}" rows="3" placeholder="What actually happened, who died, what the party broke...">${esc(record?.notes?.[ch.id] || '')}</textarea></label>
      ${ch.link ? `<div class="card link-card"><h3>${esc(ch.link.heading)}</h3>
        <p class="small">${esc(ch.link.summary)}</p>
        <ul class="small">${ch.link.clues.map(c => `<li><span class="player-inline">${esc(c.text)}</span> <span class="faint">(${esc(c.placement)}, points to ${esc(c.pointsToTitle)})</span></li>`).join('')}</ul>
        <p class="small faint">Three independent pointers, so one missed roll never strands the party.</p></div>`
        : '<div class="card"><h3>This is the last chapter</h3><p class="small">See Endings for how it can land.</p></div>'}
      ${chapterNavHTML(ch)}`;

    const progressLine = () => {
      const chapters = campaign.acts.flatMap(a => a.chapters);
      const done = chapters.filter(isDone).length;
      return done ? `<p class="small"><b>Progress</b> ${done} of ${chapters.length} chapters marked complete.</p>` : '';
    };

    const overviewHTML = () => {
      const c = campaign;
      return `<h2>${esc(c.title)}</h2>
        <div class="row" style="flex-wrap:wrap;gap:4px">
          ${c.tone.map(t => `<span class="pill accent">${esc(t)}</span>`).join('')}
          <span class="pill">levels ${c.levelRange.start}-${c.levelRange.end}</span>
          <span class="pill">${esc(c.sessions)} sessions</span>
          <span class="pill">${esc(c.pattern.label)}</span>
        </div>
        <p class="field-label mt">The pitch &mdash; what the campaign is about in one line</p>
        <p class="small muted" style="margin-top:2px">${esc(c.logline)}</p>
        <p class="field-label mt">Shape &mdash; how the chapters are arranged</p>
        <p class="small muted" style="margin-top:2px">${esc(c.pattern.note)}</p>
        ${c.opening ? `<div class="card"><h3>Opening the campaign</h3><p class="small">${esc(c.opening)}</p></div>` : ''}
        ${c.playerHooks?.length ? `<div class="card"><h3>Character hooks</h3>
          ${playerBox(`<ul class="small" style="margin:0">${c.playerHooks.map(h => `<li>${esc(h)}</li>`).join('')}</ul>`, 'Hand to players')}</div>` : ''}
        <div class="card"><h3>The story, in order</h3>
          <p class="small faint">The whole tale chapter by chapter, each with the goal as the players will hear it. Click any step to open it.</p>
          <ol class="small">${c.acts.flatMap(a => a.chapters).map(ch => `<li>
            <a href="javascript:void 0" data-ch="${esc(ch.id)}"><b>${esc(ch.title)}</b></a>
            ${ch.mandatory ? '' : '<span class="pill">optional</span>'}${isDone(ch) ? ' <span class="pill success">done</span>' : ''}<br>
            <span class="muted">${esc(ch.playerGoal || ch.summary)}</span></li>`).join('')}</ol></div>
        ${(() => {
          const o = outlook();
          return `<div class="card outlook-card"><h3>Heading for: ${esc(o.label)}</h3>
            <p class="small">${esc(o.text)}</p>
            <p class="small faint">${o.why.map(esc).join(' ')}</p>
            ${o.notes.length ? `<ul class="small faint">${o.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
            <p class="small faint">${o.progress.mandatoryDone}/${o.progress.mandatoryTotal} mandatory chapters resolved &middot; campaign clock ${o.pressure}% full.
              This updates as you tick chapters, fill clocks and set flags.</p></div>`;
        })()}
        ${flagsCardHTML()}
        <div class="card"><h3>Running it</h3>
          <p class="small">Leveling is by milestone; every chapter states its own gate. Encounters are budgeted for a party of ${c.gen?.partySize || 4} at each chapter's level, so nudge counts up or down if the table changes. Optional chapters are genuinely optional: skipping one costs content, never the plot, because every clue points at a mandatory chapter. Advance the clocks from their listed triggers, out loud, where the players can hear the tick.</p>
          <p class="small"><span class="facing player">Read aloud</span> boxed blue text is safe to say or show to the players verbatim. <span class="facing dm">DM only</span> fenced blocks are spoilers: secrets, solutions, and the true/false of things. Everything unmarked is ordinary working material, worded for you rather than for them.</p></div>
        <div class="grid-2 mt">
          <div class="card"><h3>The region</h3>
            <p class="small"><b>${esc(c.region.name)}</b>, ${esc(c.region.label)}. Base of operations: <b>${esc(c.hub)}</b>.</p>
            <ul class="small">${c.region.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>
          <div class="card"><h3>Themes</h3><ul class="small">${c.themes.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
        </div>
        <div class="card"><h3>What the campaign is about</h3>
          <p class="small"><span class="pill accent">${esc(c.objective.kindLabel || 'Recover the scattered')}</span></p>
          ${c.objective.frame ? `<p class="small">${esc(c.objective.frame)}</p>` : ''}
          ${c.objective.playerGoal ? playerBox(esc(c.objective.playerGoal), 'What the party is trying to do') : ''}
          <p class="small">${c.objective.count} x <b>${esc(c.objective.plural)}</b>. ${esc(c.objective.why)}</p>
          ${c.objective.failure ? `<p class="small"><b>If they fail</b> ${esc(c.objective.failure)}</p>` : ''}
          <p class="small"><b>If ${esc(c.villain.name)} succeeds</b> ${esc(c.objective.ifLost)}</p>
          <ul class="small">${c.objective.items.map(i => `<li><b>${esc(i.name)}</b> - ${esc(i.chapterTitle)}. ${esc(i.note)}
            ${i.power ? `<br><span class="faint">While held: ${esc(i.power)} The catch: ${esc(i.cost)}</span>` : ''}</li>`).join('')}</ul></div>
        <div class="card"><h3>By the numbers</h3>
          <p class="small">${c.stats.chapters} chapters across ${c.stats.acts} acts, ${c.stats.nodes} keyed areas,
          ${c.stats.encounters} built encounters, ${c.stats.npcs} named NPCs, ${c.stats.xp.toLocaleString()} adjusted XP in placed fights${c.treasure ? `, ${c.treasure.gp.toLocaleString()} gp in placed treasure` : ''}.</p>
          ${progressLine()}</div>`;
    };

    const villainHTML = () => {
      const v = campaign.villain;
      return `<h2>${esc(v.name)}, ${esc(v.title)}</h2>
        <p class="muted">${esc(v.ancestry)} ${esc(v.kind)}${v.statSuggestion ? `. Run them with <a href="javascript:void 0" data-mon="${esc(v.statSuggestion.slug)}">${esc(v.statSuggestion.name)}</a> (CR ${esc(v.statSuggestion.cr)})` : ''}.${v.where ? ` Waiting at <b>${esc(v.where)}</b>.` : ''}</p>
        <div class="grid-2">
          <div class="card"><h3>Goal</h3><p class="small">${esc(v.goal)}</p>
            <h3>Method</h3><p class="small">${esc(v.method)}</p></div>
          <div class="card"><h3>Resources</h3><ul class="small">${v.resources.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
            <h3>Weakness</h3><p class="small">${esc(v.weakness)}</p></div>
        </div>
        <div class="card"><h3>Lieutenants</h3>
          ${v.lieutenants.map(l => `<p class="small"><b>${esc(l.name)}</b> (${esc(l.ancestry)}) - ${esc(l.note)}${l.statSuggestion ? `. Use <a href="javascript:void 0" data-mon="${esc(l.statSuggestion.slug)}">${esc(l.statSuggestion.name)}</a>, CR ${esc(l.statSuggestion.cr)}` : ''}${l.where ? `. Found at <b>${esc(l.where)}</b>` : ''}</p>`).join('')}</div>
        ${v.gains?.length ? `<div class="card"><h3>What they take as the clock runs</h3>
          <p class="small faint">Tied to ${esc(v.gains[0].clockLabel)}. Fill that clock on the Factions page and these become true in order; the ones already reached are marked.</p>
          ${v.gains.map(g => {
            const reached = (record?.clockFill?.[g.clockId] || 0) >= g.at;
            return `<p class="small ${reached ? '' : 'faint'}">
              <span class="pill ${reached ? 'danger' : ''}">${g.at}/${esc(String(campaign.clocks.find(k => k.id === g.clockId)?.segments || g.at))}</span>
              ${reached ? '<b>' : ''}${esc(g.text)}${reached ? '</b>' : ''}</p>`;
          }).join('')}</div>` : ''}
        <div class="card"><h3>Schedule, if the party does nothing</h3>
          <ol class="small">${v.timeline.map(t => `<li><b>${esc(t.when)}:</b> ${esc(t.move)}</li>`).join('')}</ol></div>`;
    };

    // Standing runs -3..+3 relative to the faction's written attitude.
    const standingOf = (f) => record?.factionStanding?.[f.id] || 0;
    const fmtStanding = (n) => n === 0 ? 'as written' : (n > 0 ? `+${n}` : String(n));

    const outlook = () => endingOutlook(campaign, {
      clockFill: record?.clockFill || {},
      flags: record?.flags || {},
      progress: record?.progress || {},
      rivalStance: record?.rivalStance || campaign.rival?.defaultStance || 'wary',
    });

    // Flags are the campaign's memory of what the party has already done.
    // The DM sets them; every later chapter then shows only the lines that
    // apply, so the book reacts instead of repeating itself.
    const flagOn = (id) => !!record?.flags?.[id];

    const flagsCardHTML = () => {
      if (!campaign.flags?.length) return '';
      const set = campaign.flags.filter(f => flagOn(f.id)).length;
      return `<div class="card"><h3>Choices that bind${set ? ` <span class="pill accent">${set} set</span>` : ''}</h3>
        <p class="small faint">Tick these as the party earns them. Every chapter after the first carries a prepared line for each, and shows the ones that apply.</p>
        ${campaign.flags.map(f => `<label class="check flag-row">
          <input type="checkbox" data-flag="${esc(f.id)}" ${flagOn(f.id) ? 'checked' : ''}>
          <span><b>${esc(f.label)}</b><br><span class="small faint">${esc(f.prompt)}</span></span>
        </label>`).join('')}</div>`;
    };

    // Stance is the DM's dial: it changes what the rival does at every site
    // and which ending the campaign is drifting toward.
    const rivalStance = () => record?.rivalStance || campaign.rival?.defaultStance || 'wary';

    const rivalHTML = () => {
      const r = campaign.rival;
      const stance = rivalStance();
      const active = r.stances.find(x => x.id === stance) || r.stances[1];
      return `<h2>${esc(r.org)}</h2>
        <p class="muted">${esc(r.leader)}, ${esc(r.title)} &mdash; ${esc(r.kind)}${r.statSuggestion
          ? `. Run them with <a href="javascript:void 0" data-mon="${esc(r.statSuggestion.slug)}">${esc(r.statSuggestion.name)}</a> (CR ${esc(r.statSuggestion.cr)})` : ''}.</p>
        <div class="card"><h3>Where they stand with the party</h3>
          <div class="row" id="rival-stance">
            ${r.stances.map(x => `<button class="btn small ${x.id === stance ? 'primary' : ''}" data-stance="${esc(x.id)}">${esc(x.label)}</button>`).join('')}
          </div>
          <p class="small mt">${esc(active.note)}</p>
          <p class="small faint">Saved with the campaign. Set it as the party earns it.</p></div>
        <div class="grid-2">
          <div class="card"><h3>What they want</h3><p class="small">${esc(r.wants)}</p>
            <h3>How they go about it</h3><p class="small">${esc(r.method)}</p></div>
          <div class="card"><h3>Why they cross ${esc(campaign.villain.name)}</h3><p class="small">${esc(r.crosses)}</p>
            <h3>Your leverage over them</h3><p class="small">${esc(r.leverage)}</p></div>
        </div>
        <div class="grid-2">
          <div class="card"><h3>They offer</h3><p class="small">${esc(r.offers)}</p></div>
          <div class="card"><h3>They demand</h3><p class="small">${esc(r.demands)}</p></div>
        </div>
        <div class="card"><h3>First meeting</h3>${playerBox(esc(r.firstMeeting), 'How it plays')}</div>
        <div class="grid-2">
          <div class="card ${stance === 'allied' ? 'link-card' : ''}"><h3>If the party allies with them</h3>
            <p class="small">${esc(r.ifAllied)}</p></div>
          <div class="card ${stance === 'hostile' ? 'link-card' : ''}"><h3>If the party crosses them</h3>
            <p class="small">${esc(r.ifCrossed)}</p></div>
        </div>
        ${r.appearances?.length ? `<div class="card"><h3>Where they turn up</h3>
          ${r.appearances.map(a => `<p class="small"><a href="javascript:void 0" data-ch="${esc(a.chapterId)}"><b>${esc(a.chapterTitle)}</b></a>${a.first ? ' <span class="pill accent">first meeting</span>' : ''}<br>${esc(a.move)}</p>`).join('')}</div>` : ''}`;
    };

    const reversalHTML = () => {
      const r = campaign.reversal;
      return `<h2>${esc(r.label)}</h2>
        <p class="muted">The campaign's turn, planned for <a href="javascript:void 0" data-ch="${esc(r.chapterId)}"><b>${esc(r.chapterTitle)}</b></a>${r.who ? `, and it is about ${esc(r.who)}` : ''}.</p>
        <div class="card"><h3>What everyone believes</h3>
          ${playerBox(esc(r.setup), 'True as far as the party knows')}</div>
        <div class="card"><h3>What is actually true</h3>
          ${dmBox(`<p class="small">${esc(r.turn)}</p>`)}</div>
        ${r.foreshadow.length ? `<div class="card"><h3>Plant these first</h3>
          <p class="small faint">Drop each one in passing. They should mean nothing at the time and everything afterwards.</p>
          ${r.foreshadow.map(f => `<p class="small"><a href="javascript:void 0" data-ch="${esc(f.chapterId)}"><b>${esc(f.chapterTitle)}</b></a><br>${esc(f.text)}</p>`).join('')}</div>` : ''}
        <div class="grid-2">
          <div class="card"><h3>Afterwards</h3><p class="small">${esc(r.fallout)}</p></div>
          <div class="card"><h3>If they never work it out</h3><p class="small">${esc(r.ifMissed)}</p></div>
        </div>`;
    };

    const worldHTML = () => `
      <h2>Factions, clocks &amp; region</h2>
      <div class="card"><h3>Factions</h3>
        <p class="small faint">Standing tracks how the party has shifted each faction from its written attitude. It saves with the campaign.</p>
        ${campaign.factions.map(f => `<p class="small"><b>${esc(f.name)}</b> <span class="pill">${esc(f.attitude)}</span>
          <span class="hp-ctrl" style="display:inline-flex;gap:4px;margin-left:6px">
            <button class="btn small" data-fac="${esc(f.id)}" data-shift="-1" title="The party crossed them">&minus;</button>
            <span class="pill ${standingOf(f) > 0 ? 'success' : standingOf(f) < 0 ? 'danger' : ''}">${fmtStanding(standingOf(f))}</span>
            <button class="btn small" data-fac="${esc(f.id)}" data-shift="1" title="The party earned favor">+</button>
          </span><br>
          Wants to ${esc(f.goal)}. Offers ${esc(f.offers)}. Demands ${esc(f.demands)}.</p>`).join('')}</div>
      <div class="card"><h3>Clocks</h3>
        <p class="small faint">Click a segment to fill up to it; click the last filled segment to clear it back. Fills save with the campaign.</p>
        ${campaign.clocks.map(k => {
          const fill = record?.clockFill?.[k.id] || 0;
          return `<p class="small"><b>${esc(k.label)}</b>
            <span class="clock-row">${Array.from({ length: k.segments }, (_, i) =>
              `<button class="clock-seg ${i < fill ? 'filled' : ''}" data-clock="${esc(k.id)}" data-seg="${i + 1}" title="Segment ${i + 1} of ${k.segments}"></button>`).join('')}</span>
            <span class="faint">${fill}/${k.segments}</span>
            ${k.global ? '<span class="pill accent">campaign</span>' : ''}
            ${fill >= k.segments ? '<span class="pill danger">FILLED</span>' : ''}<br>${esc(k.onFill)}</p>
          ${k.advances?.length ? `<ul class="small faint">${k.advances.map(a => `<li>Advance a segment when ${esc(a)}</li>`).join('')}</ul>` : ''}`;
        }).join('')}</div>
      <div class="card"><h3>${esc(campaign.region.name)}</h3>
        <p class="small">${esc(campaign.region.label)}. Terrain: ${campaign.region.terrain.map(esc).join(', ')}. Landmarks are listed on the overview.</p></div>`;

    const actHTML = (act) => `
      <h2>${esc(act.title)}</h2>
      <p class="muted">Level ${act.levelGate} and up, ${act.chapters.length} chapters.</p>
      ${act.chapters.map(ch => `<div class="card"><h3><a href="javascript:void 0" data-ch="${esc(ch.id)}">${ch.index}. ${esc(ch.title)}</a></h3>
        <p class="small muted">${esc(ch.roleLabel)}, level ${ch.levelGate}, ${ch.mandatory ? 'mandatory' : 'optional'}</p>
        <p class="small">${esc(ch.summary)}</p>
        ${ch.link ? `<p class="small faint">Leads to ${esc(ch.link.toTitle)}</p>` : ''}</div>`).join('')}`;

    // Rerolling something inside a room should not move the page under the
    // reader: the open room is remembered by nodesHTML, and the scroll
    // position is put back once the new markup is in.
    const redrawInPlace = () => {
      const box = out.querySelector('#sg-detail');
      const top = window.scrollY, inner = box ? box.scrollTop : 0;
      drawDetail();
      const box2 = out.querySelector('#sg-detail');
      if (box2) box2.scrollTop = inner;
      window.scrollTo({ top, behavior: 'instant' in window ? 'instant' : 'auto' });
    };

    const drawDetail = () => {
      const box = out.querySelector('#sg-detail');
      const c = campaign;
      let html = '';
      switch (selection.kind) {
        case 'overview': html = overviewHTML(); break;
        case 'villain': html = villainHTML(); break;
        case 'rival': html = rivalHTML(); break;
        case 'reversal': html = reversalHTML(); break;
        case 'world': html = worldHTML(); break;
        case 'act': html = actHTML(selection.ref); break;
        case 'chapter': html = chapterHTML(selection.ref); break;
        case 'element': html = elementHTML(selection.ref); break;
        case 'npcs': html = `<h2>NPCs</h2>
          <h3>The opposition</h3>
          <p class="small muted">Who the party is up against. Rerolling one of them renames them everywhere the campaign mentions them, so nothing is left pointing at somebody who no longer exists.</p>
          ${c.villain ? villainCardHTML(c.villain) : ''}
          ${(c.villain?.lieutenants || []).map(lieutenantCardHTML).join('')}
          <h3 class="mt">The roster</h3>
          <p class="small muted">${c.appendices.npcs.length} people the chapters seated somewhere.</p>
          ${c.appendices.npcs.map(n => npcCardHTML(n)).join('')}`; break;
        case 'creatures': html = `<h2>Creatures used</h2>
          <p class="small muted">Every stat block the generated encounters reference. Rerolling one swaps it for a creature of comparable weight in every fight that uses it, and rebudgets those fights.</p>
          ${c.appendices.creatures.map(m => `<div class="row" style="align-items:center;padding:3px 0">
            <a href="javascript:void 0" data-mon="${esc(m.slug)}">${esc(m.name)}</a>
            <span class="pill">CR ${esc(m.cr)}</span>
            <span style="margin-left:auto;white-space:nowrap">
              <button class="btn small" data-crea-init="${esc(m.slug)}" title="Add one to the initiative tracker without disturbing the fight already on it">Add to initiative</button>
              <button class="btn small" data-crea-reroll="${esc(m.slug)}" title="Swap this stat block for a comparable one wherever the campaign uses it">Reroll</button>
            </span></div>`).join('')}`; break;
        case 'items': html = `<h2>Treasure &amp; magic items</h2>
          ${c.treasure ? `<p class="small muted">${c.treasure.gp.toLocaleString()} gp in placed coin and valuables${Object.keys(c.treasure.rarities || {}).length ? `, plus ${Object.entries(c.treasure.rarities).map(([r, n]) => `${n} ${r}`).join(', ')} magic items` : ''}.</p>` : ''}
          ${c.appendices.magicItems.length
          ? `<p>${c.appendices.magicItems.map(i => `<a href="javascript:void 0" data-item="${esc(i.slug)}">${esc(i.name)}</a> <span class="pill">${esc(i.rarity)}</span>`).join(' &middot; ')}</p>`
          : '<p class="faint">None rolled into this one.</p>'}`; break;
        case 'endings': {
          const o = outlook();
          html = `<h2>Endings</h2>
            <p class="small muted">Which of these the campaign lands on is not chosen in advance. It follows the state you are keeping: the clocks, the flags, the chapters ticked off, and where the rival stands.</p>
            ${c.endings.map(e => `<div class="card ${e.label === o.label ? 'outlook-card' : ''}">
              <h3>${esc(e.label)}${e.label === o.label ? ' <span class="pill accent">on course</span>' : ''}</h3>
              <p class="small">${esc(e.text)}</p>
              ${e.label === o.label ? `<p class="small faint">${o.why.map(esc).join(' ')}</p>` : ''}</div>`).join('')}`;
          break;
        }
      }
      box.innerHTML = html;

      // The player's copy of the dungeon map, exported as a standalone file.
      box.querySelector('#dm-playermap')?.addEventListener('click', () => downloadMap(selection.ref, true));
      box.querySelector('#dm-dmmap')?.addEventListener('click', () => downloadMap(selection.ref, false));
      box.querySelector('#tm-playermap')?.addEventListener('click', () => downloadTownMap(selection.ref, true));
      box.querySelector('#tm-dmmap')?.addEventListener('click', () => downloadTownMap(selection.ref, false));

      // One room open at a time. Opening a second closes the first, and the
      // choice is remembered so a reroll does not throw you back to the top.
      box.querySelectorAll('details.story-area').forEach(d => d.addEventListener('toggle', () => {
        if (!d.open) {
          if (openArea && openArea.nodeId === d.dataset.node && openArea.eltId === d.dataset.elt) openArea = null;
          return;
        }
        openArea = { eltId: d.dataset.elt, nodeId: d.dataset.node };
        for (const other of box.querySelectorAll('details.story-area[open]')) {
          if (other !== d) other.open = false;
        }
        // the drawing follows the reading: opening a room, a trap or a
        // hallway brings that part of the map into view
        const onMap = revealRoom(d.dataset.node);
        if (onMap) frameRoom(onMap.closest('.map-wrap'), onMap, onMap.classList.contains('map-hazard') ? 58 : 0);
      }));

      // Switching which level is on show, by tab or by walking a stair.
      const showLevel = (levels, idx) => {
        if (!levels) return;
        levels.querySelectorAll(':scope > .map-panel').forEach(pane => { pane.hidden = +pane.dataset.level !== idx; });
        levels.querySelectorAll(':scope > .map-tabs > .map-tab').forEach(t => {
          const on = +t.dataset.level === idx;
          t.classList.toggle('is-active', on);
          t.setAttribute('aria-selected', on ? 'true' : 'false');
        });
      };
      box.querySelectorAll('.map-tabs .map-tab').forEach(t => t.addEventListener('click', () => {
        showLevel(t.closest('.map-levels'), +t.dataset.level);
      }));

      // Bring a target's own level to the front and return its shape on the
      // map. Rooms and passage glyphs alike.
      const revealRoom = (id) => {
        const g = box.querySelector(`svg.dungeon-map [data-goto="${CSS.escape(id)}"]`);
        if (!g) return null;
        const pane = g.closest('.map-panel');
        if (pane) showLevel(pane.closest('.map-levels'), +pane.dataset.level);
        return g;
      };

      // Walking the dungeon: an exit opens its room and brings it into view.
      box.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.goto;
        const dest = box.querySelector(`#area-${CSS.escape(id)}`);
        // the drawing follows the walk, across levels if the way out is a stair
        const onMap = revealRoom(id);
        // a trap glyph is a few pixels across: frame the passage around it
        // rather than magnifying until the diamond fills the screen
        if (onMap) frameRoom(onMap.closest('.map-wrap'), onMap, onMap.classList.contains('map-hazard') ? 58 : 0);
        if (!dest) return;
        dest.open = true;
        dest.scrollIntoView({ behavior: 'smooth', block: 'center' });
        dest.classList.remove('just-opened');
        void dest.offsetWidth;   // restart the highlight if it is still running
        dest.classList.add('just-opened');
      }));

      // "outside" is a way out of the first room like any other; it leads
      // back to the approach text rather than to another key.
      box.querySelectorAll('[data-goto-approach]').forEach(b => b.addEventListener('click', () => {
        const dest = box.querySelector('#dm-approach') || box.querySelector('.map-wrap');
        dest?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }));

      wireMaps(box);
      box.querySelectorAll('[data-mon]').forEach(a => a.addEventListener('click', () => {
        const m = bySlug.get(a.dataset.mon);
        m ? showStatBlock(m) : toast('Stat block not found', 'danger');
      }));
      box.querySelectorAll('[data-item]').forEach(a => a.addEventListener('click', async () => {
        items ??= await loadItems();
        const it = items.find(x => x.slug === a.dataset.item);
        if (!it) return toast('Item not found', 'danger');
        modal(it.name, el(`<div><p class="muted">${esc([it.category, it.rarity, it.attunement ? 'requires attunement' : ''].filter(Boolean).join(', '))}</p>${md(it.desc || '')}</div>`), { wide: true });
      }));
      box.querySelectorAll('[data-run]').forEach(b => b.addEventListener('click', async () => {
        const list = JSON.parse(b.dataset.run).map(x => ({ monster: bySlug.get(x.slug), count: x.count })).filter(x => x.monster);
        if (!list.length) return toast('No stat blocks for that encounter', 'danger');
        // launching replaces the tracker; never wipe a live fight silently
        const combat = await getState('combat');
        if (combat?.started && combat.combatants?.length) {
          confirmDialog(`A fight is already running (round ${combat.round}). Replace it with this encounter?`,
            () => launchCombat(list), { label: 'Replace fight' });
        } else {
          await launchCombat(list);
        }
      }));
      box.querySelectorAll('[data-ch]').forEach(a => a.addEventListener('click', () => {
        const ch = campaign.acts.flatMap(x => x.chapters).find(x => x.id === a.dataset.ch);
        if (ch) { selection = { kind: 'chapter', ref: ch }; drawTree(); drawDetail(); }
      }));
      box.querySelectorAll('[data-el]').forEach(a => a.addEventListener('click', () => {
        const all = campaign.acts.flatMap(x => x.chapters).flatMap(ch => ch.elements.map(e => ({ e, ch })));
        const hit = all.find(x => x.e.id === a.dataset.el);
        if (hit) { selection = { kind: 'element', ref: hit.e, chapter: hit.ch }; drawTree(); drawDetail(); }
      }));
      box.querySelectorAll('[data-flag]').forEach(cb => cb.addEventListener('change', async () => {
        record.flags ||= {};
        record.flags[cb.dataset.flag] = cb.checked;
        await persistRecord();
        drawTree();   // the outlook label lives here too
        drawDetail();
        toast(cb.checked ? 'Set; later chapters will react' : 'Cleared');
      }));
      box.querySelectorAll('[data-stance]').forEach(b => b.addEventListener('click', async () => {
        record.rivalStance = b.dataset.stance;
        await persistRecord();
        drawTree();   // the outlook label lives here too
        drawDetail();
        toast(`${campaign.rival.org}: ${b.textContent}`);
      }));
      box.querySelectorAll('[data-clock]').forEach(b => b.addEventListener('click', async () => {
        const { clock, seg } = b.dataset;
        record.clockFill ||= {};
        const cur = record.clockFill[clock] || 0;
        record.clockFill[clock] = Number(seg) === cur ? cur - 1 : Number(seg);
        await persistRecord();
        drawTree();   // the outlook label lives here too
        drawDetail();
      }));
      box.querySelectorAll('[data-fac]').forEach(b => b.addEventListener('click', async () => {
        record.factionStanding ||= {};
        const cur = record.factionStanding[b.dataset.fac] || 0;
        record.factionStanding[b.dataset.fac] = Math.max(-3, Math.min(3, cur + Number(b.dataset.shift)));
        await persistRecord();
        drawTree();   // the outlook label lives here too
        drawDetail();
      }));
      box.querySelector('[data-chnote]')?.addEventListener('input', (e) => {
        clearTimeout(e.target._t);
        e.target._t = setTimeout(async () => {
          record.notes ||= {};
          record.notes[e.target.dataset.chnote] = e.target.value;
          await persistRecord();
        }, 500);
      });
      // Targeted rerolls: redraw in place so the DM keeps their scroll position.
      box.querySelectorAll('[data-reroll-enc]').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const fresh = await rerollEncounter(campaign, b.dataset.rerollEnc);
          await persistRecord();
          redrawInPlace();
          toast(`New fight: ${fresh.creatures.map(c => `${c.count} x ${c.name}`).join(', ')}`);
        } catch (err) {
          toast(err.message, 'danger');
          b.disabled = false;
        }
      }));
      // Everyone on the cast list can be found again from their id alone,
      // wherever the card that carries them happens to be drawn.
      const findPerson = (kind, id) => {
        if (kind === 'villain') return campaign.villain;
        if (kind === 'lieutenant') return (campaign.villain?.lieutenants || []).find(l => l.id === id);
        return campaign.appendices.npcs.find(n => n.id === id)
          || campaign.acts.flatMap(a => a.chapters).flatMap(ch => ch.npcs || []).find(n => n.id === id);
      };

      box.querySelectorAll('[data-add-init]').forEach(b => b.addEventListener('click', async () => {
        const [kind, id] = b.dataset.addInit.split('|');
        const who = findPerson(kind, id);
        if (!who) return toast('That person is no longer in the campaign', 'danger');
        const monster = who.statSuggestion ? bySlug.get(who.statSuggestion.slug) : null;
        await addToCombat([{ monster, name: who.name }]);
        toast(monster
          ? `${who.name} joins the fight as ${monster.name}`
          : `${who.name} joins the fight; no stat block suggested, so set their AC and HP`);
      }));

      box.querySelectorAll('[data-person-reroll]').forEach(b => b.addEventListener('click', async () => {
        const [kind, id] = b.dataset.personReroll.split('|');
        const was = findPerson(kind, id)?.name;
        b.disabled = true;
        try {
          const fresh = kind === 'villain' ? await renameVillain(campaign)
            : kind === 'lieutenant' ? await rerollLieutenant(campaign, id)
              : await rerollNPC(campaign, id);
          await persistRecord();
          drawTree();
          redrawInPlace();
          toast(`${was} is now ${fresh.name}`);
        } catch (err) {
          toast(err.message, 'danger');
          b.disabled = false;
        }
      }));

      box.querySelectorAll('[data-crea-init]').forEach(b => b.addEventListener('click', async () => {
        const m = bySlug.get(b.dataset.creaInit);
        if (!m) return toast('Stat block not found', 'danger');
        await addToCombat([{ monster: m }]);
        toast(`${m.name} joins the fight`);
      }));

      box.querySelectorAll('[data-crea-reroll]').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const out = await rerollAppendixCreature(campaign, b.dataset.creaReroll);
          await persistRecord();
          drawTree();
          redrawInPlace();
          toast(`${out.from} swapped for ${out.to} in ${out.fights} ${out.fights === 1 ? 'fight' : 'fights'}`);
        } catch (err) {
          toast(err.message, 'danger');
          b.disabled = false;
        }
      }));

      box.querySelectorAll('[data-swap]').forEach(b => b.addEventListener('click', async () => {
        const [beatId, slug] = b.dataset.swap.split('|');
        b.disabled = true;
        try {
          const line = await rerollCreature(campaign, beatId, slug);
          await persistRecord();
          redrawInPlace();
          toast(`Swapped in ${line.count} x ${line.name}`);
        } catch (err) {
          toast(err.message, 'danger');
          b.disabled = false;
        }
      }));
      box.querySelector('[data-done]')?.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.done;
        record.progress ||= {};
        record.progress[id] = !record.progress[id];
        await persistRecord();
        drawTree(); drawDetail();
      });
      box.querySelector('[data-reroll]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Rerolling...';
        try {
          const fresh = await rerollChapter(campaign, btn.dataset.reroll);
          await persistRecord();
          selection = { kind: 'chapter', ref: fresh };
          drawTree(); drawDetail();
          toast(`Chapter ${fresh.index} is now "${fresh.title}"`);
        } catch (err) {
          console.error(err);
          toast(`Reroll failed: ${err.message}`, 'danger');
          btn.disabled = false;
          btn.textContent = 'Reroll this chapter';
        }
      });
    };

    const show = (rec) => {
      record = rec;
      record.progress ||= {};
      const c = rec.data;
      campaign = c;
      mapCache.clear();
      preloadMaps();
      selection = { kind: 'overview' };
      out.innerHTML = `
        <div class="row mb mt" style="align-items:center">
          <h2 style="margin:0">${esc(c.title)}</h2>
          <span class="pill accent">${esc(c.pattern.label)}</span>
          <span style="margin-left:auto"></span>
          <button class="btn small" id="sg-handout" title="Only player-facing text: the pitch, hooks, and rumours with the true/false stripped">Player handout</button>
          <button class="btn small" id="sg-export">Export .md</button>
        </div>
        <div class="story-layout${getPrefs().sgTreeCollapsed ? ' tree-collapsed' : ''}" id="sg-layout">
          <div class="story-tree" id="sg-tree-wrap">
            <button class="tree-collapse" id="sg-tree-toggle" title="Collapse or expand the campaign outline">
              <span class="tc-arrow">&lsaquo;</span><span class="tc-where" id="sg-tree-where"></span>
            </button>
            <div id="sg-tree"></div>
          </div>
          <div class="story-detail card" id="sg-detail"></div>
        </div>`;
      // Collapsed, the outline folds to a slim rail that still says where in
      // the campaign you are; the choice is remembered like the app nav's.
      out.querySelector('#sg-tree-toggle').addEventListener('click', () => {
        const lay = out.querySelector('#sg-layout');
        lay.classList.toggle('tree-collapsed');
        setPref('sgTreeCollapsed', lay.classList.contains('tree-collapsed'));
      });
      out.querySelector('#sg-export').addEventListener('click', () => downloadMarkdown(c));
      out.querySelector('#sg-handout').addEventListener('click', () => {
        const blob = new Blob([playerHandoutMarkdown(c)], { type: 'text/markdown' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${c.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-player-handout.md`;
        a.click();
        URL.revokeObjectURL(a.href);
        toast('Player handout downloaded; safe to share as-is');
      });
      drawTree();
      drawDetail();
    };

    await drawSaved();
    // reopen the most recent campaign so switching tabs does not lose the place
    const saved = (await dbAll('stories', activeCampaignId())).sort((a, b) => b.updated - a.updated);
    if (saved.length) show(saved[0]);
  },
};
