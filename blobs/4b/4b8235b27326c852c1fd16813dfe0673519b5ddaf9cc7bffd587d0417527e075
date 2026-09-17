'use strict';

const { getGame } = require('./games');

const ALLOWED_TURN_TIMES = new Set([0, 10, 15, 20, 30, 60]);

function normalizeTurnTimeSec(value) {
  const n = Number(value);
  if (!ALLOWED_TURN_TIMES.has(n)) return 0;
  return n;
}

function clearTurnTimer(room) {
  if (!room) return;
  if (room._turnTimerHandle) {
    clearTimeout(room._turnTimerHandle);
    room._turnTimerHandle = null;
  }
  room.turnTimer = null;
}

/**
 * Start or refresh the action timer for whoever must act now.
 * @param {object} room
 * @param {{ onTimeout?: (room: object) => void }} [opts]
 */
function syncTurnTimer(room, opts = {}) {
  clearTurnTimer(room);

  const limit = Number(room.turnTimeSec) || 0;
  if (!limit || room.status !== 'playing' || !room.game) {
    return;
  }

  const mod = getGame(room.gameType);
  if (!mod || room.game.over) {
    return;
  }

  const raw = mod.getActingPlayerIds
    ? mod.getActingPlayerIds(room.game)
    : [];
  const actorIds = [...new Set((raw || []).filter(Boolean))];
  if (!actorIds.length) {
    return;
  }

  const deadline = Date.now() + limit * 1000;
  room.turnTimer = {
    actorIds,
    deadline,
    limitSec: limit,
  };

  room._turnTimerHandle = setTimeout(() => {
    room._turnTimerHandle = null;
    if (typeof opts.onTimeout === 'function') {
      opts.onTimeout(room);
    }
  }, limit * 1000);
}

module.exports = {
  ALLOWED_TURN_TIMES,
  normalizeTurnTimeSec,
  clearTurnTimer,
  syncTurnTimer,
};
