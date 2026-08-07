// Quest Hook Generator: patron, goal, complication, twist, reward.
import { loadTables } from '../srd.js';
import { esc } from '../components/ui.js';
import { historyList, timeStamp } from '../components/history.js';
import { pick } from '../dice.js';

const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export default {
  id: 'quests', title: 'Quest Hooks', shortTitle: 'Quests', group: 'Generators', icon: 'quest',
  subtitle: 'Improvised side content, assembled from parts',

  async render(container) {
    const q = await loadTables('quests');

    container.innerHTML = `
      <div class="row mb"><button class="btn primary" id="q-gen">Generate hook</button></div>
      <div id="q-history"></div>`;

    const history = await historyList({
      container: container.querySelector('#q-history'),
      key: 'history:quests',
      title: 'Generated hooks',
      renderEntry: (h, body) => {
        body.innerHTML = `
          <p><b>${esc(capFirst(h.patron))}</b> needs the party to <b>${esc(h.goal)}</b>. <span class="small faint">${timeStamp(h.ts)}</span></p>
          <p class="small"><b>Complication.</b> <span class="muted">${esc(capFirst(h.complication))}.</span></p>
          <p class="small"><b>Twist.</b> <span class="muted">${esc(capFirst(h.twist))}.</span></p>
          <p class="small"><b>Reward.</b> <span class="muted">${esc(capFirst(h.reward))}.</span></p>`;
      },
    });

    container.querySelector('#q-gen').addEventListener('click', () => history.add({
      patron: pick(q.patrons), goal: pick(q.goals), complication: pick(q.complications),
      twist: pick(q.twists), reward: pick(q.rewards),
    }));
  },
};
