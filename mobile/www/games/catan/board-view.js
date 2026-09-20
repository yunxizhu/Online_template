'use strict';

/**
 * 卡坦岛 SVG 棋盘渲染
 */
window.CatanBoardView = (function () {
  // 经典四色：红 / 蓝 / 白 / 橙，对比强、易记
  const COLORS = ['#d32f2f', '#1565c0', '#f5f5f5', '#ef6c00'];
  const COLOR_NAMES = ['红', '蓝', '白', '橙'];
  const SCALE = 72;

  const RES_LABEL = {
    brick: '砖',
    lumber: '木',
    wool: '羊',
    grain: '麦',
    ore: '矿',
    any: '任',
  };

  const RES = '/games/catan/res';
  const TERRAIN_IMG = {
    hills: RES + '/picture/zhuanchang.png',
    forest: RES + '/picture/senlin.png',
    pasture: RES + '/picture/caoyuan.png',
    fields: RES + '/picture/maitian.png',
    mountains: RES + '/picture/kuangqu.png',
    desert: null,
  };

  /** 点数对应的概率点数量（经典卡坦） */
  const NUMBER_PIPS = {
    2: 1,
    3: 2,
    4: 3,
    5: 4,
    6: 5,
    8: 5,
    9: 4,
    10: 3,
    11: 2,
    12: 1,
  };

  function hexPolygon(cx, cy, size) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i);
      pts.push(`${cx + size * Math.cos(a)},${cy + size * Math.sin(a)}`);
    }
    return pts.join(' ');
  }

  function appendNumberToken(svg, ns, cx, cy, number) {
    const hot = number === 6 || number === 8;
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('class', 'catan-number-token');
    g.setAttribute('pointer-events', 'none');

    // 外圈深描边，保证贴图上足够显眼
    const ring = document.createElementNS(ns, 'circle');
    ring.setAttribute('cx', String(cx));
    ring.setAttribute('cy', String(cy));
    ring.setAttribute('r', '26');
    ring.setAttribute('class', 'catan-number-ring');
    g.appendChild(ring);

    const disc = document.createElementNS(ns, 'circle');
    disc.setAttribute('cx', String(cx));
    disc.setAttribute('cy', String(cy));
    disc.setAttribute('r', '23');
    disc.setAttribute('class', 'catan-number-disc' + (hot ? ' hot' : ''));
    g.appendChild(disc);

    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', String(cx));
    text.setAttribute('y', String(cy - 2));
    text.setAttribute('class', 'catan-number' + (hot ? ' hot' : ''));
    text.textContent = String(number);
    g.appendChild(text);

    const pips = NUMBER_PIPS[number] || 0;
    if (pips > 0) {
      const pipY = cy + 14;
      const gap = 5.2;
      const totalW = (pips - 1) * gap;
      for (let i = 0; i < pips; i++) {
        const pip = document.createElementNS(ns, 'circle');
        pip.setAttribute('cx', String(cx - totalW / 2 + i * gap));
        pip.setAttribute('cy', String(pipY));
        pip.setAttribute('r', '2.1');
        pip.setAttribute('class', 'catan-number-pip' + (hot ? ' hot' : ''));
        g.appendChild(pip);
      }
    }

    svg.appendChild(g);
  }

  function render(container, game, opts) {
    if (!container || !game || !game.board) return;
    const onPick = (opts && opts.onPick) || function () {};
    const buildMode = (opts && opts.buildMode) || null;
    const legal = game.legal || {};
    const legalSet = {
      settlements: new Set(legal.settlements || []),
      roads: new Set(legal.roads || []),
      cities: new Set(legal.cities || []),
      robber: new Set(legal.robberHexes || []),
    };

    const tiles = game.board.tiles || [];
    const vertices = game.board.vertices || {};
    const edges = game.board.edges || {};
    const ports = game.board.ports || [];
    const buildings = game.buildings || {};
    const roads = game.roads || {};
    const colorMap = (opts && opts.playerColors) || {};
    const labelMap = (opts && opts.playerLabels) || {};
    const flashVertices = new Set((opts && opts.flashVertices) || []);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const t of tiles) {
      minX = Math.min(minX, t.x);
      minY = Math.min(minY, t.y);
      maxX = Math.max(maxX, t.x);
      maxY = Math.max(maxY, t.y);
    }
    for (const v of Object.values(vertices)) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }

    const pad = 1.55;
    const w = (maxX - minX + pad * 2) * SCALE;
    const h = (maxY - minY + pad * 2) * SCALE;
    const ox = -minX + pad;
    const oy = -minY + pad;

    function tx(x) {
      return (x + ox) * SCALE;
    }
    function ty(y) {
      return (y + oy) * SCALE;
    }

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('role', 'img');

    const defs = document.createElementNS(ns, 'defs');
    svg.appendChild(defs);

    const tileCx =
      tiles.reduce((s, t) => s + t.x, 0) / (tiles.length || 1);
    const tileCy =
      tiles.reduce((s, t) => s + t.y, 0) / (tiles.length || 1);

    // tiles：贴图 + 六边形裁剪
    for (const t of tiles) {
      const cx = tx(t.x);
      const cy = ty(t.y);
      const hexSize = SCALE * 0.98;
      const points = hexPolygon(cx, cy, hexSize);
      const clipId = `catan-hex-clip-${t.id}`;

      const clip = document.createElementNS(ns, 'clipPath');
      clip.setAttribute('id', clipId);
      const clipPoly = document.createElementNS(ns, 'polygon');
      clipPoly.setAttribute('points', points);
      clip.appendChild(clipPoly);
      defs.appendChild(clip);

      const imgSrc = TERRAIN_IMG[t.terrain];
      if (imgSrc) {
        const imgSize = hexSize * 2;
        const img = document.createElementNS(ns, 'image');
        img.setAttribute('href', imgSrc);
        img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', imgSrc);
        img.setAttribute('x', String(cx - imgSize / 2));
        img.setAttribute('y', String(cy - imgSize / 2));
        img.setAttribute('width', String(imgSize));
        img.setAttribute('height', String(imgSize));
        img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
        img.setAttribute('clip-path', `url(#${clipId})`);
        img.setAttribute('class', 'catan-hex-img');
        svg.appendChild(img);
      } else {
        const fill = document.createElementNS(ns, 'polygon');
        fill.setAttribute('points', points);
        fill.setAttribute('class', `catan-hex terrain-${t.terrain}`);
        svg.appendChild(fill);
      }

      const border = document.createElementNS(ns, 'polygon');
      border.setAttribute('points', points);
      border.setAttribute(
        'class',
        'catan-hex-border' +
          (buildMode === 'robber' && legalSet.robber.has(t.id)
            ? ' legal-robber'
            : '')
      );
      if (buildMode === 'robber' && legalSet.robber.has(t.id)) {
        border.style.cursor = 'pointer';
        border.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onPick({ kind: 'robber', hexId: t.id });
        });
      }
      svg.appendChild(border);

      if (t.number != null) {
        appendNumberToken(svg, ns, cx, cy, t.number);
      }

      if (t.id === game.board.robberHexId) {
        const r = document.createElementNS(ns, 'circle');
        r.setAttribute('cx', String(cx));
        r.setAttribute('cy', String(cy + (t.number != null ? 34 : 0)));
        r.setAttribute('r', '11');
        r.setAttribute('class', 'catan-robber');
        svg.appendChild(r);
      }
    }

    // ports：高亮海岸边 + 码头连线 + 大标签
    for (const p of ports) {
      const [va, vb] = p.vertices;
      const a = vertices[va];
      const b = vertices[vb];
      if (!a || !b) continue;
      const ax = tx(a.x);
      const ay = ty(a.y);
      const bx = tx(b.x);
      const by = ty(b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = mx - tileCx;
      const dy = my - tileCy;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const px = mx + ux * 0.55;
      const py = my + uy * 0.55;
      const kind = p.kind === 'any' ? '任' : RES_LABEL[p.kind] || p.kind;
      const labelText = `${p.rate}:1 ${kind}`;
      const lx = tx(px);
      const ly = ty(py);
      const edgeMx = (ax + bx) / 2;
      const edgeMy = (ay + by) / 2;

      // 港口海岸边高亮
      const shore = document.createElementNS(ns, 'line');
      shore.setAttribute('x1', String(ax));
      shore.setAttribute('y1', String(ay));
      shore.setAttribute('x2', String(bx));
      shore.setAttribute('y2', String(by));
      shore.setAttribute('class', 'catan-port-shore');
      svg.appendChild(shore);

      // 两边码头桩线连到标签
      for (const [sx, sy] of [
        [ax, ay],
        [bx, by],
        [edgeMx, edgeMy],
      ]) {
        const pier = document.createElementNS(ns, 'line');
        pier.setAttribute('x1', String(sx));
        pier.setAttribute('y1', String(sy));
        pier.setAttribute('x2', String(lx));
        pier.setAttribute('y2', String(ly));
        pier.setAttribute('class', 'catan-port-pier');
        svg.appendChild(pier);
      }

      // 港口顶点小环，提示可建在此享受港口
      for (const [sx, sy] of [
        [ax, ay],
        [bx, by],
      ]) {
        const dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('cx', String(sx));
        dot.setAttribute('cy', String(sy));
        dot.setAttribute('r', '5');
        dot.setAttribute('class', 'catan-port-dock');
        svg.appendChild(dot);
      }

      const pillW = Math.max(48, labelText.length * 9.5);
      const pillH = 20;
      const pill = document.createElementNS(ns, 'rect');
      pill.setAttribute('x', String(lx - pillW / 2));
      pill.setAttribute('y', String(ly - pillH / 2));
      pill.setAttribute('width', String(pillW));
      pill.setAttribute('height', String(pillH));
      pill.setAttribute('rx', '6');
      pill.setAttribute(
        'class',
        'catan-port-pill' + (p.kind === 'any' ? ' any' : ' special')
      );
      svg.appendChild(pill);

      const label = document.createElementNS(ns, 'text');
      label.setAttribute('x', String(lx));
      label.setAttribute('y', String(ly));
      label.setAttribute('class', 'catan-port-label');
      label.textContent = labelText;
      svg.appendChild(label);
    }

    // edges / roads：底描边 + 彩色路芯，明显粗于空边
    for (const [eid, e] of Object.entries(edges)) {
      const a = vertices[e.vertices[0]];
      const b = vertices[e.vertices[1]];
      if (!a || !b) continue;
      const x1 = tx(a.x);
      const y1 = ty(a.y);
      const x2 = tx(b.x);
      const y2 = ty(b.y);
      const road = roads[eid];
      const isLegal = buildMode === 'road' && legalSet.roads.has(eid);

      if (!road) {
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(x2));
        line.setAttribute('y2', String(y2));
        line.setAttribute('class', 'catan-edge' + (isLegal ? ' legal' : ''));
        if (isLegal) {
          line.addEventListener('click', (ev) => {
            ev.stopPropagation();
            onPick({ kind: 'road', edgeId: eid });
          });
        }
        svg.appendChild(line);
        continue;
      }

      const col = colorMap[road.playerId] || COLORS[0];
      const under = document.createElementNS(ns, 'line');
      under.setAttribute('x1', String(x1));
      under.setAttribute('y1', String(y1));
      under.setAttribute('x2', String(x2));
      under.setAttribute('y2', String(y2));
      under.setAttribute('class', 'catan-road-under');
      svg.appendChild(under);

      const core = document.createElementNS(ns, 'line');
      core.setAttribute('x1', String(x1));
      core.setAttribute('y1', String(y1));
      core.setAttribute('x2', String(x2));
      core.setAttribute('y2', String(y2));
      core.setAttribute('class', 'catan-road-core');
      core.setAttribute('stroke', col);
      svg.appendChild(core);
    }

    // vertices / buildings
    for (const [vid, v] of Object.entries(vertices)) {
      const b = buildings[vid];
      const cx = tx(v.x);
      const cy = ty(v.y);

      if (b) {
        const col = colorMap[b.playerId] || COLORS[0];
        const mark = labelMap[b.playerId] || '';
        const g = document.createElementNS(ns, 'g');
        g.setAttribute('class', 'catan-building catan-building-' + b.kind);
        g.setAttribute('data-vertex', vid);
        g.setAttribute('data-player', b.playerId);
        if (flashVertices.has(vid)) g.classList.add('catan-building-flash');
        if (b.kind === 'city') {
          appendCity(g, ns, cx, cy, col, mark);
        } else {
          appendSettlement(g, ns, cx, cy, col, mark);
        }
        svg.appendChild(g);
        continue;
      }

      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('cx', String(cx));
      circle.setAttribute('cy', String(cy));
      let r = 3.5;
      let cls = 'catan-vertex';
      if (
        (buildMode === 'settlement' && legalSet.settlements.has(vid)) ||
        (buildMode === 'city' && legalSet.cities.has(vid))
      ) {
        cls += ' legal';
        r = buildMode === 'city' ? 8 : 7;
        circle.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onPick({
            kind: buildMode === 'city' ? 'city' : 'settlement',
            vertexId: vid,
          });
        });
      }
      circle.setAttribute('r', String(r));
      circle.setAttribute('class', cls);
      svg.appendChild(circle);
    }

    container.innerHTML = '';
    container.appendChild(svg);
  }

  /** 村落：小屋轮廓 */
  function appendSettlement(g, ns, cx, cy, col, mark) {
    const s = 22;
    const pts = [
      [cx - s, cy + s * 0.55],
      [cx + s, cy + s * 0.55],
      [cx + s, cy - s * 0.05],
      [cx, cy - s * 0.95],
      [cx - s, cy - s * 0.05],
    ]
      .map((p) => p.join(','))
      .join(' ');
    const shadow = document.createElementNS(ns, 'polygon');
    shadow.setAttribute('points', pts);
    shadow.setAttribute('class', 'catan-settle-shadow');
    g.appendChild(shadow);
    const house = document.createElementNS(ns, 'polygon');
    house.setAttribute('points', pts);
    house.setAttribute('fill', col);
    house.setAttribute('class', 'catan-settle');
    g.appendChild(house);
    if (mark) {
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', String(cx));
      t.setAttribute('y', String(cy + 4));
      t.setAttribute('class', pieceTextClass(col));
      t.textContent = mark;
      g.appendChild(t);
    }
  }

  /** 城市：双峰大楼，明显大于村落 */
  function appendCity(g, ns, cx, cy, col, mark) {
    const s = 30;
    const pts = [
      [cx - s * 1.15, cy + s * 0.7],
      [cx + s * 1.15, cy + s * 0.7],
      [cx + s * 1.15, cy - s * 0.15],
      [cx + s * 0.55, cy - s * 0.15],
      [cx + s * 0.55, cy - s * 0.85],
      [cx + s * 0.15, cy - s * 1.25],
      [cx - s * 0.15, cy - s * 0.85],
      [cx - s * 0.15, cy - s * 0.35],
      [cx - s * 0.65, cy - s * 0.35],
      [cx - s * 0.65, cy - s * 0.95],
      [cx - s * 1.15, cy - s * 0.55],
    ]
      .map((p) => p.join(','))
      .join(' ');
    const shadow = document.createElementNS(ns, 'polygon');
    shadow.setAttribute('points', pts);
    shadow.setAttribute('class', 'catan-city-shadow');
    g.appendChild(shadow);
    const city = document.createElementNS(ns, 'polygon');
    city.setAttribute('points', pts);
    city.setAttribute('fill', col);
    city.setAttribute('class', 'catan-city');
    g.appendChild(city);
    for (const [wx, wy] of [
      [cx - s * 0.75, cy + s * 0.2],
      [cx + s * 0.55, cy + s * 0.2],
    ]) {
      const win = document.createElementNS(ns, 'rect');
      win.setAttribute('x', String(wx - 3));
      win.setAttribute('y', String(wy - 3));
      win.setAttribute('width', '6');
      win.setAttribute('height', '6');
      win.setAttribute('class', 'catan-city-window');
      g.appendChild(win);
    }
    if (mark) {
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', String(cx));
      t.setAttribute('y', String(cy + 6));
      t.setAttribute('class', pieceTextClass(col));
      t.textContent = mark;
      g.appendChild(t);
    }
  }

  function pieceTextClass(col) {
    const c = String(col || '').toLowerCase();
    // 白棋用深色字，其余浅色字
    if (c === '#f5f5f5' || c === '#fff' || c === '#ffffff' || c === '#eee') {
      return 'catan-piece-mark dark';
    }
    return 'catan-piece-mark';
  }

  return { render, COLORS, COLOR_NAMES, RES_LABEL };
})();
