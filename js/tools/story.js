// Story: one-button campaign generator plus a browser for what it produced.
// The left column is the whole campaign at a glance; the right column is
// whatever the DM drilled into.
import { dbAll, dbPut, dbDelete, activeCampaignId, getState, setState } from '../store.js';
import { loadMonsters, loadItems } from '../srd.js';
import { el, esc, md, toast, confirmDialog, modal, toggleRow, showStatBlock } from '../components/ui.js';
import { generateCampaign, campaignMarkdown } from '../campaign-gen.js';
import { launchCombat } from './encounters.js';

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

    let campaign = null;
    let selection = { kind: 'overview' };

    container.innerHTML = `
      <div class="card">
        <h2>Generate a campaign</h2>
        <p class="small muted">One press builds the whole book: a premise, an antagonist with a schedule, factions, clocks, acts and chapters, keyed dungeons with encounters and treasure, settlements with rosters and rumours, and three separate clues in every chapter pointing at the next one.</p>
        <div class="row mt" style="align-items:flex-end">
          <div id="sg-length"></div>
          <label class="field"><span>Shape</span><select id="sg-pattern">${PATTERNS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
          <label class="field"><span>Premise</span><select id="sg-premise"><option value="">Surprise me</option></select></label>
          <button class="btn primary" id="sg-go" style="font-size:1.05rem;padding:10px 18px">Generate campaign</button>
        </div>
        <div id="sg-saved" class="mt"></div>
      </div>
      <div id="sg-out"></div>`;

    const out = container.querySelector('#sg-out');

    const length = toggleRow('Length', [
      { value: 'short', label: 'Short (1-5)' },
      { value: 'standard', label: 'Standard (1-10)' },
      { value: 'epic', label: 'Epic (1-15)' },
    ], (await getState('storyLength')) || 'standard', (v) => setState('storyLength', v));
    container.querySelector('#sg-length').append(length.el);

    // premise list comes from the same table the generator uses
    fetch('data/tables/campaign.json').then(r => r.json()).then(t => {
      const sel = container.querySelector('#sg-premise');
      for (const p of t.premises) sel.insertAdjacentHTML('beforeend', `<option value="${esc(p.id)}">${esc(p.title)}</option>`);
    }).catch(() => {});

    /* ---------- persistence ---------- */

    const drawSaved = async () => {
      const saved = (await dbAll('stories', activeCampaignId())).sort((a, b) => b.updated - a.updated);
      const box = container.querySelector('#sg-saved');
      if (!saved.length) { box.innerHTML = '<p class="small faint">No campaigns generated yet.</p>'; return; }
      box.innerHTML = '<div class="small muted mb">Saved campaigns</div>';
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
        row.querySelector('[data-load]').addEventListener('click', () => { show(s.data); });
        row.querySelector('[data-md]').addEventListener('click', () => downloadMarkdown(s.data));
        row.querySelector('[data-del]').addEventListener('click', () => {
          confirmDialog(`Delete "${s.data.title}"?`, async () => {
            await dbDelete('stories', s.id);
            if (campaign?.id === s.data.id) { campaign = null; out.innerHTML = ''; }
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
          pattern: container.querySelector('#sg-pattern').value || undefined,
          premiseId: container.querySelector('#sg-premise').value || undefined,
        });
        await dbPut('stories', { campaignId: activeCampaignId(), created: Date.now(), data: c });
        show(c);
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
        { kind: 'world', label: 'Factions, clocks & region', depth: 0 },
      ];
      campaign.acts.forEach((act, ai) => {
        rows.push({ kind: 'act', ref: act, label: act.title, sub: `Act ${ai + 1}, level ${act.levelGate}+`, depth: 0 });
        for (const ch of act.chapters) {
          rows.push({ kind: 'chapter', ref: ch, label: `${ch.index}. ${ch.title}`, sub: `${ch.roleLabel}, level ${ch.levelGate}`, depth: 1 });
          for (const elt of ch.elements) {
            rows.push({ kind: 'element', ref: elt, chapter: ch, label: elt.title, sub: elt.subtitle, depth: 2 });
          }
        }
      });
      rows.push({ kind: 'npcs', label: 'NPCs', sub: `${campaign.appendices.npcs.length} in the roster`, depth: 0 });
      rows.push({ kind: 'creatures', label: 'Creatures', sub: `${campaign.appendices.creatures.length} stat blocks used`, depth: 0 });
      rows.push({ kind: 'items', label: 'Magic items', sub: `${campaign.appendices.magicItems.length} placed`, depth: 0 });
      rows.push({ kind: 'endings', label: 'Endings', depth: 0 });
      return rows;
    };

    const sameSelection = (row) =>
      row.kind === selection.kind && (!row.ref || row.ref === selection.ref);

    const drawTree = () => {
      const box = out.querySelector('#sg-tree');
      box.innerHTML = '';
      for (const row of treeRows()) {
        const node = el(`<button class="story-node d${row.depth} ${sameSelection(row) ? 'active' : ''}">
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

    const encounterHTML = (b) => `
      <div class="beat encounter">
        <div class="beat-head"><b>${esc(b.title)}</b>
          <span class="pill ${b.difficulty === 'deadly' ? 'danger' : b.difficulty === 'hard' ? 'accent' : 'info'}">${esc(b.difficulty)}</span>
          <span class="pill">${b.xp.toLocaleString()} adj XP</span>
          <button class="btn small" data-run="${esc(JSON.stringify(b.creatures))}">Run</button>
        </div>
        <p>${b.creatures.map(c => `${c.count} x ${creatureLink(c)} <span class="small faint">CR ${esc(c.cr)}</span>`).join(', ')}</p>
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
        <p class="small">${esc(b.telegraph)}. <b>Detect</b> ${esc(b.detect)}. <b>Disarm</b> ${esc(b.disarm)}.<br>
        <b>Effect</b> ${esc(b.effect)}<br><b>Consequence</b> ${esc(b.consequence)}</p></div>`;
      if (b.kind === 'puzzle') return `<div class="beat puzzle"><b>Puzzle: ${esc(b.name)}</b>
        <p class="small">${esc(b.premise)}<br><b>Solution</b> ${esc(b.solution)}<br>
        <b>Alternate route</b> ${esc(b.alternate)}<br><b>On failure</b> ${esc(b.failure)}</p></div>`;
      if (b.kind === 'treasure') return `<div class="beat treasure"><b>Treasure</b> <span class="small">${treasureHTML(b.treasure)}</span></div>`;
      if (b.kind === 'clue') return `<div class="beat clue"><b>Clue &rarr; ${esc(b.pointsToTitle)}</b> <span class="small">${esc(b.text)}</span></div>`;
      if (b.kind === 'objective') return `<div class="beat objective"><b>${esc(b.title)}</b> <span class="small">${esc(b.text)}</span></div>`;
      return `<div class="beat"><b>${esc(b.title)}</b> <span class="small">${esc(b.text || '')}</span></div>`;
    };

    const nodesHTML = (elt) => (elt.nodes || []).map((n, i) => `
      <details class="story-area" ${i === 0 ? 'open' : ''}>
        <summary><b>${esc(n.id)}</b> ${esc(n.roleLabel)}
          <span class="small faint">${esc(n.light)}${n.exits.length ? ` &rarr; ${esc(n.exits.join(', '))}` : ''}</span>
          ${n.beats.map(b => `<span class="pill ${b.kind === 'encounter' ? 'danger' : ''}">${esc(b.kind)}</span>`).join('')}
        </summary>
        <p>${esc(n.description)}${n.dressing ? ` ${esc(n.dressing)}` : ''}</p>
        ${n.beats.map(beatHTML).join('')}
      </details>`).join('');

    const elementHTML = (elt) => {
      const head = `<h2>${esc(elt.title)}</h2>
        <p class="muted">${esc(elt.subtitle)}. ${esc(elt.summary)}</p>
        ${elt.hazard ? `<p class="small"><b>Site hazard</b> ${esc(elt.hazard)}</p>` : ''}
        ${elt.alerts ? `<p class="small"><b>Alert state</b> ${esc(elt.alerts)}</p>` : ''}
        ${elt.freeClues?.length ? `<p class="small"><b>Clues placed here</b> ${elt.freeClues.map(esc).join(' / ')}</p>` : ''}`;

      if (elt.type === 'dungeon') return `${head}<div class="mt">${nodesHTML(elt)}</div>`;

      if (elt.type === 'settlement') return `${head}
        <div class="grid-2 mt">
          <div><h3>Who runs it</h3><p class="small">${esc(elt.ruler)}</p>
            <h3>Services</h3><p class="small">${elt.services.map(esc).join(', ')}. The tavern is ${esc(elt.tavern)}.</p>
            <h3>Locations of interest</h3><ul class="small">${elt.locations.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
            <h3>While they are here</h3><p class="small">${esc(elt.event)}</p></div>
          <div><h3>Rumours</h3><ul class="small">${elt.rumors.map(r => `<li>${esc(r.text)} <span class="pill ${r.true ? 'success' : 'danger'}">${r.true ? 'true' : 'false'}</span></li>`).join('')}</ul>
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
        <p><b>Objective</b> ${esc(elt.objective)}</p>
        <p><b>If it goes wrong</b> ${esc(elt.failure)}</p>
        ${elt.climaxEncounter ? `<h3>The fight, if it comes to one</h3>${encounterHTML({ ...elt.climaxEncounter, title: 'Climax encounter', objective: elt.objective, tactics: 'The event drives the tactics; terrain and the clock matter more than the numbers.', morale: 'Withdraws the moment the objective is out of reach.', ifAvoided: 'The event resolves without a fight, which is a legitimate outcome.' })}` : ''}`;

      if (elt.type === 'investigation') return `${head}
        ${elt.conclusions.map(c => `<div class="mt"><b>Conclusion</b> ${esc(c.text)}
          <ul class="small">${c.clues.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}`;

      return head;
    };

    const npcCardHTML = (n) => `<div class="npc-card">
      <b>${esc(n.name)}</b> <span class="pill">${esc(n.role)}</span>
      <span class="small faint">${esc(n.ancestry)} ${esc(n.occupation)}${n.where ? `, ${esc(n.where)}` : ''}</span>
      <p class="small">${esc(n.personality)}; ${esc(n.quirk)}.<br>
        <b>Wants</b> ${esc(n.wants)}<br>
        <b>Secret</b> ${esc(n.secret)}${n.connection ? `<br><b>Connection</b> ${esc(n.connection)}` : ''}</p></div>`;

    const chapterHTML = (ch) => `
      <h2>${ch.index}. ${esc(ch.title)}</h2>
      <p class="muted">${esc(ch.roleLabel)}, level ${ch.levelGate}, ${ch.mandatory ? 'mandatory' : 'optional'}. ${esc(ch.summary)}</p>
      <div class="grid-2 mt">
        <div class="card"><h3>Getting them here</h3><p class="small">${esc(ch.entry)}</p></div>
        <div class="card"><h3>If they walk away</h3><p class="small">${esc(ch.stakes)}</p></div>
      </div>
      ${ch.objective ? `<div class="card"><h3>${esc(ch.objective.name)}</h3><p class="small">${esc(ch.objective.note)}</p></div>` : ''}
      <h3>Elements</h3>
      ${ch.elements.map(e => `<p><a href="javascript:void 0" data-el="${esc(e.id)}"><b>${esc(e.title)}</b></a> <span class="pill">${esc(e.subtitle)}</span><br><span class="small muted">${esc(e.summary)}</span></p>`).join('')}
      ${ch.link ? `<div class="card link-card"><h3>Leads to ${esc(ch.link.toTitle)}</h3>
        <p class="small">${esc(ch.link.summary)}</p>
        <ul class="small">${ch.link.clues.map(c => `<li>${esc(c.text)} <span class="faint">(${esc(c.placement)})</span></li>`).join('')}</ul>
        <p class="small faint">Three independent pointers, so one missed roll never strands the party.</p></div>`
        : '<div class="card"><h3>This is the last chapter</h3><p class="small">See Endings for how it can land.</p></div>'}`;

    const overviewHTML = () => {
      const c = campaign;
      return `<h2>${esc(c.title)}</h2>
        <p style="font-size:1.1rem">${esc(c.logline)}</p>
        <div class="row" style="flex-wrap:wrap;gap:4px">
          ${c.tone.map(t => `<span class="pill accent">${esc(t)}</span>`).join('')}
          <span class="pill">levels ${c.levelRange.start}-${c.levelRange.end}</span>
          <span class="pill">${esc(c.sessions)} sessions</span>
          <span class="pill">${esc(c.pattern.label)}</span>
        </div>
        <p class="small muted mt">${esc(c.pattern.note)}</p>
        <div class="grid-2 mt">
          <div class="card"><h3>The region</h3>
            <p class="small"><b>${esc(c.region.name)}</b>, ${esc(c.region.label)}. Base of operations: <b>${esc(c.hub)}</b>.</p>
            <ul class="small">${c.region.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>
          <div class="card"><h3>Themes</h3><ul class="small">${c.themes.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
        </div>
        <div class="card"><h3>What the campaign is about</h3>
          <p class="small">${c.objective.count} x <b>${esc(c.objective.plural)}</b>. ${esc(c.objective.why)}</p>
          <p class="small"><b>If ${esc(c.villain.name)} succeeds</b> ${esc(c.objective.ifLost)}</p>
          <ul class="small">${c.objective.items.map(i => `<li><b>${esc(i.name)}</b> - ${esc(i.chapterTitle)}. ${esc(i.note)}</li>`).join('')}</ul></div>
        <div class="card"><h3>By the numbers</h3>
          <p class="small">${c.stats.acts} acts, ${c.stats.chapters} chapters, ${c.stats.elements} elements, ${c.stats.nodes} keyed areas,
          ${c.stats.encounters} built encounters, ${c.stats.npcs} named NPCs, ${c.stats.xp.toLocaleString()} adjusted XP in total.</p></div>`;
    };

    const villainHTML = () => {
      const v = campaign.villain;
      return `<h2>${esc(v.name)}, ${esc(v.title)}</h2>
        <p class="muted">${esc(v.ancestry)} ${esc(v.kind)}${v.statSuggestion ? `. Run them with <a href="javascript:void 0" data-mon="${esc(v.statSuggestion.slug)}">${esc(v.statSuggestion.name)}</a> (CR ${esc(v.statSuggestion.cr)})` : ''}.</p>
        <div class="grid-2">
          <div class="card"><h3>Goal</h3><p class="small">${esc(v.goal)}</p>
            <h3>Method</h3><p class="small">${esc(v.method)}</p></div>
          <div class="card"><h3>Resources</h3><ul class="small">${v.resources.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
            <h3>Weakness</h3><p class="small">${esc(v.weakness)}</p></div>
        </div>
        <div class="card"><h3>Lieutenants</h3>
          ${v.lieutenants.map(l => `<p class="small"><b>${esc(l.name)}</b> (${esc(l.ancestry)}) - ${esc(l.note)}${l.statSuggestion ? `. Use <a href="javascript:void 0" data-mon="${esc(l.statSuggestion.slug)}">${esc(l.statSuggestion.name)}</a>, CR ${esc(l.statSuggestion.cr)}` : ''}</p>`).join('')}</div>
        <div class="card"><h3>Schedule, if the party does nothing</h3>
          <ol class="small">${v.timeline.map(t => `<li><b>${esc(t.when)}:</b> ${esc(t.move)}</li>`).join('')}</ol></div>`;
    };

    const worldHTML = () => `
      <h2>Factions, clocks &amp; region</h2>
      <div class="card"><h3>Factions</h3>
        ${campaign.factions.map(f => `<p class="small"><b>${esc(f.name)}</b> <span class="pill">${esc(f.attitude)}</span><br>
          Wants to ${esc(f.goal)}. Offers ${esc(f.offers)}. Demands ${esc(f.demands)}.</p>`).join('')}</div>
      <div class="card"><h3>Clocks</h3>
        ${campaign.clocks.map(k => `<p class="small"><b>${esc(k.label)}</b> ${'&#9633;'.repeat(k.segments)} ${k.global ? '<span class="pill accent">campaign</span>' : ''}<br>${esc(k.onFill)}</p>`).join('')}</div>
      <div class="card"><h3>${esc(campaign.region.name)}</h3>
        <p class="small">${esc(campaign.region.label)}. Terrain: ${campaign.region.terrain.map(esc).join(', ')}.</p>
        <ul class="small">${campaign.region.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>`;

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
        case 'world': html = worldHTML(); break;
        case 'act': html = actHTML(selection.ref); break;
        case 'chapter': html = chapterHTML(selection.ref); break;
        case 'element': html = elementHTML(selection.ref); break;
        case 'npcs': html = `<h2>NPCs</h2>${c.appendices.npcs.map(npcCardHTML).join('')}`; break;
        case 'creatures': html = `<h2>Creatures used</h2><p class="small muted">Every stat block the generated encounters reference.</p>
          <p>${c.appendices.creatures.map(m => `<a href="javascript:void 0" data-mon="${esc(m.slug)}">${esc(m.name)}</a> <span class="small faint">CR ${esc(m.cr)}</span>`).join(' &middot; ')}</p>`; break;
        case 'items': html = `<h2>Magic items placed</h2>${c.appendices.magicItems.length
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
        await launchCombat(list);
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
    };

    const show = (c) => {
      campaign = c;
      selection = { kind: 'overview' };
      out.innerHTML = `
        <div class="row mb mt" style="align-items:center">
          <h2 style="margin:0">${esc(c.title)}</h2>
          <span class="pill accent">${esc(c.pattern.label)}</span>
          <span style="margin-left:auto"></span>
          <button class="btn small" id="sg-export">Export .md</button>
        </div>
        <div class="story-layout">
          <div class="story-tree" id="sg-tree"></div>
          <div class="story-detail card" id="sg-detail"></div>
        </div>`;
      out.querySelector('#sg-export').addEventListener('click', () => downloadMarkdown(c));
      drawTree();
      drawDetail();
    };

    await drawSaved();
    // reopen the most recent campaign so switching tabs does not lose the place
    const saved = (await dbAll('stories', activeCampaignId())).sort((a, b) => b.updated - a.updated);
    if (saved.length) show(saved[0].data);
  },
};
