'use strict';

/**
 * Carbon-Gomoku AI engine — Node.js CommonJS port
 * Faithful to AICarbon.h / AICarbon.cpp / AICarbonMove.cpp
 * Tables: STATUS1, PRIOR, CONFIG, COUNT5 (JSON)
 */

const path = require('path');
const TABLES = path.join(__dirname, 'tables');

const STATUS1_SRC = require(path.join(TABLES, 'STATUS1.json'));
const PRIOR_SRC = require(path.join(TABLES, 'PRIOR.json'));
const CONFIG = require(path.join(TABLES, 'CONFIG.json'));
const COUNT5 = require(path.join(TABLES, 'COUNT5.json'));

// --- Carbon constants -------------------------------------------------------
const DX = [1, 0, 1, 1];
const DY = [0, 1, 1, -1];

const EMPTY = 2;
const OP = 0;
const XP = 1;
const WRONG = 3;

const A = 8;
const B = 7;
const C = 6;
const D = 5;
const E = 4;
const F = 3;
const G = 2;
const H = 1;
const FORBID = 9;

const WIN_MIN = 25000;
const WIN_MAX = 30000;
const INF = 32000;
const MAX_CAND = 256;

const MATCH_SPARE = 7;
const TIMEOUT_PREVENT = 5;

const MAX_BOARD_W = 64;
const MAX_BOARD_H = 32;
const MAX_CELLS = MAX_BOARD_W * MAX_BOARD_H;

function OPPONENT(x) {
  return x === OP ? XP : OP;
}

function getTime() {
  return Date.now();
}

// --- Static tables (init once, like AICarbon::init) -------------------------
const STATUS1 = STATUS1_SRC.map((row) => row.slice());
const PRIOR = PRIOR_SRC;
const RANK = new Array(107);
const STATUS4 = new Array(10);

function getStatus4(s0, s1, s2, s3) {
  const n = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  n[s0]++;
  n[s1]++;
  n[s2]++;
  n[s3]++;

  if (n[9] >= 1) return A;
  if (n[8] >= 1) return B;
  if (n[7] >= 2) return B;
  if (n[7] >= 1 && n[6] >= 1) return C;
  if (n[7] >= 1 && n[5] >= 1) return D;
  if (n[7] >= 1 && n[4] >= 1) return D;
  if (n[7] >= 1) return E;
  if (n[6] >= 2) return F;
  if (n[6] >= 1 && n[5] >= 1) return G;
  if (n[6] >= 1 && n[4] >= 1) return G;
  if (n[6] >= 1) return H;
  return 0;
}

function getRank(cfg) {
  const mul = [3, 7, 11, 15, 19];
  const c = COUNT5[cfg];
  return (
    mul[4] * c[4] +
    mul[3] * c[3] +
    mul[2] * c[2] +
    mul[1] * c[1] +
    mul[0] * c[0]
  );
}

(function initTables() {
  for (let a = 0; a < 10; a++) {
    STATUS4[a] = new Array(10);
    for (let b = 0; b < 10; b++) {
      STATUS4[a][b] = new Array(10);
      for (let c = 0; c < 10; c++) {
        STATUS4[a][b][c] = new Array(10);
        for (let d = 0; d < 10; d++) {
          STATUS4[a][b][c][d] = getStatus4(a, b, c, d);
        }
      }
    }
  }
  for (let a = 0; a < 107; a++) RANK[a] = getRank(a);
})();

// --- HashTable no-op stub ---------------------------------------------------
function createHashStub() {
  return {
    resize() {},
    clear() {},
    present() {
      return false;
    },
    move() {},
    undo() {},
    update() {},
    depth() {
      return 0;
    },
    value() {
      return 0;
    },
    best() {
      return { x: 0, y: 0 };
    },
    moves() {
      return 0;
    },
  };
}

