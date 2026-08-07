// Dice Roller tool.
import { roll } from '../dice.js';
import { el, esc, toast } from '../components/ui.js';
import { getState, setState } from '../store.js';

const QUICK = ['1d4', '1d6', '1d8', '1d10', '1d12', '1d20', '1d100'];
const COMMON = [
  ['Advantage', '2d20kh1'], ['Disadvantage', '2d20kl1'],
  ['Stats (4d6kh3)', '4d6kh3'], ['2d6', '2d6'], ['8d6 (fireball)', '8d6'],
];

export default {
  id: 'dice', title: 'Dice Roller', shortTitle: 'Dice', group: 'Combat', icon: 'd20',
  subtitle: 'Roll anything: 3d6+2, 4d6kh3, 2d20kl1',

  async render(container) {
    let history = (await getState('diceHistory', [])) || [];

    container.innerHTML = `
      <div class="grid-2">
        <div>
          <div class="card">
            <div class="roll-result-big" id="roll-total">--</div>
            <div class="roll-detail" id="roll-detail">Roll something</div>
            <div class="row mt">
              <input type="text" id="dice-expr" class="grow" placeholder="e.g. 3d6+2" autocomplete="off">
              <button class="btn primary" id="roll-btn">Roll</button>
            </div>
            <div class="row mt" id="quick-btns"></div>
            <div class="row mt" id="common-btns"></div>
          </div>
        </div>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <h2 style="margin:0">History</h2>
            <button class="btn small" id="clear-history">Clear</button>
          </div>
          <div id="dice-history" class="mt"></div>
        </div>
      </div>`;

    const totalEl = container.querySelector('#roll-total');
    const detailEl = container.querySelector('#roll-detail');
    const exprInput = container.querySelector('#dice-expr');
    const historyEl = container.querySelector('#dice-history');

    const renderHistory = () => {
      historyEl.innerHTML = history.length
        ? `<table class="data"><tbody>${history.map((h, i) =>
            `<tr class="clickable" data-i="${i}" data-expr="${esc(h.expr)}" title="Click to re-roll"><td class="muted small">${esc(h.expr)}</td><td class="small faint">${esc(h.detail)}</td><td style="text-align:right;font-family:var(--font-mono)"><b>${h.total}</b></td><td style="text-align:right;width:30px"><button class="btn small icon-btn" data-remove title="Remove" aria-label="Remove roll" style="padding:1px 8px">&times;</button></td></tr>`
          ).join('')}</tbody></table>`
        : '<p class="faint center">No rolls yet</p>';
      historyEl.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', () => doRoll(tr.dataset.expr));
        tr.querySelector('[data-remove]').addEventListener('click', async (e) => {
          e.stopPropagation();
          history.splice(Number(tr.dataset.i), 1);
          renderHistory();
          await setState('diceHistory', history);
        });
      });
    };

    const doRoll = async (expr) => {
      try {
        const r = roll(expr);
        totalEl.textContent = r.total;
        detailEl.textContent = `${r.expr} = ${r.detail}`;
        history.unshift({ expr: r.expr, total: r.total, detail: r.detail });
        history = history.slice(0, 50);
        renderHistory();
        await setState('diceHistory', history);
      } catch (err) {
        toast(err.message, 'danger');
      }
    };

    container.querySelector('#roll-btn').addEventListener('click', () => exprInput.value.trim() && doRoll(exprInput.value.trim()));
    exprInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && exprInput.value.trim()) doRoll(exprInput.value.trim()); });

    const quick = container.querySelector('#quick-btns');
    for (const q of QUICK) {
      const b = el(`<button class="btn small">${q.replace('1d', 'd')}</button>`);
      b.addEventListener('click', () => doRoll(q));
      quick.append(b);
    }
    const common = container.querySelector('#common-btns');
    for (const [label, expr] of COMMON) {
      const b = el(`<button class="btn small">${esc(label)}</button>`);
      b.addEventListener('click', () => doRoll(expr));
      common.append(b);
    }
    container.querySelector('#clear-history').addEventListener('click', async () => {
      history = [];
      renderHistory();
      await setState('diceHistory', history);
    });

    renderHistory();
  },
};
