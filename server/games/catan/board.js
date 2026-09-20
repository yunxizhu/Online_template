'use strict';

/** @typedef {'brick'|'lumber'|'wool'|'grain'|'ore'} Resource */

const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'];

const TERRAIN_TO_RESOURCE = {
  hills: 'brick',
  forest: 'lumber',
  pasture: 'wool',
  fields: 'grain',
  mountains: 'ore',
  desert: null,
};

const TERRAIN_BAG = [
  'hills',
  'hills',
  'hills',
  'forest',
  'forest',
  'forest',
  'forest',
  'pasture',
  'pasture',
  'pasture',
  'pasture',
  'fields',
  'fields',
  'fields',
  'fields',
  'mountains',
  'mountains',
  'mountains',
  'desert',
];

const NUMBER_BAG = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

/** flat-top 轴向邻居：E, NE, NW, W, SW, SE */
const HEX_DIRS = [
  [+1, 0],
  [+1, -1],
  [0, -1],
  [-1, 0],
  [-1, +1],
  [0, +1],
];

const SIZE = 1;

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function hexKey(q, r) {
  return `${q},${r}`;
}

function generateHexCoords() {
  const coords = [];
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      if (Math.abs(-q - r) <= 2) coords.push({ q, r });
    }
  }
  return coords;
}

function hexCenter(q, r) {
  const x = SIZE * (1.5 * q);
  const y = SIZE * ((Math.sqrt(3) / 2) * q + Math.sqrt(3) * r);
  return { x, y };
}

/** flat-top：角从右侧开始，每 60° */
function hexCornerXY(q, r, corner) {
  const c = hexCenter(q, r);
  const angle = (Math.PI / 180) * (60 * corner);
  return {
    x: c.x + SIZE * Math.cos(angle),
    y: c.y + SIZE * Math.sin(angle),
  };
}

