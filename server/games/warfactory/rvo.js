'use strict';

/**
 * RVO2 / ORCA 单位避障（agent–agent）。
 *
 * 移植自 UNC RVO2 / RVO2-CS，Unity 封装见：
 *   https://github.com/warmtrue/RVO2-Unity  （Apache-2.0）
 *   https://github.com/snape/RVO2-CS
 *
 * 本模块只做「单位 ↔ 单位」ORCA；静态障碍（山/建筑）仍由战争工厂的
 * canStand / separateUnits 处理。调用方每帧：
 *   1. beginFrame(agents, opts) 建邻域
 *   2. compute(frame, agentId, prefVx, prefVy, maxSpeed, timeStep) → {vx,vy}
 */

const EPS = 1e-5;

function absSq(x, y) {
  return x * x + y * y;
}
function abs(x, y) {
  return Math.sqrt(x * x + y * y);
}
function det(ax, ay, bx, by) {
  return ax * by - ay * bx;
}
function dot(ax, ay, bx, by) {
  return ax * bx + ay * by;
}
function sqr(s) {
  return s * s;
}

function linearProgram1(lines, lineNo, radius, optVx, optVy, directionOpt, result) {
  const line = lines[lineNo];
  const dotProduct = dot(line.px, line.py, line.dx, line.dy);
  const discriminant = sqr(dotProduct) + sqr(radius) - absSq(line.px, line.py);
  if (discriminant < 0) return false;

  const sqrtDisc = Math.sqrt(discriminant);
  let tLeft = -dotProduct - sqrtDisc;
  let tRight = -dotProduct + sqrtDisc;

  for (let i = 0; i < lineNo; i++) {
    const li = lines[i];
    const denominator = det(line.dx, line.dy, li.dx, li.dy);
    const numerator = det(li.dx, li.dy, line.px - li.px, line.py - li.py);
    if (Math.abs(denominator) <= EPS) {
      if (numerator < 0) return false;
      continue;
    }
    const t = numerator / denominator;
    if (denominator >= 0) tRight = Math.min(tRight, t);
    else tLeft = Math.max(tLeft, t);
    if (tLeft > tRight) return false;
  }

  if (directionOpt) {
    if (dot(optVx, optVy, line.dx, line.dy) > 0) {
      result.vx = line.px + tRight * line.dx;
      result.vy = line.py + tRight * line.dy;
    } else {
      result.vx = line.px + tLeft * line.dx;
      result.vy = line.py + tLeft * line.dy;
    }
  } else {
    const t = dot(line.dx, line.dy, optVx - line.px, optVy - line.py);
    if (t < tLeft) {
      result.vx = line.px + tLeft * line.dx;
      result.vy = line.py + tLeft * line.dy;
    } else if (t > tRight) {
      result.vx = line.px + tRight * line.dx;
      result.vy = line.py + tRight * line.dy;
    } else {
      result.vx = line.px + t * line.dx;
      result.vy = line.py + t * line.dy;
    }
  }
  return true;
}

function linearProgram2(lines, radius, optVx, optVy, directionOpt, result) {
  if (directionOpt) {
    result.vx = optVx * radius;
    result.vy = optVy * radius;
  } else if (absSq(optVx, optVy) > sqr(radius)) {
    const len = abs(optVx, optVy) || 1;
    result.vx = (optVx / len) * radius;
    result.vy = (optVy / len) * radius;
  } else {
    result.vx = optVx;
    result.vy = optVy;
  }

  for (let i = 0; i < lines.length; i++) {
    const li = lines[i];
    if (det(li.dx, li.dy, li.px - result.vx, li.py - result.vy) > 0) {
      const temp = { vx: result.vx, vy: result.vy };
      if (!linearProgram1(lines, i, radius, optVx, optVy, directionOpt, result)) {
        result.vx = temp.vx;
        result.vy = temp.vy;
        return i;
      }
    }
  }
  return lines.length;
}

