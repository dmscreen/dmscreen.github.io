// Quest Hook + Rumor Generator.
import { loadTables } from '../srd.js';
import { esc } from '../components/ui.js';
import { historyList, timeStamp } from '../components/history.js';
import { pick, roll } from '../dice.js';

// A whole quest, built to the taxonomy in reference/quest-anatomy.md. Not
// every quest wants every part of it: "kill the kobolds" is a real quest and
// giving it a lore payoff, a moral choice and three phases would be worse,
// not better. Each shape carries a depth, and depth decides how much of the
// anatomy is filled in.
//
//   1  a job: who asked, what to do, what it pays
//   2  a job with a shape: why it exists, what it costs to fail, who is in
//      the way, and more than one thing to do
//   3  the full anatomy: prerequisites, twist, hidden objective, branching
//      solutions, outcome variants, consequences
const pickWeighted = (rows) => {
  const total = rows.reduce((a, r) => a + (r.weight || 1), 0);
  let n = Math.random() * total;
  for (const r of rows) { n -= (r.weight || 1); if (n < 0) return r; }
  return rows[rows.length - 1];
};

// Some, without repeats, and never more than there are.
const someOf = (arr, n) => {
  const copy = [...arr];
  const out = [];
  while (out.length < n && copy.length) out.push(...copy.splice(Math.floor(Math.random() * copy.length), 1));
  return out;
};

