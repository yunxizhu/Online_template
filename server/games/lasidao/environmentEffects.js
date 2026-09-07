'use strict';

/**
 * 事件牌效果
 * - setupEnvironmentOnBoard：上场初始化
 * - applyEnvironmentOnDispatch：派遣触发（可能返回 needChoice）
 * - applyEnvironmentOnSettleSlot：结算抵消后（资源发放前/穿插）
 *
 * 骰子 vs 派遣强度：
 * - workers / physical / ranked[].dice = 物理骰子枚数 → 效果文案写「骰子数」时用此值
 * - slotStrengthMap / ranked[].count / remain = 派遣强度（强化骰 1.5）→ 仅用于抵消、排名、发资源名次
 */
const {
  getEnvironmentDef,
  RESOURCE_LABELS,
  RESOURCES,
  NEUTRAL_WORKER_ID,
} = require('./decks');

function physicalDiceOnSlot(physical, pid) {
  return Number(physical && physical[pid]) || 0;
}

function envOnResourceSlot(game, number) {
  const envs =
    (game.board && game.board.resource && game.board.resource.environments) ||
    {};
  return envs[number] || null;
}

function grantOne(player, resource, amount = 1) {
  if (!player || !resource || amount <= 0) return 0;
  player.resources[resource] = (player.resources[resource] || 0) + amount;
  player.roundGained = (Number(player.roundGained) || 0) + amount;
  return amount;
}

function grantMap(player, map) {
  let total = 0;
  const detail = [];
  for (const r of RESOURCES) {
    const n = Number(map && map[r]) || 0;
    if (n <= 0) continue;
    grantOne(player, r, n);
    total += n;
    detail.push({ resource: r, amount: n });
  }
  return { total, detail };
}

function grantRandomResources(player, count) {
  const n = Math.max(0, Number(count) || 0);
  const map = {};
  for (let i = 0; i < n; i++) {
    const r = RESOURCES[Math.floor(Math.random() * RESOURCES.length)];
    map[r] = (map[r] || 0) + 1;
  }
  return grantMap(player, map);
}

function addNeutralEachSlot(game) {
  for (const area of ['resource', 'special']) {
    for (let n = 1; n <= 6; n++) {
      addNeutral(game, area, n, 1);
    }
  }
}

/** 围魏救赵：按 2×3 数字格邻接，仅在资源区周边格各放 1 枚中立骰 */
const WEI_QI_ADJACENT_SLOTS = {
  1: [2, 4],
  2: [1, 3, 5],
  3: [2, 6],
  4: [1, 5],
  5: [2, 4, 6],
  6: [3, 5],
};

function adjacentSlotsForEvent(eventNumber) {
  const key = Number(eventNumber);
  return (WEI_QI_ADJACENT_SLOTS[key] || []).slice();
}

/** @deprecated 旧奇偶逻辑；保留别名以免外部引用断裂 */
function paritySlotsForEvent(eventNumber) {
  return adjacentSlotsForEvent(eventNumber);
}

function addNeutralAdjacentSlots(game, eventNumber) {
  for (const n of adjacentSlotsForEvent(eventNumber)) {
    addNeutral(game, 'resource', n, 1);
  }
}

function addNeutralParitySlots(game, eventNumber) {
  addNeutralAdjacentSlots(game, eventNumber);
}

function countNeutralGatherSources(game, toArea, toNumber) {
  if (!game) return 0;
  let total = 0;
  const ta = toArea || 'resource';
  const tn = Number(toNumber);
  for (const area of ['resource', 'special']) {
    for (let n = 1; n <= 6; n++) {
      if (area === ta && n === tn) continue;
      if (neutralCountOn(game, area, n) > 0) total += 1;
    }
  }
  return total;
}

function moveAllNeutralsBetweenSlots(game, fromArea, fromNumber, toArea, toNumber) {
  const fromW =
    game.board[fromArea].workers[fromNumber] ||
    (game.board[fromArea].workers[fromNumber] = {});
  const n = Number(fromW[NEUTRAL_WORKER_ID]) || 0;
  if (n <= 0) {
    return { ok: false, error: '该板块没有中立骰' };
  }
  delete fromW[NEUTRAL_WORKER_ID];
  const toW =
    game.board[toArea].workers[toNumber] ||
    (game.board[toArea].workers[toNumber] = {});
  toW[NEUTRAL_WORKER_ID] = (toW[NEUTRAL_WORKER_ID] || 0) + n;
  return { ok: true, count: n };
}

