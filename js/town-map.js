// Town geometry after Watabou's TownGeneratorOS, reimplemented from a read
// of its source. The pipeline is his: a spiral cloud of seed points becomes
// a Voronoi diagram, the cells nearest the centre become the town's wards,
// the central cell the plaza, the boundary of the built wards the wall,
// streets run from the gates to the plaza along ward edges, and each ward
// is carved into building lots by recursive bisection with alleys between
// the halves. Ward types come from his shuffled pool - craftsmen, merchant,
// cathedral, administration, slum, patriciate, market, military, park -
// and the countryside gets farms and trees. Everything returned is plain
// data in pixel coordinates, persisted with the campaign, so the town a DM
// saw yesterday is the town they see today.
//
// Buildings cannot stand in a road by construction rather than by check:
// streets follow ward borders, and every ward's buildable block is inset
// from its borders by the width of whatever runs along them.

const rnd = (a, b) => a + Math.random() * (b - a);
const chance = (p) => Math.random() < p;

/* ---------- convex polygon toolkit ------------------------------------- */

const area = (p) => {
  let s = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  return Math.abs(s) / 2;
};
const centroid = (p) => {
  let x = 0, y = 0;
  for (const [px, py] of p) { x += px; y += py; }
  return [x / p.length, y / p.length];
};
const inPoly = (p, x, y) => {
  let hit = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

// keep the part of a convex polygon with a*x + b*y <= c
const clipHalf = (poly, a, b, c) => {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dp = a * p[0] + b * p[1] - c, dq = a * q[0] + b * q[1] - c;
    if (dp <= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
};

// pull each edge inward by its own distance; convex input, convex output
const shrink = (poly, dists) => {
  let out = poly;
  const [cx, cy] = centroid(poly);
  for (let i = 0; i < poly.length && out.length > 2; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    let a = q[1] - p[1], b = p[0] - q[0];
    const len = Math.hypot(a, b) || 1;
    a /= len; b /= len;
    if (a * cx + b * cy - (a * p[0] + b * p[1]) < 0) { a = -a; b = -b; }   // inward-positive
    const d = Array.isArray(dists) ? dists[i] : dists;
    out = clipHalf(out, -a, -b, -(a * p[0] + b * p[1]) - d);
  }
  return out;
};

const round1 = (v) => Math.round(v * 10) / 10;
const cleanPoly = (p) => {
  const out = [];
  for (const [x, y] of p) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - x, last[1] - y) > 0.8) out.push([round1(x), round1(y)]);
  }
  if (out.length > 2) {
    const a = out[0], b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.8) out.pop();
  }
  return out;
};

/* ---------- voronoi by half-plane clipping ------------------------------ */

const voronoi = (seeds, R) => {
  const box = [[-R, -R], [R, -R], [R, R], [-R, R]];
  return seeds.map((s, i) => {
    let cell = box;
    for (let j = 0; j < seeds.length && cell.length > 2; j++) {
      if (j === i) continue;
      const q = seeds[j];
      const ax = q[0] - s[0], ay = q[1] - s[1];
      const c = (ax * (s[0] + q[0]) + ay * (s[1] + q[1])) / 2;
      cell = clipHalf(cell, ax, ay, c);
    }
    return cell;
  });
};

/* ---------- lots: recursive bisection with alleys ----------------------- */

const bisect = (poly, px, py, dx, dy, gap) => {
  const c = dx * px + dy * py;
  return [
    cleanPoly(clipHalf(poly, dx, dy, c - gap / 2)),
    cleanPoly(clipHalf(poly, -dx, -dy, -(c + gap / 2))),
  ];
};

const longestEdge = (poly) => {
  let best = 0, bl = -1;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (l > bl) { bl = l; best = i; }
  }
  return best;
};