function linearProgram3(lines, numObstLines, beginLine, radius, result) {
  let distance = 0;
  for (let i = beginLine; i < lines.length; i++) {
    const li = lines[i];
    if (det(li.dx, li.dy, li.px - result.vx, li.py - result.vy) > distance) {
      const projLines = [];
      for (let ii = 0; ii < numObstLines; ii++) projLines.push(lines[ii]);
      for (let j = numObstLines; j < i; j++) {
        const lj = lines[j];
        const determinant = det(li.dx, li.dy, lj.dx, lj.dy);
        let px;
        let py;
        let dx;
        let dy;
        if (Math.abs(determinant) <= EPS) {
          if (dot(li.dx, li.dy, lj.dx, lj.dy) > 0) continue;
          px = 0.5 * (li.px + lj.px);
          py = 0.5 * (li.py + lj.py);
        } else {
          const t = det(lj.dx, lj.dy, li.px - lj.px, li.py - lj.py) / determinant;
          px = li.px + t * li.dx;
          py = li.py + t * li.dy;
        }
        dx = lj.dx - li.dx;
        dy = lj.dy - li.dy;
        const len = abs(dx, dy) || 1;
        projLines.push({ px, py, dx: dx / len, dy: dy / len });
      }
      const temp = { vx: result.vx, vy: result.vy };
      if (linearProgram2(projLines, radius, -li.dy, li.dx, true, result) < projLines.length) {
        result.vx = temp.vx;
        result.vy = temp.vy;
      }
      distance = det(li.dx, li.dy, li.px - result.vx, li.py - result.vy);
    }
  }
}

/**
 * 对单个 agent 算 ORCA 新速度（仅 agent 邻域线）。
 * @param {{x,y,vx,vy,r}} self
 * @param {Array<{x,y,vx,vy,r}>} neighbors
 * @param {number} prefVx
 * @param {number} prefVy
 * @param {number} maxSpeed
 * @param {number} timeStep
 * @param {number} timeHorizon
 */
function computeNewVelocity(self, neighbors, prefVx, prefVy, maxSpeed, timeStep, timeHorizon) {
  const lines = [];
  const invTimeHorizon = 1 / Math.max(1e-3, timeHorizon);
  const invTimeStep = 1 / Math.max(1e-4, timeStep);
  const px = self.x;
  const py = self.y;
  const vx = self.vx || 0;
  const vy = self.vy || 0;
  const radius = self.r;

  for (let i = 0; i < neighbors.length; i++) {
    const other = neighbors[i];
    const relX = other.x - px;
    const relY = other.y - py;
    const relVx = vx - (other.vx || 0);
    const relVy = vy - (other.vy || 0);
    const distSq = absSq(relX, relY);
    const combinedRadius = radius + other.r;
    const combinedRadiusSq = sqr(combinedRadius);

    let lineDx;
    let lineDy;
    let ux;
    let uy;

    if (distSq > combinedRadiusSq) {
      const wX = relVx - invTimeHorizon * relX;
      const wY = relVy - invTimeHorizon * relY;
      const wLengthSq = absSq(wX, wY);
      const dotProduct1 = dot(wX, wY, relX, relY);

      if (dotProduct1 < 0 && sqr(dotProduct1) > combinedRadiusSq * wLengthSq) {
        const wLength = Math.sqrt(wLengthSq) || 1;
        const unitWx = wX / wLength;
        const unitWy = wY / wLength;
        lineDx = unitWy;
        lineDy = -unitWx;
        ux = (combinedRadius * invTimeHorizon - wLength) * unitWx;
        uy = (combinedRadius * invTimeHorizon - wLength) * unitWy;
      } else {
        const leg = Math.sqrt(Math.max(0, distSq - combinedRadiusSq));
        if (det(relX, relY, wX, wY) > 0) {
          lineDx = (relX * leg - relY * combinedRadius) / distSq;
          lineDy = (relX * combinedRadius + relY * leg) / distSq;
        } else {
          lineDx = -(relX * leg + relY * combinedRadius) / distSq;
          lineDy = -(-relX * combinedRadius + relY * leg) / distSq;
        }
        const dotProduct2 = dot(relVx, relVy, lineDx, lineDy);
        ux = dotProduct2 * lineDx - relVx;
        uy = dotProduct2 * lineDy - relVy;
      }
    } else {
      const wX = relVx - invTimeStep * relX;
      const wY = relVy - invTimeStep * relY;
      const wLength = abs(wX, wY) || 1;
      const unitWx = wX / wLength;
      const unitWy = wY / wLength;
      lineDx = unitWy;
      lineDy = -unitWx;
      ux = (combinedRadius * invTimeStep - wLength) * unitWx;
      uy = (combinedRadius * invTimeStep - wLength) * unitWy;
    }

    lines.push({
      px: vx + 0.5 * ux,
      py: vy + 0.5 * uy,
      dx: lineDx,
      dy: lineDy,
    });
  }

  const result = { vx: 0, vy: 0 };
  const lineFail = linearProgram2(lines, maxSpeed, prefVx, prefVy, false, result);
  if (lineFail < lines.length) {
    linearProgram3(lines, 0, lineFail, maxSpeed, result);
  }
  return result;
}