function vertexIdFromXY(x, y) {
  return `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
}

function edgeKey(v1, v2) {
  return v1 < v2 ? `${v1}|${v2}` : `${v2}|${v1}`;
}

/**
 * 标准基础版港口种类（顺时针，自北侧起）：
 * 3:1 通用 ×4 + 羊/矿/麦/砖/木 专港各一。
 * 位置：沿海岸等距，每港口间隔 2 条海岸边（与实体版外框间距一致）。
 */
const PORT_KINDS = [
  { kind: 'any', rate: 3 },
  { kind: 'wool', rate: 2 },
  { kind: 'any', rate: 3 },
  { kind: 'ore', rate: 2 },
  { kind: 'any', rate: 3 },
  { kind: 'grain', rate: 2 },
  { kind: 'any', rate: 3 },
  { kind: 'brick', rate: 2 },
  { kind: 'lumber', rate: 2 },
];

function placePorts(vertices, edges, hexes) {
  const cx = hexes.reduce((s, h) => s + h.x, 0) / hexes.length;
  const cy = hexes.reduce((s, h) => s + h.y, 0) / hexes.length;

  function edgeAngle(e) {
    const va = vertices.get(e.vertices[0]);
    const vb = vertices.get(e.vertices[1]);
    const mx = (va.x + vb.x) / 2;
    const my = (va.y + vb.y) / 2;
    return Math.atan2(my - cy, mx - cx);
  }

  const coastal = [...edges.values()].filter((e) => e.hexIds.length === 1);
  coastal.sort((a, b) => edgeAngle(a) - edgeAngle(b));

  // 从最靠北的海岸边起，每隔 3 条边放一个港（中间空 2 条）
  let start = 0;
  let best = Infinity;
  const north = -Math.PI / 2;
  coastal.forEach((e, i) => {
    const d = Math.abs(edgeAngle(e) - north);
    if (d < best) {
      best = d;
      start = i;
    }
  });

  const ports = [];
  const n = coastal.length;
  // 30 条海岸边、9 港：间距交替 3/3/4，避免某一侧出现双倍空隙
  const gaps = [3, 3, 4, 3, 3, 4, 3, 3, 4];
  let idx = start;
  for (let i = 0; i < PORT_KINDS.length; i++) {
    const e = coastal[((idx % n) + n) % n];
    const spec = PORT_KINDS[i];
    ports.push({
      edgeId: e.id,
      vertices: e.vertices.slice(),
      kind: spec.kind,
      rate: spec.rate,
    });
    idx += gaps[i];
  }
  return ports;
}

function buildTopology() {
  const coords = generateHexCoords();
  const hexes = coords.map((c, id) => ({
    id,
    q: c.q,
    r: c.r,
    key: hexKey(c.q, c.r),
    ...hexCenter(c.q, c.r),
  }));

  /** @type {Map<string, { id: string, x: number, y: number, hexIds: number[], neighbors: string[] }>} */
  const vertices = new Map();
  /** @type {Map<string, { id: string, vertices: [string, string], hexIds: number[] }>} */
  const edges = new Map();

  for (const h of hexes) {
    const vIds = [];
    for (let corner = 0; corner < 6; corner++) {
      const { x, y } = hexCornerXY(h.q, h.r, corner);
      const vid = vertexIdFromXY(x, y);
      vIds.push(vid);
      if (!vertices.has(vid)) {
        vertices.set(vid, { id: vid, x, y, hexIds: [], neighbors: [] });
      }
      const v = vertices.get(vid);
      if (!v.hexIds.includes(h.id)) v.hexIds.push(h.id);
    }
    for (let i = 0; i < 6; i++) {
      const a = vIds[i];
      const b = vIds[(i + 1) % 6];
      const eid = edgeKey(a, b);
      if (!edges.has(eid)) {
        edges.set(eid, { id: eid, vertices: [a, b], hexIds: [] });
      }
      const e = edges.get(eid);
      if (!e.hexIds.includes(h.id)) e.hexIds.push(h.id);
    }
  }

  for (const e of edges.values()) {
    const [a, b] = e.vertices;
    const va = vertices.get(a);
    const vb = vertices.get(b);
    if (!va.neighbors.includes(b)) va.neighbors.push(b);
    if (!vb.neighbors.includes(a)) vb.neighbors.push(a);
  }

  const ports = placePorts(vertices, edges, hexes);
  return { hexes, vertices, edges, ports };
}

function createBoard(rng = Math.random) {
  const topo = buildTopology();
  const terrains = shuffle(TERRAIN_BAG, rng);
  const numbers = shuffle(NUMBER_BAG, rng);

  let desertId = -1;
  const tiles = topo.hexes.map((h, i) => {
    const terrain = terrains[i];
    if (terrain === 'desert') desertId = h.id;
    return {
      id: h.id,
      q: h.q,
      r: h.r,
      key: h.key,
      x: h.x,
      y: h.y,
      terrain,
      resource: TERRAIN_TO_RESOURCE[terrain],
      number: null,
    };
  });

  let ni = 0;
  for (const t of tiles) {
    if (t.terrain === 'desert') continue;
    t.number = numbers[ni++];
  }

  return {
    tiles,
    vertices: Object.fromEntries(
      [...topo.vertices.entries()].map(([id, v]) => [
        id,
        { id, x: v.x, y: v.y, hexIds: v.hexIds, neighbors: v.neighbors },
      ])
    ),
    edges: Object.fromEntries(
      [...topo.edges.entries()].map(([id, e]) => [
        id,
        { id, vertices: e.vertices, hexIds: e.hexIds },
      ])
    ),
    ports: topo.ports,
    robberHexId: desertId >= 0 ? desertId : 0,
  };
}

function emptyResources() {
  return { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
}

function countResources(res) {
  return RESOURCES.reduce((s, k) => s + (res[k] || 0), 0);
}

function cloneResources(res) {
  const o = emptyResources();
  for (const k of RESOURCES) o[k] = res[k] || 0;
  return o;
}

function addResources(res, delta) {
  for (const k of RESOURCES) {
    if (delta[k]) res[k] = (res[k] || 0) + delta[k];
  }
}

function subResources(res, delta) {
  for (const k of RESOURCES) {
    if (delta[k]) res[k] = (res[k] || 0) - delta[k];
  }
}

function hasResources(res, cost) {
  return RESOURCES.every((k) => (res[k] || 0) >= (cost[k] || 0));
}

module.exports = {
  RESOURCES,
  TERRAIN_TO_RESOURCE,
  HEX_DIRS,
  SIZE,
  hexCenter,
  hexCornerXY,
  createBoard,
  emptyResources,
  countResources,
  cloneResources,
  addResources,
  subResources,
  hasResources,
  edgeKey,
};
