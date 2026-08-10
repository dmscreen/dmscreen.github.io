// Dice expression parser and roller.
// Supports: "3d6+2", "d20", "4d6kh3" (keep highest), "2d20kl1" (keep lowest),
// multi-term "1d8+1d6+3", subtraction "2d6-1".

const TERM_RE = /([+-])?\s*(?:(\d*)d(\d+)(?:(kh|kl)(\d+))?|(\d+))/gi;

export function roll(expr) {
  const terms = [];
  let total = 0;
  let matched = 0;
  expr = String(expr).trim();
  if (!expr) throw new Error('Empty roll');

  let m;
  TERM_RE.lastIndex = 0;
  while ((m = TERM_RE.exec(expr)) !== null) {
    matched += m[0].length;
    const sign = m[1] === '-' ? -1 : 1;
    if (m[6] !== undefined) {
      const v = parseInt(m[6], 10);
      total += sign * v;
      terms.push({ text: `${sign < 0 ? '-' : '+'}${v}`, flat: v * sign });
      continue;
    }
    const count = m[2] ? parseInt(m[2], 10) : 1;
    const sides = parseInt(m[3], 10);
    if (count < 1 || count > 200 || sides < 2 || sides > 1000) throw new Error('Dice out of range');
    const keepMode = m[4] ? m[4].toLowerCase() : null;
    const keepN = m[5] ? parseInt(m[5], 10) : count;

    const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
    let kept = rolls;
    if (keepMode) {
      const sorted = [...rolls].sort((a, b) => keepMode === 'kh' ? b - a : a - b);
      kept = sorted.slice(0, Math.min(keepN, count));
    }
    const sum = kept.reduce((a, b) => a + b, 0);
    total += sign * sum;
    terms.push({ text: `${count}d${sides}${keepMode ? keepMode + keepN : ''}`, rolls, kept, sum: sum * sign, sides });
  }

  const stripped = expr.replace(/\s/g, '');
  const consumed = expr.replace(TERM_RE, '').replace(/\s/g, '');
  if (!terms.length || consumed.length) throw new Error(`Can't parse "${expr}"`);

  return { expr: stripped, total, terms, detail: detailString(terms) };
}

function detailString(terms) {
  return terms.map(t => {
    if (t.flat !== undefined) return t.text;
    const parts = t.rolls.map(r => {
      const used = t.kept.indexOf(r);
      const isKept = used !== -1;
      if (isKept) t.kept.splice(used, 1, NaN); // consume so duplicates display right
      const s = r === t.sides ? `${r}!` : String(r);
      return isKept ? s : `(${s})`;
    });
    return `${t.text}[${parts.join(',')}]`;
  }).join(' ');
}

// Roll several expressions at once: "3d6+2, 4d6kh3" gives one result per part.
// Separators are commas or semicolons; a single expression still works.
export function rollAll(input) {
  const parts = String(input).split(/[,;]+/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error('Empty roll');
  return parts.map(roll);
}

export const d20 = (mod = 0) => roll(`1d20${mod >= 0 ? '+' : ''}${mod}`);
export const advantage = (mod = 0) => roll(`2d20kh1${mod >= 0 ? '+' : ''}${mod}`);
export const disadvantage = (mod = 0) => roll(`2d20kl1${mod >= 0 ? '+' : ''}${mod}`);

export function rollTable(rows) {
  // rows: [{weight?, ...}] - returns a weighted random row
  const weights = rows.map(r => r.weight || 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let n = Math.random() * total;
  for (let i = 0; i < rows.length; i++) {
    n -= weights[i];
    if (n < 0) return rows[i];
  }
  return rows[rows.length - 1];
}

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