/**
 * 建一帧邻域索引（空间哈希）。
 * @param {Array<{id:any,x:number,y:number,vx:number,vy:number,r:number}>} agents
 * @param {{neighborDist?:number, maxNeighbors?:number, timeHorizon?:number, cellSize?:number}} [opts]
 */
function beginFrame(agents, opts) {
  const neighborDist = (opts && opts.neighborDist) || 140;
  const maxNeighbors = (opts && opts.maxNeighbors) || 10;
  const timeHorizon = (opts && opts.timeHorizon) || 1.25;
  const cellSize = (opts && opts.cellSize) || Math.max(40, neighborDist * 0.5);
  const byId = new Map();
  const cells = new Map();
  const rangeSq = sqr(neighborDist);

  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    byId.set(a.id, a);
    const cx = Math.floor(a.x / cellSize);
    const cy = Math.floor(a.y / cellSize);
    const key = cx + ',' + cy;
    let bucket = cells.get(key);
    if (!bucket) {
      bucket = [];
      cells.set(key, bucket);
    }
    bucket.push(a);
  }

  return {
    agents,
    byId,
    cells,
    cellSize,
    neighborDist,
    maxNeighbors,
    timeHorizon,
    rangeSq,
  };
}

function queryNeighbors(frame, agent) {
  const cx = Math.floor(agent.x / frame.cellSize);
  const cy = Math.floor(agent.y / frame.cellSize);
  const ring = Math.max(1, Math.ceil(frame.neighborDist / frame.cellSize));
  const found = [];
  for (let dy = -ring; dy <= ring; dy++) {
    for (let dx = -ring; dx <= ring; dx++) {
      const bucket = frame.cells.get(cx + dx + ',' + (cy + dy));
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const o = bucket[i];
        if (o.id === agent.id) continue;
        const d2 = absSq(o.x - agent.x, o.y - agent.y);
        if (d2 >= frame.rangeSq) continue;
        found.push({ d2, o });
      }
    }
  }
  found.sort((a, b) => a.d2 - b.d2);
  const out = [];
  const n = Math.min(frame.maxNeighbors, found.length);
  for (let i = 0; i < n; i++) out.push(found[i].o);
  return out;
}

/**
 * @returns {{vx:number,vy:number}}
 */
function compute(frame, agentId, prefVx, prefVy, maxSpeed, timeStep) {
  const self = frame.byId.get(agentId);
  if (!self) return { vx: prefVx, vy: prefVy };
  const neighbors = queryNeighbors(frame, self);
  if (!neighbors.length) {
    const sp = abs(prefVx, prefVy);
    if (sp > maxSpeed && sp > 1e-6) {
      return { vx: (prefVx / sp) * maxSpeed, vy: (prefVy / sp) * maxSpeed };
    }
    return { vx: prefVx, vy: prefVy };
  }
  return computeNewVelocity(
    self,
    neighbors,
    prefVx,
    prefVy,
    Math.max(1e-3, maxSpeed),
    timeStep,
    frame.timeHorizon
  );
}

module.exports = {
  beginFrame,
  compute,
  computeNewVelocity,
  queryNeighbors,
};
