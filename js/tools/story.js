// Story: one-button campaign generator plus a browser for what it produced.
// The left column is the whole campaign at a glance; the right column is
// whatever the DM drilled into.
import { dbAll, dbPut, dbDelete, activeCampaignId, getState, setState } from '../store.js';
import { loadMonsters, loadItems } from '../srd.js';
import { el, esc, md, toast, confirmDialog, modal, toggleRow, showStatBlock } from '../components/ui.js';
import { generateCampaign, campaignMarkdown, playerHandoutMarkdown, rerollChapter, rerollEncounter, rerollCreature } from '../campaign-gen.js';
import { icon } from '../components/icons.js';
import { launchCombat } from './encounters.js';
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
      rows.push({ kind: 'endings', label: 'Endings', depth: 0 });
      return rows;
    };

    const sameSelection = (row) =>
      row.kind === selection.kind && (!row.ref || row.ref === selection.ref);

    const drawTree = () => {
      const box = out.querySelector('#sg-tree');
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
    const playerBox = (html, tag = 'Read aloud') =>
      `<div class="player-text"><span class="facing player">${esc(tag)}</span>${html}</div>`;
    const dmBox = (html) =>
      `<div class="dm-note"><span class="facing dm">DM only</span>${html}</div>`;

    // A rough plan of the site: nodes laid out on a staggered grid with the
    // exit connections drawn between them. Not a battle map, just enough that
    // the DM does not have to sketch the graph from an exits list.
    const mapSVG = (elt) => {
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
      const lines = ns.flatMap((n, i) => n.exits.map(e => {
        const j = idx.get(e);
        return j == null ? '' : `<line x1="${pos[i].x}" y1="${pos[i].y}" x2="${pos[j].x}" y2="${pos[j].y}"/>`;
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

    const nodesHTML = (elt) => (elt.nodes || []).map((n, i) => `
      <details class="story-area" ${i === 0 ? 'open' : ''}>
        <summary><b>${esc(n.id)}</b> ${esc(n.roleLabel)}
          <span class="small faint">${esc(n.light)}${n.exits.length ? ` &rarr; ${esc(n.exits.join(', '))}` : ''}</span>
          ${n.beats.map(b => `<span class="pill ${b.kind === 'encounter' ? 'danger' : ''}">${esc(b.kind)}</span>`).join('')}
        </summary>
        ${playerBox(`${esc(n.description)}${n.dressing ? ` ${esc(n.dressing)}` : ''}`)}
        ${n.beats.map(beatHTML).join('')}
      </details>`).join('');

    const elementHTML = (elt) => {
      const head = `<h2>${esc(elt.title)}</h2>
        <p class="muted">${esc(elt.subtitle)}. ${esc(elt.summary)}</p>
        ${elt.hazard ? `<p class="small"><b>Site hazard</b> ${esc(elt.hazard)}</p>` : ''}
        ${elt.alerts ? `<p class="small"><b>Alert state</b> ${esc(elt.alerts)}</p>` : ''}
        ${elt.objectiveNote?.length ? `<p class="small"><b>Holds</b> ${elt.objectiveNote.map(esc).join(' / ')}</p>` : ''}
        ${elt.freeClues?.length ? `<p class="small"><b>Clues placed here</b> ${elt.freeClues.map(esc).join(' / ')}</p>` : ''}`;

      const wanderingHTML = !elt.wandering ? '' : `
        <h3 class="mt">Wandering (d6, each half hour of dawdling or after loud noise)</h3>
        <table class="data"><tbody>${elt.wandering.map(r =>
          `<tr><td>${esc(r.range)}</td><td>${esc(r.text)}</td></tr>`).join('')}</tbody></table>`;

      if (elt.type === 'dungeon') return `${head}${mapSVG(elt)}${wanderingHTML}<div class="mt">${nodesHTML(elt)}</div>`;

      if (elt.type === 'settlement') return `${head}
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

      if (elt.type === 'investigation') return `${head}
        ${elt.conclusions.map(c => `<div class="mt"><b>Conclusion</b> <span class="faint small">(DM only until earned)</span><br>${esc(c.text)}
          <ul class="small">${c.clues.map(x => `<li><span class="player-inline">${esc(x)}</span></li>`).join('')}</ul></div>`).join('')}`;

      return head;
    };

    // Top half is safe on a shared screen; the fenced block is where the role
    // tag lives too, since "Betrayer" next to a name is itself a spoiler.
    const npcCardHTML = (n) => `<div class="npc-card">
      <b>${esc(n.name)}</b>
      <span class="small faint">${esc(n.ancestry)} ${esc(n.occupation)}${n.where ? `, ${esc(n.where)}` : ''}</span>
      <p class="small">${esc(n.personality)}; ${esc(n.quirk)}.</p>
      ${dmBox(`<p class="small"><span class="pill">${esc(n.role)}</span><br>
        <b>Wants</b> ${esc(n.wants)}<br>
        <b>Secret</b> ${esc(n.secret)}${n.connection ? `<br><b>Connection</b> ${esc(n.connection)}` : ''}${n.statSuggestion ? `<br><b>If it comes to blows</b> use <a href="javascript:void 0" data-mon="${esc(n.statSuggestion.slug)}">${esc(n.statSuggestion.name)}</a>` : ''}</p>`)}</div>`;

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
          <p class="small">${c.objective.count} x <b>${esc(c.objective.plural)}</b>. ${esc(c.objective.why)}</p>
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
        <div class="card"><h3>Schedule, if the party does nothing</h3>
          <ol class="small">${v.timeline.map(t => `<li><b>${esc(t.when)}:</b> ${esc(t.move)}</li>`).join('')}</ol></div>`;
    };

    // Standing runs -3..+3 relative to the faction's written attitude.
    const standingOf = (f) => record?.factionStanding?.[f.id] || 0;
    const fmtStanding = (n) => n === 0 ? 'as written' : (n > 0 ? `+${n}` : String(n));

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

    const drawDetail = () => {
      const box = out.querySelector('#sg-detail');
      const c = campaign;
      let html = '';
      switch (selection.kind) {
        case 'overview': html = overviewHTML(); break;
        case 'villain': html = villainHTML(); break;
        case 'rival': html = rivalHTML(); break;
        case 'world': html = worldHTML(); break;
        case 'act': html = actHTML(selection.ref); break;
        case 'chapter': html = chapterHTML(selection.ref); break;
        case 'element': html = elementHTML(selection.ref); break;
        case 'npcs': html = `<h2>NPCs</h2>${c.appendices.npcs.map(npcCardHTML).join('')}`; break;
        case 'creatures': html = `<h2>Creatures used</h2><p class="small muted">Every stat block the generated encounters reference.</p>
          <p>${c.appendices.creatures.map(m => `<a href="javascript:void 0" data-mon="${esc(m.slug)}">${esc(m.name)}</a> <span class="small faint">CR ${esc(m.cr)}</span>`).join(' &middot; ')}</p>`; break;
        case 'items': html = `<h2>Treasure &amp; magic items</h2>
          ${c.treasure ? `<p class="small muted">${c.treasure.gp.toLocaleString()} gp in placed coin and valuables${Object.keys(c.treasure.rarities || {}).length ? `, plus ${Object.entries(c.treasure.rarities).map(([r, n]) => `${n} ${r}`).join(', ')} magic items` : ''}.</p>` : ''}
          ${c.appendices.magicItems.length
          ? `<p>${c.appendices.magicItems.map(i => `<a href="javascript:void 0" data-item="${esc(i.slug)}">${esc(i.name)}</a> <span class="pill">${esc(i.rarity)}</span>`).join(' &middot; ')}</p>`
          : '<p class="faint">None rolled into this one.</p>'}`; break;
        case 'endings': html = `<h2>Endings</h2>${c.endings.map(e => `<div class="card"><h3>${esc(e.label)}</h3><p class="small">${esc(e.text)}</p></div>`).join('')}`; break;
      }
      box.innerHTML = html;

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
      box.querySelectorAll('[data-stance]').forEach(b => b.addEventListener('click', async () => {
        record.rivalStance = b.dataset.stance;
        await persistRecord();
        drawDetail();
        toast(`${campaign.rival.org}: ${b.textContent}`);
      }));
      box.querySelectorAll('[data-clock]').forEach(b => b.addEventListener('click', async () => {
        const { clock, seg } = b.dataset;
        record.clockFill ||= {};
        const cur = record.clockFill[clock] || 0;
        record.clockFill[clock] = Number(seg) === cur ? cur - 1 : Number(seg);
        await persistRecord();
        drawDetail();
      }));
      box.querySelectorAll('[data-fac]').forEach(b => b.addEventListener('click', async () => {
        record.factionStanding ||= {};
        const cur = record.factionStanding[b.dataset.fac] || 0;
        record.factionStanding[b.dataset.fac] = Math.max(-3, Math.min(3, cur + Number(b.dataset.shift)));
        await persistRecord();
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
          drawDetail();
          toast(`New fight: ${fresh.creatures.map(c => `${c.count} x ${c.name}`).join(', ')}`);
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
          drawDetail();
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
      selection = { kind: 'overview' };
      out.innerHTML = `
        <div class="row mb mt" style="align-items:center">
          <h2 style="margin:0">${esc(c.title)}</h2>
          <span class="pill accent">${esc(c.pattern.label)}</span>
          <span style="margin-left:auto"></span>
          <button class="btn small" id="sg-handout" title="Only player-facing text: the pitch, hooks, and rumours with the true/false stripped">Player handout</button>
          <button class="btn small" id="sg-export">Export .md</button>
        </div>
        <div class="story-layout">
          <div class="story-tree" id="sg-tree"></div>
          <div class="story-detail card" id="sg-detail"></div>
        </div>`;
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