function addNeutral(game, area, number, count) {
  const areaBoard = game.board[area];
  if (!areaBoard) return;
  const slotW = areaBoard.workers[number] || (areaBoard.workers[number] = {});
  slotW[NEUTRAL_WORKER_ID] = (slotW[NEUTRAL_WORKER_ID] || 0) + count;
}

function neutralCountOn(game, area, number) {
  const w =
    (game.board[area] &&
      game.board[area].workers &&
      game.board[area].workers[number]) ||
    {};
  return Number(w[NEUTRAL_WORKER_ID]) || 0;
}

/** 吃不了兜着走：上场暗置 2 张资源 */
const KEEP_OVERFLOW_STASH_COUNT = 2;

/** 先到先得：第 1–3 轮暗置 3 张，第 4–6 轮 5 张，第 7 轮起 7 张 */
function firstComeStashCount(round) {
  const r = Number(round) || 1;
  if (r >= 7) return 7;
  if (r >= 4) return 5;
  return 3;
}

/** @deprecated 与 firstComeStashCount 相同 */
function firstComeGrantTier(round) {
  return firstComeStashCount(round);
}

function discardStashResourceCards(game, cards, pushToDiscardFn) {
  const list = Array.isArray(cards) ? cards : [];
  if (!list.length) return;
  if (typeof pushToDiscardFn === 'function') {
    for (const c of list) pushToDiscardFn(game, 'resource', c);
    return;
  }
  if (!game.resourceDiscard) game.resourceDiscard = [];
  for (const c of list) {
    if (c) game.resourceDiscard.push(c);
  }
}

function fillStashResourceCards(game, env, count, helpers) {
  env.stashClaimed = false;
  env.stashCards = [];
  const n = Math.max(0, Number(count) || 0);
  const draw =
    helpers && typeof helpers.drawOne === 'function' ? helpers.drawOne : null;
  for (let i = 0; i < n; i++) {
    const card = draw ? draw(game, 'resource') : null;
    if (!card) break;
    env.stashCards.push({ ...card, kind: 'resource', faceDown: true });
  }
  return env.stashCards.length;
}

function claimStashResourceCards(game, env, player, pushToDiscardFn) {
  const cards = Array.isArray(env.stashCards) ? env.stashCards.slice() : [];
  env.stashClaimed = true;
  env.stashCards = [];
  const grant = {};
  for (const c of cards) {
    const r = c && c.resource;
    if (!RESOURCES.includes(r)) continue;
    grant[r] = (grant[r] || 0) + 1;
  }
  const got = grantMap(player, grant);
  discardStashResourceCards(game, cards, pushToDiscardFn);
  return got;
}

/** 先到先得：第 1–3 轮需 2 村民，第 4–6 轮需 3，第 7 轮起需 4 */
function firstComeRequiredWorkers(round) {
  const r = Number(round) || 1;
  if (r >= 7) return 4;
  if (r >= 4) return 3;
  return 2;
}

/** 派遣后是否成为本格严格最大者（基于总强度含强化加成） */
function becameStrictSlotLeader(workers, playerId, placed, boosts) {
  const myCount = Number((workers || {})[playerId]) || 0;
  const myBoost = Math.min(Math.max(0, Number(boosts && boosts[playerId]) || 0), myCount);
  const myStrength = myCount * 2 + myBoost;

  const myPrevCount = Math.max(0, myCount - (Number(placed) || 0));
  const myPrevBoost = Math.min(Math.max(0, Number(boosts && boosts[playerId]) || 0 - Math.max(0, myCount - myPrevCount)), myPrevCount);
  const myPrevStrength = myPrevCount * 2 + myPrevBoost;

  let otherMaxStrength = 0;
  for (const [pid, c] of Object.entries(workers || {})) {
    if (pid === playerId) continue;
    const count = Number(c) || 0;
    const boost = Math.min(Math.max(0, Number(boosts && boosts[pid]) || 0), count);
    const strength = count * 2 + boost;
    otherMaxStrength = Math.max(otherMaxStrength, strength);
  }
  return myStrength > otherMaxStrength && myPrevStrength <= otherMaxStrength;
}

/** 本格骰子归属者数量：每位玩家与中立各计 1（数量>0 才计入） */
function slotDistinctOwnerCount(workers) {
  let n = 0;
  for (const c of Object.values(workers || {})) {
    if ((Number(c) || 0) > 0) n += 1;
  }
  return n;
}

/** @deprecated 与 becameStrictSlotLeader 相同；保留供测试兼容 */
function becameLeaderAgain(workers, playerId, placed, pastLeaders, boosts) {
  void pastLeaders;
  return becameStrictSlotLeader(workers, playerId, placed, boosts);
}

