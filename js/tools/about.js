// About: what this is, attribution, license.
export default {
  id: 'about', title: 'About', shortTitle: 'About', group: 'More', icon: 'info',

  async render(container) {
    container.innerHTML = `
      <div class="card">
        <h2>DM Screen Kit</h2>
        <p class="muted">A free, browser-based virtual screen for D&D 5e Dungeon Masters: initiative tracking, encounter building, travel, generators, and SRD reference in one place.</p>
        <p class="muted mt">Everything runs in your browser. There is no server, no account, and no tracking; your campaign data never leaves this device. Use <b>Settings &gt; Export backup</b> to move it or keep it safe.</p>
        <p class="mt"><a href="https://github.com/dmscreen/dmscreen.github.io" target="_blank" rel="noopener">Source code on GitHub</a></p>
      </div>
      <div class="card">
        <h2>Licensing & attribution</h2>
        <p class="small muted">This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC, available at
        <a href="https://dnd.wizards.com/resources/systems-reference-document" target="_blank" rel="noopener">dnd.wizards.com</a>.
        The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License, available at
        <a href="https://creativecommons.org/licenses/by/4.0/legalcode" target="_blank" rel="noopener">creativecommons.org</a>.</p>
        <p class="small muted">SRD data was compiled via the excellent <a href="https://open5e.com" target="_blank" rel="noopener">Open5e</a> project.
        DM Screen Kit is unofficial fan content and is not affiliated with or endorsed by Wizards of the Coast.</p>
        <p class="small muted">Application code is MIT licensed.</p>
      </div>`;
  },
};