// Watabou's createAlleys: cut across the longest edge at 40-60% of its
// length, the cut tilted by up to 30 degrees times the ward's chaos, an
// alley's width of daylight between the halves, until the pieces are lot
// sized. A few lots stay empty.
const makeLots = (poly, opt, depth = 0) => {
  const a = area(poly);
  const threshold = opt.minSq * Math.pow(2, 4 * opt.sizeChaos * (Math.random() - 0.5));
  if ((a < threshold && depth > 0) || depth > 9 || poly.length < 3) {
    if (a < opt.minSq * 0.22 || a > opt.minSq * 9) return [];   // slivers and failures
    if (chance(opt.emptyProb ?? 0.04)) return [];
    const lot = cleanPoly(shrink(poly, 0.8));
    return lot.length > 2 ? [lot] : [];
  }
  const i = longestEdge(poly);
  const p = poly[i], q = poly[(i + 1) % poly.length];
  const t = 0.4 + Math.random() * 0.2;
  const mx = p[0] + (q[0] - p[0]) * t, my = p[1] + (q[1] - p[1]) * t;
  let ang = Math.atan2(q[1] - p[1], q[0] - p[0]) + (Math.random() - 0.5) * (Math.PI / 3) * opt.gridChaos;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const halves = bisect(poly, mx, my, dx, dy, opt.alley);
  const out = [];
  for (const half of halves) {
    if (half.length > 2 && area(half) > 1) out.push(...makeLots(half, opt, depth + 1));
  }
  return out;
};

/* ---------- ward looks -------------------------------------------------- */

// Watabou's pool, verbatim: eleven craftsmen to one cathedral.
const WARD_POOL = [
  ...Array(11).fill('craftsmen'), 'merchant', 'merchant', 'cathedral', 'administration',
  'slum', 'slum', 'slum', 'slum', 'patriciate', 'patriciate', 'market', 'market',
  'military', 'park',
];
const LOTS = {
  craftsmen: { minSq: 150, gridChaos: 0.4, sizeChaos: 0.6, alley: 2.2 },
  gate: { minSq: 150, gridChaos: 0.5, sizeChaos: 0.7, alley: 2.2 },
  military: { minSq: 190, gridChaos: 0.2, sizeChaos: 0.3, alley: 2.6 },
  administration: { minSq: 240, gridChaos: 0.2, sizeChaos: 0.3, alley: 2.6 },
  merchant: { minSq: 240, gridChaos: 0.3, sizeChaos: 0.5, alley: 2.4 },
  patriciate: { minSq: 340, gridChaos: 0.2, sizeChaos: 0.4, alley: 3, emptyProb: 0.14 },
  slum: { minSq: 85, gridChaos: 0.7, sizeChaos: 0.9, alley: 1.7 },
  countryside: { minSq: 300, gridChaos: 0.3, sizeChaos: 0.6, alley: 3, emptyProb: 0.65 },
};

/* ---------- the sizes the campaign asks for ----------------------------- */

const SIZES = {
  hamlet: { nP: 5, wall: 0, citadel: 0, plaza: 0.3, U: 3.4 },
  village: { nP: 8, wall: 0.15, citadel: 0, plaza: 0.5, U: 3.2 },
  town: { nP: 12, wall: 0.65, citadel: 0.3, plaza: 0.7, U: 3 },
  'small city': { nP: 18, wall: 0.9, citadel: 0.5, plaza: 0.85, U: 2.7 },
};

/* ---------- the generator ----------------------------------------------- */