function hasDispatchEffect(env) {
  if (!env) return false;
  if (env.trigger === 'dispatch') return true;
  const def = getEnvironmentDef(env.envType) || {};
  return Boolean(def.dispatchAlso || env.dispatchAlso);
}

/**
 * 上场初始化（抽到 4/5/6 后立刻执行）
 */
function setupEnvironmentOnBoard(game, env, number, helpers) {
  if (!env) return;
  const setup = env.setup || (getEnvironmentDef(env.envType) || {}).setup;
  switch (setup) {
    case 'marker':
      if (helpers && helpers.pushLog) {
        helpers.pushLog(
          game,
          `「${env.label}」：上场于资源格 ${number}（成为本格唯一领先者可放置标记）`
        );
      }
      break;
    case 'neutral3':
      addNeutral(game, 'resource', number, 3);
      if (helpers && helpers.pushLog) {
        helpers.pushLog(game, `「${env.label}」：资源格 ${number} 放置 3 枚中立骰`);
      }
      break;
    case 'neutral2':
      addNeutral(game, 'resource', number, 2);
      if (helpers && helpers.pushLog) {
        helpers.pushLog(game, `「${env.label}」：资源格 ${number} 放置 2 枚中立骰`);
      }
      break;
    case 'neutralEachSlot':
      addNeutralEachSlot(game);
      if (helpers && helpers.pushLog) {
        helpers.pushLog(
          game,
          `「${env.label}」：资源区与功能/建筑区各数字格各放置 1 枚中立骰`
        );
      }
      break;
    case 'neutralAdjacentSlots':
    case 'neutralParitySlots':
      addNeutralAdjacentSlots(game, number);
      if (helpers && helpers.pushLog) {
        const slots = adjacentSlotsForEvent(number);
        helpers.pushLog(
          game,
          `「${env.label}」：资源区周边格（${slots.join('、')}）各放置 1 枚中立骰`
        );
      }
      break;
    case 'mercenary2':
      env.mercenaryDice = 2;
      if (helpers && helpers.pushLog) {
        helpers.pushLog(game, `「${env.label}」：资源格 ${number} 放置 2 枚雇佣骰`);
      }
      break;
    case 'sideCard': {
      const card =
        helpers && typeof helpers.drawOne === 'function'
          ? helpers.drawOne(game, 'special')
          : null;
      if (card) {
        env.sideCard = { ...card, faceDown: true };
        if (helpers && helpers.pushLog) {
          helpers.pushLog(
            game,
            `「${env.label}」：合堆顶 1 张牌暗置在资源格 ${number} 旁`
          );
        }
      }
      break;
    }
    case 'stashResources': {
      const count = firstComeStashCount(game.round);
      const required = firstComeRequiredWorkers(game.round);
      env.firstComeRequired = required;
      env.firstComeClaims = {};
      fillStashResourceCards(game, env, count, helpers);
      if (helpers && helpers.pushLog) {
        helpers.pushLog(
          game,
          `「${env.label}」：资源格 ${number} 旁暗置 ${env.stashCards.length} 张资源（本格放置满 ${required} 个村民可获得）`
        );
      }
      break;
    }
    case 'stashTwoResources': {
      fillStashResourceCards(game, env, KEEP_OVERFLOW_STASH_COUNT, helpers);
      if (helpers && helpers.pushLog) {
        helpers.pushLog(
          game,
          `「${env.label}」：资源格 ${number} 旁暗置 ${env.stashCards.length} 张资源`
        );
      }
      break;
    }
    case 'lowestScoreTwo': {
      const alive =
        (helpers && typeof helpers.alivePlayers === 'function' &&
          helpers.alivePlayers(game)) ||
        [];
      const scoreFn = helpers && helpers.playerScore;
      if (!scoreFn || !alive.length) break;
      let min = Infinity;
      for (const p of alive) {
        const s = scoreFn(p);
        if (s < min) min = s;
      }
      if (!Number.isFinite(min)) break;
      const lows = alive.filter((p) => scoreFn(p) === min);
      let count = 2;
      if (game.round >= 7) count = 4;
      else if (game.round >= 4) count = 3;
      if (!game.pendingWelfareMinimumQueue) game.pendingWelfareMinimumQueue = [];
      for (const p of lows) {
        game.pendingWelfareMinimumQueue.push({
          playerId: p.id,
          envType: env.envType,
          label: env.label,
          envNumber: number,
          envId: env.id,
          needChoice: 'pickTwoResources',
          resume: 'welfareSetup',
          count,
        });
      }
      if (helpers && typeof helpers.pushProduceFx === 'function') {
        helpers.pushProduceFx({
          type: 'envReveal',
          envType: env.envType,
          envId: env.id,
          number,
          label: env.label,
        });
      }
      if (helpers && helpers.pushLog && lows.length) {
        helpers.pushLog(
          game,
          `「${env.label}」：${lows.map((p) => p.name).join('、')}（${min} 分）请选择 ${count} 个资源`
        );
      }
      break;
    }
    default:
      break;
  }
}

