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
 * 标准 9 港口：外圈指定边。
 */
const PORT_EDGE_SPECS = [
  { q: 0, r: -2, corner: 4, kind: 'any', rate: 3 },
  { q: 1, r: -2, corner: 5, kind: 'wool', rate: 2 },
  { q: 2, r: -1, corner: 0, kind: 'any', rate: 3 },
  { q: 2, r: 0, corner: 0, kind: 'ore', rate: 2 },
  { q: 1, r: 1, corner: 1, kind: 'any', rate: 3 },
  { q: -1, r: 2, corner: 2, kind: 'grain', rate: 2 },
  { q: -2, r: 2, corner: 2, kind: 'any', rate: 3 },
  { q: -2, r: 1, corner: 3, kind: 'lumber', rate: 2 },
  { q: -1, r: -1, corner: 4, kind: 'brick', rate: 2 },
];

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

  const ports = [];
  for (const spec of PORT_EDGE_SPECS) {
    const v1 = vertexIdFromXY(
      hexCornerXY(spec.q, spec.r, spec.corner).x,
      hexCornerXY(spec.q, spec.r, spec.corner).y
    );
    const v2 = vertexIdFromXY(
      hexCornerXY(spec.q, spec.r, (spec.corner + 1) % 6).x,
      hexCornerXY(spec.q, spec.r, (spec.corner + 1) % 6).y
    );
    if (!vertices.has(v1) || !vertices.has(v2)) continue;
    ports.push({
      edgeId: edgeKey(v1, v2),
      vertices: [v1, v2],
      kind: spec.kind,
      rate: spec.rate,
    });
  }

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
