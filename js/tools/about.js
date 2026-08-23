// About: what this is, attribution, license, and a tally of everything the
// DM has made in this browser.
import { dbAll, getPrefs, storageStatus, STORES } from '../store.js';
import { esc } from '../components/ui.js';

const n = (x) => (x || 0).toLocaleString();

function bytes(b) {
  if (b == null) return 'unknown';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 * 1048576) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(1)} GB`;
}

// Walk every generated campaign and add up what is inside them.
function storyTotals(stories) {
  const t = {
    acts: 0, chapters: 0, chaptersDone: 0, elements: 0, dungeons: 0, settlements: 0,
    events: 0, regions: 0, investigations: 0, areas: 0, encounters: 0, monstersFielded: 0,
    traps: 0, puzzles: 0, clues: 0, npcs: 0, villains: 0, lieutenants: 0, factions: 0,
    clocks: 0, gp: 0, magicItems: 0, xp: 0, notes: 0, distinctCreatures: new Set(),
  };
  for (const rec of stories) {
    const c = rec.data;
    if (!c) continue;
    t.villains++;
    t.lieutenants += c.villain?.lieutenants?.length || 0;
    t.factions += c.factions?.length || 0;
    t.clocks += c.clocks?.length || 0;
    t.acts += c.acts?.length || 0;
    t.gp += c.treasure?.gp || 0;
    t.magicItems += c.appendices?.magicItems?.length || 0;
    t.npcs += c.appendices?.npcs?.length || 0;
    t.xp += c.stats?.xp || 0;
    for (const m of c.appendices?.creatures || []) t.distinctCreatures.add(m.slug);
    t.notes += Object.values(rec.notes || {}).filter(v => String(v).trim()).length;
    t.chaptersDone += Object.values(rec.progress || {}).filter(Boolean).length;
    for (const act of c.acts || []) {
      for (const ch of act.chapters || []) {
        t.chapters++;
        t.clues += ch.link?.clues?.length || 0;
        for (const el of ch.elements || []) {
          t.elements++;
          if (el.type === 'dungeon') t.dungeons++;
          if (el.type === 'settlement') t.settlements++;
          if (el.type === 'event') t.events++;
          if (el.type === 'region') t.regions++;
          if (el.type === 'investigation') t.investigations++;
          for (const node of el.nodes || []) {
            t.areas++;
            for (const b of node.beats || []) {
              if (b.kind === 'encounter') {
                t.encounters++;
                for (const cr of b.creatures || []) t.monstersFielded += cr.count || 0;
              }
              if (b.kind === 'trap') t.traps++;
              if (b.kind === 'puzzle') t.puzzles++;
            }
          }
        }
      }
    }
  }
  return t;
}

export default {
  id: 'about', title: 'About', shortTitle: 'About', group: 'More', icon: 'info',

  async render(container) {
    container.innerHTML = `
      <div class="card">
        <h2>DM Screen</h2>
        <p>Created by <a href="https://github.com/dangeratio" target="_blank" rel="noopener">dangeratio</a></p>
        <p>Report issues at <a href="https://github.com/dmscreen/dmscreen.github.io/issues" target="_blank" rel="noopener">GitHub</a></p>
      </div>
      <div class="card">
        <h2>Licensing & attribution</h2>
        <p class="small muted">This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC, available at
        <a href="https://dnd.wizards.com/resources/systems-reference-document" target="_blank" rel="noopener">dnd.wizards.com</a>.
        The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License, available at
        <a href="https://creativecommons.org/licenses/by/4.0/legalcode" target="_blank" rel="noopener">creativecommons.org</a>.</p>
        <p class="small muted">This work also includes material from the <b>Level Up: Advanced 5th Edition (A5E)</b> books by
        <a href="https://enpublishingrpg.com" target="_blank" rel="noopener">EN Publishing</a>:
        the <i>Adventurer's Guide</i>, <i>Dungeon Delver's Guide</i>, <i>Gate Pass Gazette</i>, and <i>Monstrous Menagerie</i>,
        used under the terms of the Open Gaming License via the
        <a href="https://a5esrd.com" target="_blank" rel="noopener">A5E System Reference Document</a>,
        including equipment and enchanted items taken from the published A5E SRD documents.
        Level Up: Advanced 5th Edition and the book titles are trademarks of EN Publishing; this site is not affiliated with or endorsed by EN Publishing.</p>
        <p class="small muted">The reference also includes open-content material from
        <a href="https://koboldpress.com" target="_blank" rel="noopener">Kobold Press</a>, used under the terms of the Open Gaming License:
        monsters from <i>Tome of Beasts</i> (both the original and the 2023 edition), <i>Tome of Beasts 2</i>, <i>Tome of Beasts 3</i>, and <i>Creature Codex</i>;
        spells from <i>Deep Magic for 5th Edition</i> and <i>Deep Magic Extended</i>;
        and magic items from <i>Vault of Magic</i> and <i>Tome of Heroes</i>.</p>
        <p class="small muted">Spells from <i>Spells That Don't Suck</i> and material from
        Green Ronin Publishing (<i>Critical Role: Tal'Dorei Campaign Setting</i>) are likewise used under the terms of the Open Gaming License.
        None of these publishers endorse this site.</p>
        <p class="small muted">The rumor generator and the importable table catalog come from the companion project
        <a href="https://autorolltables.github.io" target="_blank" rel="noopener">Auto Roll Tables</a>.</p>
        <p class="small muted">All rules data was compiled via the excellent <a href="https://open5e.com" target="_blank" rel="noopener">Open5e</a> project and API.
        DM Screen is unofficial fan content and is not affiliated with or endorsed by Wizards of the Coast.</p>
        <p class="small muted">Application code is MIT licensed.</p>
      </div>
      <div class="card" id="ab-stats">
        <h2>What you have made</h2>
        <p class="small faint">Counting up everything saved in this browser...</p>
      </div>`;

    drawStats(container.querySelector('#ab-stats'));
  },
};

async function drawStats(box) {
  try {
    const [campaigns, party, encounters, npcs, notes, tables, shops, events, stories, links, misc, status] =
      await Promise.all([
        dbAll('campaigns'), dbAll('party'), dbAll('encounters'), dbAll('npcs'), dbAll('notes'),
        dbAll('customTables'), dbAll('shops'), dbAll('calendarEvents'), dbAll('stories'),
        dbAll('links'), dbAll('misc'), storageStatus(),
      ]);

    const st = storyTotals(stories);
    const tableRows = tables.reduce((a, t) => a + (t.rows?.length || 0), 0);
    const shopItems = shops.reduce((a, s) => a + (s.items?.length || 0), 0);
    const noteWords = notes.reduce((a, x) => a + String(x.body || '').split(/\s+/).filter(Boolean).length, 0);
    const encMonsters = encounters.reduce((a, e) => a + (e.monsters || []).reduce((b, m) => b + (m.count || 0), 0), 0);
    const partyLevels = party.reduce((a, p) => a + (p.level || 0), 0);
    const prefsBytes = new Blob([JSON.stringify(getPrefs())]).size;
    const records = [campaigns, party, encounters, npcs, notes, tables, shops, events, stories, links, misc]
      .reduce((a, x) => a + x.length, 0);

    const groups = [
      { title: 'Campaigns', rows: [
        ['Campaigns', campaigns.length],
        ['Player characters', party.length],
        ['Total party levels', partyLevels],
        ['Session notes', notes.length],
        ['Words written in notes', noteWords],
        ['Calendar events logged', events.length],
      ] },
      { title: 'Generated stories', rows: [
        ['Campaigns generated', stories.length],
        ['Chapters written', st.chapters],
        ['Chapters marked complete', st.chaptersDone],
        ['Acts', st.acts],
        ['Keyed areas', st.areas],
        ['Dungeons and sites', st.dungeons],
        ['Settlements', st.settlements],
        ['Set pieces and events', st.events],
        ['Travel legs', st.regions],
        ['Investigation webs', st.investigations],
        ['Clues planted', st.clues],
        ['Chapter notes you added', st.notes],
      ] },
      { title: 'Things to fight', rows: [
        ['Encounters built', st.encounters + encounters.length],
        ['Saved encounters (builder)', encounters.length],
        ['Monsters placed in encounters', st.monstersFielded + encMonsters],
        ['Distinct creatures used', st.distinctCreatures.size],
        ['Traps set', st.traps],
        ['Puzzles posed', st.puzzles],
        ['Adjusted XP across all fights', st.xp],
      ] },
      { title: 'People and powers', rows: [
        ['NPCs in your roster', npcs.length + st.npcs],
        ['Villains plotting', st.villains],
        ['Lieutenants serving them', st.lieutenants],
        ['Factions with an agenda', st.factions],
        ['Clocks ticking', st.clocks],
      ] },
      { title: 'Loot and shops', rows: [
        ['Gold placed as treasure', st.gp],
        ['Magic items placed', st.magicItems],
        ['Shops stocked', shops.length],
        ['Items on their shelves', shopItems],
      ] },
      { title: 'Your own tables and links', rows: [
        ['Custom tables', tables.length],
        ['Rows across those tables', tableRows],
        ['Custom links saved', links.length],
      ] },
    ];

    // Only the sections with something in them; a screen full of zeroes is
    // not much of a trophy cabinet.
    const filled = groups.filter(g => g.rows.some(([, v]) => v > 0));

    box.innerHTML = `
      <h2>What you have made</h2>
      <p class="small faint">Everything below lives in this browser only. ${n(records)} records in total.</p>
      ${filled.length ? `<div class="grid-2">
        ${filled.map(g => `
          <div class="stat-group">
            <h3>${esc(g.title)}</h3>
            <table class="data"><tbody>
              ${g.rows.filter(([, v]) => v > 0).map(([label, v]) =>
                `<tr><td>${esc(label)}</td><td class="stat-num">${n(v)}</td></tr>`).join('')}
            </tbody></table>
          </div>`).join('')}
      </div>` : '<p class="small muted">Nothing saved yet. Generate a campaign, add a party, or stock a shop and this fills up.</p>'}
      <h3>Storage</h3>
      <p class="small muted">Using ${bytes(status.usage)}${status.quota ? ` of about ${bytes(status.quota)} available` : ''},
        across ${STORES.length} data stores, plus ${bytes(prefsBytes)} of preferences.
        ${status.persisted
          ? 'This browser has agreed to keep the data and will not evict it to reclaim space.'
          : 'The browser may evict this data if it needs space; export a backup from Settings to be safe.'}</p>`;
  } catch (err) {
    console.error(err);
    box.innerHTML = '<h2>What you have made</h2><p class="small muted">Could not read local storage on this device.</p>';
  }
}