function countRecallableOwnDice(game, playerId, dispatchArea, dispatchNumber, justPlacedCount) {
  if (!game || !playerId) return 0;
  let total = 0;
  for (const area of ['resource', 'special']) {
    const workers = (game.board[area] && game.board[area].workers) || {};
    for (let num = 1; num <= 6; num++) {
      const w = workers[num] || {};
      total += Number(w[playerId]) || 0;
    }
  }
  const jp = Math.max(0, Number(justPlacedCount) || 0);
  if (dispatchArea && Number(dispatchNumber) >= 1 && Number(dispatchNumber) <= 6) {
    const workers =
      (game.board[dispatchArea] && game.board[dispatchArea].workers) || {};
    const onDispatchSlot =
      Number((workers[dispatchNumber] || {})[playerId]) || 0;
    total -= Math.min(jp, onDispatchSlot);
  }
  return total;
}

function countOwnDiceOnBoard(game, playerId, excludeArea, excludeNumber) {
  if (!game || !playerId) return 0;
  let total = 0;
  const exArea = excludeArea || null;
  const exNum = Number(excludeNumber);
  for (const area of ['resource', 'special']) {
    const workers = (game.board[area] && game.board[area].workers) || {};
    for (let num = 1; num <= 6; num++) {
      if (area === exArea && num === exNum) continue;
      const w = workers[num] || {};
      total += Number(w[playerId]) || 0;
    }
  }
  return total;
}

function countAllDiceOnBoard(game) {
  if (!game) return 0;
  let total = 0;
  for (const area of ['resource', 'special']) {
    const workers = (game.board[area] && game.board[area].workers) || {};
    for (let num = 1; num <= 6; num++) {
      const w = workers[num] || {};
      for (const c of Object.values(w)) {
        total += Number(c) || 0;
      }
    }
  }
  return total;
}

/**
 * 派遣触发
 * @returns {null|{ needChoice, envType, label, number }|object}
 */
