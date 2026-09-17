'use strict';

/**
 * Canvas renderer + click mapper for 15x15 Gomoku.
 */
window.GomokuBoard = (function () {
  const PAD = 24;

  function create(canvas) {
    const ctx = canvas.getContext('2d');
    let size = 15;
    let cell = 0;
    let board = null;
    let lastMove = null;
    let winLine = null;
    let interactive = false;
    let onPlace = null;

    function layout() {
      const cssSize = Math.min(480, canvas.parentElement ? canvas.parentElement.clientWidth : 480);
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = cssSize + 'px';
      canvas.style.height = cssSize + 'px';
      canvas.width = Math.floor(cssSize * dpr);
      canvas.height = Math.floor(cssSize * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cell = (cssSize - PAD * 2) / (size - 1);
    }

    function stoneColor(v) {
      return v === 1 ? '#1a1a1a' : '#f3f3f3';
    }

    function draw() {
      layout();
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      ctx.fillStyle = '#d4a574';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#5c4030';
      ctx.lineWidth = 1;
      for (let i = 0; i < size; i++) {
        const p = PAD + i * cell;
        ctx.beginPath();
        ctx.moveTo(PAD, p);
        ctx.lineTo(PAD + (size - 1) * cell, p);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p, PAD);
        ctx.lineTo(p, PAD + (size - 1) * cell);
        ctx.stroke();
      }

      // star points
      const stars = [3, 7, 11];
      ctx.fillStyle = '#5c4030';
      for (const y of stars) {
        for (const x of stars) {
          ctx.beginPath();
          ctx.arc(PAD + x * cell, PAD + y * cell, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (board) {
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const v = board[y][x];
            if (!v) continue;
            const cx = PAD + x * cell;
            const cy = PAD + y * cell;
            const r = cell * 0.42;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fillStyle = stoneColor(v);
            ctx.fill();
            ctx.strokeStyle = v === 1 ? '#000' : '#999';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      if (lastMove) {
        const cx = PAD + lastMove.x * cell;
        const cy = PAD + lastMove.y * cell;
        ctx.strokeStyle = '#c45c5c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.18, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (winLine && winLine.length) {
        ctx.strokeStyle = '#2ecc71';
        ctx.lineWidth = 3;
        ctx.beginPath();
        winLine.forEach((c, i) => {
          const cx = PAD + c.x * cell;
          const cy = PAD + c.y * cell;
          if (i === 0) ctx.moveTo(cx, cy);
          else ctx.lineTo(cx, cy);
        });
        ctx.stroke();
      }
    }

    function eventToCell(evt) {
      const rect = canvas.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      const y = evt.clientY - rect.top;
      const gx = Math.round((x - PAD) / cell);
      const gy = Math.round((y - PAD) / cell);
      if (gx < 0 || gy < 0 || gx >= size || gy >= size) return null;
      return { x: gx, y: gy };
    }

    canvas.addEventListener('click', (evt) => {
      if (!interactive || !onPlace) return;
      const cellPos = eventToCell(evt);
      if (!cellPos) return;
      onPlace(cellPos.x, cellPos.y);
    });

    function render(state, opts = {}) {
      if (!state) return;
      size = state.size || 15;
      board = state.board;
      lastMove = state.lastMove;
      winLine = state.winLine;
      interactive = Boolean(opts.interactive);
      onPlace = opts.onPlace || null;
      draw();
    }

    window.addEventListener('resize', () => {
      if (board) draw();
    });

    return { render, draw };
  }

  return { create };
})();
