// Calendar & Time Tracker: in-world date, watches, and events.
import { getState, setState, dbAll, dbPut, dbDelete, activeCampaignId } from '../store.js';
import { el, esc, promptDialog, confirmDialog, modal, toast } from '../components/ui.js';

const WATCHES = ['Late night (0-4)', 'Dawn (4-8)', 'Morning (8-12)', 'Afternoon (12-16)', 'Evening (16-20)', 'Night (20-24)'];
const DEFAULT_CAL = {
  year: 1490,
  weekdays: ['Firstday', 'Seconday', 'Thirday', 'Fourthday', 'Fifthday', 'Sixthday', 'Seventhday'],
  months: [
    { name: 'Deepwinter', days: 30 }, { name: 'Thawing', days: 30 }, { name: 'Firstseed', days: 30 },
    { name: 'Rainmoon', days: 30 }, { name: 'Blossom', days: 30 }, { name: 'Highsun', days: 30 },
    { name: 'Suncrest', days: 30 }, { name: 'Harvestide', days: 30 }, { name: 'Fadingsun', days: 30 },
    { name: 'Leaffall', days: 30 }, { name: 'Frostmoon', days: 30 }, { name: 'Yearsend', days: 30 },
  ],
};

export default {
  id: 'calendar', title: 'Calendar & Time', shortTitle: 'Calendar', group: 'Travel', icon: 'calendar',
  subtitle: 'Track the in-world date and time of day',

  async render(container) {
    let cal = (await getState('calendarConfig')) || structuredClone(DEFAULT_CAL);
    let now = (await getState('calendarNow')) || { year: cal.year, month: 0, day: 1, watch: 2 };
    const save = () => Promise.all([setState('calendarConfig', cal), setState('calendarNow', now)]);

    const totalDayIndex = () => {
      let d = 0;
      for (let i = 0; i < now.month; i++) d += cal.months[i].days;
      return d + now.day - 1;
    };

    const advance = async (watches) => {
      now.watch += watches;
      while (now.watch >= WATCHES.length) {
        now.watch -= WATCHES.length;
        now.day++;
        if (now.day > cal.months[now.month].days) {
          now.day = 1; now.month++;
          if (now.month >= cal.months.length) { now.month = 0; now.year++; }
        }
      }
      await save(); draw();
    };

    const dateKey = (y, m, d) => `${y}-${m}-${d}`;

    const draw = async () => {
      const events = await dbAll('calendarEvents', activeCampaignId());
      const month = cal.months[now.month];
      const weekdayName = cal.weekdays[totalDayIndex() % cal.weekdays.length];
      const eventsByDay = new Map();
      for (const ev of events) {
        if (!eventsByDay.has(ev.dateKey)) eventsByDay.set(ev.dateKey, []);
        eventsByDay.get(ev.dateKey).push(ev);
      }

      container.innerHTML = `
        <div class="grid-2">
          <div class="card">
            <h2>${esc(weekdayName)}, ${now.day} ${esc(month.name)}, ${now.year}</h2>
            <p class="muted">${esc(WATCHES[now.watch])}</p>
            <div class="row mt">
              <button class="btn" id="c-watch">+1 watch (4 h)</button>
              <button class="btn" id="c-day">+1 day</button>
              <button class="btn" id="c-week">+1 week</button>
              <button class="btn" id="c-set">Set date...</button>
              <button class="btn" id="c-config">Edit calendar...</button>
            </div>
            <h3 class="mt">Today's events</h3>
            <div id="c-today"></div>
            <button class="btn small mt" id="c-add-event">+ Add event on this day</button>
          </div>
          <div class="card">
            <h2>${esc(month.name)} ${now.year}</h2>
            <div class="table-scroll"><table class="data"><thead><tr>${cal.weekdays.map(w => `<th>${esc(w.slice(0, 3))}</th>`).join('')}</tr></thead><tbody id="c-grid"></tbody></table></div>
          </div>
        </div>
        <div class="card"><h2>All events</h2><div id="c-all"></div></div>`;

      // month grid
      const firstIdx = (totalDayIndex() - (now.day - 1)) % cal.weekdays.length;
      const grid = container.querySelector('#c-grid');
      let html = '<tr>' + '<td></td>'.repeat(firstIdx);
      let col = firstIdx;
      for (let d = 1; d <= month.days; d++) {
        const key = dateKey(now.year, now.month, d);
        const has = eventsByDay.has(key);
        html += `<td style="${d === now.day ? 'background:var(--bg-raised);outline:1px solid var(--accent);' : ''}${has ? 'color:var(--accent);font-weight:700;' : ''}cursor:pointer" data-day="${d}">${d}</td>`;
        col++;
        if (col % cal.weekdays.length === 0 && d < month.days) html += '</tr><tr>';
      }
      html += '</tr>';
      grid.innerHTML = html;
      grid.querySelectorAll('[data-day]').forEach(td => td.addEventListener('click', () => {
        now.day = Number(td.dataset.day);
        save().then(draw);
      }));

      // today's events
      const todayKey = dateKey(now.year, now.month, now.day);
      const today = eventsByDay.get(todayKey) || [];
      container.querySelector('#c-today').innerHTML = today.length
        ? today.map(ev => `<p>${esc(ev.text)}</p>`).join('')
        : '<p class="faint small">Nothing scheduled.</p>';

      // all events
      const allEl = container.querySelector('#c-all');
      const sorted = events.sort((a, b) => a.sortKey - b.sortKey);
      allEl.innerHTML = sorted.length ? '' : '<p class="faint small">No events logged. Use them for festivals, deadlines, ransom due dates, full moons...</p>';
      for (const ev of sorted) {
        const [y, m, d] = ev.dateKey.split('-').map(Number);
        const row = el(`<div class="row" style="align-items:center;padding:3px 0">
          <span class="pill">${d} ${esc(cal.months[m]?.name || '?')} ${y}</span>
          <span>${esc(ev.text)}</span>
          <button class="btn small danger" style="margin-left:auto">Del</button>
        </div>`);
        row.querySelector('button').addEventListener('click', () =>
          confirmDialog('Delete this event?', async () => { await dbDelete('calendarEvents', ev.id); draw(); }));
        allEl.append(row);
      }

      container.querySelector('#c-watch').addEventListener('click', () => advance(1));
      container.querySelector('#c-day').addEventListener('click', () => advance(WATCHES.length));
      container.querySelector('#c-week').addEventListener('click', () => advance(WATCHES.length * cal.weekdays.length));
      container.querySelector('#c-add-event').addEventListener('click', () => {
        promptDialog('Add event', [{ key: 'text', label: `Event on ${now.day} ${cal.months[now.month].name} ${now.year}` }], async ({ text }) => {
          if (!text.trim()) return false;
          await dbPut('calendarEvents', {
            campaignId: activeCampaignId(), dateKey: todayKey, text: text.trim(),
            sortKey: now.year * 100000 + now.month * 100 + now.day,
          });
          draw();
        });
      });
      container.querySelector('#c-set').addEventListener('click', () => {
        promptDialog('Set date', [
          { key: 'year', label: 'Year', type: 'number', value: now.year },
          { key: 'month', label: 'Month', type: 'select', value: String(now.month), options: cal.months.map((m, i) => ({ value: String(i), label: m.name })) },
          { key: 'day', label: 'Day', type: 'number', value: now.day },
          { key: 'watch', label: 'Time', type: 'select', value: String(now.watch), options: WATCHES.map((w, i) => ({ value: String(i), label: w })) },
        ], async (out) => {
          now = {
            year: out.year, month: Number(out.month),
            day: Math.min(Math.max(1, out.day), cal.months[Number(out.month)].days),
            watch: Number(out.watch),
          };
          await save(); draw();
        });
      });
      container.querySelector('#c-config').addEventListener('click', () => {
        const body = el(`<div>
          <p class="small muted mb">One month per line, as <b>Name, days</b>. Weekdays comma-separated.</p>
          <label class="field mb"><span>Months</span><textarea id="cc-months" rows="12">${cal.months.map(m => `${m.name}, ${m.days}`).join('\n')}</textarea></label>
          <label class="field"><span>Weekdays</span><input id="cc-weekdays" value="${esc(cal.weekdays.join(', '))}"></label>
        </div>`);
        modal('Edit calendar', body, {
          actions: [
            { label: 'Cancel', onClick: () => {} },
            {
              label: 'Save', class: 'primary',
              onClick: () => {
                const months = body.querySelector('#cc-months').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
                  const idx = l.lastIndexOf(',');
                  return { name: l.slice(0, idx).trim(), days: Math.max(1, parseInt(l.slice(idx + 1), 10) || 30) };
                }).filter(m => m.name);
                const weekdays = body.querySelector('#cc-weekdays').value.split(',').map(s => s.trim()).filter(Boolean);
                if (!months.length || !weekdays.length) { toast('Need at least one month and one weekday', 'danger'); return false; }
                cal.months = months; cal.weekdays = weekdays;
                now.month = Math.min(now.month, months.length - 1);
                now.day = Math.min(now.day, months[now.month].days);
                save().then(draw);
              },
            },
          ],
        });
      });
    };

    await draw();
  },
};