function applyEnvironmentOnDispatch(game, ctx) {
  if (!game || !ctx || ctx.area !== 'resource') return null;
  const num = Number(ctx.number);
  if (num < 1 || num > 6) return null;
  const env = envOnResourceSlot(game, num);
  if (!env || !hasDispatchEffect(env)) return null;
  const player = ctx.player;
  if (!player) return null;

  // 派遣时触发的效果：仅在自己回合生效；在别人回合被传送/驱逐过来时不触发（firstCome除外）
  if (env.envType !== 'firstCome' && game.currentPlayerId !== player.id) return null;

  switch (env.envType) {
    case 'fishermanProfit': {
      const workers = game.board.resource.workers[num] || {};
      const boostsFish = (game.board.resource.boosts && game.board.resource.boosts[num]) || {};
      if (!becameStrictSlotLeader(workers, player.id, ctx.count, boostsFish)) {
        return null;
      }
      return {
        needChoice: 'pickTwoResources',
        envType: env.envType,
        label: env.label,
        number: num,
        playerId: player.id,
        count: Math.max(1, slotDistinctOwnerCount(workers)),
      };
    }
    case 'barrenHarvest': {
      const workers = game.board.resource.workers[num] || {};
      const boostsBarren = (game.board.resource.boosts && game.board.resource.boosts[num]) || {};
      if (!becameStrictSlotLeader(workers, player.id, ctx.count, boostsBarren)) {
        return null;
      }
      return {
        needChoice: 'moveBarrenMarker',
        envType: env.envType,
        label: env.label,
        number: num,
        playerId: player.id,
      };
    }

    case 'clearSky':
      return {
        needChoice: 'pickTwoResources',
        envType: env.envType,
        label: env.label,
        number: num,
        playerId: player.id,
        count: Math.max(1, Number(ctx.count) || 1),
      };

    case 'enterFray': {
      const n = neutralCountOn(game, 'resource', num);
      if (n <= 0) {
        if (ctx.pushLog) {
          ctx.pushLog(
            game,
            `${player.name} 触发「${env.label}」：本格已无中立骰，无法移动`
          );
        }
        return { envType: env.envType, label: env.label, skipped: true };
      }
      const want = Math.max(1, Number(ctx.count) || 1);
      return {
        needChoice: 'moveNeutral',
        envType: env.envType,
        label: env.label,
        number: num,
        playerId: player.id,
        fromArea: 'resource',
        fromNumber: num,
        count: Math.min(n, want),
      };
    }

    case 'recall': {
      const justPlaced = Math.max(1, Number(ctx.count) || 1);
      const justBoosted = Math.min(
        justPlaced,
        Math.max(0, Number(ctx.boostAdd) || 0)
      );
      const recallable = countRecallableOwnDice(
        game,
        player.id,
        'resource',
        num,
        justPlaced
      );
      if (recallable <= 0) {
        if (ctx.pushLog) {
          ctx.pushLog(
            game,
            `${player.name} 触发「${env.label}」：场上无其它可召回的骰子，跳过`
          );
        }
        return { envType: env.envType, label: env.label, skipped: true };
      }
      return {
        needChoice: 'recallDie',
        envType: env.envType,
        label: env.label,
        number: num,
        playerId: player.id,
        excludeArea: 'resource',
        excludeNumber: num,
        justPlacedCount: justPlaced,
        justPlacedEnhanced: justBoosted,
      };
    }

    case 'teleport': {
      const workersTp = game.board.resource.workers[num] || {};
      const boostsTp = (game.board.resource.boosts && game.board.resource.boosts[num]) || {};
      if (!becameStrictSlotLeader(workersTp, player.id, ctx.count, boostsTp)) {
        return null;
      }
      if (countAllDiceOnBoard(game) <= 0) {
        if (ctx.pushLog) {
          ctx.pushLog(
            game,
            `${player.name} 触发「${env.label}」：场上无骰子可传送`
          );
        }
        return { envType: env.envType, label: env.label, skipped: true };
      }
      return {
        needChoice: 'teleportDie',
        teleportStep: 'from',
        envType: env.envType,
        label: env.label,
        number: num,
        playerId: player.id,
      };
    }

    case 'weiQiRescueZhao': {
      const toArea = 'resource';
      const toNumber = num;
      if (countNeutralGatherSources(game, toArea, toNumber) <= 0) {
        if (ctx.pushLog) {
          ctx.pushLog(
            game,
            `${player.name} 触发「${env.label}」：无其他板块的中立骰可集中`
          );
        }
        return { envType: env.envType, label: env.label, skipped: true };
      }
      return {
        needChoice: 'gatherNeutrals',
        envType: env.envType,
        label: env.label,
        number: num,
        playerId: player.id,
        toArea,
        toNumber,
      };
    }

    case 'firstCome': {
      const workers = game.board.resource.workers[num] || {};
      const physical = Number(workers[player.id]) || 0;
      const placed = Number(ctx.count) || 0;
      const prevCount = Math.max(0, physical - placed);
      const required =
        env.firstComeRequired != null
          ? Number(env.firstComeRequired)
          : firstComeRequiredWorkers(game.round);
      if (!env.firstComeClaims) env.firstComeClaims = {};
      if (env.firstComeClaims[player.id]) return null;
      // 先到先得：暗置资源只有一份，已被别人领走后自己不能再领
      if (env.stashClaimed) return null;
      if (!(prevCount < required && physical >= required)) return null;
      const cards = Array.isArray(env.stashCards) ? env.stashCards.slice() : [];
      if (!cards.length) return null;
      const got = claimStashResourceCards(game, env, player, ctx.pushToDiscard);
      env.firstComeClaims[player.id] = true;
      if (ctx.pushLog) {
        ctx.pushLog(
          game,
          `${player.name} 触发「${env.label}」：本格放置满 ${required} 个村民，获得了${got.total}张随机资源`
        );
      }
      if (ctx.syncResourceHandPending) ctx.syncResourceHandPending(player, game);
      if (ctx.pushProduceFx && typeof ctx.pushProduceFx === 'function') {
        ctx.pushProduceFx({
          type: 'envReward',
          envType: env.envType,
          envId: env.id,
          number: num,
          label: env.label,
          rewards: [
            {
              pid: player.id,
              detail: got.detail,
              total: got.total,
            },
          ],
        });
      }
      return {
        envType: env.envType,
        label: env.label,
        claimed: true,
        required,
        total: got.total,
      };
    }

    default:
      return null;
  }
}

