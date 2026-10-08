'use strict';
/**
 * 转向速率诊断：复刻 smoke/path.js §4 的 3 人局 #2，逐段打印车头角度 / 速度折扣 / 位移，
 * 用来看「加了角速度之后到底慢在哪」。node scripts/warfactory-turn-diag.js
 */
const mod = require('../server/games/warfactory');
const { createGameState, setPlayerInput, __test } = mod;

const DT = 0.1;
const players = [];
for (let i = 0; i < 3; i++) players.push({ id: 'p' + i + '-route1', name: 'P' + i });
const g = createGameState({ id: 'path-route1', players });
g.phase = 'playing';
g.phaseEndsAt = 0;
const t = g.terrain;
const pg = __test.passGrid(g);
const cb = __test.compLabels(g);
const compOf = (x, y) => {
  const c = Math.min(t.cols - 1, Math.max(0, Math.floor(x / t.cell)));
  const r = Math.min(t.rows - 1, Math.max(0, Math.floor(y / t.cell)));
  let l = cb.lab[r * t.cols + c];
  if (l < 0) {
    for (let ring = 1; ring <= 6 && l < 0; ring++) {
      for (let dr = -ring; dr <= ring && l < 0; dr++) {
        for (let dc = -ring; dc <= ring && l < 0; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr >= t.rows || cc < 0 || cc >= t.cols) continue;
          if (pg[rr * t.cols + cc]) l = cb.lab[rr * t.cols + cc];
        }
      }
    }
  }
  return l;
};
const u = g.units.find((x) => !x.dead && x.ownerIdx === 0);
const k0 = compOf(u.x, u.y);
const wps = [];
for (const want of [900, 1800, 2600]) {
  let best = null;
  let bd = Infinity;
  for (let r = 2; r < t.rows - 2; r += 2) {
    for (let c = 2; c < t.cols - 2; c += 2) {
      const i = r * t.cols + c;
      if (!pg[i] || cb.lab[i] !== k0) continue;
      const px = (c + 0.5) * t.cell;
      const py = (r + 0.5) * t.cell;
      const d = Math.hypot(px - u.x, py - u.y);
      if (Math.abs(d - want) >= bd) continue;
      bd = Math.abs(d - want);
      best = { x: px, y: py };
    }
  }
  if (best) wps.push(best);
}
console.log('路点', wps.map((w) => `${Math.round(w.x)},${Math.round(w.y)}`).join(' | '));
let now = 1000;
const last = wps[wps.length - 1];
setPlayerInput(g, g.players[0].id, { cmd: 'move', x: last.x, y: last.y, path: wps, ids: [u.id] }, now);

let prev = { x: u.x, y: u.y, a: u.angle };
let mulSum = 0;
let mulZero = 0;
for (let s = 0; s < 3000; s++) {
  now += DT * 1000;
  const mvx = u.moveX;
  const want = mvx == null ? null : Math.atan2(u.moveY - u.y, u.moveX - u.x);
  const off = want == null ? 0 : Math.abs(Math.atan2(Math.sin(want - u.angle), Math.cos(want - u.angle)));
  const mul = off > 1.23 ? 0 : Math.max(0.35, Math.cos(off));
  __test.step(g, DT, now);
  const mv = Math.hypot(u.x - prev.x, u.y - prev.y);
  const da = Math.abs(Math.atan2(Math.sin(u.angle - prev.a), Math.cos(u.angle - prev.a)));
  mulSum += mul;
  if (mul === 0) mulZero++;
  if (s > 690 && s < 700) {
    console.log('DBG tick', s, 'angle=', ((u.angle*180)/Math.PI).toFixed(1), 'want=', want==null?'x':((want*180)/Math.PI).toFixed(1), 'off=', ((off*180)/Math.PI).toFixed(1), 'turnLeft=', u._turnLeft, 'moveTo=', u.moveX, u.moveY, 'pos=', u.x.toFixed(1), u.y.toFixed(1));
  }
  if (s % 100 === 0 || (s < 30 && s % 5 === 0)) {
    console.log(
      `t=${(s * DT).toFixed(0)}s pos=${Math.round(u.x)},${Math.round(u.y)} 目标=${mvx == null ? '无' : Math.round(u.moveX) + ',' + Math.round(u.moveY)}` +
        ` 余${u.route ? u.route.length : 0} 夹角=${((off * 180) / Math.PI).toFixed(0)}° mul=${mul.toFixed(2)} 位移=${mv.toFixed(1)} 转角=${((da * 180) / Math.PI).toFixed(0)}°`
    );
  }
  prev = { x: u.x, y: u.y, a: u.angle };
  if (u.dead || (u.moveX == null && !u.route)) {
    console.log(`走完于 ${(s * DT).toFixed(0)}s`);
    break;
  }
}
console.log('平均 mul', (mulSum / 3000).toFixed(2), '原地掉头 tick 数', mulZero);
console.log('离终点', Math.round(Math.hypot(u.x - last.x, u.y - last.y)), 'px');
