// About: what this is, attribution, license, and what the browser is
// holding on this device.
import { getPrefs, storageStatus, STORES } from '../store.js';

function bytes(b) {
  if (b == null) return 'unknown';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 * 1048576) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(1)} GB`;
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
        <h2>Storage</h2>
        <p class="small faint">Measuring what this browser is holding...</p>
      </div>`;

    drawStats(container.querySelector('#ab-stats'));
  },
};

async function drawStats(box) {
  try {
    const status = await storageStatus();
    const prefsBytes = new Blob([JSON.stringify(getPrefs())]).size;
    box.innerHTML = `
      <h2>Storage</h2>
      <p class="small muted">Using ${bytes(status.usage)}${status.quota ? ` of about ${bytes(status.quota)} available` : ''},
        across ${STORES.length} data stores, plus ${bytes(prefsBytes)} of preferences.
        ${status.persisted
          ? 'This browser has agreed to keep the data and will not evict it to reclaim space.'
          : 'The browser may evict this data if it needs space; export a backup from Settings to be safe.'}</p>`;
  } catch (err) {
    console.error(err);
    box.innerHTML = '<h2>Storage</h2><p class="small muted">Could not read local storage on this device.</p>';
  }
}
