'use strict';

const helpers = (() => {
  try {
    return require('./hero/_infra_helpers');
  } catch (_) {
    return null;
  }
})();

function alivePlayers(game) {
  return game.players.filter((p) => p.alive);
}

function seatDistance(game, fromId, toId) {
  if (fromId === toId) return 0;
  const seats = alivePlayers(game);
  const n = seats.length;
  const i = seats.findIndex((p) => p.id === fromId);
  const j = seats.findIndex((p) => p.id === toId);
  if (i < 0 || j < 0) return 99;
  const d = Math.abs(i - j);
  return Math.min(d, n - d);
}

function offensiveHorse(p) {
  return p.equips.horseMinus ? 1 : 0;
}

function defensiveHorse(p) {
  return p.equips.horsePlus ? 1 : 0;
}

/** 从 from 计算到 to 的距离 */
function distance(game, fromId, toId) {
  const from = game.players.find((p) => p.id === fromId);
  const to = game.players.find((p) => p.id === toId);
  if (!from || !to || !from.alive || !to.alive) return 99;
  let d = seatDistance(game, fromId, toId);
  let off = offensiveHorse(from);
  if (helpers && typeof helpers.distanceOffBonus === 'function') {
    off += helpers.distanceOffBonus(from);
  } else if (from.skills && from.skills.some((s) => s.id === 'mashu')) {
    off += 1;
  }
  d = Math.max(1, d - off + defensiveHorse(to));
  if (fromId === toId) return 0;
  return d;
}

function attackRange(player) {
  if (player.skillStates && player.skillStates.gongqiRange) return 99;
  if (player.equips.weapon && player.equips.weapon.range) {
    return player.equips.weapon.range;
  }
  return 1;
}

function inAttackRange(game, fromId, toId) {
  const from = game.players.find((p) => p.id === fromId);
  if (!from) return false;
  if (
    from.skillStates &&
    from.skillStates.liegongRange != null &&
    typeof from.skillStates.liegongRange === 'number'
  ) {
    return distance(game, fromId, toId) <= from.skillStates.liegongRange;
  }
  return attackRange(from) >= distance(game, fromId, toId);
}

module.exports = {
  alivePlayers,
  seatDistance,
  distance,
  attackRange,
  inAttackRange,
};
