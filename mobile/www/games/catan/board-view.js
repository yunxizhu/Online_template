'use strict';

/**
 * 卡坦岛 SVG 棋盘渲染
 */
window.CatanBoardView = (function () {
  const COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835'];
  const SCALE = 42;

  const RES_LABEL = {
    brick: '砖',
    lumber: '木',
    wool: '羊',
    grain: '麦',
    ore: '矿',
    any: '任',
  };

  function hexPolygon(cx, cy, size) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i);
      pts.push(`${cx + size * Math.cos(a)},${cy + size * Math.sin(a)}`);
    }
    return pts.join(' ');
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

    const pad = 1.4;
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

    // tiles
    for (const t of tiles) {
      const poly = document.createElementNS(ns, 'polygon');
      poly.setAttribute('points', hexPolygon(tx(t.x), ty(t.y), SCALE));
      poly.setAttribute('class', `catan-hex terrain-${t.terrain}`);
      if (buildMode === 'robber' && legalSet.robber.has(t.id)) {
        poly.classList.add('legal-robber');
        poly.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onPick({ kind: 'robber', hexId: t.id });
        });
      }
      svg.appendChild(poly);

      if (t.number != null) {
        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', String(tx(t.x)));
        text.setAttribute('y', String(ty(t.y)));
        text.setAttribute(
          'class',
          'catan-number' + (t.number === 6 || t.number === 8 ? ' hot' : '')
        );
        text.textContent = String(t.number);
        svg.appendChild(text);
      }

      if (t.id === game.board.robberHexId) {
        const r = document.createElementNS(ns, 'circle');
        r.setAttribute('cx', String(tx(t.x)));
        r.setAttribute('cy', String(ty(t.y) + (t.number != null ? 12 : 0)));
        r.setAttribute('r', '7');
        r.setAttribute('class', 'catan-robber');
        svg.appendChild(r);
      }
    }

    // ports
    for (const p of ports) {
      const [va, vb] = p.vertices;
      const a = vertices[va];
      const b = vertices[vb];
      if (!a || !b) continue;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      // 略向外偏移
      const cx = (tiles.reduce((s, t) => s + t.x, 0) / tiles.length) || 0;
      const cy = (tiles.reduce((s, t) => s + t.y, 0) / tiles.length) || 0;
      const dx = mx - cx;
      const dy = my - cy;
      const len = Math.hypot(dx, dy) || 1;
      const px = mx + (dx / len) * 0.35;
      const py = my + (dy / len) * 0.35;
      const label = document.createElementNS(ns, 'text');
      label.setAttribute('x', String(tx(px)));
      label.setAttribute('y', String(ty(py)));
      label.setAttribute('class', 'catan-port-label');
      const kind = p.kind === 'any' ? '任' : RES_LABEL[p.kind] || p.kind;
      label.textContent = `${p.rate}:1 ${kind}`;
      svg.appendChild(label);
    }

    // edges / roads
    for (const [eid, e] of Object.entries(edges)) {
      const a = vertices[e.vertices[0]];
      const b = vertices[e.vertices[1]];
      if (!a || !b) continue;
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', String(tx(a.x)));
      line.setAttribute('y1', String(ty(a.y)));
      line.setAttribute('x2', String(tx(b.x)));
      line.setAttribute('y2', String(ty(b.y)));
      const road = roads[eid];
      let cls = 'catan-edge';
      if (road) {
        cls += ' has-road';
        const colorMap = (opts && opts.playerColors) || {};
        line.setAttribute('stroke', colorMap[road.playerId] || COLORS[0]);
      }
      if (buildMode === 'road' && legalSet.roads.has(eid)) {
        cls += ' legal';
        line.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onPick({ kind: 'road', edgeId: eid });
        });
      }
      line.setAttribute('class', cls);
      svg.appendChild(line);
    }

    // vertices / buildings
    for (const [vid, v] of Object.entries(vertices)) {
      const b = buildings[vid];
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('cx', String(tx(v.x)));
      circle.setAttribute('cy', String(ty(v.y)));
      let r = 4;
      let cls = 'catan-vertex';
      if (b) {
        const colorMap = (opts && opts.playerColors) || {};
        const col = colorMap[b.playerId] || COLORS[0];
        circle.setAttribute('fill', col);
        circle.setAttribute('stroke', '#111');
        circle.setAttribute('stroke-width', '1.5');
        if (b.kind === 'city') {
          r = 7;
          cls += ' building-city';
        } else {
          r = 5.5;
          cls += ' building-settlement';
        }
      } else if (
        (buildMode === 'settlement' && legalSet.settlements.has(vid)) ||
        (buildMode === 'city' && legalSet.cities.has(vid))
      ) {
        cls += ' legal';
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

      if (b && b.kind === 'city') {
        const mark = document.createElementNS(ns, 'text');
        mark.setAttribute('x', String(tx(v.x)));
        mark.setAttribute('y', String(ty(v.y) + 1));
        mark.setAttribute('class', 'catan-number');
        mark.setAttribute('font-size', '8');
        mark.textContent = '城';
        svg.appendChild(mark);
      }
    }

    container.innerHTML = '';
    container.appendChild(svg);
  }

  return { render, COLORS, RES_LABEL };
})();