/**
 * 结算触发（抵消后、发放本格资源前调用；部分效果在发放后由 afterShare 处理）
 */
function applyEnvironmentOnSettleSlot(game, ctx) {
  if (!game || !ctx) return null;
  const num = Number(ctx.number);
  const env = envOnResourceSlot(game, num);
  if (!env || env.trigger !== 'settle') return null;

  const ranked = ctx.ranked || [];
  const remain = ctx.remain || {};
  const result = {
    envType: env.envType,
    label: env.label,
    trigger: 'settle',
    number: num,
  };

  switch (env.envType) {
    case 'oneMountain': {
      if (ctx.skipSecondShare) ctx.skipSecondShare.add(num);
      if (ctx.pushLog) {
        ctx.pushLog(
          game,
          `「${env.label}」：第二名不获得本格小份资源，第一名额外获得小份`
        );
      }
      break;
    }

    case 'resistBarbarians':
      // 改在全部分发资源后、弃牌前由 applyResistBarbariansAfterSettle 处理
      break;

    case 'keepOverflow':
      // 改在全部分发资源后、弃牌前由 applyKeepOverflowAfterSettle 处理
      break;

    case 'prisonersDilemma': {
      const physical = ctx.physical || {};
      const alive = (ctx.alivePlayers && ctx.alivePlayers(game)) || [];
      if (!alive.length) break;

      // 计算弃牌数 n：先看板上所有实体（含中立）抵消后的名次，取第一名的骰子数
      const entries = Object.entries(physical).filter(([, c]) => c > 0);
      const byCount = new Map();
      for (const [pid, c] of entries) {
        if (!byCount.has(c)) byCount.set(c, []);
        byCount.get(c).push(pid);
      }
      const physicalRemain = {};
      for (const [c, pids] of byCount) {
        if (pids.length === 1) physicalRemain[pids[0]] = c;
      }
      const physicalRanked = Object.entries(physicalRemain)
        .map(([pid, count]) => ({
          pid,
          count,
          dice: Number(physical[pid]) || 0,
        }))
        .sort((a, b) => b.count - a.count);

      const top = physicalRanked[0];
      const n = top
        ? Number(top.dice) || physicalDiceOnSlot(physical, top.pid)
        : 0;

      // 确定受害者：看所有玩家中谁的“抵消后物理骰子数”最少（含没放的 0）
      // 中立骰只用来参与抵消，本身不进入受害者判定
      const playerCounts = alive.map((p) => ({
        pid: p.id,
        count: physicalRemain[p.id] || 0,
      }));
      if (playerCounts.length <= 1) break; // 只有一人不罚
      const minCount = Math.min(...playerCounts.map((pc) => pc.count));
      const maxCount = Math.max(...playerCounts.map((pc) => pc.count));

      // 若所有玩家抵消后骰子数相同，则人人都是最后一名
      const victims = alive.filter((p) => {
        const count = physicalRemain[p.id] || 0;
        if (minCount === maxCount) return true;
        return count === minCount;
      });

      if (!game.pendingPrisonerDiscards) game.pendingPrisonerDiscards = {};
      for (const p of victims) {
        if (n <= 0) continue;
        game.pendingPrisonerDiscards[p.id] =
          (Number(game.pendingPrisonerDiscards[p.id]) || 0) + n;
      }
      if (ctx.pushLog) {
        ctx.pushLog(
          game,
          n <= 0
            ? `「${env.label}」：第一名骰数为 0，无需弃牌`
            : `「${env.label}」：${victims.map((p) => p.name).join('、')}（最后一名）各需弃 ${n} 张（个人产出后）`
        );
      }
      break;
    }

    case 'luckyDraw': {
      // 含中立排名：仅当抵消后真正第一名为玩家时发牌（中立独占第一则无人获得）
      const top = ranked[0];
      if (
        top &&
        top.pid !== NEUTRAL_WORKER_ID &&
        env.sideCard &&
        ctx.playerById
      ) {
        const p = ctx.playerById(game, top.pid);
        if (p) {
          const card = { ...env.sideCard, faceDown: false };
          env.sideCard = null;
          if (typeof ctx.takeEventSideCard === 'function') {
            ctx.takeEventSideCard(game, p, card);
          }
          if (ctx.pushLog) {
            const kindText =
              card.kind === 'building' || card.buildType
                ? '建筑卡'
                : '功能卡';
            ctx.pushLog(
              game,
              `「${env.label}」：${p.name}获得了1张${kindText}`
            );
          }
          result.envReveal = {
            envType: env.envType,
            envId: env.id,
            number: num,
            label: env.label,
            claimPid: p.id,
            sideCardKind:
              card.kind === 'building' || card.buildType
                ? 'building'
                : 'function',
          };
        }
      } else if (ctx.pushLog) {
        ctx.pushLog(game, `「${env.label}」：无有效第一名或无暗置牌`);
      }
      break;
    }

    case 'mercenaries':
      // 改为全员放置完毕、生产判定前由 queueMercenariesBeforeSettle 处理
      break;

    case 'fishermanProfit':
      // 在资源发放后由 afterShare 处理
      result.afterShare = true;
      break;

    default:
      break;
  }

  return result;
}

