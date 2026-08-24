// Dungeon geometry engine. Takes the story's keyed rooms (roles decided by
// the campaign generator) and gives each one a real shape on a 5-ft grid:
// varied room sizes, sprawling corridors routed around other rooms, doors
// where a corridor actually meets a wall, and organic cave outlines for the
// dungeon kinds that live in raw stone.
//
// Story-first on purpose: the campaign already knows what each room is FOR.
// This module only decides where everything IS, and adjacency (node.exits)
// is then read off the geometry, so the tiles, the clue placements and the
// map can never disagree about which rooms connect.
//
// The output is plain JSON and is persisted with the campaign, so the maps
// a DM has already annotated their notes against never silently redraw when
// this engine changes.

const int = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;

// Footprints in grid squares, by what the room is for. A lair earns its
// floor space; a junction is deliberately small because the corridors are
// the point of it.
const SIZES = {
  threshold: [[4, 6], [3, 5]],
  junction: [[2, 3], [2, 3]],
  encounter: [[4, 8], [4, 7]],
  puzzle: [[4, 6], [4, 6]],
  trap: [[2, 3], [7, 12]],        // a corridor that is a room
  treasure: [[3, 5], [3, 5]],
  lore: [[3, 6], [3, 5]],
  empty: [[3, 6], [3, 6]],
  haven: [[3, 5], [3, 5]],
  shortcut: [[2, 3], [2, 4]],
  boss: [[8, 12], [7, 10]],
};

// Which dungeon kinds are dug rather than built.
const CAVE_KINDS = new Set(['lair', 'mine']);
const ROUNDABLE = new Set(['boss', 'puzzle', 'haven', 'treasure']);

const overlaps = (a, b, pad) =>
  a.x - pad < b.x + b.w && a.x + a.w + pad > b.x &&
  a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;

const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

// A wobbly polygon inside the room's rectangle, for cave chambers. Kept in
// the data so the blob a DM saw yesterday is the blob they see today.
function caveOutline(r) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const points = Math.max(9, Math.round((r.w + r.h) * 0.9));
  const poly = [];
  for (let i = 0; i < points; i++) {
    const ang = (i / points) * Math.PI * 2;
    const jit = 0.62 + Math.random() * 0.36;
    poly.push([
      +(cx + Math.cos(ang) * (r.w / 2) * jit).toFixed(2),
      +(cy + Math.sin(ang) * (r.h / 2) * jit).toFixed(2),
    ]);
  }
  return poly;
}

/* ---------- corridor routing ---------- */

// A* over grid cells. Room interiors are walls; existing corridor cells are
// cheap, which is what makes separate routes merge into the shared, wandering
// passages the reference maps have; turns cost a little so paths stay sane.
function route(start, goal, blocked, corridorCells, bounds) {
  const key = (x, y) => x + ',' + y;
  const open = [{ x: start[0], y: start[1], g: 0, dir: null }];
  const best = new Map([[key(start[0], start[1]), 0]]);
  const from = new Map();
  const h = (x, y) => Math.abs(x - goal[0]) + Math.abs(y - goal[1]);

  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].g + h(open[i].x, open[i].y) < open[bi].g + h(open[bi].x, open[bi].y)) bi = i;
    }
    const cur = open.splice(bi, 1)[0];
    if (cur.x === goal[0] && cur.y === goal[1]) {
      const path = [];
      let k = key(cur.x, cur.y);
      while (k) { const [x, y] = k.split(',').map(Number); path.push([x, y]); k = from.get(k); }
      return path.reverse();
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < bounds.minX || ny < bounds.minY || nx > bounds.maxX || ny > bounds.maxY) continue;
      const k = key(nx, ny);
      if (blocked.has(k) && !(nx === goal[0] && ny === goal[1])) continue;
      const step = corridorCells.has(k) ? 0.35 : 1;
      const turn = cur.dir && cur.dir !== dx + ',' + dy ? 0.45 : 0;
      const g = cur.g + step + turn;
      if (g < (best.get(k) ?? Infinity)) {
        best.set(k, g);
        from.set(k, key(cur.x, cur.y));
        open.push({ x: nx, y: ny, g, dir: dx + ',' + dy });
      }
    }
    if (best.size > 20000) return null; // give up rather than hang
  }
  return null;
}

