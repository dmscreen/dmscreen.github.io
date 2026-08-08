// Quest Hook + Rumor Generator.
import { loadTables } from '../srd.js';
import { esc } from '../components/ui.js';
import { historyList, timeStamp } from '../components/history.js';
import { pick } from '../dice.js';

const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// lowercase a leading capital so table entries read mid-sentence, but leave
// acronyms and all-caps words alone
const lowerFirst = (s) => (/^[A-Z](?![A-Z])/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const stripDot = (s) => s.replace(/\s*\.\s*$/, '');
const b = (s) => `<b>${esc(s)}</b>`;
// don't stack a period on top of ! or ?
const endSentence = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);

// "My cousin told me about a child, and they got drunk, and discovered a new
// disease, and now people are disappearing!" (rolled parts in bold)
function rollNews(news) {
  const picks = news.parts.map(p => pick(p.rows));
  const values = picks.map(v => stripDot(lowerFirst(v)));
  const html = news.parts.map((p, i) => {
    const lead = i === 0 ? `${news.lead} ` : `${p.connector} `;
    return `${lead}${b(values[i])}`;
  }).join(', ');
  // the closing period goes outside the bold, and only if the last entry
  // doesn't already end in punctuation of its own
  const tail = /[.!?]$/.test(values[values.length - 1]) ? '' : '.';
  return { html: capFirst(html) + tail, picks };
}

// "I heard that, a year ago from tonight, the king was seen with a prostitute
// down near the docks, and nearby there was a dead commoner. I heard it from a
// shopkeeper, so it might be true."
function rollBuilder(builder) {
  const picks = builder.map(part => pick(part.rows));
  let out = '';
  builder.forEach((part, i) => {
    const value = stripDot(picks[i]);
    if (part.before) out += `${out && !out.endsWith(' ') ? ' ' : ''}${part.before} `;
    else if (out && !out.endsWith(' ')) out += ' ';
    out += b(value);
    out += part.after || '';
  });
  return { html: out.replace(/\s+/g, ' ').trim(), picks };
}

export default {
  id: 'quests', title: 'Quest Hooks', shortTitle: 'Quests', group: 'Generators', icon: 'quest',
  subtitle: 'Improvised side content, assembled from parts',

  async render(container) {
    const [q, rumorData] = await Promise.all([loadTables('quests'), loadTables('rumors')]);

    container.innerHTML = `
      <div class="row mb">
        <button class="btn primary" id="q-gen">Generate hook</button>
        <button class="btn primary" id="q-rumors">Generate rumors</button>
      </div>
      <div id="q-history"></div>`;

    const history = await historyList({
      container: container.querySelector('#q-history'),
      key: 'history:quests',
      title: 'Generated hooks & rumors',
      renderEntry: (h, body) => {
        if (h.kind === 'rumors') {
          body.innerHTML = `
            <div><span class="pill accent">rumors</span> <span class="small faint">${timeStamp(h.ts)}</span></div>
            <p><b>Word on the street.</b> <span class="muted">${esc(h.gossip)}</span></p>
            <p><b>Did you hear the news?</b> <span class="muted">${h.news}</span></p>
            <p><b>They say...</b> <span class="muted">${h.builder}</span></p>`;
          return;
        }
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

    container.querySelector('#q-rumors').addEventListener('click', () => history.add({
      kind: 'rumors',
      gossip: pick(rumorData.gossip),
      news: rollNews(rumorData.news).html,
      builder: rollBuilder(rumorData.builder).html,
    }));
  },
};