export function generateTownMap({ size = 'village', spots = 0, coast = 'no' } = {}) {
  const S = SIZES[size] || SIZES.village;
  const U = S.U;                                 // px per watabou unit
  const nP = S.nP;

  // seed cloud: his spiral, then squeezed and turned so no two towns share
  // a silhouette
  const squash = rnd(0.68, 1), turn = rnd(0, Math.PI);
  const nPts = nP * 8;
  let seeds = [[0, 0]];
  const a0 = rnd(0, Math.PI * 2);
  for (let i = 1; i < nPts; i++) {
    const a = a0 + Math.sqrt(i) * 5;
    const r = U * (10 + i * (2 + Math.random()));
    let x = Math.cos(a) * r, y = Math.sin(a) * r * squash;
    const xr = x * Math.cos(turn) - y * Math.sin(turn);
    const yr = x * Math.sin(turn) + y * Math.cos(turn);
    seeds.push([xr, yr]);
  }
  const R = U * (10 + nPts * 3.2) + 60;

  // Lloyd relaxation settles the cells into the rounded, even patches the
  // reference maps have
  let cells = voronoi(seeds, R);
  for (let k = 0; k < 3; k++) {
    seeds = cells.map((c, i) => (i === 0 || c.length < 3) ? seeds[i] : centroid(c));
    cells = voronoi(seeds, R);
  }

  // order by distance from the centre; that order IS the town plan
  let order = seeds.map((s, i) => ({ i, d: Math.hypot(s[0], s[1]) })).sort((a, b) => a.d - b.d);

  // the coast takes its side of the map before anything is built on it
  let water = null;
  if (coast !== 'no' && (coast === 'yes' || chance(0.35))) {
    const ca = rnd(0, Math.PI * 2);
    const nx = Math.cos(ca), ny = Math.sin(ca);
    const innerR = order[Math.min(nP, order.length - 1)].d || U * 40;
    const off = innerR * rnd(0.55, 0.85);
    const dry = order.filter(o => seeds[o.i][0] * nx + seeds[o.i][1] * ny <= off);
    if (dry.length >= nP + 3) {              // enough land left to build on
      water = { nx, ny, off };
      order = dry;
    }
  }

  const cityIdx = order.slice(0, nP).map(o => o.i);
  const citySet = new Set(cityIdx);
  const innerR = order[nP - 1].d || 60;
  const ringIdx = order.slice(nP, Math.min(order.length, Math.round(nP * 2.6)))
    .filter(o => o.d < innerR * 1.65).map(o => o.i);
  const walled = chance(S.wall);
  const hasPlaza = chance(S.plaza);
  const citadelIdx = S.citadel && chance(S.citadel) && order.length > nP ? order[nP].i : null;

  /* -- the wall: the outer boundary of the built wards ------------------- */
  const vkey = ([x, y]) => `${Math.round(x)},${Math.round(y)}`;
  const edgeCount = new Map();
  for (const ci of cityIdx) {
    const c = cells[ci];
    for (let i = 0; i < c.length; i++) {
      const a = c[i], b = c[(i + 1) % c.length];
      const k = [vkey(a), vkey(b)].sort().join('|');
      edgeCount.set(k, (edgeCount.get(k) || []).concat([[a, b]]));
    }
  }
  const boundary = [...edgeCount.values()].filter(v => v.length === 1).map(v => v[0]);
  const nextFrom = new Map(boundary.map(([a, b]) => [vkey(a), b]));
  let wallPts = [];
  if (boundary.length > 2) {
    let cur = boundary[0][0];
    for (let g = 0; g < boundary.length + 2; g++) {
      wallPts.push(cur);
      const nxt = nextFrom.get(vkey(cur));
      if (!nxt || (wallPts.length > 2 && vkey(nxt) === vkey(wallPts[0]))) break;
      cur = nxt;
    }
    wallPts = cleanPoly(wallPts);
  }

  // entrances: wall vertices that more than one ward meets, where a street
  // can actually continue inward
  const vertexWards = new Map();
  for (const ci of cityIdx) for (const v of cells[ci]) {
    const k = vkey(v);
    vertexWards.set(k, (vertexWards.get(k) || 0) + 1);
  }
  const entranceIdx = wallPts.map((v, i) => ({ v, i })).filter(o => (vertexWards.get(vkey(o.v)) || 0) > 1);
  const gates = [];
  {
    // his spacing rule: taking a gate removes its neighbours from the pool
    const pool = [...entranceIdx];
    const want = Math.max(2, Math.min(4, Math.round(nP / 5) + 1));
    while (pool.length && gates.length < want) {
      const at = Math.floor(Math.random() * pool.length);
      gates.push(pool[at]);
      pool.splice(Math.max(0, at - 1), Math.min(3, pool.length));
    }
    if (!gates.length && wallPts.length) gates.push({ v: wallPts[0], i: 0 });
  }

  /* -- streets: gate to plaza along ward edges --------------------------- */
  // graph over every ward-edge vertex, city and countryside both
  const adj = new Map();
  const link = (a, b) => {
    const ka = vkey(a), kb = vkey(b);
    if (!adj.has(ka)) adj.set(ka, { p: a, n: new Map() });
    if (!adj.has(kb)) adj.set(kb, { p: b, n: new Map() });
    const w = Math.hypot(a[0] - b[0], a[1] - b[1]);
    adj.get(ka).n.set(kb, w);
    adj.get(kb).n.set(ka, w);
  };
  for (const ci of [...cityIdx, ...ringIdx]) {
    const c = cells[ci];
    for (let i = 0; i < c.length; i++) link(c[i], c[(i + 1) % c.length]);
  }
  const dijkstra = (fromKey, goalKeys) => {
    const dist = new Map([[fromKey, 0]]), prev = new Map(), seen = new Set();
    const goal = new Set(goalKeys);
    for (let guard = 0; guard < adj.size + 2; guard++) {
      let bk = null, bd = Infinity;
      for (const [k, d] of dist) if (!seen.has(k) && d < bd) { bd = d; bk = k; }
      if (bk == null) break;
      if (goal.has(bk)) {
        const path = [];
        for (let k = bk; k != null; k = prev.get(k)) path.unshift(adj.get(k).p);
        return path;
      }
      seen.add(bk);
      for (const [nk, w] of adj.get(bk).n) {
        const nd = bd + w;
        if (nd < (dist.get(nk) ?? Infinity)) { dist.set(nk, nd); prev.set(nk, bk); }
      }
    }
    return null;
  };
  const plazaCell = cells[cityIdx[0]];
  const plazaKeys = plazaCell.map(vkey);
  // The polylines are NOT smoothed: the no-building-in-a-road guarantee
  // rests on streets lying exactly on the ward edges the blocks were inset
  // from, and smoothing pulled them off those edges and into the lots.
  // Round joins soften the corners instead.
  const streets = [];
  const streetEdges = new Set();
  for (const g of gates) {
    const path = dijkstra(vkey(g.v), plazaKeys);
    if (!path || path.length < 2) continue;
    for (let i = 0; i < path.length - 1; i++) {
      streetEdges.add([vkey(path[i]), vkey(path[i + 1])].sort().join('|'));
    }
    streets.push(path.map(p => [round1(p[0]), round1(p[1])]));
  }

  // roads: out of each gate, walking the countryside edges away from town
  const roads = [];
  for (const g of gates) {
    const pts = [g.v];
    let curK = vkey(g.v), prevK = null;
    for (let hop = 0; hop < 7; hop++) {
      const node = adj.get(curK);
      if (!node) break;
      let bk = null, bd = -1;
      for (const nk of node.n.keys()) {
        if (nk === prevK) continue;
        const q = adj.get(nk).p;
        const d = Math.hypot(q[0], q[1]);
        if (d > bd) { bd = d; bk = nk; }
      }
      if (!bk || bd <= Math.hypot(node.p[0], node.p[1])) break;
      prevK = curK; curK = bk;
      pts.push(adj.get(bk).p);
    }
    if (pts.length > 1) roads.push(pts.map(p => [round1(p[0]), round1(p[1])]));
  }

  /* -- wards into buildings ---------------------------------------------- */
  const wallKeySet = new Set(wallPts.map(vkey));
  // The street's drawn casing is 3.8px from its centreline, and a block
  // corner can sit at the miter of a street edge and a cheaper one, which
  // is why the cheap edges still keep most of a lane's width: the corner's
  // distance to a street END is set by the smaller of the two insets.
  const insetFor = (cell) => cell.map((v, i) => {
    const a = vkey(v), b = vkey(cell[(i + 1) % cell.length]);
    if (streetEdges.has([a, b].sort().join('|'))) return 4.4;      // a street runs here
    if (walled && wallKeySet.has(a) && wallKeySet.has(b)) return 4.6; // room to walk the wall
    return 2.8;                                                     // an alley between wards
  });

  const pool = [...WARD_POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const gateWardIdx = new Set();
  for (const g of gates) {
    for (const ci of cityIdx) if (cells[ci].some(v => vkey(v) === vkey(g.v)) && chance(0.6)) { gateWardIdx.add(ci); break; }
  }

  const buildings = [];
  const greens = [];
  const farms = [];
  let plaza = null;
  const wardOf = new Map();
  for (let k = 0; k < cityIdx.length; k++) {
    const ci = cityIdx[k];
    let type;
    if (k === 0 && hasPlaza) type = 'plaza';
    else if (gateWardIdx.has(ci)) type = 'gate';
    else type = pool.length ? pool.pop() : 'slum';
    wardOf.set(ci, type);
    const block = cleanPoly(shrink(cells[ci], insetFor(cells[ci])));
    if (block.length < 3) continue;
    if (type === 'plaza' || type === 'market') { plaza = plaza || block; continue; }
    if (type === 'park') { greens.push(block); continue; }
    if (type === 'cathedral') {
      // one great building holding the middle of its ward
      const inner = cleanPoly(shrink(block, Math.min(6, Math.sqrt(area(block)) * 0.16)));
      if (inner.length > 2) buildings.push({ pts: inner.map(p => [round1(p[0]), round1(p[1])]), big: 1 });
      continue;
    }
    const lots = makeLots(block, LOTS[type] || LOTS.craftsmen);
    for (const lot of lots) buildings.push({ pts: lot });
    if (type === 'patriciate' && chance(0.7)) greens.push(cleanPoly(shrink(block, area(block) > 900 ? 2 : 1)).slice(0, 0));
  }
  // drop the accidental empty green
  for (let i = greens.length - 1; i >= 0; i--) if (greens[i].length < 3) greens.splice(i, 1);

  // countryside: farms where the land is compact, trees elsewhere
  const trees = [];
  for (const ci of ringIdx) {
    if (ci === citadelIdx) continue;
    const cell = cells[ci];
    if (cell.length < 3) continue;
    const A = area(cell), P = cell.reduce((s2, v, i) => {
      const q = cell[(i + 1) % cell.length];
      return s2 + Math.hypot(q[0] - v[0], q[1] - v[1]);
    }, 0);
    const compact = (4 * Math.PI * A) / (P * P);
    // countryside roads run along these same edges, so the country keeps
    // the same clearance from them the town does
    const block = cleanPoly(shrink(cell, 4.4));
    if (block.length < 3) continue;
    if (compact > 0.55 && A < 12000 && chance(0.3)) {
      farms.push({ poly: block.map(p => [round1(p[0]), round1(p[1])]), ang: round1(rnd(0, Math.PI)) });
      const lots = makeLots(block, { minSq: 220, gridChaos: 0.3, sizeChaos: 0.3, alley: 3, emptyProb: 0.86 });
      if (lots[0]) buildings.push({ pts: lots[0] });
    } else {
      const [bx0, by0] = block.reduce((m, v) => [Math.min(m[0], v[0]), Math.min(m[1], v[1])], [1e9, 1e9]);
      const [bx1, by1] = block.reduce((m, v) => [Math.max(m[0], v[0]), Math.max(m[1], v[1])], [-1e9, -1e9]);
      const n = Math.min(9, Math.round(A / 900));
      for (let tI = 0; tI < n * 3 && trees.length < 400; tI++) {
        const tx = rnd(bx0, bx1), ty = rnd(by0, by1);
        if (!inPoly(block, tx, ty)) continue;
        if (roads.some(rd => rd.some(p => Math.hypot(p[0] - tx, p[1] - ty) < 9))) continue;
        trees.push([round1(tx), round1(ty), round1(rnd(2, 4))]);
      }
      if (chance(0.3)) {
        const lots = makeLots(block, { ...LOTS.countryside, emptyProb: 0.8 });
        if (lots[0]) buildings.push({ pts: lots[0] });
      }
    }
  }

  // the citadel: its own wall around its own ward, a keep in the middle
  let castle = null;
  if (citadelIdx != null && cells[citadelIdx].length > 2) {
    const cw = cleanPoly(shrink(cells[citadelIdx], 2));
    const keepBlock = cleanPoly(shrink(cw, Math.min(9, Math.sqrt(area(cw)) * 0.28)));
    if (cw.length > 2 && keepBlock.length > 2) {
      castle = { wall: cw.map(p => [round1(p[0]), round1(p[1])]) };
      buildings.push({ pts: keepBlock.map(p => [round1(p[0]), round1(p[1])]), big: 1 });
    }
  }

  /* -- normalise everything onto a positive canvas ------------------------ */
  const allPts = [];
  const gather = (pts) => { for (const p of pts) allPts.push(p); };
  for (const b of buildings) gather(b.pts);
  for (const s2 of streets) gather(s2);
  for (const r of roads) gather(r);
  if (wallPts.length) gather(wallPts);
  for (const f of farms) gather(f.poly);
  for (const g2 of greens) gather(g2);
  for (const t of trees) allPts.push([t[0], t[1]]);
  if (plaza) gather(plaza);
  if (castle) gather(castle.wall);
  if (!allPts.length) return generateTownMap({ size, spots, coast: 'no' });
  const M = 16;
  const minX = Math.min(...allPts.map(p => p[0])) - M, minY = Math.min(...allPts.map(p => p[1])) - M;
  const maxX = Math.max(...allPts.map(p => p[0])) + M, maxY = Math.max(...allPts.map(p => p[1])) + M;
  const tx = (p) => [round1(p[0] - minX), round1(p[1] - minY)];
  const txAll = (pts) => pts.map(tx);
  const t = {
    v: 2, size, w: Math.round(maxX - minX), h: Math.round(maxY - minY),
    streets: streets.map(txAll),
    roads: roads.map(txAll),
    buildings: buildings.map(b => ({ ...b, pts: txAll(b.pts) })),
    plaza: plaza ? txAll(plaza) : null,
    greens: greens.map(txAll),
    farms: farms.map(f => ({ ...f, poly: txAll(f.poly) })),
    trees: trees.map(([x, y, r]) => [round1(x - minX), round1(y - minY), r]),
    wall: walled && wallPts.length > 2 ? {
      pts: txAll(wallPts),
      towers: wallPts.filter((v, i) => !gates.some(g => vkey(g.v) === vkey(v)) && i % 2 === 0).map(tx),
      gates: gates.map(g => tx(g.v)),
    } : null,
    castle: castle ? { wall: txAll(castle.wall) } : null,
    water: water ? { nx: water.nx, ny: water.ny, off: round1(water.off - (water.nx * minX + water.ny * minY)) } : null,
  };

  /* -- spots: the campaign's own locations on the map --------------------- */
  const spotList = [];
  if (spots > 0 && t.buildings.length) {
    const cen = plaza ? tx(centroid(plaza)) : [t.w / 2, t.h / 2];
    const cands = t.buildings.map(b => ({ b, c: centroid(b.pts) }))
      .filter(o => o.c[0] > M && o.c[1] > M && o.c[0] < t.w - M && o.c[1] < t.h - M);
    if (cands.length) {
      cands.sort((a2, b2) => Math.hypot(a2.c[0] - cen[0], a2.c[1] - cen[1]) - Math.hypot(b2.c[0] - cen[0], b2.c[1] - cen[1]));
      const first = cands.shift();
      first.b.spot = 1;
      spotList.push({ n: 1, x: round1(first.c[0]), y: round1(first.c[1]) });
      cands.sort((a2, b2) => Math.atan2(a2.c[1] - cen[1], a2.c[0] - cen[0]) - Math.atan2(b2.c[1] - cen[1], b2.c[0] - cen[0]));
      const need = Math.min(spots - 1, cands.length);
      for (let i = 0; i < need; i++) {
        const o = cands[Math.floor((i + 0.5) * cands.length / need) % cands.length];
        o.b.spot = i + 2;
        spotList.push({ n: i + 2, x: round1(o.c[0]), y: round1(o.c[1]) });
      }
    }
  }
  t.spots = spotList;
  return t;
}

/* ---------- rendering ---------------------------------------------------- */

// One renderer for the app and the exports, so they can never disagree.
// Colours come from the same --map-* variables the dungeon maps use.
export function renderTownSVG(t, { player = false, spotIds = null } = {}) {
  const poly = (pts) => pts.map(([x, y]) => `${x},${y}`).join(' ');
  const line = (pts, stroke, w2, extra = '') =>
    `<polyline points="${poly(pts)}" fill="none" stroke="${stroke}" stroke-width="${w2}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
  let out = `<rect width="${t.w}" height="${t.h}" fill="var(--map-page)"/>`;

  if (t.water) {
    // the sea: everything on its side of the line
    const { nx, ny, off } = t.water;
    const corners = [[0, 0], [t.w, 0], [t.w, t.h], [0, t.h]];
    const wet = clipHalf(corners, -nx, -ny, -off);
    if (wet.length > 2) out += `<polygon points="${poly(wet)}" fill="var(--map-water)" opacity="0.5"/>`
      + `<polygon points="${poly(wet)}" fill="none" stroke="var(--map-ink)" stroke-width="1.6"/>`;
  }
  for (const f of t.farms || []) {
    out += `<polygon points="${poly(f.poly)}" fill="var(--map-floor)" stroke="var(--map-hatch)" stroke-width="0.9"/>`;
    // furrows: parallel lines clipped to the field
    const [cx, cy] = centroid(f.poly);
    const dx = Math.cos(f.ang), dy = Math.sin(f.ang);
    const px = -dy, py = dx;
    const span = Math.sqrt(area(f.poly)) * 1.6;
    let rows = '';
    for (let d = -span; d <= span; d += 4.5) {
      const seg = [[cx + px * d - dx * span, cy + py * d - dy * span], [cx + px * d + dx * span, cy + py * d + dy * span]];
      const clipped = f.poly.length > 2 ? clipSegToPoly(seg, f.poly) : null;
      if (clipped) rows += `<line x1="${round1(clipped[0][0])}" y1="${round1(clipped[0][1])}" x2="${round1(clipped[1][0])}" y2="${round1(clipped[1][1])}"/>`;
    }
    out += `<g stroke="var(--map-hatch)" stroke-width="0.7" opacity="0.7">${rows}</g>`;
  }
  for (const g of t.greens || []) {
    out += `<polygon points="${poly(g)}" fill="var(--map-floor)" stroke="var(--map-hatch)" stroke-width="0.9"/>`;
    const [cx, cy] = centroid(g);
    let dots = '';
    for (let i = 0; i < Math.min(12, area(g) / 90); i++) {
      dots += `<circle cx="${round1(cx + (Math.sin(i * 37.1) * 0.5) * Math.sqrt(area(g)))}" cy="${round1(cy + (Math.sin(i * 57.7) * 0.5) * Math.sqrt(area(g)))}" r="1.7"/>`;
    }
    out += `<g fill="none" stroke="var(--map-hatch)" stroke-width="1">${dots}</g>`;
  }
  for (const [x, y, r] of t.trees || []) {
    out += `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="var(--map-hatch)" stroke-width="1"/>`;
  }
  for (const r of t.roads || []) out += line(r, 'var(--map-ink)', 7.6);
  for (const s2 of t.streets || []) out += line(s2, 'var(--map-ink)', 7.6);
  for (const r of t.roads || []) out += line(r, 'var(--map-floor)', 5);
  for (const s2 of t.streets || []) out += line(s2, 'var(--map-floor)', 5);
  if (t.plaza) out += `<polygon points="${poly(t.plaza)}" fill="var(--map-floor)" stroke="var(--map-ink)" stroke-width="1.3"/>`;
  if (t.wall) {
    out += `<polygon points="${poly(t.wall.pts)}" fill="none" stroke="var(--map-ink)" stroke-width="3.4" stroke-linejoin="round"/>`;
    for (const [x, y] of t.wall.towers || []) {
      out += `<rect x="${round1(x - 2.8)}" y="${round1(y - 2.8)}" width="5.6" height="5.6" fill="var(--map-ink)"/>`;
    }
    for (const [x, y] of t.wall.gates || []) {
      out += `<rect x="${round1(x - 4)}" y="${round1(y - 4)}" width="8" height="8" fill="var(--map-floor)" stroke="var(--map-ink)" stroke-width="1.6"/>`;
    }
  }
  if (t.castle) {
    out += `<polygon points="${poly(t.castle.wall)}" fill="none" stroke="var(--map-ink)" stroke-width="2.2" stroke-linejoin="round"/>`;
  }
  for (const b of t.buildings || []) {
    out += `<polygon points="${poly(b.pts)}" fill="var(--map-floor)" stroke="var(--map-ink)" stroke-width="${b.big ? 1.9 : 1.15}"/>`;
  }
  if (!player) {
    // A pin whose location has a section of its own is clickable, the way a
    // room on a dungeon map is; the rest are plain.
    for (const sp of t.spots || []) {
      const goto = spotIds && spotIds[sp.n - 1];
      const attr = goto ? ` class="map-spot" data-goto="${goto}"` : '';
      out += `<g${attr}><circle cx="${sp.x}" cy="${sp.y}" r="7" class="map-badge"/><text x="${sp.x}" y="${sp.y + 3}" class="map-label">${sp.n}</text></g>`;
    }
  }
  return `<svg class="dungeon-map is-town" viewBox="0 0 ${t.w} ${t.h}" role="img" aria-label="Town map">${out}</svg>`;
}

// clip a segment to a convex polygon; null when it misses entirely
function clipSegToPoly(seg, p) {
  let [a, b] = seg;
  for (let i = 0; i < p.length; i++) {
    const u = p[i], v = p[(i + 1) % p.length];
    let ex = v[1] - u[1], ey = u[0] - v[0];
    const [cx, cy] = centroid(p);
    if (ex * cx + ey * cy - (ex * u[0] + ey * u[1]) > 0) { ex = -ex; ey = -ey; }  // outward
    const c = ex * u[0] + ey * u[1];
    const da = ex * a[0] + ey * a[1] - c, db = ex * b[0] + ey * b[1] - c;
    if (da > 0 && db > 0) return null;
    if (da > 0) { const q = da / (da - db); a = [a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q]; }
    else if (db > 0) { const q = db / (db - da); b = [b[0] + (a[0] - b[0]) * q, b[1] + (a[1] - b[1]) * q]; }
  }
  return [a, b];
}
