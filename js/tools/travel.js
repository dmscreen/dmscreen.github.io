// Travel Calculator: pace, terrain, and mode math.
import { el } from '../components/ui.js';

const PACES = {
  fast: { mph: 4, label: 'Fast', note: '-5 to passive Wisdom (Perception)' },
  normal: { mph: 3, label: 'Normal', note: '' },
  slow: { mph: 2, label: 'Slow', note: 'Able to use stealth' },
};
const SHIPS = {
  rowboat: 1.5, keelboat: 1, 'sailing ship': 2, longship: 3, warship: 2.5, galley: 4,
};

export default {
  id: 'travel', title: 'Travel Calculator', shortTitle: 'Travel', group: 'Travel', icon: 'map',
  subtitle: 'How long does the journey take?',

  async render(container) {
    container.innerHTML = `
      <div class="grid-2">
        <div class="card">
          <h2>Journey</h2>
          <div class="row">
            <label class="field"><span>Distance (miles)</span><input type="number" id="t-dist" value="60" min="1" style="width:100px"></label>
            <label class="field"><span>Mode</span><select id="t-mode">
              <option value="foot">On foot</option>
              <option value="mounted">Mounted</option>
              ${Object.keys(SHIPS).map(s => `<option value="ship:${s}">Ship: ${s}</option>`).join('')}
            </select></label>
            <label class="field" id="t-pace-wrap"><span>Pace</span><select id="t-pace">
              ${Object.entries(PACES).map(([k, p]) => `<option value="${k}" ${k === 'normal' ? 'selected' : ''}>${p.label} (${p.mph} mph)</option>`).join('')}
            </select></label>
            <label class="field"><span>Terrain</span><select id="t-terrain">
              <option value="1">Road / open</option>
              <option value="0.5">Difficult (forest, swamp, mountains)</option>
            </select></label>
            <label class="field" id="t-hours-wrap"><span>Hours per day</span><input type="number" id="t-hours" value="8" min="1" max="24" style="width:70px"></label>
          </div>
          <div id="t-out" class="mt"></div>
        </div>
        <div class="card">
          <h2>Pace effects</h2>
          <p><b>Fast.</b> <span class="muted">4 mph, 30 miles/day. -5 to passive Wisdom (Perception).</span></p>
          <p><b>Normal.</b> <span class="muted">3 mph, 24 miles/day.</span></p>
          <p><b>Slow.</b> <span class="muted">2 mph, 18 miles/day. The party can move stealthily.</span></p>
          <p><b>Difficult terrain.</b> <span class="muted">Half speed.</span></p>
          <p><b>Forced march.</b> <span class="muted">Each hour past 8: Con save DC 10 + 1 per extra hour, or one level of exhaustion.</span></p>
          <p><b>Gallop.</b> <span class="muted">A mount can double fast pace for about 1 hour.</span></p>
          <p><b>Ships.</b> <span class="muted">Can sail around the clock with a sufficient crew.</span></p>
        </div>
      </div>`;

    const out = container.querySelector('#t-out');
    const calc = () => {
      const dist = Number(container.querySelector('#t-dist').value) || 0;
      const mode = container.querySelector('#t-mode').value;
      const paceKey = container.querySelector('#t-pace').value;
      const terrain = Number(container.querySelector('#t-terrain').value);
      const hoursPerDay = Math.min(24, Math.max(1, Number(container.querySelector('#t-hours').value) || 8));
      const isShip = mode.startsWith('ship:');

      container.querySelector('#t-pace-wrap').style.display = isShip ? 'none' : '';
      container.querySelector('#t-hours-wrap').style.display = isShip ? 'none' : '';

      let mph, dailyHours, notes = [];
      if (isShip) {
        mph = SHIPS[mode.slice(5)] * terrain;
        dailyHours = 24;
        notes.push('Ships can travel 24 hours a day with a full crew.');
      } else {
        const pace = PACES[paceKey];
        mph = pace.mph * terrain;
        dailyHours = hoursPerDay;
        if (pace.note) notes.push(pace.note + '.');
        if (mode === 'mounted') notes.push('Mounted: you can gallop (double fast pace) for about 1 hour a day.');
        if (hoursPerDay > 8) notes.push(`Forced march: hours 9-${hoursPerDay} each require a Con save (DC ${10 + 1}` +
          ` for hour 9, +1 per additional hour, up to DC ${10 + hoursPerDay - 8}) or a level of exhaustion.`);
      }
      if (terrain < 1) notes.push('Difficult terrain: speed halved (already applied).');

      const milesPerDay = mph * dailyHours;
      const totalHours = dist / mph;
      const days = Math.floor(totalHours / dailyHours);
      const remHours = totalHours - days * dailyHours;

      out.innerHTML = `
        <p class="roll-result-big" style="font-size:1.8rem">${days > 0 ? `${days} day${days === 1 ? '' : 's'}, ` : ''}${remHours.toFixed(1)} hours</p>
        <p class="center muted">${mph.toFixed(1)} mph, ${milesPerDay.toFixed(0)} miles per travel day</p>
        ${notes.map(n => `<p class="small muted">${n}</p>`).join('')}`;
    };

    container.querySelectorAll('input,select').forEach(x => x.addEventListener('input', calc));
    calc();
  },
};