// --- Engine instance --------------------------------------------------------
function createEngine() {
  const cell = [];
  for (let x = 0; x < MAX_BOARD_W + 8; x++) {
    cell[x] = [];
    for (let y = 0; y < MAX_BOARD_H + 8; y++) {
      cell[x][y] = makeCell();
    }
  }

  let boardWidth = 15;
  let boardHeight = 15;
  let moveCount = 0;
  let remCount = 0;
  let who = OP;
  let opp = XP;
  let firstPlayer = OP;

  const nSt = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ];

  const remMove = new Array(MAX_CELLS);
  const remCell = new Array(MAX_CELLS);
  const remULCand = new Array(MAX_CELLS);
  const remLRCand = new Array(MAX_CELLS);

  let upperLeftCand = { x: 99, y: 99 };
  let lowerRightCand = { x: 0, y: 0 };

  const table = createHashStub();

  let totalSearched = 0;
  let nSearched = 0;
  let start_time = 0;
  let info_timeout_turn = 30000;
  let info_time_left = 1000000000;
  let terminateAI = 0;
  const info_exact5 = 0;
  const info_renju = 0;

  let bestMove = { x: -1, y: -1 };

  function makeCell() {
    return {
      piece: EMPTY,
      pattern: [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ],
      status1: [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ],
      status4: [0, 0],
      adj1: 0,
      adj2: 0,
    };
  }

  function update1(c, k) {
    c.status1[k][0] = STATUS1[c.pattern[k][0]][c.pattern[k][1]];
    c.status1[k][1] = STATUS1[c.pattern[k][1]][c.pattern[k][0]];
  }

  function update4(c) {
    c.status4[0] =
      STATUS4[c.status1[0][0]][c.status1[1][0]][c.status1[2][0]][c.status1[3][0]];
    c.status4[1] =
      STATUS4[c.status1[0][1]][c.status1[1][1]][c.status1[2][1]][c.status1[3][1]];
  }

  function cellPrior(c) {
    return (
      PRIOR[c.pattern[0][0]][c.pattern[0][1]] +
      PRIOR[c.pattern[1][0]][c.pattern[1][1]] +
      PRIOR[c.pattern[2][0]][c.pattern[2][1]] +
      PRIOR[c.pattern[3][0]][c.pattern[3][1]] +
      PRIOR[c.pattern[0][1]][c.pattern[0][0]] +
      PRIOR[c.pattern[1][1]][c.pattern[1][0]] +
      PRIOR[c.pattern[2][1]][c.pattern[2][0]] +
      PRIOR[c.pattern[3][1]][c.pattern[3][0]] +
      (c.adj1 !== 0 ? 1 : 0)
    );
  }

  function stopTime() {
    const t = Math.min(info_timeout_turn, Math.floor(info_time_left / MATCH_SPARE));
    return start_time + t - 30;
  }

  function forEveryCand(fn) {
    for (let y = upperLeftCand.y; y <= lowerRightCand.y; y++) {
      for (let x = upperLeftCand.x; x <= lowerRightCand.x; x++) {
        const c = cell[x][y];
        if (c.piece === EMPTY && (c.adj1 || c.adj2)) fn(x, y, c);
      }
    }
  }

  function databaseMove() {
    return false;
  }

  function initExact5() {
    // info_exact5 fixed at 0 — no-op (matches Carbon when exact5 unchanged)
  }

  // --- start / move / undo --------------------------------------------------

  function start(width, height) {
    if (height === undefined) height = width;
    boardWidth = width;
    boardHeight = height;

    for (let y = 0; y < height + 8; y++) {
      for (let x = 0; x < width + 8; x++) {
        const c = cell[x][y];
        c.piece =
          x < 4 || y < 4 || x >= width + 4 || y >= height + 4 ? WRONG : EMPTY;
        for (let k = 0; k < 4; k++) {
          c.pattern[k][0] = 0;
          c.pattern[k][1] = 0;
        }
        c.adj1 = 0;
        c.adj2 = 0;
      }
    }

    for (let y = 4; y < height + 4; y++) {
      for (let x = 4; x < width + 4; x++) {
        for (let k = 0; k < 4; k++) {
          let xx = x - DX[k];
          let yy = y - DY[k];
          for (let p = 8; p !== 0; p >>= 1) {
            if (cell[xx][yy].piece === WRONG) {
              cell[x][y].pattern[k][0] |= p;
              cell[x][y].pattern[k][1] |= p;
            }
            xx -= DX[k];
            yy -= DY[k];
          }
          xx = x + DX[k];
          yy = y + DY[k];
          for (let p = 16; p !== 0; p = (p << 1) & 0xff) {
            if (cell[xx][yy].piece === WRONG) {
              cell[x][y].pattern[k][0] |= p;
              cell[x][y].pattern[k][1] |= p;
            }
            xx += DX[k];
            yy += DY[k];
          }
        }
      }
    }

    for (let y = 4; y < height + 4; y++) {
      for (let x = 4; x < width + 4; x++) {
        const c = cell[x][y];
        update1(c, 0);
        update1(c, 1);
        update1(c, 2);
        update1(c, 3);
        update4(c);
        c.adj1 = 0;
        c.adj2 = 0;
      }
    }

    for (let i = 0; i < 2; i++) for (let j = 0; j < 10; j++) nSt[i][j] = 0;

    totalSearched = 0;
    who = OP;
    opp = XP;
    firstPlayer = OP;
    moveCount = 0;
    remCount = 0;

    upperLeftCand = { x: 99, y: 99 };
    lowerRightCand = { x: 0, y: 0 };

    table.clear();
    bestMove = { x: -1, y: -1 };
  }

  function setWho(_who) {
    who = _who;
    opp = OPPONENT(who);
    if (moveCount === 0) firstPlayer = _who;
  }

  /**
   * Load board by placing stones with alternating who.
   * Same-color order is center-out (patterns/adj are order-independent).
   * Prefer options.moves chronological list when available.
   */
  function loadBoard(board, playerToMove) {
    const h = board.length;
    const w = board[0].length;
    start(w, h);

    const blacks = [];
    const whites = [];
    const cx = (w - 1) / 2;
    const cy = (h - 1) / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = board[y][x];
        if (v === 1) blacks.push({ x, y });
        else if (v === 2) whites.push({ x, y });
      }
    }
    const dist = (p) => Math.abs(p.x - cx) + Math.abs(p.y - cy);
    blacks.sort((a, b) => dist(a) - dist(b));
    whites.sort((a, b) => dist(a) - dist(b));

    let bi = 0;
    let wi = 0;
    const total = blacks.length + whites.length;
    let next = XP; // black first
    for (let i = 0; i < total; i++) {
      if (next === XP) {
        if (bi >= blacks.length) break;
        setWho(XP);
        move(blacks[bi].x, blacks[bi].y);
        bi++;
      } else {
        if (wi >= whites.length) break;
        setWho(OP);
        move(whites[wi].x, whites[wi].y);
        wi++;
      }
      next = OPPONENT(next);
    }
    while (bi < blacks.length) {
      setWho(XP);
      move(blacks[bi].x, blacks[bi].y);
      bi++;
    }
    while (wi < whites.length) {
      setWho(OP);
      move(whites[wi].x, whites[wi].y);
      wi++;
    }

    setWho(playerToMove === 1 ? XP : OP);
  }

  function move(xp, yp) {
    table.resize(1);
    initExact5();
    _move(xp + 4, yp + 4, true);
  }

  function _move(xp, yp, updateHash) {
    nSearched++;

    nSt[0][cell[xp][yp].status4[0]]--;
    nSt[1][cell[xp][yp].status4[1]]--;

    cell[xp][yp].piece = who;
    remCell[remCount] = cell[xp][yp];
    remMove[moveCount] = { x: xp, y: yp };
    remULCand[remCount] = { x: upperLeftCand.x, y: upperLeftCand.y };
    remLRCand[remCount] = { x: lowerRightCand.x, y: lowerRightCand.y };
    moveCount++;
    remCount++;

    if (xp - 2 < upperLeftCand.x) upperLeftCand.x = Math.max(xp - 2, 4);
    if (yp - 2 < upperLeftCand.y) upperLeftCand.y = Math.max(yp - 2, 4);
    if (xp + 2 > lowerRightCand.x) lowerRightCand.x = Math.min(xp + 2, boardWidth + 3);
    if (yp + 2 > lowerRightCand.y) lowerRightCand.y = Math.min(yp + 2, boardHeight + 3);

    for (let k = 0; k < 4; k++) {
      let x = xp;
      let y = yp;
      for (let p = 16; p !== 0; p = (p << 1) & 0xff) {
        x -= DX[k];
        y -= DY[k];
        cell[x][y].pattern[k][who] |= p;
        if (cell[x][y].piece === EMPTY) {
          update1(cell[x][y], k);
          nSt[0][cell[x][y].status4[0]]--;
          nSt[1][cell[x][y].status4[1]]--;
          update4(cell[x][y]);
          nSt[0][cell[x][y].status4[0]]++;
          nSt[1][cell[x][y].status4[1]]++;
        }
      }
      x = xp;
      y = yp;
      for (let p = 8; p !== 0; p >>= 1) {
        x += DX[k];
        y += DY[k];
        cell[x][y].pattern[k][who] |= p;
        if (cell[x][y].piece === EMPTY) {
          update1(cell[x][y], k);
          nSt[0][cell[x][y].status4[0]]--;
          nSt[1][cell[x][y].status4[1]]--;
          update4(cell[x][y]);
          nSt[0][cell[x][y].status4[0]]++;
          nSt[1][cell[x][y].status4[1]]++;
        }
      }
    }

    cell[xp - 1][yp - 1].adj1++;
    cell[xp][yp - 1].adj1++;
    cell[xp + 1][yp - 1].adj1++;
    cell[xp - 1][yp].adj1++;
    cell[xp + 1][yp].adj1++;
    cell[xp - 1][yp + 1].adj1++;
    cell[xp][yp + 1].adj1++;
    cell[xp + 1][yp + 1].adj1++;
    cell[xp - 2][yp - 2].adj2++;
    cell[xp][yp - 2].adj2++;
    cell[xp + 2][yp - 2].adj2++;
    cell[xp - 2][yp].adj2++;
    cell[xp + 2][yp].adj2++;
    cell[xp - 2][yp + 2].adj2++;
    cell[xp][yp + 2].adj2++;
    cell[xp + 2][yp + 2].adj2++;

    if (updateHash) table.move(xp, yp, who);

    who = OPPONENT(who);
    opp = OPPONENT(opp);
  }

  function undo() {
    moveCount--;
    remCount--;
    const xp = remMove[moveCount].x;
    const yp = remMove[moveCount].y;
    upperLeftCand = remULCand[remCount];
    lowerRightCand = remLRCand[remCount];

    const c = remCell[remCount];
    update1(c, 0);
    update1(c, 1);
    update1(c, 2);
    update1(c, 3);
    update4(c);

    nSt[0][c.status4[0]]++;
    nSt[1][c.status4[1]]++;

    c.piece = EMPTY;

    who = OPPONENT(who);
    opp = OPPONENT(opp);

    table.undo(xp, yp, who);

    for (let k = 0; k < 4; k++) {
      let x = xp;
      let y = yp;
      for (let p = 16; p !== 0; p = (p << 1) & 0xff) {
        x -= DX[k];
        y -= DY[k];
        cell[x][y].pattern[k][who] ^= p;
        if (cell[x][y].piece === EMPTY) {
          update1(cell[x][y], k);
          nSt[0][cell[x][y].status4[0]]--;
          nSt[1][cell[x][y].status4[1]]--;
          update4(cell[x][y]);
          nSt[0][cell[x][y].status4[0]]++;
          nSt[1][cell[x][y].status4[1]]++;
        }
      }
      x = xp;
      y = yp;
      for (let p = 8; p !== 0; p >>= 1) {
        x += DX[k];
        y += DY[k];
        cell[x][y].pattern[k][who] ^= p;
        if (cell[x][y].piece === EMPTY) {
          update1(cell[x][y], k);
          nSt[0][cell[x][y].status4[0]]--;
          nSt[1][cell[x][y].status4[1]]--;
          update4(cell[x][y]);
          nSt[0][cell[x][y].status4[0]]++;
          nSt[1][cell[x][y].status4[1]]++;
        }
      }
    }

    cell[xp - 1][yp - 1].adj1--;
    cell[xp][yp - 1].adj1--;
    cell[xp + 1][yp - 1].adj1--;
    cell[xp - 1][yp].adj1--;
    cell[xp + 1][yp].adj1--;
    cell[xp - 1][yp + 1].adj1--;
    cell[xp][yp + 1].adj1--;
    cell[xp + 1][yp + 1].adj1--;
    cell[xp - 2][yp - 2].adj2--;
    cell[xp][yp - 2].adj2--;
    cell[xp + 2][yp - 2].adj2--;
    cell[xp - 2][yp].adj2--;
    cell[xp + 2][yp].adj2--;
    cell[xp - 2][yp + 2].adj2--;
    cell[xp][yp + 2].adj2--;
    cell[xp + 2][yp + 2].adj2--;
  }

  // --- evaluate / generateCand / quickWin / minimax -------------------------

  function evaluate() {
    const p = [0, 0];
    for (let i = 0; i < remCount; i++) {
      const c = remCell[i];
      const a = c.piece;
      for (let k = 0; k < 4; k++) {
        p[a] += RANK[CONFIG[c.pattern[k][a]][c.pattern[k][1 - a]]];
      }
    }
    return p[who] - p[opp];
  }

  function generateCand(cnd) {
    cnd[0] = { x: -1, y: -1, value: 0 };
    let nCnd = 0;

    if (table.present() && table.depth() >= 0 && table.best().x !== 0) {
      const b = table.best();
      cnd[0] = { x: b.x, y: b.y, value: 10000 };
      nCnd = 1;
    }

    forEveryCand((x, y, c) => {
      if (x !== cnd[0].x || y !== cnd[0].y) {
        const value = cellPrior(c);
        if (value > 1) {
          cnd[nCnd] = { x, y, value };
          nCnd++;
        }
      }
    });

    function oneCand(plr, st) {
      let i = 0;
      while (cell[cnd[i].x][cnd[i].y].status4[plr] !== st) i++;
      cnd[0] = cnd[i];
      return 1;
    }

    if (nSt[who][A] > 0) return oneCand(who, A);
    if (nSt[opp][A] > 0) return oneCand(opp, A);
    if (nSt[who][B] > 0) return oneCand(who, B);

    if (nSt[opp][B] > 0) {
      nCnd = 0;
      forEveryCand((x, y, c) => {
        if (
          (c.status4[who] >= E && c.status4[who] !== FORBID) ||
          (c.status4[opp] >= E && c.status4[opp] !== FORBID)
        ) {
          const value = cellPrior(c);
          if (value > 0) {
            cnd[nCnd] = { x, y, value };
            nCnd++;
          }
        }
      });
      return nCnd;
    }

    return nCnd;
  }

  function quickWinSearch() {
    let q;
    if (nSt[who][A] >= 1) return 1;
    if (nSt[opp][A] >= 2) return -2;
    if (nSt[opp][A] === 1) {
      let result = 0;
      forEveryCand((x, y, c) => {
        if (c.status4[opp] === A && result === 0) {
          _move(x, y, true);
          q = -quickWinSearch();
          undo();
          if (q < 0) q--;
          else if (q > 0) q++;
          result = q;
        }
      });
      return result;
    }
    if (nSt[who][B] >= 1) return 3;
    if (nSt[who][C] >= 1) {
      if (
        nSt[opp][B] === 0 &&
        nSt[opp][C] === 0 &&
        nSt[opp][D] === 0 &&
        nSt[opp][E] === 0
      )
        return 5;
      let found = 0;
      forEveryCand((x, y, c) => {
        if (c.status4[who] === C && found === 0) {
          _move(x, y, true);
          q = -quickWinSearch();
          undo();
          if (q > 0) found = q + 1;
        }
      });
      if (found) return found;
    }
    if (nSt[who][F] >= 1) {
      if (
        nSt[opp][B] === 0 &&
        nSt[opp][C] === 0 &&
        nSt[opp][D] === 0 &&
        nSt[opp][E] === 0
      )
        return 5;
    }
    return 0;
  }

  let timeCheckCnt = 0;

  function minimax(h, root, alpha, beta) {
    if (alpha > beta + 1) return { x: 0, y: 0, value: beta + 1 };
    let best = { x: 0, y: 0, value: alpha - 1 };

    if (--timeCheckCnt < 0) {
      timeCheckCnt = 1000;
      if (getTime() - stopTime() > 0) terminateAI = 2;
    }

    const q = quickWinSearch();
    if (q !== 0) {
      if (!root) return { x: 0, y: 0, value: (q > 0 ? +WIN_MAX : -WIN_MAX) - q };
      if (q === 1) {
        let winMove = null;
        forEveryCand((x, y, c) => {
          if (c.status4[who] === A && !winMove) winMove = { x, y, value: WIN_MAX - 1 };
        });
        if (winMove) return winMove;
      }
    }

    if (h === 0) {
      return { x: 0, y: 0, value: evaluate() };
    }

    h--;

    const cnd = new Array(MAX_CAND);
    let nCnd = generateCand(cnd);

    if (nCnd > 1) {
      cnd.length = nCnd;
      cnd.sort((a, b) => b.value - a.value);
    } else if (nCnd === 1) {
      if (root) return { x: cnd[0].x, y: cnd[0].y, value: 0 };
    } else {
      nCnd = 0;
      forEveryCand((x, y) => {
        if (nCnd < MAX_CAND) cnd[nCnd++] = { x, y, value: 0 };
      });
      if (nCnd === 0) best.value = 0;
    }

    for (let i = 0; i < nCnd; i++) {
      table.move(cnd[i].x, cnd[i].y, who);

      let value;
      if (
        table.present() &&
        (table.depth() >= h && ((table.depth() ^ h) & 1) === 0 ||
          Math.abs(table.value()) >= WIN_MIN)
      ) {
        nSearched++;
        value = table.value();
        table.undo(cnd[i].x, cnd[i].y, who);
      } else {
        _move(cnd[i].x, cnd[i].y, false);

        let vA = -beta;
        let vB = -(best.value + 1);
        if (vB >= +WIN_MIN) vB++;
        if (vA <= -WIN_MIN) vA--;

        const m = minimax(h, false, vA, vB);
        value = -m.value;

        if (value >= +WIN_MIN) value--;
        if (value <= -WIN_MIN) value++;

        if (-vB <= value && value <= -vA && !terminateAI) {
          table.update(value, h, moveCount, m);
        }

        undo();
      }

      if (value > best.value) {
        best = { x: cnd[i].x, y: cnd[i].y, value };
        if (value > beta) return { x: best.x, y: best.y, value: beta + 1 };
      }

      if (terminateAI) break;
    }

    return best;
  }

  function yourTurn(depth, timeMs) {
    start_time = getTime();
    let turnSearched = 0;
    table.resize(50000);
    initExact5();
    terminateAI = 0;
    timeCheckCnt = 0;

    if (moveCount === 0) {
      bestMove = {
        x: Math.floor(boardWidth / 2),
        y: Math.floor(boardHeight / 2),
      };
      return bestMove;
    }

    if (databaseMove()) return bestMove;

    // timeMs: our API uses milliseconds directly (Carbon yourTurn uses seconds*1000)
    if (timeMs > 0) info_timeout_turn = timeMs;
    else if (depth > 0) info_timeout_turn = 1000000;

    let best;
    let usedDepth = depth;

    if (depth > 0) {
      nSearched = 0;
      best = minimax(depth, true, -INF, INF);
      turnSearched = nSearched;
      bestMove = { x: best.x - 4, y: best.y - 4 };
    } else {
      let prevSearched = 0;
      for (usedDepth = 2; usedDepth <= 50; usedDepth++) {
        const t0 = getTime();
        nSearched = 0;
        best = minimax(usedDepth, true, -INF, INF);
        turnSearched += nSearched;

        if (terminateAI && usedDepth > 4) {
          usedDepth = 0;
          break;
        }
        bestMove = { x: best.x - 4, y: best.y - 4 };
        table.resize(nSearched * 2);

        const t1 = getTime();
        const td = t1 - t0;
        if (
          terminateAI ||
          t1 + TIMEOUT_PREVENT * td - stopTime() >= 0 ||
          nSearched === prevSearched
        )
          break;

        prevSearched = nSearched;
      }
    }

    totalSearched += turnSearched;
    return bestMove;
  }

  function search(depthOrTime) {
    // If number < 100 treat as depth; else as timeMs (heuristic for API)
    // Prefer explicit: positive small = depth; options handled in findMove
    if (typeof depthOrTime === 'object' && depthOrTime) {
      const d = depthOrTime.depth || 0;
      const t = depthOrTime.timeMs || 0;
      return yourTurn(d, t);
    }
    if (depthOrTime > 0 && depthOrTime <= 50) return yourTurn(depthOrTime, 0);
    return yourTurn(0, depthOrTime || 300);
  }

  function getBestMove() {
    return { x: bestMove.x, y: bestMove.y };
  }

  // Public move: board coords 0..size-1, player 1|2
  function publicMove(x, y, player) {
    setWho(player === 1 ? XP : OP);
    move(x, y);
  }

  return {
    start(size) {
      start(size || 15, size || 15);
    },
    move: publicMove,
    setWho(player) {
      setWho(player === 1 ? XP : OP);
    },
    search,
    getBestMove,
    yourTurn,
    loadBoard,
    _internal: {
      get who() {
        return who;
      },
      get moveCount() {
        return moveCount;
      },
      get nSt() {
        return nSt;
      },
      cell,
      evaluate,
      quickWinSearch,
    },
  };
}