/**
 * 本格 1/2 名资源发放完毕后（渔翁得利等）
 */
function applyEnvironmentAfterShare(game, ctx) {
  if (!game || !ctx) return null;
  const num = Number(ctx.number);
  const env = envOnResourceSlot(game, num);
  if (!env || env.envType !== 'fishermanProfit') return null;

  const ranked = ctx.ranked || [];
  const third = ranked[2];
  if (!third || third.pid === NEUTRAL_WORKER_ID) {
    if (ctx.pushLog) {
      ctx.pushLog(game, `「${env.label}」：无第三名玩家，未生效`);
    }
    return null;
  }
  const p = ctx.playerById(game, third.pid);
  if (!p) return null;

  const sum = { wood: 0, stone: 0, food: 0, iron: 0 };
  for (const g of ctx.gains || []) {
    if (g.rank !== 1 && g.rank !== 2) continue;
    for (const d of g.detail || []) {
      if (!d.resource) continue;
      sum[d.resource] = (sum[d.resource] || 0) + (Number(d.amount) || 0);
    }
  }
  const got = grantMap(p, sum);
  if (ctx.pushLog) {
    ctx.pushLog(
      game,
      got.total
        ? `「${env.label}」：第三名 ${p.name} 获得 ` +
            got.detail
              .map((d) => `${d.amount} ${RESOURCE_LABELS[d.resource]}`)
              .join('、')
        : `「${env.label}」：前两名未获得资源，第三名无奖励`
    );
  }
  if (ctx.syncResourceHandPending) ctx.syncResourceHandPending(p, game);
  return { envType: env.envType, thirdId: p.id, got };
}

/**
 * 生产结算（抵消+发资源）全部完成后、弃牌前：
 * 抵抗南蛮等效果按名次从第一名起发分，达 15 立刻结束。
 */
function applyResistBarbariansAfterSettle(game, report, helpers) {
  if (!game || game.over || !report) return;
  const playerById = helpers && helpers.playerById;
  const pushLog = helpers && helpers.pushLog;
  const checkWin = helpers && helpers.checkWin;
  if (!playerById) return;

  for (const slot of report.slots || []) {
    if (game.over) return;
    if (!slot || slot.area !== 'resource') continue;
    const env = envOnResourceSlot(game, slot.number);
    if (!env || env.envType !== 'resistBarbarians') continue;

    const remain = slot.remain || {};
    const physical = slot.physical || {};
    const ranked = slot.ranked || [];
    const awards = [];
    for (const r of ranked) {
      if (game.over) break;
      if (!r || r.pid === NEUTRAL_WORKER_ID) continue;
      if (!(Number(remain[r.pid]) || 0)) continue;
      const diceCount =
        Number(r.dice) || physicalDiceOnSlot(physical, r.pid);
      let needDice = 2;
      if (game.round >= 7) needDice = 4;
      else if (game.round >= 4) needDice = 3;
      if (diceCount < needDice) continue;
      const p = playerById(game, r.pid);
      if (!p || p.left) continue;
      p.bonusScore = (Number(p.bonusScore) || 0) + 1;
      awards.push({ pid: p.id, amount: 1 });
      if (pushLog) {
        pushLog(
          game,
          `「${env.label}」：${p.name}（第 ${ranked.indexOf(r) + 1} 名，剩余 ${diceCount} 骰，需≥${needDice}）+1 胜利点`
        );
      }
      if (typeof checkWin === 'function' && checkWin(game)) break;
    }
    if (awards.length) {
      slot.envReveal = {
        envType: env.envType,
        envId: env.id,
        number: slot.number,
        label: env.label,
        scoreAwards: awards,
      };
    } else if (pushLog) {
      let needDesc = '2';
      if (game.round >= 7) needDesc = '4';
      else if (game.round >= 4) needDesc = '3';
      pushLog(game, `「${env.label}」：无人拥有 ≥${needDesc} 骰，未生效`);
    }
    if (game.over) return;
  }
}