// The cell just outside a room's wall nearest to a target point, plus the
// wall cell it came through (which is where the door goes).
function doorward(room, toward) {
  const c = center(room);
  const dx = toward.x - c.x, dy = toward.y - c.y;
  let wall, out, orient;
  if (Math.abs(dx) * room.h > Math.abs(dy) * room.w) {
    const x = dx > 0 ? room.x + room.w - 1 : room.x;
    const y = Math.round(Math.min(room.y + room.h - 1, Math.max(room.y, c.y + (dy / Math.max(1, Math.abs(dx))) * (room.w / 2))));
    wall = [x, y]; out = [dx > 0 ? x + 1 : x - 1, y]; orient = 'h';
  } else {
    const y = dy > 0 ? room.y + room.h - 1 : room.y;
    const x = Math.round(Math.min(room.x + room.w - 1, Math.max(room.x, c.x + (dx / Math.max(1, Math.abs(dy))) * (room.h / 2))));
    wall = [x, y]; out = [x, dy > 0 ? y + 1 : y - 1]; orient = 'v';
  }
  return { wall, out, orient };
}

/* ---------- the generator ---------- */

// nodes: the campaign's rooms, in DM reading order. kindId decides built vs
// cave styling. Returns geometry plus the adjacency the caller should adopt
// as each node's exits.
export function generateDungeonMap(nodes, kindId) {
  const cave = CAVE_KINDS.has(kindId);
  const rooms = [];

  // ---- placement: anchored sprawl. Each room goes near an earlier one, in
  // a random direction with a corridor-sized gap, so the map branches the
  // way hand-drawn ones do instead of marching in a line.
  for (let i = 0; i < nodes.length; i++) {
    const role = nodes[i].role;
    const [[w0, w1], [h0, h1]] = SIZES[role] || SIZES.empty;
    let w = int(w0, w1), h = int(h0, h1);
    if (role === 'trap' && chance(0.5)) [w, h] = [h, w]; // long corridors run either way

    if (i === 0) {
      rooms.push({ id: nodes[i].id, role, x: 0, y: 0, w, h });
      continue;
    }
    let placed = null;
    for (let attempt = 0; attempt < 40 && !placed; attempt++) {
      // mostly hang off the previous room (a spine), sometimes any earlier
      // room (a branch); later attempts roam wider
      const anchor = attempt < 10 && chance(0.7) ? rooms[i - 1] : pick(rooms);
      const gap = int(2, 5 + Math.floor(attempt / 10));
      const dir = pick(['n', 's', 'e', 'w']);
      const slide = int(-2, 2);
      let x, y;
      if (dir === 'e') { x = anchor.x + anchor.w + gap; y = anchor.y + slide; }
      else if (dir === 'w') { x = anchor.x - gap - w; y = anchor.y + slide; }
      else if (dir === 's') { x = anchor.x + slide; y = anchor.y + anchor.h + gap; }
      else { x = anchor.x + slide; y = anchor.y - gap - h; }
      const cand = { id: nodes[i].id, role, x, y, w, h, anchor: anchor.id };
      if (!rooms.some(r => overlaps(cand, r, 2))) placed = cand;
    }
    if (!placed) { // pathological fallback: extend the eastern frontier
      const maxX = Math.max(...rooms.map(r => r.x + r.w));
      placed = { id: nodes[i].id, role, x: maxX + 3, y: int(-4, 4), w, h, anchor: rooms[i - 1].id };
    }
    rooms.push(placed);
  }

  // normalise to a positive grid with margin for the crag band
  const minX = Math.min(...rooms.map(r => r.x)) - 4;
  const minY = Math.min(...rooms.map(r => r.y)) - 4;
  for (const r of rooms) { r.x -= minX; r.y -= minY; }
  const byId = new Map(rooms.map(r => [r.id, r]));

  // shapes: caves get blobs; a few big built rooms go round or octagonal
  for (const r of rooms) {
    if (cave) { r.shape = 'cave'; r.poly = caveOutline(r); }
    else if (ROUNDABLE.has(r.role) && r.w >= 4 && Math.abs(r.w - r.h) <= 2 && chance(0.3)) {
      r.shape = chance(0.5) ? 'round' : 'octagon';
    } else r.shape = 'rect';
  }

  const bounds = {
    minX: 0, minY: 0,
    maxX: Math.max(...rooms.map(r => r.x + r.w)) + 4,
    maxY: Math.max(...rooms.map(r => r.y + r.h)) + 4,
  };
  const blocked = new Set();
  for (const r of rooms) {
    for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) blocked.add(x + ',' + y);
  }

  const corridorCells = new Set();
  const corridors = [];
  const doors = [];
  const adjacency = new Map(rooms.map(r => [r.id, new Set()]));

  const connect = (a, b, doorType) => {
    if (a.id === b.id || adjacency.get(a.id).has(b.id)) return true;
    const da = doorward(a, center(b));
    const db = doorward(b, center(a));
    const path = route(da.out, db.out, blocked, corridorCells, bounds);
    if (!path) return false;
    for (const [x, y] of path) corridorCells.add(x + ',' + y);
    corridors.push({ a: a.id, b: b.id, cells: path });
    const type = doorType || (cave ? 'arch' : chance(0.12) ? 'arch' : 'door');
    doors.push({ x: da.wall[0], y: da.wall[1], outside: da.out, between: [a.id, b.id], type, orient: da.orient });
    doors.push({ x: db.wall[0], y: db.wall[1], outside: db.out, between: [b.id, a.id], type, orient: db.orient });
    adjacency.get(a.id).add(b.id);
    adjacency.get(b.id).add(a.id);
    return true;
  };

  // spanning connections: every room to its anchor, so the whole map is
  // walkable from the entrance
  for (const r of rooms) {
    if (!r.anchor) continue;
    connect(byId.get(r.anchor), r);
  }
  // loops, so there is more than one way round
  for (let i = 2; i < rooms.length; i++) {
    if (!chance(0.3)) continue;
    const others = rooms.slice(0, i - 1).filter(o => !adjacency.get(rooms[i].id).has(o.id));
    const near = others.sort((p, q) => {
      const cp = center(p), cq = center(q), ci = center(rooms[i]);
      return (Math.abs(cp.x - ci.x) + Math.abs(cp.y - ci.y)) - (Math.abs(cq.x - ci.x) + Math.abs(cq.y - ci.y));
    })[0];
    if (near) connect(rooms[i], near);
  }
  // a shortcut's whole identity is the secret way back to the entrance
  for (const r of rooms) {
    if (r.role === 'shortcut' && r.id !== rooms[0].id) connect(r, rooms[0], 'secret');
  }
  // junctions must earn the name; if the map genuinely cannot give one three
  // ways out, the caller is told so it can demote the room instead of lying
  const thinJunctions = [];
  for (const r of rooms) {
    if (r.role !== 'junction') continue;
    const others = rooms.filter(o => o.id !== r.id && !adjacency.get(r.id).has(o.id))
      .sort((p, q) => {
        const cp = center(p), cq = center(q), ci = center(r);
        return (Math.abs(cp.x - ci.x) + Math.abs(cp.y - ci.y)) - (Math.abs(cq.x - ci.x) + Math.abs(cq.y - ci.y));
      });
    for (const o of others) {
      if (adjacency.get(r.id).size >= 3) break;
      connect(r, o);
    }
    if (adjacency.get(r.id).size < 3) thinJunctions.push(r.id);
  }

  // the way in: an opening on the entrance room's outward-facing wall
  const first = rooms[0];
  const c0 = center(first);
  const mapC = { x: bounds.maxX / 2, y: bounds.maxY / 2 };
  const eDir = doorward(first, { x: c0.x + (c0.x - mapC.x || -1) * 10, y: c0.y + (c0.y - mapC.y || 0) * 10 });
  const entrance = { room: first.id, x: eDir.wall[0], y: eDir.wall[1], outside: eDir.out, orient: eDir.orient };

  // ---- furniture: what the room's purpose looks like on the floor. Placed
  // here rather than at render time so it persists with the map, and kept
  // away from doorways so nothing blocks an opening.
  const doorCellsByRoom = new Map();
  for (const d of doors) {
    if (!doorCellsByRoom.has(d.between[0])) doorCellsByRoom.set(d.between[0], []);
    doorCellsByRoom.get(d.between[0]).push([d.x, d.y]);
  }
  for (const r of rooms) {
    const feats = [];
    const nearDoor = (x, y) => (doorCellsByRoom.get(r.id) || []).some(([dx2, dy2]) => Math.abs(dx2 - x) + Math.abs(dy2 - y) < 2);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const big = r.w * r.h >= 30;

    if (r.role === 'boss') {
      // a dais against the wall furthest from the first door, and columns
      const dw = Math.max(2, Math.round(r.w * 0.45)), dh = Math.max(1.5, r.h * 0.22);
      feats.push({ t: 'dais', x: +(cx - dw / 2).toFixed(1), y: +(r.y + 0.8).toFixed(1), w: dw, h: +dh.toFixed(1) });
      const colY = [r.y + r.h * 0.55, r.y + r.h * 0.8];
      for (const yy of colY) for (const xx of [r.x + r.w * 0.25, r.x + r.w * 0.75]) {
        if (!nearDoor(Math.round(xx), Math.round(yy))) feats.push({ t: 'column', x: +xx.toFixed(1), y: +yy.toFixed(1) });
      }
    } else if (r.role === 'puzzle' && !cave) {
      // two ranks of pillars, the furniture of every puzzle room ever keyed
      for (const fx of [0.3, 0.7]) for (const fy of [0.3, 0.5, 0.7]) {
        const xx = r.x + r.w * fx, yy = r.y + r.h * fy;
        if (!nearDoor(Math.round(xx), Math.round(yy))) feats.push({ t: 'column', x: +xx.toFixed(1), y: +yy.toFixed(1) });
      }
    } else if (r.role === 'treasure') {
      const n2 = int(1, 3);
      for (let i = 0; i < n2; i++) feats.push({ t: 'chest', x: +(r.x + 1 + Math.random() * (r.w - 2)).toFixed(1), y: +(r.y + 0.9 + Math.random() * 0.8).toFixed(1) });
    } else if (r.role === 'lore') {
      feats.push({ t: 'table', x: +(r.x + 0.8).toFixed(1), y: +(cy - 0.4).toFixed(1), w: +Math.min(r.w - 1.6, 3).toFixed(1), h: 0.8 });
    } else if (r.role === 'haven') {
      feats.push({ t: 'table', x: +(cx - 1).toFixed(1), y: +(cy - 0.4).toFixed(1), w: 2, h: 0.8 });
    } else if (r.role === 'encounter' && big && !cave && chance(0.6)) {
      for (const fy of [0.33, 0.66]) for (const fx of [0.3, 0.7]) {
        const xx = r.x + r.w * fx, yy = r.y + r.h * fy;
        if (!nearDoor(Math.round(xx), Math.round(yy))) feats.push({ t: 'column', x: +xx.toFixed(1), y: +yy.toFixed(1) });
      }
    }
    if (cave && big && chance(0.3)) {
      feats.push({ t: 'pool', x: +(cx + (Math.random() - 0.5) * r.w * 0.3).toFixed(1), y: +(cy + (Math.random() - 0.5) * r.h * 0.3).toFixed(1), r: +(Math.min(r.w, r.h) * 0.28).toFixed(1) });
    }
    if ((cave && chance(0.5)) || (['empty', 'junction'].includes(r.role) && chance(0.3))) {
      feats.push({ t: 'rubble', x: +(r.x + 0.8 + Math.random() * (r.w - 1.6)).toFixed(1), y: +(r.y + 0.8 + Math.random() * (r.h - 1.6)).toFixed(1) });
    }
    if (feats.length) r.features = feats;
  }

  for (const r of rooms) delete r.anchor;
  return {
    grid: 5,           // feet per square
    style: cave ? 'cave' : 'built',
    rooms, corridors, doors, entrance,
    bounds: { w: bounds.maxX, h: bounds.maxY },
    adjacency: Object.fromEntries([...adjacency].map(([id, set]) => [id, [...set]])),
    thinJunctions,
  };
}