/**
 * board[y][x]: 0 empty, 1 black, 2 white
 * playerToMove: 1|2
 * options: { depth, timeMs, difficulty, moves: [{x,y},...] }
 */
function findMove(board, playerToMove, options) {
  options = options || {};
  const eng = createEngine();
  const w = board[0].length;
  eng.start(w);

  if (options.moves && options.moves.length) {
    let color = 1;
    for (const m of options.moves) {
      eng.move(m.x, m.y, color);
      color = color === 1 ? 2 : 1;
    }
    eng.setWho(playerToMove);
  } else {
    eng.loadBoard(board, playerToMove);
  }

  let depth = options.depth || 0;
  let timeMs = options.timeMs || 0;

  if (options.difficulty) {
    const map = {
      easy: { depth: 2, timeMs: 0 },
      normal: { depth: 0, timeMs: 300 },
      hard: { depth: 0, timeMs: 700 },
      hardplus: { depth: 0, timeMs: 1200 },
      hell: { depth: 0, timeMs: 1800 },
    };
    const d = map[options.difficulty];
    if (d) {
      depth = d.depth;
      timeMs = d.timeMs;
    }
  }

  const result = eng.yourTurn(depth, timeMs);
  return { x: result.x, y: result.y };
}

module.exports = {
  createEngine,
  findMove,
  // constants for tests / bot wiring
  EMPTY,
  OP,
  XP,
  WRONG,
  A,
  B,
  C,
  WIN_MIN,
  WIN_MAX,
  INF,
};
