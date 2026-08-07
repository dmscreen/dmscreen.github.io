// Weather Generator with SRD mechanical notes.
import { el, esc } from '../components/ui.js';
import { roll, pick } from '../dice.js';

const CLIMATES = {
  temperate: { spring: 55, summer: 78, fall: 55, winter: 35 },
  cold: { spring: 35, summer: 60, fall: 35, winter: 10 },
  arid: { spring: 75, summer: 100, fall: 75, winter: 55 },
  tropical: { spring: 85, summer: 90, fall: 85, winter: 78 },
};

const FLAVOR = {
  clear: ['A cloudless sky.', 'Thin, high clouds drift by.', 'Bright and open weather.'],
  light: ['A steady drizzle.', 'Patchy showers come and go.', 'A light, cold mist hangs in the air.'],
  heavy: ['Sheets of rain hammer down.', 'A rolling storm with distant thunder.', 'Visibility drops as the downpour thickens.'],
  snowL: ['Light flurries dust the ground.', 'Slow, fat snowflakes fall.'],
  snowH: ['A driving snowstorm.', 'Whiteout conditions in a howling wind.'],
};

export default {
  id: 'weather', title: 'Weather Generator', shortTitle: 'Weather', group: 'Travel', icon: 'cloud',
  subtitle: 'Roll the sky for today',

  async render(container) {
    container.innerHTML = `
      <div class="card">
        <div class="row">
          <label class="field"><span>Climate</span><select id="w-climate">${Object.keys(CLIMATES).map(c => `<option ${c === 'temperate' ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label class="field"><span>Season</span><select id="w-season"><option>spring</option><option selected>summer</option><option>fall</option><option>winter</option></select></label>
          <button class="btn primary" id="w-roll">Roll weather</button>
        </div>
        <div id="w-out" class="mt"></div>
      </div>`;

    const out = container.querySelector('#w-out');
    const gen = () => {
      const climate = container.querySelector('#w-climate').value;
      const season = container.querySelector('#w-season').value;
      const base = CLIMATES[climate][season];
      const temp = base + roll('2d10').total - 11;

      const windRoll = roll('1d20').total;
      const wind = windRoll <= 12 ? 'calm' : windRoll <= 17 ? 'light wind' : 'strong wind';

      let precipRoll = roll('1d20').total;
      if (climate === 'arid') precipRoll -= 5;
      if (climate === 'tropical') precipRoll += 3;
      const precip = precipRoll <= 12 ? 'none' : precipRoll <= 17 ? 'light' : 'heavy';

      const snowing = temp <= 32 && precip !== 'none';
      const desc = precip === 'none' ? pick(FLAVOR.clear)
        : snowing ? pick(precip === 'heavy' ? FLAVOR.snowH : FLAVOR.snowL)
        : pick(precip === 'heavy' ? FLAVOR.heavy : FLAVOR.light);

      const notes = [];
      if (temp <= 0) notes.push('Extreme cold: DC 10 Con save each hour or gain a level of exhaustion (cold resistance or cold-weather gear negates).');
      if (temp >= 100) notes.push('Extreme heat: Con save each hour without water (DC 5, +1 per additional hour) or gain a level of exhaustion. Disadvantage in heavy armor.');
      if (wind === 'strong wind') notes.push('Strong wind: disadvantage on ranged weapon attacks and hearing-based Perception; open flames are extinguished, fog dispersed.');
      if (precip === 'heavy') notes.push('Heavy precipitation: lightly obscures everything, disadvantage on sight-based Perception; douses open flames.');
      if (snowing && precip === 'heavy') notes.push('Deep snow is difficult terrain.');

      out.innerHTML = `
        <p class="roll-result-big" style="font-size:2rem">${temp} F</p>
        <p class="center">${esc(desc)}</p>
        <p class="center muted">${wind}${precip !== 'none' ? `, ${precip} ${snowing ? 'snow' : 'rain'}` : ''}</p>
        ${notes.map(n => `<p class="small muted">${esc(n)}</p>`).join('') || '<p class="small faint center">No mechanical effects.</p>'}`;
    };

    container.querySelector('#w-roll').addEventListener('click', gen);
    gen();
  },
};
