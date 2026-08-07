// Quest Hook Generator: patron, goal, complication, twist, reward.
import { loadTables } from '../srd.js';
import { esc } from '../components/ui.js';
import { pick } from '../dice.js';

export default {
  id: 'quests', title: 'Quest Hooks', shortTitle: 'Quests', group: 'Generators', icon: 'quest',
  subtitle: 'Improvised side content, assembled from parts',

  async render(container) {
    const q = await loadTables('quests');

    container.innerHTML = `
      <div class="row mb"><button class="btn primary" id="q-gen">Generate hook</button></div>
      <div id="q-out"></div>`;

    const out = container.querySelector('#q-out');
    const gen = () => {
      const hook = {
        patron: pick(q.patrons), goal: pick(q.goals), complication: pick(q.complications),
        twist: pick(q.twists), reward: pick(q.rewards),
      };
      out.insertAdjacentHTML('afterbegin', `<div class="card">
        <p style="font-size:1.05rem"><b>${esc(hook.patron[0].toUpperCase() + hook.patron.slice(1))}</b> needs the party to <b>${esc(hook.goal)}</b>.</p>
        <p><b>Complication.</b> <span class="muted">${esc(hook.complication[0].toUpperCase() + hook.complication.slice(1))}.</span></p>
        <p><b>Twist.</b> <span class="muted">${esc(hook.twist[0].toUpperCase() + hook.twist.slice(1))}.</span></p>
        <p><b>Reward.</b> <span class="muted">${esc(hook.reward[0].toUpperCase() + hook.reward.slice(1))}.</span></p>
      </div>`);
    };

    container.querySelector('#q-gen').addEventListener('click', gen);
    gen();
  },
};
