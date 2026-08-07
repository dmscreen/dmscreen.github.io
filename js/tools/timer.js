// Session Timer: elapsed session time plus an optional break countdown.
import { getState, setState } from '../store.js';
import { toast } from '../components/ui.js';

let tickHandle = null;

export default {
  id: 'timer', title: 'Session Timer', shortTitle: 'Timer', group: 'Session', icon: 'timer',
  subtitle: 'How long have we been at this?',

  onExit() { clearInterval(tickHandle); },

  async render(container) {
    let session = await getState('sessionTimer', null); // {startedAt, pausedAt}
    let breakEnd = null;
    let breakWarned = false;

    container.innerHTML = `
      <div class="grid-2">
        <div class="card center">
          <h2>Session</h2>
          <div class="roll-result-big" id="tm-elapsed">0:00:00</div>
          <div class="row mt" style="justify-content:center">
            <button class="btn primary" id="tm-toggle">Start session</button>
            <button class="btn danger" id="tm-reset">Reset</button>
          </div>
        </div>
        <div class="card center">
          <h2>Break</h2>
          <div class="roll-result-big" id="tm-break">--:--</div>
          <div class="row mt" style="justify-content:center">
            <button class="btn" data-break="5">5 min</button>
            <button class="btn" data-break="10">10 min</button>
            <button class="btn" data-break="15">15 min</button>
            <button class="btn" id="tm-break-clear">Clear</button>
          </div>
        </div>
      </div>`;

    const elapsedEl = container.querySelector('#tm-elapsed');
    const breakEl = container.querySelector('#tm-break');
    const toggleBtn = container.querySelector('#tm-toggle');

    const fmt = (ms) => {
      const s = Math.max(0, Math.floor(ms / 1000));
      return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    };

    const tick = () => {
      if (session?.startedAt) {
        const end = session.pausedAt || Date.now();
        elapsedEl.textContent = fmt(end - session.startedAt);
        toggleBtn.textContent = session.pausedAt ? 'Resume' : 'Pause';
      } else {
        elapsedEl.textContent = '0:00:00';
        toggleBtn.textContent = 'Start session';
      }
      if (breakEnd) {
        const left = breakEnd - Date.now();
        breakEl.textContent = left <= 0 ? 'Back!' : `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
        if (left <= 0 && !breakWarned) { breakWarned = true; toast('Break is over!'); }
      } else {
        breakEl.textContent = '--:--';
      }
    };

    toggleBtn.addEventListener('click', async () => {
      if (!session?.startedAt) session = { startedAt: Date.now(), pausedAt: null };
      else if (session.pausedAt) {
        session = { startedAt: session.startedAt + (Date.now() - session.pausedAt), pausedAt: null };
      } else session.pausedAt = Date.now();
      await setState('sessionTimer', session);
      tick();
    });
    container.querySelector('#tm-reset').addEventListener('click', async () => {
      session = null;
      await setState('sessionTimer', null);
      tick();
    });
    container.querySelectorAll('[data-break]').forEach(b => b.addEventListener('click', () => {
      breakEnd = Date.now() + Number(b.dataset.break) * 60000;
      breakWarned = false;
      tick();
    }));
    container.querySelector('#tm-break-clear').addEventListener('click', () => { breakEnd = null; tick(); });

    clearInterval(tickHandle);
    tickHandle = setInterval(tick, 500);
    tick();
  },
};
