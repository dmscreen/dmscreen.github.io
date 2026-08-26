// Town geometry: streets, blocks and walls for a settlement, in the spirit
// of Watabou's medieval town generator. Story-first like the dungeon
// engine: the campaign decides what the place is and which locations
// matter; this decides what it looks like on paper. Everything returned is
// plain data in pixel coordinates, persisted with the campaign so the town
// a DM saw yesterday is the town they see today.

const int = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const rnd = (a, b) => a + Math.random() * (b - a);
const chance = (p) => Math.random() < p;

// Footprints by settlement size. The radius is the built-up edge; the wall,
// where there is one, stands a little beyond it.
const SIZES = {
  hamlet: { R: 72, rays: 3, rings: 0, walled: false, density: 0.5, trees: 26 },
  village: { R: 104, rays: 4, rings: 1, walled: false, density: 0.62, trees: 34 },
  town: { R: 150, rays: 5, rings: 1, walled: true, density: 0.72, trees: 26 },
  'small city': { R: 195, rays: 6, rings: 2, walled: true, density: 0.8, trees: 18 },
};

export function generateTownMap({ size = 'village', spots = 0 } = {}) {
  const S = SIZES[size] || SIZES.village;
  const M = 26;                       // margin for trees and the wall
  const cx = S.R + M, cy = S.R + M;
  const w = 2 * cx, h = 2 * cy;

  // ---- the plaza: an irregular open ground the roads grow out of
  const plazaR = Math.max(13, S.R * 0.12);
  const plaza = [];
  const pn = int(5, 7);
  for (let i = 0; i < pn; i++) {
    const a = (i / pn) * Math.PI * 2 + rnd(-0.15, 0.15);
    const r = plazaR * rnd(0.85, 1.2);
    plaza.push([+(cx + Math.cos(a) * r).toFixed(1), +(cy + Math.sin(a) * r).toFixed(1)]);
  }

  // ---- roads: rays out of the plaza, wiggling as they go, plus ring roads
  // that tie the rays together the way real towns grow in layers
  const roads = [];
  const rayAngles = [];
  const a0 = rnd(0, Math.PI * 2);
  for (let i = 0; i < S.rays; i++) {
    const a = a0 + (i / S.rays) * Math.PI * 2 + rnd(-0.22, 0.22);
    rayAngles.push(a);
    const pts = [];
    const reach = S.R * rnd(1.02, 1.14);
    for (let r = plazaR * 0.7; r < reach; r += 16) {
      const wob = rnd(-4, 4);
      const px = cx + Math.cos(a) * r - Math.sin(a) * wob;
      const py = cy + Math.sin(a) * r + Math.cos(a) * wob;
      pts.push([+px.toFixed(1), +py.toFixed(1)]);
    }
    roads.push(pts);
  }
  const ringRadii = [];
  for (let k = 0; k < S.rings; k++) {
    const rr = S.R * (S.rings === 1 ? 0.58 : 0.42 + k * 0.33);
    ringRadii.push(rr);
    const pts = [];
    const n = Math.max(18, Math.round(rr / 6));
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = rr + rnd(-4, 4);
      pts.push([+(cx + Math.cos(a) * r).toFixed(1), +(cy + Math.sin(a) * r).toFixed(1)]);
    }
    roads.push(pts);
  }

  // ---- buildings: quads shouldered up along the roads, deeper lots close
  // to the plaza, thinning toward the edge
  const buildings = [];
  const overlaps = (bx, by, br) => buildings.some(b => {
    const dx = b.cx - bx, dy = b.cy - by;
    return dx * dx + dy * dy < (br + b.r) * (br + b.r);
  });
  const quad = (px, py, ang, along, deep) => {
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const vx = -uy, vy = ux;
    const j = () => rnd(-1.3, 1.3);
    return [
      [+(px - ux * along / 2 + j()).toFixed(1), +(py - uy * along / 2 + j()).toFixed(1)],
      [+(px + ux * along / 2 + j()).toFixed(1), +(py + uy * along / 2 + j()).toFixed(1)],
      [+(px + ux * along / 2 + vx * deep + j()).toFixed(1), +(py + uy * along / 2 + vy * deep + j()).toFixed(1)],
      [+(px - ux * along / 2 + vx * deep + j()).toFixed(1), +(py - uy * along / 2 + vy * deep + j()).toFixed(1)],
    ];
  };
  const lotAlong = (roadPts, side) => {
    for (let i = 0; i < roadPts.length - 1; i++) {
      if (!chance(S.density)) continue;
      const [ax, ay] = roadPts[i], [bx, by] = roadPts[i + 1];
      const ang = Math.atan2(by - ay, bx - ax);
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const along = rnd(9, 17), deep = rnd(9, 16);
      const off = 6.5;                       // clear of the road itself
      const nx = -Math.sin(ang) * side, ny = Math.cos(ang) * side;
      const px = mx + nx * off, py = my + ny * off;
      const distC = Math.hypot(px - cx, py - cy);
      if (distC < plazaR + 8 || distC > S.R) continue;
      const r = Math.max(along, deep) * 0.62;
      if (overlaps(px + nx * deep / 2, py + ny * deep / 2, r)) continue;
      buildings.push({
        pts: quad(px, py, ang, along, deep * side),
        cx: px + nx * deep / 2, cy: py + ny * deep / 2, r,
      });
    }
  };
  for (const road of roads) { lotAlong(road, 1); lotAlong(road, -1); }

  // ---- the wall: only real towns earn one, standing beyond the houses
  // with a gate wherever a road runs through
  let wall = null, gates = [];
  if (S.walled) {
    const wr = S.R + 9;
    wall = [];
    const n = 30;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = wr + rnd(-4, 4);
      wall.push([+(cx + Math.cos(a) * r).toFixed(1), +(cy + Math.sin(a) * r).toFixed(1)]);
    }
    gates = rayAngles.map(a => [
      +(cx + Math.cos(a) * wr).toFixed(1), +(cy + Math.sin(a) * wr).toFixed(1),
    ]);
  }

  // ---- trees: the country the town sits in, kept off roads and roofs
  const trees = [];
  for (let i = 0; i < S.trees; i++) {
    const a = rnd(0, Math.PI * 2);
    const r = rnd(S.walled ? S.R + 16 : S.R * 0.65, S.R + M - 6);
    const tx = cx + Math.cos(a) * r, ty = cy + Math.sin(a) * r;
    if (buildings.some(b => Math.hypot(b.cx - tx, b.cy - ty) < b.r + 6)) continue;
    trees.push([+tx.toFixed(1), +ty.toFixed(1), +rnd(2.2, 4.2).toFixed(1)]);
  }

  // ---- the spots: which buildings the campaign's locations live in.
  // Spread around the town by angle so two locations are never next door,
  // except the first spot, which goes to the building nearest the plaza:
  // the caller puts the most central location (the tavern) first.
  const spotList = [];
  if (spots > 0 && buildings.length) {
    const byDist = [...buildings].sort((a, b) =>
      Math.hypot(a.cx - cx, a.cy - cy) - Math.hypot(b.cx - cx, b.cy - cy));
    const taken = new Set();
    const central = byDist[0];
    taken.add(central);
    spotList.push({ n: 1, x: +central.cx.toFixed(1), y: +central.cy.toFixed(1) });
    const rest = buildings.filter(b => !taken.has(b))
      .sort((a, b) => Math.atan2(a.cy - cy, a.cx - cx) - Math.atan2(b.cy - cy, b.cx - cx));
    const need = Math.min(spots - 1, rest.length);
    for (let i = 0; i < need; i++) {
      const b = rest[Math.floor((i + 0.5) * rest.length / need) % rest.length];
      spotList.push({ n: i + 2, x: +b.cx.toFixed(1), y: +b.cy.toFixed(1) });
      b.spot = i + 2;
    }
    central.spot = 1;
  }

  return {
    v: 1, w, h, size,
    plaza, roads, wall, gates, trees,
    buildings: buildings.map(b => ({ pts: b.pts, spot: b.spot })),
    spots: spotList,
  };
}