function buildQuest(Q) {
  const shape = pickWeighted(Q.shapes);
  const depth = shape.depth;
  const [lo, hi] = shape.objectives;
  const count = lo + Math.floor(Math.random() * (hi - lo + 1));

  // One objective per line: a verb, a target, sometimes a quantity, a place,
  // and at this depth sometimes a constraint on how it is done.
  const kinds = someOf(shape.kinds, Math.min(count, shape.kinds.length));
  while (kinds.length < count) kinds.push(pick(shape.kinds));
  const usedTargets = new Set();
  const objectives = kinds.map((kind, i) => {
    const pool = (Q.targets[kind] || []).filter(t => !usedTargets.has(t));
    const target = pool.length ? pick(pool) : pick(Q.targets[kind] || ['it']);
    usedTargets.add(target);
    const qty = (kind === 'kill' || kind === 'collect') && Math.random() < 0.7
      ? roll(kind === 'collect' ? '1d6+2' : '1d4+2').total : null;
    return {
      text: `${Q.verbPhrases[kind] || 'Deal with'} ${qty ? `${qty} of ` : ''}${target}`,
      place: Math.random() < 0.7 ? pick(Q.places) : null,
      constraint: depth >= 2 && Math.random() < (depth >= 3 ? 0.5 : 0.3) ? pick(Q.constraints) : null,
      optional: depth >= 2 && i === kinds.length - 1 && kinds.length > 1 && Math.random() < 0.3,
    };
  });

  const q = {
    kind: 'quest',
    shape: shape.label,
    depth,
    // 1. Acquisition
    giver: pick(Q.givers),
    pitch: pick(Q.pitches),
    prerequisite: depth >= 3 && Math.random() < 0.6 ? pick(Q.prerequisites) : null,
    walkAway: depth >= 2 ? pick(Q.walkAway) : null,
    // 2. Narrative
    premise: depth >= 2 ? shape.premise : null,
    stakes: depth >= 2 ? pick(Q.stakes) : null,
    antagonist: depth >= 2 ? pick(Q.antagonists) : null,
    twist: depth >= 3 ? pick(Q.twists) : null,
    moralChoice: depth >= 3 && Math.random() < 0.6 ? pick(Q.moralChoices) : null,
    lore: depth >= 3 && Math.random() < 0.5 ? pick(Q.lore) : null,
    // 3. Objectives
    objectives,
    hidden: depth >= 3 && Math.random() < 0.6 ? pick(Q.hiddenObjectives) : null,
    solutions: depth >= 3 ? someOf(Q.solutions, 3) : [],
    // 4. Resolution
    turnIn: pick(Q.turnIns),
    outcomes: depth >= 3 ? someOf(Q.outcomes, 3) : (depth === 2 ? someOf(Q.outcomes, 2) : []),
    debrief: depth >= 3 ? pick(Q.debriefs) : null,
    // 5. Rewards
    reward: pick(Q.rewardsCoin),
    rewardChoice: depth >= 2 && Math.random() < 0.5 ? pick(Q.rewardsChoice) : null,
    unlock: depth >= 3 && Math.random() < 0.6 ? pick(Q.rewardsUnlock) : null,
    reputation: depth >= 2 && Math.random() < 0.6 ? pick(Q.rewardsRep) : null,
    narrative: depth >= 3 && Math.random() < 0.6 ? pick(Q.rewardsNarrative) : null,
    hiddenBonus: depth >= 3 && Math.random() < 0.5 ? pick(Q.rewardsHidden) : null,
    // 6. Consequences
    worldChange: depth >= 2 && Math.random() < 0.7 ? pick(Q.worldChanges) : null,
    followUp: depth >= 3 ? pick(Q.followUps) : null,
    memory: depth >= 3 && Math.random() < 0.7 ? pick(Q.memory) : null,
  };
  return q;
}

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
        <button class="btn primary" id="q-quest" title="A whole quest: who asked, what it is, what to do, how it ends and what it changes">Generate quest</button>
        <button class="btn primary" id="q-gen">Generate hook</button>
        <button class="btn primary" id="q-rumors">Generate rumors</button>
      </div>
      <div id="q-history"></div>`;

    const history = await historyList({
      container: container.querySelector('#q-history'),
      key: 'history:quests',
      title: 'Generated hooks & rumors',
      renderEntry: (h, body) => {
        if (h.kind === 'quest') {
          const sect = (title, rows) => {
            const kept = rows.filter(Boolean);
            if (!kept.length) return '';
            return `<p class="small"><b>${title}.</b> <span class="muted">${kept.join(' ')}</span></p>`;
          };
          const line = (label, v) => (v ? `<b>${label}</b> ${esc(capFirst(stripDot(v)))}.` : '');
          body.innerHTML = `
            <div><span class="pill accent">${esc(h.shape.toLowerCase())}</span>
              <span class="small faint">${timeStamp(h.ts)}</span></div>
            <p><b>${esc(capFirst(stripDot(h.giver)))}</b> is asking. <span class="muted">${esc(h.pitch)}</span></p>
            ${sect('The job', [
              h.premise ? esc(h.premise) : '',
              line('If it is left', h.stakes),
              line('In the way', h.antagonist),
              line('First they have to', h.prerequisite),
              h.walkAway ? esc(h.walkAway) : '',
            ])}
            <p class="small"><b>Objectives.</b></p>
            <ul class="small quest-objectives">${h.objectives.map(o => `<li>${esc(o.text)}${
              o.place ? ` <span class="muted">at ${esc(o.place)}</span>` : ''}${
              o.constraint ? ` <span class="muted">&mdash; ${esc(o.constraint)}</span>` : ''}${
              o.optional ? ' <span class="pill">optional</span>' : ''}</li>`).join('')}${
              h.hidden ? `<li class="quest-hidden"><span class="pill danger">hidden</span> ${esc(capFirst(h.hidden))}</li>` : ''}</ul>
            ${h.solutions.length ? `<p class="small"><b>Ways through.</b> <span class="muted">${
              h.solutions.map(x => esc(stripDot(x))).join('; ')}.</span></p>` : ''}
            ${sect('Ending it', [
              line('Turn in', h.turnIn),
              line('Twist', h.twist),
              line('The choice', h.moralChoice),
              line('Behind it all', h.lore),
              line('Afterwards', h.debrief),
            ])}
            ${h.outcomes.length ? `<p class="small"><b>How it can land.</b></p>
              <ul class="small quest-objectives">${h.outcomes.map(o =>
                `<li><span class="pill ${o.kind === 'success' ? 'success' : o.kind === 'failure' ? 'danger' : ''}">${esc(o.kind)}</span> ${esc(o.text)}</li>`).join('')}</ul>` : ''}
            ${sect('Pays', [
              line('Coin', h.reward),
              line('Or pick one of', h.rewardChoice),
              line('Opens up', h.unlock),
              line('Standing', h.reputation),
              line('And', h.narrative),
              line('If they looked', h.hiddenBonus),
            ])}
            ${sect('Afterwards', [
              line('The world', h.worldChange),
              line('This leads on', h.followUp),
              line('They remember', h.memory),
            ])}`;
          return;
        }
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

    container.querySelector('#q-quest').addEventListener('click', () => history.add(buildQuest(q.quest)));

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