/** 本格第一名玩家 id（含中立排名；中立为第一则无人获得玩家向「第一名」奖励） */
function firstPlacePlayerIds(ranked) {
  const top = (ranked || [])[0];
  if (!top || !top.pid || (Number(top.count) || 0) <= 0) return [];
  if (top.pid === NEUTRAL_WORKER_ID) return [];
  const topCount = Number(top.count) || 0;
  return (ranked || [])
    .filter(
      (r) =>
        r &&
        r.pid &&
        r.pid !== NEUTRAL_WORKER_ID &&
        (Number(r.count) || 0) === topCount
    )
    .map((r) => r.pid);
}

/**
 * 生产结算（抵消并发资源）全部完成后、弃牌前：
 * 吃不了兜着走：本格第一名跳过本轮资源弃牌阶段，并获得上场暗置的 2 张资源。
 */
function applyKeepOverflowAfterSettle(game, report, helpers) {
  if (!game || game.over || !report) return;
  const playerById = helpers && helpers.playerById;
  const pushLog = helpers && helpers.pushLog;
  const syncPending = helpers && helpers.syncResourceHandPending;
  const pushToDiscard = helpers && helpers.pushToDiscard;
  if (!playerById) return;

  for (const slot of report.slots || []) {
    if (!slot || slot.area !== 'resource') continue;
    const env = envOnResourceSlot(game, slot.number);
    if (!env || env.envType !== 'keepOverflow') continue;

    const ids = firstPlacePlayerIds(slot.ranked || []);
    if (!ids.length) {
      if (pushLog) {
        pushLog(game, `「${env.label}」：本格无有效第一名，未生效`);
      }
      continue;
    }
    const names = [];
    const rewards = [];
    let stashGranted = false;
    for (const pid of ids) {
      const p = playerById(game, pid);
      if (!p || p.left) continue;
      p.skipSettleResourceDiscard = true;
      if (typeof syncPending === 'function') {
        syncPending(p, game);
      } else {
        p.pendingDiscardRes = false;
      }
      let got = { total: 0, detail: [] };
      if (!stashGranted) {
        got = claimStashResourceCards(game, env, p, pushToDiscard);
        stashGranted = true;
      }
      if (typeof syncPending === 'function') {
        syncPending(p, game);
      }
      names.push(p.name);
      if (pushLog && got.total) {
        pushLog(game, `${p.name}获得了${got.total}张随机资源`);
      }
      if (got.total) {
        rewards.push({ pid: p.id, detail: got.detail, total: got.total });
      }
    }
    if (pushLog && !names.length) {
      pushLog(game, `「${env.label}」：本格无有效第一名，未生效`);
    }
    if (rewards.length) {
      slot.envReward = {
        type: 'envReward',
        envType: env.envType,
        envId: env.id,
        number: slot.number,
        label: env.label,
        rewards,
      };
    }
  }
}

/** 有标记的格：资源区不发放资源，功能/建筑区不取得卡牌 */
function isBarrenMarkerOn(game, area, number) {
  if (!game || game.barrenMarkerNumber == null) return false;
  const markerArea = game.barrenMarkerArea || 'resource';
  return (
    markerArea === area && Number(game.barrenMarkerNumber) === Number(number)
  );
}

/** @deprecated 使用 isBarrenMarkerOn(game, 'resource', number) */
function isBarrenSlot(game, number) {
  return isBarrenMarkerOn(game, 'resource', number);
}

module.exports = {
  setupEnvironmentOnBoard,
  applyEnvironmentOnDispatch,
  applyEnvironmentOnSettleSlot,
  applyEnvironmentAfterShare,
  applyResistBarbariansAfterSettle,
  applyKeepOverflowAfterSettle,
  firstPlacePlayerIds,
  envOnResourceSlot,
  isBarrenMarkerOn,
  isBarrenSlot,
  grantOne,
  grantMap,
  addNeutral,
  addNeutralEachSlot,
  addNeutralAdjacentSlots,
  addNeutralParitySlots,
  adjacentSlotsForEvent,
  paritySlotsForEvent,
  neutralCountOn,
  countNeutralGatherSources,
  moveAllNeutralsBetweenSlots,
  firstComeGrantTier,
  firstComeStashCount,
  firstComeRequiredWorkers,
  KEEP_OVERFLOW_STASH_COUNT,
  becameStrictSlotLeader,
  becameLeaderAgain,
  hasDispatchEffect,
  countOwnDiceOnBoard,
  countAllDiceOnBoard,
};
