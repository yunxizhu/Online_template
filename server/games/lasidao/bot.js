'use strict';

/**
 * ???? AI?Bot??????
 *
 * ?? decideBotAction(game, playerId, difficulty, botState) ??{ type, payload }|null
 * ??????bot ??????????????????? tick???
 *
 * ????
 *   easy   ?????????/????????????????????
 *   normal ?????????????????????????????
 *   hard   ?????????????????????????????????
 */

const { becameStrictSlotLeader } = require('./environmentEffects');
const {
  BUILD_HOUSE_COST,
  BUY_FUNC_COST,
  breedFoodCost,
} = require('./decks');

const RESOURCES = ['wood', 'stone', 'food', 'iron'];
const BOARD_AREAS = ['resource', 'special'];
/** 常驻扩建造价（与 engine.expandPermanentCost 一致） */
const EXPAND_COST = { wood: 1, stone: 1 };

/* ?????????? ?????? engine ???????????????????? */

/**
 * 本次往资源格放 count 枚（含 boostAdd 强化）后，是否「成为」严格最大者。
 * 与 engine 传送/渔翁/颗粒无收触发条件一致：已是最大再加码不触发。
 */
function wouldBecomeStrictLeaderOnResource(game, player, number, count, boostAdd) {
  const board = game.board && game.board.resource;
  if (!board || !player) return false;
  const face = Number(number);
  const n = Math.max(0, Number(count) || 0);
  if (!(face >= 1 && face <= 6) || n <= 0) return false;
  const beforeWk = (board.workers && board.workers[face]) || {};
  const beforeBoosts = (board.boosts && board.boosts[face]) || {};
  const afterWk = {
    ...beforeWk,
    [player.id]: (Number(beforeWk[player.id]) || 0) + n,
  };
  const afterBoosts = {
    ...beforeBoosts,
    [player.id]: (Number(beforeBoosts[player.id]) || 0) + (Number(boostAdd) || 0),
  };
  return becameStrictSlotLeader(afterWk, player.id, n, afterBoosts);
}

function playerById(game, id) {
  return (game.players || []).find((p) => p.id === id) || null;
}
function alivePlayers(game) {
  return (game.players || []).filter((p) => !p.left);
}
function sumRes(r) {
  return RESOURCES.reduce((s, k) => s + (r[k] || 0), 0);
}
function canPay(have, cost) {
  for (const k of RESOURCES) {
    if ((have[k] || 0) < (cost[k] || 0)) return false;
  }
  return true;
}
function pay(have, cost) {
  for (const k of RESOURCES) have[k] = (have[k] || 0) - (cost[k] || 0);
}
function copyRes(src) {
  const o = {};
  for (const k of RESOURCES) o[k] = src[k] || 0;
  return o;
}
function addRes(have, gain) {
  for (const k of RESOURCES) have[k] = (have[k] || 0) + (gain[k] || 0);
}
/** 剩余住房空位（与 engine：每房 2 人） */
function freeHousesFor(player) {
  const capacity = (Number(player && player.houses) || 0) * 2;
  const villagers = Number(player && player.villagers) || 0;
  return Math.max(0, capacity - villagers);
}
function idleVillagers(player) {
  const n = Number(player.villagers) || 0;
  return Math.max(0, n - (Number(player.dispatched) || 0) - (Number(player.voided) || 0));
}

/** ???????????????? */
function remainingDiceCount(player) {
  const total = Number(player.villagers) || 0;
  const dispatched = Number(player.dispatched) || 0;
  const voided = Number(player.voided) || 0;
  return Math.max(0, total - dispatched - voided);
}

/** ????????????face ??????
 * ?????????????0~1)?? ???????? ?????? */
function rivalCanStillInterfereOnFace(game, player, face) {
  // ?????????? face ????????
  let maxRivalRemaining = 0;
  for (const p of alivePlayers(game)) {
    if (p.id === player.id || p.left) continue;
    const rem = remainingDiceCount(p);
    if (rem > maxRivalRemaining) maxRivalRemaining = rem;
  }

  // ??????????????????face????????????face
  // ?????????? rem ???????????????1 ????
  // = 1 - (5/6)^rem
  if (maxRivalRemaining <= 0) return 0;
  const probAtLeastOne = 1 - Math.pow(5 / 6, maxRivalRemaining);
  return probAtLeastOne;
}

/** ??????????????????????????? */
function maxRemainingAmongRivals(game, player) {
  let max = 0;
  for (const p of alivePlayers(game)) {
    if (p.id === player.id || p.left) continue;
    max = Math.max(max, remainingDiceCount(p));
  }
  return max;
}

/** 对手剩余可派遣骰总数（全员合计） */
function totalRemainingAmongRivals(game, player) {
  let sum = 0;
  for (const p of alivePlayers(game)) {
    if (p.id === player.id || p.left) continue;
    sum += remainingDiceCount(p);
  }
  return sum;
}

/**
 * 对手剩余骰越少，往已占格加码越亏。
 * rem=0 满扣；rem≥5 基本不扣。
 */
function rivalScarceStackPenalty(game, player, stackCount) {
  const rem = totalRemainingAmongRivals(game, player);
  const n = Math.max(1, Number(stackCount) || 1);
  const scarcity = Math.max(0, 5 - rem);
  if (scarcity <= 0) return 0;
  return Math.round(scarcity * 8 * selfGainFactor(game) * n);
}

/**
 * 先到先得 / 抵抗南蛮：尚未达到触发门槛时，可无视「对手骰少→堆骰扣分」。
 * 加码能升名次（如被中立抵消后夺回第一）同样不是浪费堆骰。
 */
function canIgnoreRivalScarceStackPenalty(game, player, face, count, env, boostAdd) {
  if (!player) return false;
  const wk = slotWorkers(game.board && game.board.resource, face) || {};
  const myPrev = Number(wk[player.id]) || 0;
  const after = myPrev + Math.max(0, Number(count) || 0);
  if (env && env.envType === 'firstCome' && !env.stashClaimed) {
    const required =
      env.firstComeRequired != null
        ? Number(env.firstComeRequired)
        : firstComeRequiredWorkers(game.round);
    return myPrev < required && after > myPrev;
  }
  if (env && env.envType === 'resistBarbarians') {
    const need = _resistBarbariansNeedDice(game.round);
    return myPrev < need && after > myPrev;
  }
  // 名次变好（无名次→有、第二→第一等）：必要加码，不扣稀缺堆骰
  const beforeEst = estimateProduceGain(game, player, 'resource', face, 0, 0);
  const afterEst = estimateProduceGain(
    game,
    player,
    'resource',
    face,
    count,
    boostAdd || 0
  );
  if (afterEst.myRank < beforeEst.myRank) return true;
  return false;
}

function playerScore(p, game) {
  let s = Number(p.houseScore) || 0;
  for (const b of p.buildings || []) {
    if (b.built && b.score) s += b.score;
  }
  s += Number(p.bonusScore) || 0;
  if (game && game.boostedTycoonPlayerId === p.id) s += 2;
  if (game && game.workshopMasterPlayerId === p.id) s += 2;
  if (game && game.whatYouWantPlayerId === p.id) s += 2;
  return s;
}
function maxResourceHandFor(player) {
  return 9 + (Number(player.expandResSlots) || 0) * 3;
}
function maxFuncHandFor(player) {
  return 3 + (Number(player.expandFuncSlots) || 0);
}
function maxBuildingsFor(player) {
  return 3 + (Number(player.expandSlots) || 0);
}

/** 生产阶段识别到资源手牌将超上限（爆牌风险）时打标，建造阶段资源够则扩容一次 */
function noteResourceOverflowRisk(player, botState, projectedGain) {
  if (!botState || !player) return;
  const hand = sumRes(player.resources || {});
  const cap = maxResourceHandFor(player);
  const gain = Math.max(0, Number(projectedGain) || 0);
  if (hand > cap || hand + gain > cap) {
    botState.wasOverCap = true;
    botState.needExpandRes = true;
  }
}

function wantsExpandResource(botState) {
  return Boolean(botState && (botState.needExpandRes || botState.wasOverCap));
}

function markExpandedResource(botState, player) {
  if (botState) {
    // 清掉本次标记；下轮再生产若再爆牌可再扩
    botState.needExpandRes = false;
    botState.wasOverCap = false;
    botState.didExpand = true;
    botState.expandedResOnce = true;
  }
  clearExpandResourceIntent(player);
}

function clearExpandResourceIntent(player) {
  if (player) player.__botWantExpandRes = false;
}
function countBuiltExchanges(player) {
  return (player.buildings || []).filter((b) => b.built && b.buildType === 'exchange').length;
}
function exchangeCostN(count) {
  const n = Math.min(Number(count) || 0, 2);
  if (n === 0) return 3;
  if (n === 1) return 2;
  return 1;
}
function effectiveExchangeCost(player, game) {
  // 与 engine.caravanExchangeActive 对齐：本建造回合且商队未过期
  if (
    game &&
    player &&
    game.phase === 'build' &&
    game.currentPlayerId === player.id &&
    Boolean(player.caravanPending) &&
    !(game.buildPassed && game.buildPassed[player.id])
  ) {
    return 1;
  }
  return exchangeCostN(countBuiltExchanges(player));
}
function tilesOnNumber(areaBoard, number) {
  return (areaBoard && areaBoard.tiles || []).filter((t) => t.number === number);
}
function slotWorkers(areaBoard, number) {
  return (areaBoard && areaBoard.workers && areaBoard.workers[number]) || {};
}
function slotBoosts(areaBoard, number) {
  return (areaBoard && areaBoard.boosts && areaBoard.boosts[number]) || {};
}

/* ?????????? ????????engine ???????????????????? */

function envOnResourceSlot(game, number) {
  const envs =
    (game.board && game.board.resource && game.board.resource.environments) || {};
  return envs[number] || null;
}

function neutralCountOn(game, area, number) {
  const board = game.board && game.board[area];
  const wk = board && board.workers && board.workers[number];
  return (wk && wk.__neutral__) || 0;
}

/** ?? engine ??firstCome ???????????? */
function firstComeStashCount(round) {
  const r = Number(round) || 1;
  if (r >= 7) return 7;
  if (r >= 4) return 5;
  return 3;
}
function firstComeRequiredWorkers(round) {
  const r = Number(round) || 1;
  if (r >= 7) return 4;
  if (r >= 4) return 3;
  return 2;
}

/** ???????????????????? */
function playerCount(game) {
  return Math.max(2, (game.players || []).filter(p => !p.left).length);
}

/**
 * 对手损失权重：人数越多越低（对冲只让第三人得利）。
 * 2 人 100%，3 人 40%，4 人 28%，5 人 20%。
 */
function rivalsLossFactor(game) {
  const n = playerCount(game);
  if (n <= 2) return 1.0;
  if (n === 3) return 0.4;
  if (n === 4) return 0.28;
  return 0.2;
}

/**
 * 自身收益权重：人数越多越高（独占无主格的相对价值更大）。
 * 2 人 100%，3 人 125%，4 人 145%，5 人 165%。
 */
function selfGainFactor(game) {
  const n = playerCount(game);
  if (n <= 2) return 1.0;
  if (n === 3) return 1.25;
  if (n === 4) return 1.45;
  return 1.65;
}

/**
 * ??????????????????????????????
 * @returns number  ????????
 */
function estimateEventDispatchGain(game, player, number, count, selfRank, boostAdd) {
  const env = envOnResourceSlot(game, number);
  // 囚徒困境等为 settle + dispatchAlso，不能只认 trigger===dispatch
  if (!env || !envTriggersDispatch(env) || !envHasDispatchEffect(env.envType)) return 0;

  switch (env.envType) {
    case 'clearSky':
      return count * 8 * selfGainFactor(game);

    case 'prisonersDilemma': {
      // 派遣时再放 1 中立；第一名时仍有占坑/施压价值
      if (selfRank === 0) return 22;
      if (selfRank === 1) return 12;
      return 8;
    }

    case 'enterFray': {
      const n = neutralCountOn(game, 'resource', number);
      if (n <= 0) return 0;
      return _bestEnterFrayMoveValue(game, player, number, count);
    }

    case 'barrenHarvest': {
      // 需成为最大者；已是最大再加码不触发
      if (selfRank !== 0) return 0;
      if (!wouldBecomeStrictLeaderOnResource(game, player, number, count, boostAdd)) {
        return 0;
      }
      let score = 35;
      const wk = slotWorkers(game.board && game.board.resource, number);
      if (wk) {
        let hasRival = false;
        for (const [pid, c] of Object.entries(wk)) {
          if (pid !== '__neutral__' && pid !== player.id && c > 0) hasRival = true;
        }
        if (hasRival) {
          // ???????? = ??????????
          const tiles = tilesOnNumber(game.board && game.board.resource, number);
          let large = 0;
          for (const t of tiles) large += t.large || 0;
          score += large * 8 * rivalsLossFactor(game); // ???? large ??
        }
      }
      // ??????????????????????
      if (game.barrenMarkerOwnerId === player.id) {
        const barrenNum = Number(game.barrenMarkerNumber);
        if (!isNaN(barrenNum) && barrenNum !== number) {
          const barrenTiles = tilesOnNumber(game.board && game.board.resource, barrenNum);
          let myGain = 0;
          for (const t of barrenTiles) myGain += (t.large || 0) + (t.small || 0);
          if (myGain > 0) score += myGain * 8 * selfGainFactor(game) + 15;
        }
      }
      return score;
    }

    case 'fishermanProfit': {
      if (selfRank !== 0) return 0;
      if (!wouldBecomeStrictLeaderOnResource(game, player, number, count, boostAdd)) {
        return 0;
      }
      const workers = (game.board && game.board.resource && game.board.resource.workers && game.board.resource.workers[number]) || {};
      const distinctOwners = Object.keys(workers).filter(pid => pid !== '__neutral__' && (workers[pid] || 0) > 0).length;
      const n = Math.max(1, distinctOwners + (workers[player.id] ? 0 : 1));
      // 渔翁得利可自选资源，价值高于普通大份
      return n * 12 * selfGainFactor(game);
    }

    case 'recall': {
      // 召回：收回自己骰子，价值等同于该骰子后续可能创造的收益
      const wk = slotWorkers(game.board && game.board.resource, number);
      const myPrev = (wk && wk[player.id]) || 0;
      if (myPrev > 0) return 55; // 收回已有骰子，高价值
      return 20; // 新放触发召回也有价值
    }

    case 'teleport': {
      // 需重新成为最大者；已是最大再加码无法触发 → 收益 0
      if (selfRank !== 0) return 0;
      if (!wouldBecomeStrictLeaderOnResource(game, player, number, count, boostAdd)) {
        return 0;
      }
      let bestVal = _bestTeleportTargetValue(game, player, number);
      // ?????????????????????????? + ????????
      for (const area2 of BOARD_AREAS) {
        for (let num2 = 1; num2 <= 6; num2++) {
          if (area2 === 'resource' && num2 === number) continue;
          const board2 = game.board && game.board[area2];
          const wk2 = board2 && board2.workers && board2.workers[num2];
          if (!wk2) continue;
          const myCount2 = wk2[player.id] || 0;
          let rivalCount = 0;
          let totalRivals = 0;
          for (const [pid, c] of Object.entries(wk2)) {
            if (pid === '__neutral__' || pid === player.id) continue;
            totalRivals++;
            if (c > rivalCount) rivalCount = c;
          }
          if (area2 === 'resource' && myCount2 === 0 && totalRivals === 1 && rivalCount > 0) {
            const tiles2 = tilesOnNumber(board2, num2);
            let large = 0;
            for (const t of tiles2) large += t.large || 0;
            bestVal = Math.max(bestVal, large * 8 * rivalsLossFactor(game) + 35);
          }
        }
      }
      return bestVal;
    }

    case 'weiQiRescueZhao': {
      // ??????????????????????????
      let releaseGain = 0;
      for (const nr of [1,2,3,4,5,6]) {
        if (nr === number) continue;
        const board = game.board && game.board.resource;
        const wk = board && board.workers && board.workers[nr];
        if (!wk) continue;
        const neutral = wk.__neutral__ || 0;
        const myCount = wk[player.id] || 0;
        if (neutral <= 0 || myCount <= 0) continue;
        const tiles = tilesOnNumber(board, nr);
        if (!tiles.length) continue;
        let large = 0, small = 0;
        for (const t of tiles) { large += t.large || 0; small += t.small || 0; }
        // ??????????small ????????????????large
        releaseGain += small * 8 * selfGainFactor(game) + Math.min(neutral, myCount) * 8 * selfGainFactor(game);
        // ????????????????????
        const env2 = envOnResourceSlot(game, nr);
        if (env2 && env2.envType === 'prisonersDilemma') releaseGain += 50;
      }
      // ??????????????????????
      const curWk = slotWorkers(game.board && game.board.resource, number);
      const myCur = (curWk && curWk[player.id]) || 0;
      const curTiles = tilesOnNumber(game.board && game.board.resource, number);
      let curLoss = 0;
      for (const t of curTiles) curLoss += (t.large || 0) + (t.small || 0);
      const cost = myCur > 0 ? Math.min(myCur, curLoss) * 8 * selfGainFactor(game) : 0;
      return releaseGain - cost;
    }

    case 'firstCome': {
      if (env.stashClaimed) return 0;
      const required =
        env.firstComeRequired != null
          ? Number(env.firstComeRequired)
          : firstComeRequiredWorkers(game.round);
      const wk = slotWorkers(game.board && game.board.resource, number) || {};
      const myPrev = Number(wk[player.id]) || 0;
      const after = myPrev + count;
      // 未达门槛：满额分不给，由追梦分单独处理
      if (after < required) return 0;
      const stashCards = Array.isArray(env.stashCards)
        ? env.stashCards.length
        : firstComeStashCount(game.round);
      let cardVal = stashCards * 8.5;
      if (selfRank === 0) cardVal += 15;
      return cardVal;
    }

    default:
      return 0;
  }
}

/**
 * ????????????????
 */
function envHasDispatchEffect(envType) {
  return [
    'clearSky',
    'prisonersDilemma',
    'enterFray',
    'barrenHarvest',
    'fishermanProfit',
    'recall',
    'teleport',
    'weiQiRescueZhao',
    'firstCome',
  ].includes(envType);
}

/** 与 engine hasDispatchEffect 一致：dispatch 触发或 dispatchAlso */
function envTriggersDispatch(env) {
  if (!env) return false;
  if (env.trigger === 'dispatch') return true;
  return Boolean(env.dispatchAlso);
}

/**
 * 以身入局：把 moveCount 枚中立砸到某格。
 * 只计「真改变结算」：对手被对冲掉/降级丢收益，或自己因此升到第一。
 * 挪完仍不改变任何人收益 → 0（无效对冲无安慰分）。
 */
function _scoreEnterFrayNeutralDrop(game, player, toArea, toNumber, moveCount, fromNumber) {
  if (toArea === 'resource' && toNumber === fromNumber) return -Infinity;
  const board = game.board && game.board[toArea];
  if (!board) return -Infinity;
  const tiles = tilesOnNumber(board, toNumber);
  if (toArea === 'special') {
    const openMax = Math.min(
      6,
      2 + Math.floor((Math.max(1, Number(game.round) || 1) - 1) / 2)
    );
    if (toNumber > openMax) return -Infinity;
  } else if (!tiles.length) {
    return -Infinity;
  }

  const n = Math.max(1, Number(moveCount) || 1);
  const beforeWk = {
    ...(board.workers && board.workers[toNumber] ? board.workers[toNumber] : {}),
  };
  const boosts = { ...((board.boosts && board.boosts[toNumber]) || {}) };
  const beforeRemain = _cancelEqualCountsLocal(_slotStrengthLocal(beforeWk, boosts));
  const beforeRanked = Object.entries(beforeRemain).sort((a, b) => b[1] - a[1]);
  const beforeFirst = beforeRanked[0] ? beforeRanked[0][0] : null;
  const beforeAiFirst = beforeFirst === player.id;

  const afterWk = { ...beforeWk };
  afterWk.__neutral__ = (Number(afterWk.__neutral__) || 0) + n;
  const afterRemain = _cancelEqualCountsLocal(_slotStrengthLocal(afterWk, boosts));
  const afterRanked = Object.entries(afterRemain).sort((a, b) => b[1] - a[1]);
  const afterFirst = afterRanked[0] ? afterRanked[0][0] : null;
  const afterAiFirst = afterFirst === player.id;
  const aiCancelled = beforeAiFirst && !afterRemain[player.id];

  // 绝不能拆掉自己的第一
  if (aiCancelled || (beforeAiFirst && !afterAiFirst)) {
    let large = 0;
    for (const t of tiles) large += t.large || 0;
    return -90 - large * 8 * selfGainFactor(game);
  }

  let large = 0;
  let small = 0;
  for (const t of tiles) {
    large += t.large || 0;
    small += t.small || 0;
  }
  const env =
    toArea === 'resource' ? envOnResourceSlot(game, toNumber) : null;
  const rFactor = rivalsLossFactor(game);
  const sFactor = selfGainFactor(game);
  let score = 0;

  const rivalId =
    beforeFirst && beforeFirst !== player.id && beforeFirst !== '__neutral__'
      ? beforeFirst
      : null;
  const rivalCancelled = Boolean(rivalId && !afterRemain[rivalId]);
  const rivalDemoted =
    Boolean(rivalId) && beforeFirst === rivalId && afterFirst !== rivalId;

  if (toArea === 'special') {
    if (rivalCancelled) {
      const hasEnhance = tiles.some((t) => t.funcType === 'enhance');
      score += (70 + (hasEnhance ? 45 : 18)) * rFactor;
    } else if (rivalDemoted) {
      score += 32 * rFactor;
    }
    // 未改变牌权：0
  } else if (rivalCancelled) {
    // 对手失去第一名大份（按人数折扣；多人下纯损手权重很低）
    score += large * 8 * rFactor;
    // 轻量搅局溢价，同样随人数衰减
    score += 6 * rFactor;
    if (env && env.envType === 'mercenaries') score += 50 * rFactor;
  } else if (rivalDemoted) {
    // 第一→第二：损失大份与小份之差
    score += Math.max(0, large - small) * 8 * rFactor + 4 * rFactor;
  }
  // 否则：挪中立不改任何人收益 → 该格资源对冲分保持 0（无安慰分）

  // 砸完后自己变第一：按自身收益系数拿大份
  if (!beforeAiFirst && afterAiFirst && toArea === 'resource') {
    score += large * 8 * sFactor * 0.85;
  }

  // 空格堆中立几乎无收益
  if (!rivalId && Object.keys(beforeWk).filter((k) => k !== '__neutral__').length === 0) {
    score -= 10;
  }

  return score;
}

/**
 * 以身入局：派遣并移走 moveN 枚中立后，本格自己的结算资源份（可能升到第一/第二）。
 */
function _enterFrayPostMoveSlotSelf(game, player, fromNumber, placeCount, boostAdd, moveN) {
  const board = game.board && game.board.resource;
  if (!board) return { self: 0, myRank: 2 };
  const tiles = tilesOnNumber(board, fromNumber);
  if (!tiles.length) return { self: 0, myRank: 2 };

  const beforeWk = {
    ...(board.workers && board.workers[fromNumber] ? board.workers[fromNumber] : {}),
  };
  const boosts = {
    ...((board.boosts && board.boosts[fromNumber]) || {}),
  };
  const myPrev = Number(beforeWk[player.id]) || 0;
  const afterWk = { ...beforeWk, [player.id]: myPrev + Math.max(0, Number(placeCount) || 0) };
  const neuLeft = Math.max(
    0,
    (Number(beforeWk.__neutral__) || 0) - Math.max(0, Number(moveN) || 0)
  );
  if (neuLeft > 0) afterWk.__neutral__ = neuLeft;
  else delete afterWk.__neutral__;

  const boostPrev = Number(boosts[player.id]) || 0;
  const afterBoosts = {
    ...boosts,
    [player.id]: boostPrev + (Number(boostAdd) || 0),
  };
  const remain = _cancelEqualCountsLocal(_slotStrengthLocal(afterWk, afterBoosts));
  const ranked = Object.entries(remain).sort((a, b) => b[1] - a[1]);
  let myRank = 2;
  for (let i = 0; i < ranked.length; i++) {
    if (ranked[i][0] === player.id) {
      myRank = i;
      break;
    }
  }
  if (!remain[player.id]) myRank = 2;

  let selfGain = 0;
  for (const t of tiles) {
    if (myRank === 0) selfGain += t.large || 0;
    else if (myRank === 1) selfGain += t.small || 0;
  }
  return { self: selfGain, myRank };
}

/**
 * 以身入局派遣估值 = 最佳中立落点（仅真对冲/自升第一）。
 * 无有效目标时为 0（不再保底），避免无脑占以身入局。
 * 本格名次资源由 scoreProduceMove 按「挪走中立后」计入，避免重复。
 */
function _bestEnterFrayMoveValue(game, player, fromNumber, count) {
  const neutrals = neutralCountOn(game, 'resource', fromNumber);
  if (neutrals <= 0) return 0;
  const moveN = Math.min(neutrals, Math.max(1, Number(count) || 1));

  let bestDrop = -Infinity;
  for (const area of BOARD_AREAS) {
    for (let num = 1; num <= 6; num++) {
      const sc = _scoreEnterFrayNeutralDrop(
        game,
        player,
        area,
        num,
        moveN,
        fromNumber
      );
      if (sc > bestDrop) bestDrop = sc;
    }
  }
  if (!Number.isFinite(bestDrop) || bestDrop <= 0) return 0;

  // 有效对冲才给轻量发动溢价（随人数衰减，避免多人纯损手虚高）
  const act =
    (6 + Math.min(moveN, 3) * 2) * Math.min(1, rivalsLossFactor(game) + 0.2);
  return Math.round(bestDrop + act);
}

/**
 * ???????????
 * ?????"???????????"??????????
 */
function _bestTeleportTargetValue(game, player, fromNumber) {
  const envs =
    (game.board && game.board.resource && game.board.resource.environments) || {};
  let bestVal = 12; // ????????????????????

  for (const num of [1, 2, 3, 4, 5, 6]) {
    if (num === fromNumber) continue;
    const env = envs[num];
    const wk = slotWorkers(game.board.resource, num);
    const tiles = tilesOnNumber(game.board.resource, num);
    if (!tiles.length && !env) continue;

    let val = 0;

    // ???????????? 2 ????????= ?? 2 ??
    if (env && env.envType === 'mercenaries') {
      const myCount = wk[player.id] || 0;
      const bestOther = Math.max(
        0,
        ...Object.entries(wk)
          .filter(([pid]) => pid !== player.id && pid !== '__neutral__')
          .map(([, c]) => c)
      );
      // ??? myCount + 1?????? 2??????vs bestOther
      if (bestOther > 0) {
        // ???????? ?????????????+ ??????
        if (myCount + 3 > bestOther) val = 100 * rivalsLossFactor(game);
        else if (myCount + 3 === bestOther) val = 40 * rivalsLossFactor(game); // ????????2
        else val = 20 * selfGainFactor(game);
      } else {
        // ??????????= ????????????
        val = 50 * selfGainFactor(game);
      }
    }
    // ?????dispatch ??????????
    else if (env && envTriggersDispatch(env) && envHasDispatchEffect(env.envType)) {
      val = estimateEventDispatchGain(game, player, num, 1, 0);
    }
    // ????????????
    else {
      const myCount = wk[player.id] || 0;
      const bestOther = Math.max(
        0,
        ...Object.entries(wk)
          .filter(([pid]) => pid !== player.id && pid !== '__neutral__')
          .map(([, c]) => c)
      );
      if (bestOther > 0 && myCount + 1 > bestOther) {
        // ???????? ?????= ???? + ????
        val = 25;
      } else if (bestOther === 0 && myCount === 0) {
        // ??????
        val = 15;
      }
    }

    if (val > bestVal) bestVal = val;
  }

  return bestVal;
}

/**
 * ??????????????????????????????
 * @param {number|null} count 本次放置枚数；抵抗南蛮等按放置后枚数判断是否已达门槛
 */
function estimateEventSettleGain(game, player, number, selfRank, count = null) {
  const env = envOnResourceSlot(game, number);
  if (!env || env.trigger !== 'settle') return 0;

  switch (env.envType) {
    case 'prisonersDilemma': {
      // 最后一名弃 n 张；第一名施压且自己不用弃；低保户类 setup 事件无此效果
      // 自己被对冲出局：无资源也无避弃价值
      if (selfRank > 1) return 0;
      const others = Math.max(0, alivePlayers(game).length - 1);
      if (selfRank === 0) {
        return 28 + others * 14;
      }
      // 第二名（常为中立第一、自己第二）：拿小份且不是最后一名 → 无需弃牌
      return 24;
    }

    case 'oneMountain':
      if (selfRank === 0) return 8 * selfGainFactor(game);
      if (selfRank === 1) return -8 * selfGainFactor(game);
      return 0;

    case 'resistBarbarians': {
      if (selfRank > 1) return 0;
      const wk = slotWorkers(game.board && game.board.resource, number) || {};
      const myPrev = Number(wk[player.id]) || 0;
      const placed = count == null ? 0 : Math.max(0, Number(count) || 0);
      const after = count == null ? myPrev : myPrev + placed;
      const need = _resistBarbariansNeedDice(game.round);
      // 未达物理骰门槛：满额 VP 不给，由追梦分处理
      if (after < need) return 0;
      // 放置前已能领到南蛮分：再堆不增加 VP → 事件收益 0
      //（对冲危机下加码使自己从「被抵消」变「能领分」时仍给满额）
      if (
        myPrev >= need &&
        _wouldEarnResistBarbariansVp(game, player, number, myPrev)
      ) {
        return 0;
      }
      if (!_wouldEarnResistBarbariansVp(game, player, number, after)) {
        return 0;
      }
      const myScore = playerScore(player, game);
      const maxScore = Math.max(...alivePlayers(game).map((p) => playerScore(p, game)));
      if (myScore >= maxScore - 3) return 45;
      return 25;
    }

    case 'luckyDraw':
      if (selfRank === 0) return 30;
      return 0;

    case 'keepOverflow': {
      if (selfRank !== 0) return 0;
      // 暗置 2 张任意资源 ≈ 2*8；另有跳过本轮资源弃牌
      let score = 16 * selfGainFactor(game) + 10;
      const board = game.board && game.board.resource;
      const tiles = tilesOnNumber(board, number);
      // 仅估第一名大份（与本格产出一致），用于判断是否会超手牌上限
      let firstGain = 0;
      for (const t of tiles) firstGain += t.large || 0;
      const hand = sumRes(player.resources);
      const cap = maxResourceHandFor(player);
      if (hand + firstGain > cap) {
        const wouldDiscard = hand + firstGain - cap;
        score += wouldDiscard * 12;
      }
      return score;
    }

    case 'fishermanProfit': {
      // ??????????????
      if (selfRank === 2) {
        const board = game.board && game.board.resource;
        const tiles = tilesOnNumber(board, number);
        let large = 0, small = 0;
        for (const t of tiles) { large += t.large || 0; small += t.small || 0; }
        const sum = large + small; // ????????????
        return Math.min(sum, 6) * 8 * selfGainFactor(game) + 10; // ??? 6 ????+ ?????
      }
      // ??????????????????????
      if (selfRank === 1) {
        // ??????????????????????????????
        // ??????????????
        return -5;
      }
      return 0;
    }

    default:
      return 0;
  }
}

/**
 * 先到先得 / 抵抗南蛮：本次未达触发门槛时的「追梦」分。
 * 只算手里还能落到本点数的骰；别的点数放不上这格。
 * 库存已领走 / 南蛮格对手骰过多则不加。
 */
function estimateThresholdChaseBonus(game, player, number, count, selfRank) {
  const env = envOnResourceSlot(game, number);
  if (!env) return 0;
  const wk = slotWorkers(game.board && game.board.resource, number) || {};
  const myPrev = Number(wk[player.id]) || 0;
  const placed = Math.max(0, Number(count) || 0);
  const after = myPrev + placed;
  const hand = (game.dice && player && game.dice[player.id]) || [];
  let sameFace = 0;
  for (const d of hand) if (Number(d) === Number(number)) sameFace += 1;
  const remAfter = Math.max(0, sameFace - placed);
  const villagers = Number(player.villagers) || 0;
  // 同点剩余较多才值得追：≥3，或村民池大且同点仍有 ≥2
  const diceRich = remAfter >= 3 || (remAfter >= 2 && villagers >= 5);

  if (env.envType === 'firstCome') {
    if (env.stashClaimed) return 0;
    const required =
      env.firstComeRequired != null
        ? Number(env.firstComeRequired)
        : firstComeRequiredWorkers(game.round);
    if (after >= required) return 0;
    if (!diceRich && remAfter < Math.max(1, required - after)) return 0;
    const stashCards = Array.isArray(env.stashCards)
      ? env.stashCards.length
      : firstComeStashCount(game.round);
    const fullVal = stashCards * 8.5 + (selfRank === 0 ? 12 : 0);
    const deficit = required - after;
    let bonus = fullVal * (after / Math.max(1, required)) * 0.5;
    if (remAfter >= deficit + 2) bonus += 12;
    else if (remAfter >= deficit) bonus += 8;
    else if (diceRich) bonus += 5;
    else bonus *= 0.35;
    // 尚无任何进度时，给一笔占坑起步分
    if (after <= 0) bonus = Math.max(bonus, diceRich ? 8 : 0);
    else if (myPrev === 0 && placed > 0) bonus += 4;
    return Math.round(Math.max(0, bonus));
  }

  if (env.envType === 'resistBarbarians') {
    let rivalDice = 0;
    for (const [pid, c] of Object.entries(wk)) {
      if (pid === '__neutral__' || pid === player.id) continue;
      rivalDice += Number(c) || 0;
    }
    // 对手已堆 2+ 枚：再追往往要 4 枚，放弃
    if (rivalDice >= 2) return 0;
    const need = _resistBarbariansNeedDice(game.round);
    if (after >= need && selfRank <= 1) return 0;
    if (selfRank > 1 && rivalDice >= 1) {
      // 名次也差且已有对手：追梦价值低
      if (remAfter + after < need + rivalDice) return 0;
    }
    const deficit = Math.max(0, need - after);
    if (deficit <= 0) return 0;
    if (!diceRich && remAfter < deficit) return 0;
    const fullVp = 28;
    let bonus = fullVp * (after / need) * 0.55;
    if (remAfter >= deficit + 2) bonus += 10;
    else if (remAfter >= deficit) bonus += 7;
    else if (diceRich) bonus += 4;
    else bonus *= 0.3;
    if (after <= 0) bonus = Math.max(bonus, diceRich ? 7 : 0);
    else if (myPrev === 0 && placed > 0) bonus += 3;
    return Math.round(Math.max(0, bonus));
  }

  return 0;
}

function isBotPlayer(player) {
  return Boolean(player && player.isBot);
}
function buildingStackKey(b) {
  return [b.buildType, b.resource || '', b.rich ? 'rich' : 'poor'].join('|');
}
function countBuiltByStackKey(player, key) {
  return (player.buildings || []).filter((b) => b.built && buildingStackKey(b) === key).length;
}

/* ?????????? ?????? ?????????? */

function randInt(n) {
  return Math.floor(Math.random() * n);
}
function pickRandom(arr) {
  if (!arr || !arr.length) return null;
  return arr[randInt(arr.length)];
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ?????????? ???????????????????? */

/**
 * 囚徒困境派遣：额外放 1 枚中立（与 environmentEffects 一致，与本次枚数无关）。
 */
function prisonersDilemmaDispatchExtraNeutral(game, area, face) {
  if (area !== 'resource') return 0;
  const env = envOnResourceSlot(game, face);
  if (!env || env.envType !== 'prisonersDilemma') return 0;
  if (!envTriggersDispatch(env)) return 0;
  return 1;
}

/**
 * 估算 count 枚放到 area/face 后的结算收益（含与中立/对手的同数抵消）。
 * 囚徒困境会先按派遣效果把 +1 中立算进终态，再估名次。
 */
function estimateProduceGain(game, player, area, face, count, boostAdd) {
  const board = game.board && game.board[area];
  if (!board) return { self: 0, rivalsLoss: 0, tileCount: 0, rivalDropped: false, myRank: 2 };
  const tiles = tilesOnNumber(board, face);
  if (!tiles.length) return { self: 0, rivalsLoss: 0, tileCount: 0, rivalDropped: false, myRank: 2 };
  const wk = slotWorkers(board, face);
  const boosts = (board.boosts && board.boosts[face]) || {};

  const myPrev = Number(wk[player.id]) || 0;
  const myTotal = myPrev + count;
  const boostPrev = Number(boosts[player.id]) || 0;
  const boostAfter = boostPrev + (Number(boostAdd) || 0);

  // 放置前：用于判断是否挤掉对手第一
  const beforeWorkers = { ...wk };
  const beforeBoosts = { ...boosts };
  const beforeStrength = _slotStrengthLocal(beforeWorkers, beforeBoosts);
  const beforeRemain = _cancelEqualCountsLocal(beforeStrength);
  const beforeRanked = Object.entries(beforeRemain).sort((a, b) => b[1] - a[1]);
  const beforeFirstId = beforeRanked[0] ? beforeRanked[0][0] : null;

  const afterWorkers = { ...wk, [player.id]: myTotal };
  const pdExtra = prisonersDilemmaDispatchExtraNeutral(game, area, face);
  if (pdExtra > 0) {
    afterWorkers.__neutral__ = (Number(afterWorkers.__neutral__) || 0) + pdExtra;
  }
  const afterBoosts = { ...boosts, [player.id]: boostAfter };
  const afterStrength = _slotStrengthLocal(afterWorkers, afterBoosts);
  const afterRemain = _cancelEqualCountsLocal(afterStrength);
  const afterRanked = Object.entries(afterRemain).sort((a, b) => b[1] - a[1]);

  let myRank = 2; // 0=第一, 1=第二, 2+=无
  for (let i = 0; i < afterRanked.length; i++) {
    if (afterRanked[i][0] === player.id) {
      myRank = i;
      break;
    }
  }
  // 抵消后不在场上
  if (!afterRemain[player.id]) myRank = 2;

  const rivalDropped =
    Boolean(beforeFirstId) &&
    beforeFirstId !== player.id &&
    beforeFirstId !== '__neutral__' &&
    myRank === 0 &&
    !afterRemain[beforeFirstId];

  // 与对手同数抵消双双出局，对手原本是第一 → 拦截成功，算对手损失
  const rivalEliminatedByCancel =
    Boolean(beforeFirstId) &&
    beforeFirstId !== player.id &&
    beforeFirstId !== '__neutral__' &&
    myRank >= 2 &&
    !afterRemain[beforeFirstId];

  let selfGain = 0;
  let rivalsLoss = 0;
  for (const t of tiles) {
    const large = t.large || 0;
    const small = t.small || 0;
    if (myRank === 0) selfGain += large;
    else if (myRank === 1) selfGain += small;
    if (rivalDropped && area === 'resource') {
      rivalsLoss += large - small;
    }
    if (rivalEliminatedByCancel && area === 'resource') {
      rivalsLoss += large;
    }
  }

  if (area === 'special') {
    selfGain = 0;
    rivalsLoss = 0;
  }

  return { self: selfGain, rivalsLoss, tileCount: tiles.length, rivalDropped, myRank };
}

/**
 * ?? face ????????????????
 */
function hasNeutralOnFace(game, area, face) {
  const board = game.board && game.board[area];
  if (!board) return false;
  const wk = slotWorkers(board, face);
  return Object.keys(wk).some((id) => id === '__neutral__' && (wk[id] || 0) > 0);
}

/**
 * 放置后是否会因与中立（或同数）抵消而拿不到名次。
 * 必须计入场上已有己方骰：已有 1 + 再放 1 vs 中立 1 → 不会对冲。
 * 囚徒困境派遣会再 +1 中立，须算进终态（1 己 vs 1 中立 → 放后变 1 vs 2，不对冲）。
 */
function wouldCancelWithNeutral(game, area, face, count, playerId) {
  const board = game.board && game.board[area];
  if (!board || !playerId) return false;
  const wk = slotWorkers(board, face);
  let neutral = Number(wk.__neutral__) || 0;
  neutral += prisonersDilemmaDispatchExtraNeutral(game, area, face);
  if (neutral <= 0) return false;
  const myTotal = (Number(wk[playerId]) || 0) + count;
  if (myTotal <= 0) return false;
  // 用强度抵消判断（与结算一致；强化骰不会被裸中立同数误杀）
  const boosts = (board.boosts && board.boosts[face]) || {};
  const afterWk = { ...wk, [playerId]: myTotal, __neutral__: neutral };
  const remain = _cancelEqualCountsLocal(_slotStrengthLocal(afterWk, boosts));
  return !remain[playerId];
}

/**
 * 放骰视角：估功能/建筑区第一名可拿的牌价值（与「1 资源 ≈ 8 分」同量级）。
 * 立即资源应显著高于「未建造的许愿井」这类延迟收益。
 */
function estimateSpecialTilePlaceValue(game, player, tile, diff) {
  if (!tile) return 10;
  if (tile.faceDown) return 12;

  if (tile.funcType || tile.kind === 'function') {
    if (diff === 'hard') {
      const vals = {
        enhance: 40, // 空强化应压过空的 3 资源大份（含最后一骰独占），仍低于真正触发的先到先得
        shelter: 22,
        recruit: 22,
        redraw: 18,
        harvest: 16,
        expand: 12,
        caravan: 12,
        robbery: 14,
        illegalBuild: 12,
        exile: 10,
        remoteDice: 10,
        banditRaid: 8,
        welfareHouse: 8,
      };
      return vals[tile.funcType] || 10;
    }
    const vals = {
      enhance: 18,
      recruit: 16,
      harvest: 14,
      redraw: 14,
      expand: 10,
      shelter: 12,
      caravan: 10,
      robbery: 12,
      illegalBuild: 10,
      exile: 8,
      remoteDice: 8,
      banditRaid: 6,
      welfareHouse: 6,
    };
    return vals[tile.funcType] || 8;
  }

  if (tile.buildType === 'score1') return 32;
  if (tile.buildType === 'score2') {
    return canPay(player.resources, tile.cost || {}) ? 22 : 12;
  }
  if (tile.buildType === 'exchange') {
    const ex = countBuiltExchanges(player);
    if (ex >= 3) return 8;
    return 26 + ex * 6;
  }
  if (tile.buildType === 'wishWell') {
    // 造价 4 资源，建成后每轮才 +1 自选；远弱于当场 2 固定 + 2 随机
    const canAfford = canPay(player.resources, tile.cost || {});
    let v = canAfford ? 14 : 9;
    const built = (player.buildings || []).filter((b) => b.built);
    const workshops =
      built.filter((b) => b.buildType === 'produce' || b.buildType === 'wishWell').length;
    if (workshops + 1 >= 3) v += 6;
    return v;
  }
  if (tile.buildType === 'produce' && tile.resource) {
    const needs = estimateResourceNeeds(player);
    let v = 18;
    if (needs && needs[tile.resource]) v += 6;
    if (tile.rich) v += 4;
    return v;
  }
  return 12;
}

function estimateSpecialClaimValue(game, player, face, myRank, diff) {
  if (myRank !== 0) return -40; // 功能区只有第一名拿牌
  const board = game.board && game.board.special;
  const tiles = tilesOnNumber(board, face);
  if (!tiles.length) return 0;
  let sum = 0;
  for (const t of tiles) sum += estimateSpecialTilePlaceValue(game, player, t, diff);
  // 略奖空位，幅度远小于牌面本身，避免无脑偏功能区
  const bldCap = maxBuildingsFor(player);
  const heldBld = (player.buildings || []).length;
  if (heldBld < bldCap && tiles.some((t) => t.buildType || t.kind === 'building')) {
    sum += diff === 'hard' ? 4 : 2;
  }
  if (
    (player.funcCards || []).length < maxFuncHandFor(player) &&
    tiles.some((t) => t.funcType || t.kind === 'function')
  ) {
    sum += diff === 'hard' ? 3 : 2;
  }
  return sum;
}

/** 该格是否已有其他玩家骰（有归属 / 可争抢）；仅中立或空则视为无归属 */
function _slotHasRivalWorkers(game, area, face, playerId) {
  const board = game.board && game.board[area];
  const wk = board && board.workers && board.workers[face];
  if (!wk) return false;
  for (const [pid, c] of Object.entries(wk)) {
    if (pid === '__neutral__' || pid === playerId) continue;
    if ((Number(c) || 0) > 0) return true;
  }
  return false;
}

/** 功能区当前已解锁的最大号码格 */
function _specialOpenMax(game) {
  return Math.min(6, 2 + Math.floor((Math.max(1, Number(game.round) || 1) - 1) / 2));
}

/**
 * 格上是否无玩家骰（中立不算有主）。
 */
function isSlotUnownedByPlayers(wk) {
  for (const [pid, c] of Object.entries(wk || {})) {
    if (pid === '__neutral__') continue;
    if ((Number(c) || 0) > 0) return false;
  }
  return true;
}

/**
 * 在该板块「只多放 1 枚」是否有效放置。
 * 无主板块一定有效（放 1 即独占第一）；有主时需放 1 后抵消仍为第一。
 */
function isEffectiveSinglePlaceSlot(game, player, area, face) {
  const board = game.board && game.board[area];
  if (!board || !player) return false;
  const f = Number(face);
  if (!(f >= 1 && f <= 6)) return false;
  if (!tilesOnNumber(board, f).length) return false;

  const wk = slotWorkers(board, f) || {};
  if (isSlotUnownedByPlayers(wk)) return true;

  const boosts = (board.boosts && board.boosts[f]) || {};
  const afterWk = {
    ...wk,
    [player.id]: (Number(wk[player.id]) || 0) + 1,
  };
  // 囚徒困境派遣会 +1 中立，单独多放 1 可能自毁 → 不算有效
  const pdExtra = prisonersDilemmaDispatchExtraNeutral(game, area, f);
  if (pdExtra > 0) {
    afterWk.__neutral__ = (Number(afterWk.__neutral__) || 0) + pdExtra;
  }
  const remain = _cancelEqualCountsLocal(
    _slotStrengthLocal(afterWk, boosts)
  );
  if (!(Number(remain[player.id]) > 0)) return false;
  const ranked = Object.entries(remain).sort((a, b) => b[1] - a[1]);
  return ranked.length > 0 && ranked[0][0] === player.id;
}

/**
 * 全场：每格只多放 1 枚时，有效放置板块数（无主必计）。
 */
function countEffectiveSinglePlaceSlots(game, player) {
  let n = 0;
  const openMax = _specialOpenMax(game);
  for (const area of BOARD_AREAS) {
    const board = game.board && game.board[area];
    if (!board) continue;
    const maxFace = area === 'special' ? openMax : 6;
    for (let face = 1; face <= maxFace; face++) {
      if (isEffectiveSinglePlaceSlot(game, player, area, face)) n += 1;
    }
  }
  return n;
}

/**
 * 当前骰点能落到的有效单骰放置数（跳过机会成本用）。
 */
function countEffectiveSinglePlaceSlotsMatchingDice(game, player) {
  const dice = (game.dice && game.dice[player.id]) || [];
  if (!dice.length || !player) return 0;
  const faces = new Set(
    dice.map((d) => Number(d)).filter((f) => f >= 1 && f <= 6)
  );
  let n = 0;
  const openMax = _specialOpenMax(game);
  for (const face of faces) {
    for (const area of BOARD_AREAS) {
      if (area === 'special' && face > openMax) continue;
      if (isEffectiveSinglePlaceSlot(game, player, area, face)) n += 1;
    }
  }
  return n;
}

/** @deprecated 兼容旧测试名：无主 ⊆ 有效单骰放置 */
function countUnownedBoardSlots(game, player) {
  if (player) return countEffectiveSinglePlaceSlots(game, player);
  // 无 player 时退回纯无主统计
  let n = 0;
  const openMax = _specialOpenMax(game);
  for (const area of BOARD_AREAS) {
    const board = game.board && game.board[area];
    if (!board) continue;
    const maxFace = area === 'special' ? openMax : 6;
    for (let face = 1; face <= maxFace; face++) {
      if (!tilesOnNumber(board, face).length) continue;
      if (isSlotUnownedByPlayers(slotWorkers(board, face))) n += 1;
    }
  }
  return n;
}

/**
 * 有效单骰放置机会成本：数量越多，多骰硬塞/跳过浪费越高。
 * @param {number} weight 权重（多骰用 count-1；跳过用 1）
 * @param {number} [slotCount] 若不传则用全场有效单骰放置数
 */
function effectivePlaceOpportunityPenalty(game, player, weight, slotCount) {
  const w = Math.max(0, Number(weight) || 0);
  if (w <= 0 || !player) return 0;
  const n =
    slotCount != null
      ? Math.max(0, Number(slotCount) || 0)
      : countEffectiveSinglePlaceSlots(game, player);
  if (n <= 0) return 0;
  const per = Math.round(4 * selfGainFactor(game));
  return n * per * w;
}

/** @deprecated 旧名 */
function unownedBoardOpportunityPenalty(game, weight, unownedCount) {
  // 无 player 的旧调用不应再出现；保留避免崩
  const w = Math.max(0, Number(weight) || 0);
  if (w <= 0) return 0;
  const n = Math.max(0, Number(unownedCount) || 0);
  if (n <= 0) return 0;
  return n * Math.round(4 * selfGainFactor(game)) * w;
}

/** 先到先得 / 抵抗南蛮：正当需要堆多枚，不受「无主机会成本」多骰惩罚 */
function isMultiDiceThresholdEnv(env) {
  return Boolean(
    env && (env.envType === 'firstCome' || env.envType === 'resistBarbarians')
  );
}

/** 抵抗南蛮所需物理骰数（与 engine 一致） */
function _resistBarbariansNeedDice(round) {
  const r = Math.max(1, Number(round) || 1);
  if (r >= 7) return 4;
  if (r >= 4) return 3;
  return 2;
}

/**
 * 以 myCount 枚（及对应强化）占该资源格时，结算后是否仍能领到抵抗南蛮 VP。
 * 需：物理骰 ≥ 门槛，且同强度抵消后仍留在场上。
 */
function _wouldEarnResistBarbariansVp(game, player, number, myCount, myBoost) {
  const need = _resistBarbariansNeedDice(game.round);
  const n = Math.max(0, Number(myCount) || 0);
  if (n < need || !player) return false;
  const board = game.board && game.board.resource;
  if (!board) return false;
  const face = Number(number);
  const beforeWk = (board.workers && board.workers[face]) || {};
  const beforeBoosts = (board.boosts && board.boosts[face]) || {};
  const wk = { ...beforeWk, [player.id]: n };
  const boosts = {
    ...beforeBoosts,
    [player.id]: Math.min(
      n,
      Math.max(0, myBoost != null ? Number(myBoost) : Number(beforeBoosts[player.id]) || 0)
    ),
  };
  const remain = _cancelEqualCountsLocal(_slotStrengthLocal(wk, boosts));
  return Boolean(remain[player.id]);
}

/**
 * 派遣枚数敏感的事件结果指纹：用于判断少放几枚是否仍拿到同等事件收益。
 * 晴天/先到先得/抵抗南蛮/以身入局等按枚数或门槛生效。
 */
function _dispatchCountOutcomeKey(game, player, area, face, count, selfRank) {
  if (area !== 'resource') return 'na';
  const env = envOnResourceSlot(game, face);
  if (!env) return 'none';
  const wk = slotWorkers(game.board && game.board.resource, face) || {};
  const myPrev = Number(wk[player.id]) || 0;
  const after = myPrev + count;

  if (env.envType === 'clearSky' && envTriggersDispatch(env)) {
    return `clearSky:${count}`;
  }
  if (env.envType === 'firstCome' && !env.stashClaimed) {
    const required =
      env.firstComeRequired != null
        ? Number(env.firstComeRequired)
        : firstComeRequiredWorkers(game.round);
    return `fc:${after >= required ? 1 : 0}:${Math.min(after, required)}`;
  }
  if (env.envType === 'resistBarbarians') {
    const need = _resistBarbariansNeedDice(game.round);
    const qualifies = after >= need && selfRank <= 1;
    return `rb:${qualifies ? 1 : 0}`;
  }
  if (env.envType === 'enterFray' && envTriggersDispatch(env)) {
    const n = neutralCountOn(game, 'resource', face);
    return `ef:${n > 0 ? count : 0}`;
  }
  return 'base';
}

/** 手中是否另有点数，能落到「玩家无主」的资源格（不含当前点数） */
function hasOtherUnownedResourceClaimFace(game, player, excludeFace) {
  if (!game || !player) return false;
  const dice = (game.dice && game.dice[player.id]) || [];
  const faces = new Set();
  for (const d of dice) {
    const f = Number(d);
    if (f >= 1 && f <= 6 && f !== Number(excludeFace)) faces.add(f);
  }
  if (!faces.size) return false;
  const board = game.board && game.board.resource;
  if (!board) return false;
  for (const face of faces) {
    if (!tilesOnNumber(board, face).length) continue;
    if (isSlotUnownedByPlayers(slotWorkers(board, face))) return true;
  }
  return false;
}

/**
 * 放满 count 枚时的名次/收益/事件门槛，最少需要几枚就能达到同一结果。
 * 多出来的骰等价于「本可爆骰换资源」。
 */
function minDiceForSameOutcome(game, player, area, face, count, boostAdd) {
  const full = estimateProduceGain(game, player, area, face, count, boostAdd);
  const fullKey = _dispatchCountOutcomeKey(
    game,
    player,
    area,
    face,
    count,
    full.myRank
  );
  let best = count;
  for (let k = 1; k <= count; k++) {
    const b = Math.min(Number(boostAdd) || 0, k);
    const est = estimateProduceGain(game, player, area, face, k, b);
    if (est.myRank !== full.myRank || est.self !== full.self) continue;
    const key = _dispatchCountOutcomeKey(game, player, area, face, k, est.myRank);
    if (key !== fullKey) continue;
    best = k;
    break;
  }
  return best;
}

/**
 * 未来生产机会：闲置村民 × 场上「只放1枚就有效」的板块。
 * 跳过烂骰是为了把村民留给之后更好的点数去占这些格。
 */
function estimateFutureDiceOpportunity(game, player) {
  if (!player) return 0;
  const eff = countEffectiveSinglePlaceSlots(game, player);
  const idle = idleVillagers(player);
  if (eff <= 0 || idle <= 0) return 0;
  const factor = selfGainFactor(game);
  // 单次有效占坑粗估值（低于稳拿大份，避免动辄压过正当落子）
  const per = Math.round(6 * factor);
  return Math.min(eff, idle) * per;
}

/** 当前落子收益是否过低（不值得留下这手骰） */
function isCurrentPlaceBenefitTooLow(placeScore) {
  if (!Number.isFinite(placeScore)) return true;
  return placeScore < 8;
}

/** 未来有效占坑机会是否足够高，才值得为它跳过 */
function isFuturePlaceOpportunityHigh(game, player, futureScore) {
  const eff = countEffectiveSinglePlaceSlots(game, player);
  const idle = idleVillagers(player);
  return (
    (Number(futureScore) || 0) >= 18 &&
    eff >= 3 &&
    idle >= 2
  );
}

/**
 * 是否应用「机会型跳过」：当前收益过低 且 未来可能收益较高。
 * 缺一不可——当前还行就落子；未来也没坑就不必为跳过而跳过。
 */
function shouldOpportunityVoidSkip(game, player, placeScore, futureScore) {
  return (
    isCurrentPlaceBenefitTooLow(placeScore) &&
    isFuturePlaceOpportunityHigh(game, player, futureScore)
  );
}

/** 爆 1 骰换 1 任意资源的即时分（不含「未来占坑」；未来在 decidePlaceDice 里合成） */
function scoreVoidSkipBurn(game, player, diff) {
  const dice = (game.dice && game.dice[player.id]) || [];
  if (!dice.length || idleVillagers(player) <= 0) return -Infinity;

  const factor = selfGainFactor(game);
  let score = Math.round(6 * factor);

  const needs = estimateResourceNeeds(player);
  const target = pickMostNeededResource(player, needs);
  const have = player.resources || {};
  if (target) {
    const gap = (needs[target] || 0) - (have[target] || 0);
    if (gap > 0) score += Math.min(2, gap);
  }

  const hand = sumRes(have);
  const free = freeResourceSlots(player);
  if (free <= 0) score -= 10;
  else if (free <= 2) score -= 4;
  else if (hand === 0) score += diff === 'hard' ? 3 : 2;
  else if (hand <= 2 && (Number(game.round) || 1) <= 3) score += 1;

  // 爆骰少 1 闲置村民 → 略减未来（具体未来加成在外层按条件加）
  score -= Math.round(2 * factor);

  return score;
}

/**
 * 弃置 2 张跳过的即时分（保留全部村民；未来占坑加成在外层合成）
 */
function scoreVoidSkipPay(game, player, diff) {
  const dice = (game.dice && game.dice[player.id]) || [];
  if (!dice.length || idleVillagers(player) <= 0) return -Infinity;
  const hand = sumRes(player.resources || {});
  if (hand < 2) return -Infinity;

  const factor = selfGainFactor(game);
  const free = freeResourceSlots(player);
  let score = Math.round(-10 * factor);

  if (free <= 1) score += 14;
  else if (free <= 3) score += 10;
  else if (hand >= 8) score += 9;
  else if (hand >= 6) score += 6;
  else if (hand >= 4) score += 3;
  else score -= 6;

  const byFace = {};
  for (const d of dice) byFace[d] = (byFace[d] || 0) + 1;
  const maxSame = Math.max(0, ...Object.values(byFace));
  if (maxSame >= 2) score += diff === 'hard' ? 5 : 3;
  if (dice.length >= 3) score += 2;

  return score;
}

/** @returns {{score:number, mode:'burn'|'pay'}} 仅即时分 */
function bestVoidSkipOption(game, player, diff) {
  const burn = scoreVoidSkipBurn(game, player, diff);
  const pay = scoreVoidSkipPay(game, player, diff);
  if (pay > burn && pay > -Infinity) return { score: pay, mode: 'pay' };
  return { score: burn, mode: 'burn' };
}

/**
 * 综合「即时跳过」+（若传入当前落子分且满足「当前低且未来高」）未来占坑。
 * 不传 placeScore 时只返回即时分，供单测对照。
 */
function scoreVoidSkipOption(game, player, diff, placeScore) {
  const best = bestVoidSkipOption(game, player, diff);
  if (!Number.isFinite(best.score)) return best.score;
  if (placeScore == null || !Number.isFinite(Number(placeScore))) {
    return best.score;
  }
  const placeSc = Number(placeScore);
  const future = estimateFutureDiceOpportunity(game, player);
  if (!shouldOpportunityVoidSkip(game, player, placeSc, future)) {
    return best.score;
  }
  const futW = best.mode === 'pay' ? 0.4 : 0.28;
  return best.score + Math.round(future * futW);
}

/** 弃置 2 张：优先丢缺口小、存量多的 */
function pickVoidSkipPayAmounts(player) {
  const have = player.resources || {};
  const needs = estimateResourceNeeds(player);
  const amounts = { wood: 0, stone: 0, food: 0, iron: 0 };
  let left = 2;
  const order = RESOURCES.slice().sort((a, b) => {
    const gapA = (needs[a] || 0) - (have[a] || 0);
    const gapB = (needs[b] || 0) - (have[b] || 0);
    if (gapA !== gapB) return gapA - gapB;
    return (have[b] || 0) - (have[a] || 0);
  });
  for (const r of order) {
    while (left > 0 && (have[r] || 0) - amounts[r] > 0) {
      amounts[r] += 1;
      left -= 1;
    }
    if (left <= 0) break;
  }
  return amounts;
}

/**
 * 独占雇佣军（唯一第一）：投 2 枚雇佣骰，落点立刻拿对应格大份。
 * 价值应明显高于「本格静态大份」，否则会被旁格厚资源牌压过。
 */
function estimateMercenariesClaimValue(game, player, env, diff) {
  const diceN = Math.max(1, Number(env && env.mercenaryDice) || 2);
  const board = game.board && game.board.resource;
  const larges = [];
  for (let n = 1; n <= 6; n++) {
    const tiles = tilesOnNumber(board, n);
    if (!tiles.length) continue;
    let large = 0;
    for (const t of tiles) large += t.large || 0;
    if (large > 0) larges.push(large);
  }
  larges.sort((a, b) => b - a);
  const avg =
    larges.length > 0
      ? larges.reduce((s, x) => s + x, 0) / larges.length
      : 2;

  let expected = 0;
  for (let i = 0; i < diceN; i++) {
    const top = larges[i] != null ? larges[i] : avg;
    // 看见点数后再选落点，偏向第 i 好堆，仍保留掷骰不确定
    expected += top * 0.7 + avg * 0.3;
  }

  let score = expected * 8 * selfGainFactor(game);
  // 雇佣骰还会留在场上参与结算，并可触发派遣事件
  score += diceN * (diff === 'hard' ? 10 : 8);
  score += 6;
  if (sumRes(player.resources || {}) <= 2) score += 6;
  return score;
}

/**
 * 功能区：对冲掉对手对本格的第一/独占，剥夺其拿牌（自己不一定拿得到）。
 */
function estimateSpecialDenyValue(game, player, face, count, boostAdd, diff) {
  const board = game.board && game.board.special;
  if (!board || !player) return 0;
  const tiles = tilesOnNumber(board, face);
  if (!tiles.length) return 0;
  const wk = slotWorkers(board, face);
  const boosts = (board.boosts && board.boosts[face]) || {};
  const beforeRemain = _cancelEqualCountsLocal(_slotStrengthLocal(wk, boosts));
  const beforeRanked = Object.entries(beforeRemain).sort((a, b) => b[1] - a[1]);
  const beforeFirst = beforeRanked[0] ? beforeRanked[0][0] : null;
  if (
    !beforeFirst ||
    beforeFirst === player.id ||
    beforeFirst === '__neutral__'
  ) {
    return 0;
  }
  const n = Math.max(0, Number(count) || 0);
  if (n <= 0) return 0;
  const afterWk = {
    ...wk,
    [player.id]: (Number(wk[player.id]) || 0) + n,
  };
  const afterBoosts = {
    ...boosts,
    [player.id]: (Number(boosts[player.id]) || 0) + (Number(boostAdd) || 0),
  };
  const afterRemain = _cancelEqualCountsLocal(
    _slotStrengthLocal(afterWk, afterBoosts)
  );
  if (afterRemain[beforeFirst]) return 0;
  const claimVal = estimateSpecialClaimValue(game, player, face, 0, diff);
  return Math.max(
    14,
    Math.round(Math.max(12, claimVal) * 0.8 * rivalsLossFactor(game))
  );
}

/**
 * 给某次放骰打分
 */
function scoreProduceMove(game, player, face, area, count, boostAdd, diff, botState) {
  const est = estimateProduceGain(game, player, area, face, count, boostAdd);
  const env = area === 'resource' ? envOnResourceSlot(game, face) : null;
  const hand = sumRes(player.resources);
  const cap = maxResourceHandFor(player);
  const room = Math.max(0, cap - hand);
  const keepOverflowFirst =
    env && env.envType === 'keepOverflow' && est.myRank === 0;
  // 资源收益：只按手牌空位能留下的数量计分（如 7/9 空位、预计拿 5 → 按 2 计），不额外扣分；
  // 幸运一抽等其它收益仍在下方全额叠加。吃不了兜着走 / 本轮跳过弃牌则不截断。
  let scoredSelf = est.self;
  // 本已是第一再加码：结算大份不是新收益（与传送落点评分一致）
  let alreadyFirstBefore = false;
  if (area === 'resource') {
    const beforeEst = estimateProduceGain(game, player, area, face, 0, 0);
    alreadyFirstBefore = beforeEst.myRank === 0;
    if (alreadyFirstBefore && est.myRank === 0 && beforeEst.self >= est.self) {
      scoredSelf = 0;
    }
  }
  if (
    area === 'resource' &&
    env &&
    env.envType === 'enterFray' &&
    neutralCountOn(game, 'resource', face) > 0
  ) {
    // 派遣后会挪走中立，本格名次按「挪走后」估（常能拿到第一/第二）
    const moveN = Math.min(
      neutralCountOn(game, 'resource', face),
      Math.max(1, Number(count) || 1)
    );
    const post = _enterFrayPostMoveSlotSelf(
      game,
      player,
      face,
      count,
      boostAdd,
      moveN
    );
    scoredSelf = post.self;
    est.myRank = post.myRank;
  }
  if (
    area === 'resource' &&
    !keepOverflowFirst &&
    !player.skipSettleResourceDiscard
  ) {
    const rawSelf = Number(scoredSelf) || 0;
    scoredSelf = Math.min(rawSelf, room);
    if (rawSelf > room) {
      noteResourceOverflowRisk(player, botState, rawSelf);
    }
  }
  let score = scoredSelf * 8 * selfGainFactor(game);

  // 往已占资源格加码：对手剩余骰越少扣分越多（先到/南蛮凑门槛除外）；
  // 对手骰仍多时给一点防抢加码，避免「已是第一」边际资源归零后只剩跳过。
  if (area === 'resource') {
    const wkNow = slotWorkers(game.board && game.board.resource, face) || {};
    const myPrevNow = Number(wkNow[player.id]) || 0;
    if (myPrevNow >= 1) {
      if (!canIgnoreRivalScarceStackPenalty(game, player, face, count, env, boostAdd)) {
        score -= rivalScarceStackPenalty(game, player, count);
      }
      const rem = totalRemainingAmongRivals(game, player);
      if (
        rem >= 3 &&
        alreadyFirstBefore &&
        myPrevNow <= 2 &&
        (diff === 'hard' || diff === 'normal')
      ) {
        score += Math.round(Math.min(rem, 6) * 2.5 * selfGainFactor(game));
      }
    }
  }

  if (wouldCancelWithNeutral(game, area, face, count, player.id)) {
    // 囚徒困境：终态仍对冲掉自己时重罚（常见于多放与中立打平）
    if (env && env.envType === 'prisonersDilemma') score -= 80;
    // 以身入局会移走中立：本格假对冲不罚也不额外加分（价值只看挪中立后的真收益）
    else if (env && env.envType === 'enterFray') {
      // no-op
    }
    // 有实际触发效果的事件：不额外惩罚，让事件收益在底部叠加竞争
    else if (env && (envHasDispatchEffect(env.envType) || env.trigger === 'settle')) {
      // 事件收益会在下方正常加分，对冲风险不扣
    }
    // 无任何效果的纯白板格：一票否决
    else score -= 200;
  }

  // 超额占用：同结果少放几枚即可时，按「可爆骰换资源」计价扣分
  const SKIP_BASELINE = Math.round(8 * selfGainFactor(game));
  const needed = minDiceForSameOutcome(game, player, area, face, count, boostAdd);
  const surplus = Math.max(0, count - needed);
  if (surplus > 0) {
    // 默认 1:1 机会成本（旧 *3 会把幸运一抽等误判成爆骰）
    let penaltyMult = area === 'special' ? 10 : 1;
    if (area === 'resource') {
      const settleEvt =
        env && env.trigger === 'settle'
          ? estimateEventSettleGain(game, player, face, est.myRank, count)
          : 0;
      const dispatchEvt = estimateEventDispatchGain(
        game,
        player,
        face,
        count,
        est.myRank,
        boostAdd
      );
      const unclaimed = !_slotHasRivalWorkers(game, area, face, player.id);
      // 以身入局：多骰=多挪中立，超额惩罚大幅减轻
      if (env && env.envType === 'enterFray') {
        penaltyMult = 0.35;
      } else if (env && env.envType === 'prisonersDilemma') {
        // 囚徒：同结果多塞几乎纯亏（尤其堆到第一仍可少放时）
        penaltyMult = unclaimed ? 3.25 : 2.5;
      } else if (unclaimed) {
        // 无归属空板：单骰即可独占，多枚几乎纯浪费（除非上面 needed 已计入先到/南蛮/晴天等）
        penaltyMult = 2.75;
      } else if (settleEvt <= 0 && dispatchEvt <= 0) {
        // 有人占着但仍超额：略加重
        penaltyMult = 1.5;
      }
    }
    // 雇佣军要求唯一第一；对手还有骰时薄领先很脆，超额扣分减轻
    if (
      env &&
      env.envType === 'mercenaries' &&
      maxRemainingAmongRivals(game, player) >= 1
    ) {
      penaltyMult = 0.25;
    }
    score -= surplus * SKIP_BASELINE * penaltyMult;
  }

  // 非先到先得/抵抗南蛮：单次多枚时，场上「只放1枚就有效」的板块越多惩罚越重
  if (count >= 2 && !isMultiDiceThresholdEnv(env)) {
    score -= effectivePlaceOpportunityPenalty(game, player, count - 1);
  }

  // 手中另有无主资源点可占时，别往囚徒堆人：场上坑多时更亏
  if (
    area === 'resource' &&
    env &&
    env.envType === 'prisonersDilemma' &&
    (diff === 'hard' || diff === 'normal') &&
    hasOtherUnownedResourceClaimFace(game, player, face)
  ) {
    const factor = selfGainFactor(game);
    const eff = countEffectiveSinglePlaceSlots(game, player);
    // 多枚抢囚徒第一：几乎总应让位于另点无主；单枚也略抑（空板独占更稳）
    if (count >= 2) {
      score -= Math.round((22 + Math.min(eff, 8) * 4) * count * factor);
    } else {
      // 单枚也抑：另有无主点时，空板独占通常稳过囚徒第二
      score -= Math.round((18 + Math.min(eff, 6) * 3) * factor);
    }
  }

  // 无其它点数可占时：场上仍有有效单骰坑，也不要用 ≥3 枚硬抢囚徒第一（少放+重掷更好）
  if (
    area === 'resource' &&
    env &&
    env.envType === 'prisonersDilemma' &&
    (diff === 'hard' || diff === 'normal') &&
    count >= 3 &&
    !hasOtherUnownedResourceClaimFace(game, player, face)
  ) {
    const eff = countEffectiveSinglePlaceSlots(game, player);
    if (eff >= 2) {
      score -= Math.round(36 * selfGainFactor(game) * (count - 1));
    }
  }

  if (area === 'special') {
    const claim = estimateSpecialClaimValue(
      game,
      player,
      face,
      est.myRank,
      diff
    );
    const deny =
      diff === 'hard' || diff === 'normal'
        ? estimateSpecialDenyValue(game, player, face, count, boostAdd, diff)
        : 0;
    if (deny > 0 && est.myRank !== 0) {
      // 对冲拆掉对手牌权：不吃「没拿到第一」的固定负分
      score += deny;
    } else {
      score += claim + deny;
    }
  }

  // 事件收益：normal/hard 都计入（否则吃不了兜着走等会被低估）
  if (area === 'resource' && (diff === 'hard' || diff === 'normal')) {
    const evtScale = diff === 'hard' ? 1 : 0.75;
    score += estimateEventDispatchGain(game, player, face, count, est.myRank, boostAdd) * evtScale;
    score += estimateEventSettleGain(game, player, face, est.myRank, count) * evtScale;
    // 先到先得 / 抵抗南蛮：未达门槛但剩余骰多 → 追梦占坑
    score += estimateThresholdChaseBonus(game, player, face, count, est.myRank) * evtScale;
    // 雇佣军是 preSettle，不走上面 settle/dispatch 估值
    if (env && env.envType === 'mercenaries' && est.myRank === 0) {
      score += estimateMercenariesClaimValue(game, player, env, diff) * evtScale;
    }
  }

  if (diff === 'hard') {
    // 纯损手按「资源×8×人数折扣」计，多人局对冲价值明显低于自爆换 1 资源
    score += Math.round(est.rivalsLoss * 8 * rivalsLossFactor(game));
    if (player.skipSettleResourceDiscard) score += 15;

    if (area === 'resource') {
      if (env && env.envType === 'fishermanProfit' && env.trigger === 'settle') {
        const board = game.board && game.board.resource;
        const wk = board && board.workers && board.workers[face];
        if (wk) {
          const myPower = (wk[player.id] || 0) + count + (boostAdd || 0);
          const ord = Object.entries(wk)
            .filter(([pid]) => pid !== '__neutral__' && pid !== player.id)
            .map(([, c]) => c)
            .sort((a, b) => b - a);
          const second = ord[0] || 0;
          const third = ord[1] || 0;
          if (myPower <= second && myPower >= third) {
            const tiles = tilesOnNumber(board, face);
            let large = 0;
            for (const t of tiles) large += t.large || 0;
            const keepable = Math.min(large, 6, room);
            const potential = keepable * 8 * selfGainFactor(game);
            if (potential > 0) score += potential + 15;
          }
        }
      }
    }

    if (area === 'resource' && est.myRank === 0) {
      const risk = rivalCanStillInterfereOnFace(game, player, face);
      const maxRival = maxRemainingAmongRivals(game, player);
      // 按「本次放置后」剩余空闲计，避免单骰占坑拿不到安全独占加成
      const myRemAfter = Math.max(0, remainingDiceCount(player) - count);
      const settleEvt =
        env && env.trigger === 'settle'
          ? estimateEventSettleGain(game, player, face, est.myRank, count)
          : 0;
      // 手牌已满且事件也吃不到：第一名占坑加成无意义
      const hollowFirst = scoredSelf <= 0 && settleEvt <= 0;
      if (myRemAfter <= 0 && maxRival >= 2) {
        score -= 15;
      } else if (myRemAfter <= 0 && maxRival === 1) {
        if (!hollowFirst) score += 5;
      } else if (myRemAfter <= 0 && maxRival === 0) {
        // 超额堆骰 / 已是第一再加码 / 空壳第一：安全独占不是本步新收益
        score +=
          surplus > 0 || alreadyFirstBefore || hollowFirst ? 0 : 25;
      } else if (!hollowFirst && risk < 0.3) {
        score += alreadyFirstBefore ? 3 : 12;
      } else if (!hollowFirst && risk < 0.5) {
        score += alreadyFirstBefore ? 1 : 5;
      }
    }

    if (area === 'resource' && count > 0) {
      const wk = slotWorkers(game.board && game.board.resource, face) || {};
      const myPrev = wk[player.id] || 0;
      if (myPrev >= 1 && myPrev <= 2) {
        const rivalsTotalRem = totalRemainingAmongRivals(game, player);
        // 对手还有较多骰时，薄领先加码仍有一点占坑价值；骰少时不再给加分
        if (rivalsTotalRem >= 4 && !alreadyFirstBefore) {
          const tileCount = tilesOnNumber(game.board && game.board.resource, face).length;
          if (tileCount >= 2) score += 8;
          if (tileCount >= 3) score += 10;
          if (
            env &&
            ['teleport', 'mercenaries', 'enterFray', 'firstCome'].includes(env.envType)
          ) {
            if (
              env.envType === 'teleport' &&
              !wouldBecomeStrictLeaderOnResource(
                game,
                player,
                face,
                count,
                boostAdd
              )
            ) {
              // skip
            } else {
              score += 10;
            }
          }
        }
      }
    }
  }

  return score;
}

/**
 * 生产放骰：选 face + area（及可选 count）发 placeDice
 * 返回 { type:'placeDice', payload:{ face, area, count? } } 或 null
 */
function decidePlaceDice(game, player, diff, botState) {
  const dice = game.dice && game.dice[player.id] ? game.dice[player.id] : [];
  if (!dice.length) return null;
  botState = botState || {};
  // 当前已超/顶格也算爆牌风险
  noteResourceOverflowRisk(player, botState, 0);

  // 按点数聚合
  const byFace = {};
  for (const d of dice) {
    byFace[d] = (byFace[d] || 0) + 1;
  }

  let best = null;
  let bestScore = -Infinity;

  for (const faceStr of Object.keys(byFace)) {
    const face = Number(faceStr);
    const maxCount = byFace[faceStr];
    // 该点数上强化骰数（按枚数从前往后截取）
    const boostFlags = (game.diceBoosted && game.diceBoosted[player.id]) || [];
    const boostIdx = [];
    for (let i = 0; i < dice.length; i++) {
      if (dice[i] === face && boostFlags[i]) boostIdx.push(i);
    }
    const totalBoost = boostIdx.length;

    for (const area of BOARD_AREAS) {
      const board = game.board && game.board[area];
      const tiles = board ? tilesOnNumber(board, face) : [];
      if (!tiles.length) continue;
      if (diff === 'easy') {
        if (wouldCancelWithNeutral(game, area, face, maxCount, player.id)) continue;
        // random accept first valid
        if (Math.random() < 0.5 || !best) {
          best = { type: 'placeDice', payload: { face, area } };
          bestScore = 0;
        }
        continue;
      }
      // normal/hard：评估 1..N 枚，避免同点硬塞满
      for (let c = 1; c <= maxCount; c++) {
        const boostAdd = Math.min(totalBoost, c);
        const sc = scoreProduceMove(
          game,
          player,
          face,
          area,
          c,
          boostAdd,
          diff,
          botState
        );
        if (sc > bestScore) {
          bestScore = sc;
          const payload = { face, area };
          if (c < maxCount) payload.count = c;
          best = { type: 'placeDice', payload };
        }
      }
    }
  }

  // normal/hard：跳过 = 即时收益 +（仅当「当前过低且未来较高」时）未来占坑
  if (diff !== 'easy') {
    const placeSc = best ? bestScore : -Infinity;
    const future = estimateFutureDiceOpportunity(game, player);
    const oppSkip = shouldOpportunityVoidSkip(game, player, placeSc, future);
    const voidBest = bestVoidSkipOption(game, player, diff);
    let voidSc = voidBest.score;
    if (oppSkip && Number.isFinite(voidSc)) {
      const futW = voidBest.mode === 'pay' ? 0.4 : 0.28;
      voidSc += Math.round(future * futW);
    }

    // 机会型跳过：当前低+未来高，且综合跳过优于落子
    // 灾难型：落子极差/无子可放，允许用即时爆骰/弃牌脱困（不要求未来高）
    // 最后一枚：直接比即时分——3 人局纯对冲 2 资源独占应让位于爆骰拿 1 任意资源
    const placeCatastrophic = !best || placeSc < -20;
    const onlyOneDie = dice.length === 1;

    const preferVoid =
      Number.isFinite(voidSc) &&
      ((oppSkip && voidSc > placeSc) ||
        (placeCatastrophic && voidBest.score > placeSc) ||
        (onlyOneDie && voidSc > placeSc) ||
        !best);

    if (preferVoid) {
      const voidAct = decideVoidSkip(game, player, diff, botState, {
        preferMode: voidBest.mode,
      });
      if (voidAct) return voidAct;
    }
  }

  // ????????????????????????remoteDice / exile
  if (!best) {
    // ???????????????????????????????
    const funcRemote = (player.funcCards || []).find((c) => c.funcType === 'remoteDice');
    const funcExile = (player.funcCards || []).find((c) => c.funcType === 'exile');
    if (funcRemote && game.phase === 'produce' && game.currentPlayerId === player.id) {
      // ??/?????remote??
      if (diff !== 'easy') {
        return { type: 'useFunc', payload: { cardId: funcRemote.id } };
      }
    }
    // ??????voidSkip
    return decideVoidSkip(game, player, diff, botState);
  }

  return best;
}

/**
 * 跳过本回合：机会型跳过且手牌够时优先弃 2 张；否则爆 1 骰换资源。
 */
function decideVoidSkip(game, player, diff, botState, opts) {
  const dice = game.dice && game.dice[player.id] ? game.dice[player.id] : [];
  if (!dice.length) return null;
  if (idleVillagers(player) <= 0) return null;

  const best = bestVoidSkipOption(game, player, diff);
  const mode =
    opts && (opts.preferMode === 'pay' || opts.preferMode === 'burn')
      ? opts.preferMode
      : best.mode;

  if (mode === 'pay' && sumRes(player.resources || {}) >= 2) {
    return {
      type: 'voidSkip',
      payload: { mode: 'pay', amounts: pickVoidSkipPayAmounts(player) },
    };
  }

  let targetRes = 'wood';
  if (diff === 'hard' || diff === 'normal') {
    const needs = estimateResourceNeeds(player);
    targetRes = pickMostNeededResource(player, needs) || 'wood';
  } else {
    targetRes = pickRandom(RESOURCES) || 'wood';
  }

  return {
    type: 'voidSkip',
    payload: { mode: 'burn', resource: targetRes },
  };
}

/* ?????????? ????????????????? */

/**
 * ???????????????????????
 * ????????????????
 */
function estimateResourceNeeds(player) {
  const needs = { wood: 0, stone: 0, food: 0, iron: 0 };
  for (const k of RESOURCES) needs[k] += BUILD_HOUSE_COST[k] || 0;
  // 繁殖粮
  if (
    player &&
    !player.roundBred &&
    (Number(player.villagers) || 0) < 15 &&
    freeHousesFor(player) > 0
  ) {
    needs.food += breedFoodCost(player.villagers);
  }
  // 扩容 1 木 1 石
  needs.wood += 1;
  needs.stone += 1;
  // 未建成建筑造价
  for (const b of player.buildings || []) {
    if (!b.built && b.cost) {
      for (const k of RESOURCES) needs[k] += b.cost[k] || 0;
    }
  }
  return needs;
}

function pickMostNeededResource(player, needs) {
  const have = player.resources || {};
  let best = null;
  let bestGap = -Infinity;
  for (const r of RESOURCES) {
    const gap = (needs[r] || 0) - (have[r] || 0);
    if (gap > bestGap) {
      bestGap = gap;
      best = r;
    }
  }
  return best;
}

/**
 * ??????????????????????
 */
function decideResourceOverflow(game, player, diff, botState) {
  const hand = sumRes(player.resources);
  const cap = maxResourceHandFor(player);
  const over = hand - cap;
  if (over <= 0) return null;

  const exchCost = effectiveExchangeCost(player, game);

  // ??????
  if (diff !== 'easy') {
    const needs = estimateResourceNeeds(player);
    const needRes = pickMostNeededResource(player, needs);
    if (needRes) {
      for (const from of RESOURCES) {
        if (from === needRes) continue;
        const available = player.resources[from] || 0;
        if (available >= exchCost) {
          const maxCount = Math.floor(available / exchCost);
          // ??????????????maxCount
          const want = Math.min(maxCount, Math.ceil(over / 1));
          if (want > 0) {
            return {
              type: 'exchange',
              payload: { from, to: needRes, count: want },
            };
          }
        }
      }
    }
  }

  // easy ????????
  if (diff === 'easy') {
    const shuffledFrom = shuffle(RESOURCES);
    const shuffledTo = shuffle(RESOURCES);
    for (const from of shuffledFrom) {
      for (const to of shuffledTo) {
        if (from === to) continue;
        if ((player.resources[from] || 0) >= exchCost) {
          return { type: 'exchange', payload: { from, to, count: 1 } };
        }
      }
    }
  }

  // 无法兑换消化时：按流水线保留权重弃置多余资源
  const amounts = _pickDiscardResourceAmounts(game, player, over, botState);
  if (Object.keys(amounts).length) {
    return { type: 'discardResources', payload: { amounts } };
  }
  return null;
}

/**
 * 根据建造流水线推算「本回合应优先保障」的能力权重（越高越该留牌/留资源）。
 * 对齐 decideBuildActionHard：购卡 → 满房建房 → 称号建筑 → 高分建房 → 繁殖 → 扩容…
 */
function _buildPipelineKeepNeeds(game, player, botState) {
  const needs = {
    breed: 0,
    expandRes: 0,
    expandBld: 0,
    house: 0,
    construct: 0,
    harvest: 0,
  };
  if (!player) return needs;

  const score = playerScore(player, game);
  const canBreed =
    !player.roundBred &&
    (Number(player.villagers) || 0) < 15 &&
    freeHousesFor(player) > 0;
  if (canBreed) needs.breed = 100;

  if (shouldExpandResourceHand(player, game, botState)) needs.expandRes = 92;
  if (buildingSlotsTight(player)) needs.expandBld = 88;

  if (!player.roundBuiltHouse) {
    if (freeHousesFor(player) <= 0) needs.house = 96;
    else if (score >= 8) needs.house = 82;
    else if (score >= 6) needs.house = 72;
    else needs.house = 60;
  }

  const unbuilt = (player.buildings || []).filter((b) => !b.built);
  const valuable = unbuilt.filter((b) =>
    _buildingHelpsTitleOrScore(player, b, game)
  );
  if (valuable.length) {
    needs.construct = score >= 7 ? 90 : 65;
  } else if (unbuilt.length) {
    needs.construct = 40;
  }

  if (
    needs.breed ||
    needs.house ||
    needs.expandRes ||
    needs.expandBld ||
    needs.construct
  ) {
    needs.harvest = 55;
  }
  return needs;
}

/** 弃功能卡时的保留分：越高越不该弃 */
function _keepScoreFuncForDiscard(game, player, card, botState) {
  if (!card) return 0;
  const needs = _buildPipelineKeepNeeds(game, player, botState);
  const t = card.funcType;
  let score = 8;

  // 与建造流水线直接相关的功能卡优先保留
  if (t === 'breed') score = 50 + needs.breed;
  else if (t === 'expand') {
    score = 48 + Math.max(needs.expandRes, needs.expandBld);
  } else if (t === 'buildHouse') score = 46 + needs.house;
  else if (t === 'harvest') score = 36 + needs.harvest;
  else if (t === 'redraw') score = 34;
  else if (t === 'enhance') score = 32;
  else if (t === 'recruit') {
    score = 30 + (freeHousesFor(player) > 0 && (player.villagers || 0) < 12 ? 15 : 0);
  } else if (t === 'caravan') score = 28;
  else if (t === 'shelter') score = 26;
  else if (t === 'robbery') score = 18;
  else if (t === 'illegalBuild') score = 16;
  else if (t === 'exile') score = 14;
  else if (t === 'remoteDice') score = 12;
  else if (t === 'banditRaid') score = 10;
  else if (t === 'welfareHouse') score = 9;

  return score;
}

/** 弃未建建筑时的保留分：越高越不该弃（称号/分数优先，不因资源缺口抬高工坊牌） */
function _keepScoreBuildingForDiscard(game, player, b) {
  if (!b) return 0;
  if (b.built) return 1000;
  let score = (Number(b.score) || 0) * 20;
  if (b.buildType === 'exchange') {
    const n = countBuiltExchanges(player);
    if (n < 2) score += 80;
    else if (n < 3) score += 90;
    else score += 20;
  } else if (b.buildType === 'wishWell') {
    score += 55 + (_workshopWishCount(player) < 3 ? 30 : 0);
  } else if (b.buildType === 'produce') {
    score += 18 + (_workshopWishCount(player) < 3 ? 22 : 0);
  } else if (b.buildType === 'score2') {
    score += 75;
  } else if (b.buildType === 'score1') {
    score += 58;
  } else if (_buildingHelpsTitleOrScore(player, b, game)) {
    score += 45;
  }
  // 造价越高略减（更难立刻建成）
  score -= Math.min(24, sumRes(b.cost || {}) * 2);
  return score;
}

/**
 * 弃资源时各色「保留权重」：流水线急需的原料权重大，优先丢掉多余色。
 */
function _resourceKeepWeights(game, player, botState) {
  const w = { wood: 1, stone: 1, food: 1, iron: 1 };
  const needs = _buildPipelineKeepNeeds(game, player, botState);
  if (needs.breed > 0) {
    w.food += 8 + Math.min(6, breedFoodCost(player.villagers));
  }
  if (needs.expandRes > 0 || needs.expandBld > 0) {
    w.wood += 6;
    w.stone += 6;
  }
  if (needs.house > 0) {
    for (const k of RESOURCES) w[k] += (BUILD_HOUSE_COST[k] || 0) * 3;
  }
  if (needs.construct > 0) {
    const ranked = (player.buildings || [])
      .filter((b) => !b.built && b.cost)
      .slice()
      .sort(
        (a, b) =>
          _keepScoreBuildingForDiscard(game, player, b) -
          _keepScoreBuildingForDiscard(game, player, a)
      );
    const top = ranked[0];
    if (top && top.cost) {
      for (const k of RESOURCES) w[k] += (top.cost[k] || 0) * 2;
    }
  }
  // 购发展卡（手牌≥12 时流水线第一步）
  if (sumRes(player.resources || {}) >= 12 && _canBuyFuncThisTurn(player)) {
    w.wood += 4;
    w.stone += 4;
    w.food += 4;
    w.iron += 4;
  }
  return w;
}

/**
 * 超限弃资源：优先丢「保留权重低且存量多」的，尽量保住流水线原料。
 */
function _pickDiscardResourceAmounts(game, player, over, botState) {
  const amounts = {};
  let still = Math.max(0, Number(over) || 0);
  if (still <= 0) return amounts;
  const weights = _resourceKeepWeights(game, player, botState);
  const have = copyRes(player.resources || {});
  while (still > 0) {
    let best = null;
    let bestKey = Infinity;
    for (const r of RESOURCES) {
      const n = Number(have[r]) || 0;
      if (n <= 0) continue;
      // 权重低、存量高 → 先丢
      const key = weights[r] * 10 - n;
      if (key < bestKey) {
        bestKey = key;
        best = r;
      }
    }
    if (!best) break;
    amounts[best] = (amounts[best] || 0) + 1;
    have[best] -= 1;
    still -= 1;
  }
  return amounts;
}

/**
 * 待弃功能卡 / 未建建筑：按建造流水线保留高优先级，弃掉其余。
 */
function decidePendingDiscard(game, player, diff, botState) {
  botState = botState || {};

  if (player.pendingDiscardBuild) {
    const unbuilt = (player.buildings || []).filter((b) => !b.built);
    const neu =
      player.pendingDiscardBuild.newCard ||
      (player.pendingDiscardBuild.newCards &&
        player.pendingDiscardBuild.newCards[0]) ||
      null;

    if (!unbuilt.length) {
      // 没有可弃的未建旧卡，只能弃新卡
      return { type: 'discardPendingBuild' };
    }

    let worst = unbuilt[0];
    let worstScore = _keepScoreBuildingForDiscard(game, player, worst);
    for (const b of unbuilt) {
      const sc = _keepScoreBuildingForDiscard(game, player, b);
      if (sc < worstScore) {
        worstScore = sc;
        worst = b;
      }
    }

    if (diff !== 'easy' && neu) {
      const neuScore = _keepScoreBuildingForDiscard(game, player, neu);
      // 新卡明显更差：弃新卡，保住现有高优先级未建
      if (neuScore + 8 < worstScore) {
        return { type: 'discardPendingBuild' };
      }
    }

    return { type: 'discardUnbuilt', payload: { buildingId: worst.id } };
  }

  if (
    player.pendingDiscardFunc ||
    (player.funcCards || []).length > maxFuncHandFor(player)
  ) {
    const cards = player.funcCards || [];
    if (!cards.length) return null;

    if (diff === 'easy') {
      return {
        type: 'discardFunc',
        payload: { cardId: cards[cards.length - 1].id },
      };
    }

    let worst = cards[0];
    let worstScore = _keepScoreFuncForDiscard(game, player, worst, botState);
    for (const c of cards) {
      const sc = _keepScoreFuncForDiscard(game, player, c, botState);
      if (sc < worstScore) {
        worstScore = sc;
        worst = c;
      }
    }
    return { type: 'discardFunc', payload: { cardId: worst.id } };
  }

  return null;
}

/**
 * ??????????????????
 */
function scoreBuildingForHard(player, b, game) {
  if (!b.cost) return 0;
  let score = (b.score || 0) * 15;
  const rate = game ? currentExchangeRate(player, game) : 3;
  if (b.buildType === 'produce' && b.resource) {
    const needs = estimateResourceNeeds(player);
    const gap = Math.max(0, (needs[b.resource] || 0) - (player.resources[b.resource] || 0));
    score += gap * 8 * selfGainFactor(game);
  }
  // 集市：第 2 座冲向 1:1 无损兑换价值最高
  if (b.buildType === 'exchange') {
    const exCount = countBuiltExchanges(player);
    if (exCount === 0) score += 40;
    else if (exCount === 1) score += 55;
    else score += 12;
  }
  if (b.buildType === 'wishWell') score += 25;
  // 分数卡：兑换越好越该优先建成冲分
  if (b.buildType === 'score2') score += 30 + (rate <= 1 ? 28 : rate <= 2 ? 12 : 0);
  if (b.buildType === 'score1') score += 18 + (rate <= 1 ? 16 : rate <= 2 ? 8 : 0);
  const costSum = sumRes(b.cost);
  // 兑换好时造价惩罚降低（可无损/低损凑齐）
  score -= costSum * (rate <= 1 ? 1.2 : rate <= 2 ? 2 : 3);
  return score;
}

function scoreBuildingForNormal(player, b) {
  if (!b.cost) return 0;
  let score = (b.score || 0) * 10;
  if (b.buildType === 'exchange') {
    const exCount = countBuiltExchanges(player);
    score += exCount === 0 ? 18 : exCount === 1 ? 28 : 8;
  }
  if (b.buildType === 'score2') score += 22;
  if (b.buildType === 'score1') score += 12;
  if (b.buildType === 'produce' && b.resource) {
    const needs = estimateResourceNeeds(player);
    const gap = Math.max(0, (needs[b.resource] || 0) - (player.resources[b.resource] || 0));
    score += gap * 5;
  }
  const costSum = sumRes(b.cost);
  score -= costSum * 2;
  return score;
}

function scoreBuildingForEasy(_player, b) {
  // ???????????????????????????????
  if (!b.cost) return 0;
  return (b.score || 0) * 10 - sumRes(b.cost) * 2;
}

/* ?????????? ???????????????? ?????????? */

/** 丰收三选：优先补扩建缺的木/石，再补繁殖粮 */
function _harvestResourcePicks(player) {
  const picks = [];
  const have = (player && player.resources) || {};
  const push = (r, n) => {
    const k = Math.max(0, Number(n) || 0);
    for (let i = 0; i < k && picks.length < 3; i++) picks.push(r);
  };
  if ((Number(have.wood) || 0) < 1) push('wood', 1);
  if ((Number(have.stone) || 0) < 1) push('stone', 1);
  if (
    player &&
    !player.roundBred &&
    (Number(player.villagers) || 0) < 15 &&
    freeHousesFor(player) > 0
  ) {
    const gap = breedFoodCost(player.villagers) - (Number(have.food) || 0);
    if (gap > 0) push('food', gap);
  }
  const fill = ['wood', 'stone', 'iron', 'food'];
  let i = 0;
  while (picks.length < 3) {
    picks.push(fill[i % fill.length]);
    i += 1;
  }
  return picks;
}

function decideUseFuncCardHard(game, player, botState) {
  const cards = player.funcCards || [];
  if (!cards.length) return null;
  if (game.buildPassed && game.buildPassed[player.id]) return null;

  botState = botState || {};

  // ?? ????????????????????? ??
  const needs = _planPermanentActions(game, player, botState);
  const needTotal = (needs.house ? 1 : 0) + (needs.breed ? 1 : 0) + (needs.expand ? 1 : 0);
  const resSum = sumRes(player.resources);

  // ?? 1. ???redraw??????????? ??
  const redraw = cards.find((c) => c.funcType === 'redraw' && !player.buildTurnUsedRedraw);
  if (redraw) {
    const bldCap = maxBuildingsFor(player);
    const unbuilt = (player.buildings || []).filter((b) => !b.built).length;
    if (unbuilt < bldCap) {
      return { type: 'useFunc', payload: { cardId: redraw.id } };
    }
    // ???????????????????????????????
    // ??????redraw
  }

  // ?? 2. ?????freeExpand???
  const freeExpand = cards.find((c) => c.funcType === 'expand');
  if (freeExpand) {
    const bldCap = maxBuildingsFor(player);
    const funcCap = maxFuncHandFor(player);
    const unbuilt = (player.buildings || []).filter((b) => !b.built).length;
    const funcN = (player.funcCards || []).length;
    // ??????????????
    if (unbuilt >= bldCap) {
      return {
        type: 'useFunc',
        payload: { cardId: freeExpand.id, direction: 'building' },
      };
    }
    if (funcN >= funcCap) {
      return {
        type: 'useFunc',
        payload: { cardId: freeExpand.id, direction: 'function' },
      };
    }
    // 资源扩容交给建造流水线（空位≤9 顺序）
  }

  // 丰收：缺口 1～2 张时发动，必须带上 3 个资源（否则引擎拒绝，超时会直接跳过建造）
  const harvest = cards.find((c) => c.funcType === 'harvest');
  if (harvest && needTotal > 0) {
    const shortfall = _shortfallForNeeds(player, needs);
    if (shortfall > 0 && shortfall <= 2) {
      return {
        type: 'useFunc',
        payload: { cardId: harvest.id, resources: _harvestResourcePicks(player) },
      };
    }
  }

  // ?? 4. ???robbery?????? ??
  const robbery = cards.find((c) => c.funcType === 'robbery');
  if (robbery) {
    const target = _pickRobberyTarget(game, player);
    if (target) {
      return { type: 'useFunc', payload: { cardId: robbery.id, targetId: target.id, mode: target.mode } };
    }
  }

  // ?? 5. ???illegalBuild????????????????
  const illegalBuild = cards.find((c) => c.funcType === 'illegalBuild');
  if (illegalBuild) {
    const target = _pickIllegalBuildTarget(game, player);
    if (target) {
      return { type: 'useFunc', payload: { cardId: illegalBuild.id, targetId: target.id } };
    }
  }

  // ?? 6. ?????caravan?????????????????
  const caravan = cards.find((c) => c.funcType === 'caravan');
  if (caravan && !player.caravanPending && _canBuyFuncThisTurn(player)) {
    const needExch = _needsExchangeBreed(player);
    if (resSum >= 8 || needExch) {
      return { type: 'useFunc', payload: { cardId: caravan.id } };
    }
  }

  // ?? 7. ???recruit??????????????????
  const recruit = cards.find((c) => c.funcType === 'recruit');
  if (recruit && player.villagers < 15) {
    return { type: 'useFunc', payload: { cardId: recruit.id } };
  }

  // ?? 8. ???enhance???????? ??
  const enhance = cards.find((c) => c.funcType === 'enhance');
  if (enhance) {
    const canEnh = Math.min(player.villagers || 0, 5) - (player.enhancedDice || 0);
    if (canEnh > 0) return { type: 'useFunc', payload: { cardId: enhance.id } };
  }

  // ?? 9. ???shelter???????? ??
  const shelter = cards.find((c) => c.funcType === 'shelter');
  if (shelter && player.villagers < 15) {
    return { type: 'useFunc', payload: { cardId: shelter.id } };
  }

  // ?? 10. ????welfareHouse????????
  const welfareHouse = cards.find((c) => c.funcType === 'welfareHouse');
  if (welfareHouse) {
    return { type: 'useFunc', payload: { cardId: welfareHouse.id } };
  }

  return null;
}

/** ????????????????needs ?? */
function _planPermanentActions(game, player, botState) {
  botState = botState || {};
  const needs = { house: false, breed: false, expand: false, targetRes: null };

  // 村民未满房且能繁殖（含兑换）
  if (
    !player.roundBred &&
    player.villagers < 15 &&
    freeHousesFor(player) > 0 &&
    _canBreedNowOrViaExchange(game, player)
  ) {
    needs.breed = true;
  }

  // 满房或冲分：优先建房
  if (!player.roundBuiltHouse && shouldPrioritizeHouse(player, game)) {
    if (
      canPay(player.resources, BUILD_HOUSE_COST) ||
      _canAffordCostViaExchange(game, player, BUILD_HOUSE_COST)
    ) {
      needs.house = true;
    }
  }

  // 进场空位≤5 才规划资源扩建（≤3 才会兑换；材料不够时丰收可补）
  ensureBuildTurnEntryFree(player);
  if (player.buildTurnEntryFreeRes <= 5) {
    needs.expand = true;
    needs.expandDir = 'resource';
  }

  return needs;
}

/** ???????????????? */
function _shortfallForNeeds(player, needs) {
  let short = 0;
  if (needs.breed) {
    const need = breedFoodCost(player.villagers) - (player.resources.food || 0);
    if (need > 0) short += need;
  }
  if (needs.house) {
    if ((player.resources.wood || 0) < BUILD_HOUSE_COST.wood) {
      short += BUILD_HOUSE_COST.wood - (player.resources.wood || 0);
    }
    if ((player.resources.stone || 0) < BUILD_HOUSE_COST.stone) {
      short += BUILD_HOUSE_COST.stone - (player.resources.stone || 0);
    }
    if ((player.resources.iron || 0) < BUILD_HOUSE_COST.iron) {
      short += BUILD_HOUSE_COST.iron - (player.resources.iron || 0);
    }
  }
  if (needs.expand) {
    if ((player.resources.wood || 0) < 1) short++;
    if ((player.resources.stone || 0) < 1) short++;
  }
  return short;
}

/** 当前能否繁殖（含银行/集市兑换模拟） */
function _canBreedNowOrViaExchange(game, player) {
  if (!player || player.roundBred) return false;
  if ((Number(player.villagers) || 0) >= 15) return false;
  if (freeHousesFor(player) <= 0) return false;
  const foodNeed = breedFoodCost(player.villagers);
  const foodHave = Number(player.resources.food) || 0;
  if (foodHave >= foodNeed) return true;
  const gap = foodNeed - foodHave;
  return _canExchangeTo(
    player,
    effectiveExchangeCost(player, game),
    'food',
    gap
  );
}

/** 可用换出池（为凑 cost 保留原料；reserveExtra 额外锁定；useSoft 时再避开后续动作） */
function _exchangePoolAvailable(have, cost, excludeRes, reserveExtra, softReserve, useSoft) {
  let pool = 0;
  for (const r of RESOURCES) {
    if (r === excludeRes) continue;
    const reserve =
      (Number(cost && cost[r]) || 0) +
      (Number(reserveExtra && reserveExtra[r]) || 0) +
      (useSoft ? Number(softReserve && softReserve[r]) || 0 : 0);
    pool += Math.max(0, (Number(have[r]) || 0) - reserve);
  }
  return pool;
}

/**
 * 能否用兑换凑齐目标资源（支持混合换出，与 engine 银行/集市一致）
 */
function _canExchangeTo(player, exchCost, targetRes, need) {
  if (need <= 0) return true;
  const n = Math.max(0, Math.floor(Number(need) || 0));
  const rate = Math.max(1, Math.floor(Number(exchCost) || 0));
  if (!n || !rate) return false;
  const pool = _exchangePoolAvailable(player.resources || {}, null, targetRes);
  return Math.floor(pool / rate) >= n;
}

/** 模拟兑换后能否付得起 cost（如扩容 1 木 1 石）；reserveExtra 不可动用 */
function _canAffordCostViaExchange(game, player, cost, reserveExtra) {
  if (!player || !cost) return false;
  if (canPay(player.resources, cost)) {
    if (!reserveExtra) return true;
    const after = copyRes(player.resources);
    for (const k of RESOURCES) {
      after[k] = (after[k] || 0) - (Number(cost[k]) || 0);
    }
    for (const k of RESOURCES) {
      if ((after[k] || 0) < (Number(reserveExtra[k]) || 0)) return false;
    }
    return true;
  }
  const exchCost = effectiveExchangeCost(player, game);
  if (exchCost <= 0) return false;
  const sim = copyRes(player.resources);
  for (let guard = 0; guard < 16; guard++) {
    if (canPay(sim, cost)) {
      if (!reserveExtra) return true;
      const after = copyRes(sim);
      for (const k of RESOURCES) {
        after[k] = (after[k] || 0) - (Number(cost[k]) || 0);
      }
      let ok = true;
      for (const k of RESOURCES) {
        if ((after[k] || 0) < (Number(reserveExtra[k]) || 0)) ok = false;
      }
      if (ok) return true;
    }
    let progressed = false;
    for (const needRes of RESOURCES) {
      const need = Number(cost[needRes]) || 0;
      if (need <= 0 || (sim[needRes] || 0) >= need) continue;
      for (const from of RESOURCES) {
        if (from === needRes) continue;
        const reserve =
          (Number(cost[from]) || 0) + (Number(reserveExtra && reserveExtra[from]) || 0);
        const available = (sim[from] || 0) - reserve;
        if (available >= exchCost) {
          sim[from] -= exchCost;
          sim[needRes] = (sim[needRes] || 0) + 1;
          progressed = true;
          break;
        }
      }
      if (progressed) break;
      if (_exchangePoolAvailable(sim, cost, needRes, reserveExtra) >= exchCost) {
        let left = exchCost;
        for (const from of RESOURCES) {
          if (from === needRes || left <= 0) continue;
          const reserve =
            (Number(cost[from]) || 0) +
            (Number(reserveExtra && reserveExtra[from]) || 0);
          let available = (sim[from] || 0) - reserve;
          if (available <= 0) continue;
          const take = Math.min(available, left);
          sim[from] -= take;
          left -= take;
        }
        if (left <= 0) {
          sim[needRes] = (sim[needRes] || 0) + 1;
          progressed = true;
          break;
        }
      }
    }
    if (!progressed) break;
  }
  if (!canPay(sim, cost)) return false;
  if (!reserveExtra) return true;
  for (const k of RESOURCES) {
    sim[k] = (sim[k] || 0) - (Number(cost[k]) || 0);
  }
  for (const k of RESOURCES) {
    if ((sim[k] || 0) < (Number(reserveExtra[k]) || 0)) return false;
  }
  return true;
}

/** 单个动作还缺的资源张数（各资源缺口之和）。 */
function actionResourceGap(resources, cost) {
  let gap = 0;
  const have = resources || {};
  for (const k of RESOURCES) {
    const need = Number(cost && cost[k]) || 0;
    const n = Number(have[k]) || 0;
    if (n < need) gap += need - n;
  }
  return gap;
}

/**
 * 为凑齐一个动作，兑换最多补 2 张缺口；再多就不值得。
 * opts.ignoreExchangeGap 仅给第 3、4 步冲分：做完就能赢，不看缺口。
 */
function _exchangeGapWorthIt(player, cost, opts) {
  if (opts && opts.ignoreExchangeGap) return true;
  return actionResourceGap(player && player.resources, cost) <= 2;
}

function _blankNeed() {
  return { wood: 0, stone: 0, food: 0, iron: 0 };
}

function _addNeed(into, cost) {
  for (const k of RESOURCES) into[k] += Number(cost && cost[k]) || 0;
}

/** 后续建造步骤会优先做成的那座建筑的造价（不含当前正在凑的那座） */
function _peekConstructCost(game, player, opts) {
  opts = opts || {};
  const cands = (player.buildings || []).filter((b) => {
    if (!b || b.built) return false;
    if (opts.skipId && b.id === opts.skipId) return false;
    if (opts.excludePalace && b.buildType === 'score2') return false;
    if (opts.requireTitleOrScore && !_buildingHelpsTitleOrScore(player, b, game)) {
      return false;
    }
    return true;
  });
  if (!cands.length) return null;
  cands.sort(
    (a, b) =>
      scoreBuildingForHard(player, b, game) - scoreBuildingForHard(player, a, game)
  );
  const payable = cands.find((b) => canPay(player.resources, b.cost || {}));
  if (payable) return payable.cost || {};
  if (opts.payableOnly) return null;
  for (const b of cands) {
    if (_exchangeGapWorthIt(player, b.cost || {}, opts)) return b.cost || {};
  }
  return null;
}

/**
 * 兑换前看后续动作还要的资源。返回的是「尽量留着」的数量，不够换时仍可动用。
 * step：2/3/4/7/9/10/11/12/13，以及 14 购卡、15 建造、16 建房、17 扩资源、18 扩建筑、19 任意扩容。
 */
function _laterSoftReserve(game, player, step, extra) {
  const reserve = _blankNeed();
  if (!player || !step) return reserve;
  extra = extra || {};
  const score = playerScore(player, game);
  const entry = ensureBuildTurnEntryFree(player);
  const hand = sumRes(player.resources || {});
  const houseSteps = [2, 4, 10, 13, 16];
  const houseDone = Boolean(player.roundBuiltHouse) || houseSteps.includes(step);
  const bred = Boolean(player.roundBred) || step === 5 || step === 9;

  if (!houseDone) {
    const gapOk =
      canPay(player.resources, BUILD_HOUSE_COST) ||
      actionResourceGap(player.resources, BUILD_HOUSE_COST) <= 2;
    const want =
      (step < 4 && score >= 8) ||
      (step < 10 && score >= 6 && gapOk) ||
      (step < 13 && gapOk) ||
      (step < 16 && hand >= 6 && gapOk);
    if (want) _addNeed(reserve, BUILD_HOUSE_COST);
  }

  if (
    !bred &&
    freeHousesFor(player) > 0 &&
    (Number(player.villagers) || 0) < 15
  ) {
    const foodNeed = breedFoodCost(player.villagers);
    const foodCost = { food: foodNeed };
    const canNow = (Number(player.resources.food) || 0) >= foodNeed;
    const gapOk = canNow || actionResourceGap(player.resources, foodCost) <= 2;
    if ((step < 5 && canNow) || (step < 9 && gapOk)) _addNeed(reserve, foodCost);
  }

  const expandGapOk =
    canPay(player.resources, EXPAND_COST) ||
    actionResourceGap(player.resources, EXPAND_COST) <= 2;
  if (step !== 12 && step !== 17) {
    const wantRes =
      (step < 6 && entry != null && entry <= 5 && canPay(player.resources, EXPAND_COST)) ||
      (step < 12 && entry != null && entry <= 3 && expandGapOk) ||
      (step < 17 && hand >= 6 && entry != null && entry <= 3 && expandGapOk);
    if (wantRes) _addNeed(reserve, EXPAND_COST);
  }
  if (step !== 7 && step !== 18 && buildingSlotsTight(player)) {
    const wantBld = step < 7 || (step < 18 && hand >= 6 && expandGapOk);
    if (wantBld) _addNeed(reserve, EXPAND_COST);
  }

  if (step < 14 && hand >= 6 && _canBuyFuncThisTurn(player)) {
    const buyOk =
      canPay(player.resources, BUY_FUNC_COST) ||
      actionResourceGap(player.resources, BUY_FUNC_COST) <= 2;
    if (buyOk) _addNeed(reserve, BUY_FUNC_COST);
  }

  const constructSpecs = [];
  if (step < 3 && score >= 7) {
    constructSpecs.push({
      minScore: 7,
      requireTitleOrScore: true,
      ignoreExchangeGap: true,
      skipId: extra.skipBuildingId,
    });
  }
  if (step < 8) {
    constructSpecs.push({
      excludePalace: true,
      payableOnly: true,
      skipId: extra.skipBuildingId,
    });
  }
  if (step < 11) {
    constructSpecs.push({
      excludePalace: true,
      skipId: extra.skipBuildingId,
    });
  }
  if (step < 15 && hand >= 6) {
    constructSpecs.push({
      excludePalace: false,
      skipId: extra.skipBuildingId,
    });
  }
  for (const spec of constructSpecs) {
    const cost = _peekConstructCost(game, player, spec);
    if (cost) {
      _addNeed(reserve, cost);
      break;
    }
  }
  return reserve;
}

/**
 * 为凑齐 cost 兑换一次（优先补缺口；保留 cost 与 reserveExtra 原料；支持混合）
 * softReserve：后续动作尽量留着的资源，有别的原料就不动。
 * @returns {{type:string,payload:object}|null}
 */
function _exchangeTowardCost(game, player, cost, reserveExtra, softReserve) {
  if (!player || !cost) return null;
  if (canPay(player.resources, cost)) return null;
  const exchCost = effectiveExchangeCost(player, game);
  if (exchCost <= 0) return null;
  const have = player.resources || {};
  const keepSoft = Boolean(
    softReserve && RESOURCES.some((k) => (Number(softReserve[k]) || 0) > 0)
  );

  function fillNeed(needRes, useSoft) {
    const need = Number(cost[needRes]) || 0;
    const haveN = Number(have[needRes]) || 0;
    if (need <= 0 || haveN >= need) return null;
    for (const from of RESOURCES) {
      if (from === needRes) continue;
      const reserve =
        (Number(cost[from]) || 0) +
        (Number(reserveExtra && reserveExtra[from]) || 0) +
        (useSoft ? Number(softReserve && softReserve[from]) || 0 : 0);
      const available = (Number(have[from]) || 0) - reserve;
      if (available < exchCost) continue;
      const maxGet = Math.floor(available / exchCost);
      const count = Math.min(need - haveN, maxGet);
      if (count > 0) {
        return {
          type: 'exchange',
          payload: { from, to: needRes, count },
        };
      }
    }
    if (
      _exchangePoolAvailable(have, cost, needRes, reserveExtra, softReserve, useSoft) >=
      exchCost
    ) {
      const fromObj = {};
      let left = exchCost;
      for (const from of RESOURCES) {
        if (from === needRes || left <= 0) continue;
        const reserve =
          (Number(cost[from]) || 0) +
          (Number(reserveExtra && reserveExtra[from]) || 0) +
          (useSoft ? Number(softReserve && softReserve[from]) || 0 : 0);
        let available = (Number(have[from]) || 0) - reserve;
        if (available <= 0) continue;
        const take = Math.min(available, left);
        fromObj[from] = take;
        left -= take;
      }
      if (left <= 0) {
        return {
          type: 'exchange',
          payload: { from: fromObj, to: { [needRes]: 1 } },
        };
      }
    }
    return null;
  }

  for (const needRes of RESOURCES) {
    const softHit = keepSoft ? fillNeed(needRes, true) : null;
    if (softHit) return softHit;
    const hit = fillNeed(needRes, false);
    if (hit) return hit;
  }
  return null;
}

/** 剩余资源手牌空位 */
function freeResourceSlots(player) {
  return Math.max(0, maxResourceHandFor(player) - sumRes(player.resources || {}));
}

/**
 * 空位是否宽裕：上限 − 当前手牌 > 9 才不必强行扩。
 * （空位 ≤ 9 时生产很容易再次顶格，建造结束前应尽力扩容）
 */
function hasPlentyResourceSlots(player) {
  return freeResourceSlots(player) > 9;
}

/**
 * 当前兑换代价（张）：1=无损(≥2集市/商队)，2=一座集市，3=银行。
 * 只影响「怎么花」资源的效率，不决定要不要扩手牌上限。
 */
function currentExchangeRate(player, game) {
  return effectiveExchangeCost(player, game);
}

/** 兑换是否已接近/达到无损，适合把资源兑成建造/买卡原料 */
function hasEfficientExchange(player, game) {
  return currentExchangeRate(player, game) <= 2;
}

/** 是否已无损兑换（2 座集市或商队） */
function hasLosslessExchange(player, game) {
  return currentExchangeRate(player, game) <= 1;
}

/** 本回合第一次决策时补记进场空位（冒烟直接切阶段时引擎未必已记） */
function ensureBuildTurnEntryFree(player) {
  if (!player) return null;
  if (player.buildTurnEntryFreeRes == null) {
    player.buildTurnEntryFreeRes = freeResourceSlots(player);
  }
  return player.buildTurnEntryFreeRes;
}

/**
 * 是否还应扩资源手牌上限。
 * normal/easy 仍看当前空位 ≤ 9。hard 第 6/12 步改看进场空位，不走这里。
 */
function shouldExpandResourceHand(player, game, botState) {
  if (!player) return false;
  const free = freeResourceSlots(player);
  if (free <= 9) {
    player.__botWantExpandRes = true;
    return true;
  }
  if (player.__botWantExpandRes && canPay(player.resources, EXPAND_COST)) {
    return true;
  }
  if (!canPay(player.resources, EXPAND_COST)) {
    player.__botWantExpandRes = false;
  }
  return false;
}

/**
 * 花牌时更偏向买功能卡/冲分建筑（兑换好则转化成本低；上限高则少靠扩容消化）。
 * 与「要不要扩手牌」是两件事。
 */
function prefersBuyFuncSink(player, game) {
  const cap = maxResourceHandFor(player);
  const rate = currentExchangeRate(player, game);
  return rate <= 1 || cap >= 15 || (rate <= 2 && cap >= 12);
}

/** 建筑格是否紧张（已满或只剩 0 空位） */
function buildingSlotsTight(player) {
  return (player.buildings || []).length >= maxBuildingsFor(player);
}

/**
 * 资源压力：剩余卡位越少越高。满手/几乎满手时必须尽量花掉，勿屯到下回合弃牌。
 */
function resourceDumpUrgency(player) {
  const free = freeResourceSlots(player);
  const hand = sumRes(player.resources || {});
  if (free <= 0) return 100;
  if (free <= 1) return 80;
  if (free <= 2) return 60;
  if (free <= 3) return 40;
  if (hand >= 7) return 35;
  if (hand >= 5) return 20;
  return 0;
}

function shouldPrioritizeHouse(player, game) {
  if (!player || player.roundBuiltHouse) return false;
  if (freeHousesFor(player) <= 0) return true;
  if (playerScore(player, game) >= 6) return true;
  return false;
}

/**
 * 结束建造前尽量花资源：繁殖 / 建房 / 建分卡 / 买功能卡 /（确需时）扩容。
 * 兑换比只影响花牌效率；扩手牌只看容量/空位（提高生产带入量）。
 * @returns {{type:string,payload?:object}|null}
 */
function decideSpendBeforePass(game, player, diff, botState) {
  botState = botState || {};
  const urgency = resourceDumpUrgency(player);
  if (urgency <= 0 && diff === 'easy') return null;

  const preferHouse = shouldPrioritizeHouse(player, game);
  const rate = currentExchangeRate(player, game);
  const buySink = prefersBuyFuncSink(player, game);
  const wantExpandRes = shouldExpandResourceHand(player, game, botState);

  // 1) 村民已满房 或 分数>=6：优先建房冲分/腾空位（付得起才建；空位紧时先扩容）
  if (preferHouse && !player.roundBuiltHouse) {
    if (canPay(player.resources, BUILD_HOUSE_COST)) {
      return { type: 'buildHousePermanent' };
    }
    if (
      !wantExpandRes &&
      _canAffordCostViaExchange(game, player, BUILD_HOUSE_COST)
    ) {
      const exch = _exchangeTowardCost(game, player, BUILD_HOUSE_COST);
      if (exch) return exch;
    }
  }

  // 2) 能繁殖（含兑换凑粮）则繁殖
  if (
    !player.roundBred &&
    (Number(player.villagers) || 0) < 15 &&
    freeHousesFor(player) > 0
  ) {
    const foodNeed = breedFoodCost(player.villagers);
    if ((Number(player.resources.food) || 0) >= foodNeed) {
      return { type: 'breedPermanent' };
    }
    if (_canBreedNowOrViaExchange(game, player)) {
      const exch = _exchangeTowardCost(game, player, { food: foodNeed });
      if (exch) return exch;
    }
  }

  // 非优先建房时：仍可建房
  if (
    !player.roundBuiltHouse &&
    !preferHouse &&
    (urgency >= 40 || diff !== 'easy' || rate <= 2)
  ) {
    if (canPay(player.resources, BUILD_HOUSE_COST)) {
      return { type: 'buildHousePermanent' };
    }
    if (
      (urgency >= 40 || rate <= 1) &&
      _canAffordCostViaExchange(game, player, BUILD_HOUSE_COST)
    ) {
      const exch = _exchangeTowardCost(game, player, BUILD_HOUSE_COST);
      if (exch) return exch;
    }
  }

  // 2.5) 空位≤9：先扩资源上限，避免后面买卡/建造把木石花光后顶格进生产
  if (wantExpandRes) {
    if (canPay(player.resources, EXPAND_COST)) {
      markExpandedResource(botState, player);
      return { type: 'expandPermanent', payload: { direction: 'resource' } };
    }
    const exchEarly = _exchangeTowardCost(game, player, EXPAND_COST);
    if (exchEarly) return exchEarly;
    const freeExpandEarly = (player.funcCards || []).find(
      (c) => c.funcType === 'expand'
    );
    if (freeExpandEarly) {
      markExpandedResource(botState, player);
      return {
        type: 'useFunc',
        payload: { cardId: freeExpandEarly.id, direction: 'resource' },
      };
    }
  }

  // 2.6) 兑换高效时：优先兑成原料建成手上海分/集市/所需建筑
  if (diff !== 'easy' && hasEfficientExchange(player, game)) {
    const unbuilt = (player.buildings || []).filter((b) => !b.built);
    if (unbuilt.length) {
      const ranked = unbuilt.slice().sort((a, b) => {
        if (diff === 'normal') {
          return scoreBuildingForNormal(player, b) - scoreBuildingForNormal(player, a);
        }
        return (
          scoreBuildingForHard(player, b, game) -
          scoreBuildingForHard(player, a, game)
        );
      });
      for (const b of ranked.slice(0, 4)) {
        const cost = b.cost || {};
        if (canPay(player.resources, cost)) {
          return { type: 'construct', payload: { buildingId: b.id } };
        }
        if (_canAffordCostViaExchange(game, player, cost)) {
          const exch = _exchangeTowardCost(game, player, cost);
          if (exch) return exch;
        }
      }
    }
  }

  // 3) 买功能卡花牌
  if (
    diff !== 'easy' &&
    _canBuyFuncThisTurn(player) &&
    !buildingSlotsTight(player) &&
    (buySink ||
      urgency >= 40 ||
      (Number(player.expandResSlots) || 0) >= 2 ||
      rate <= 1)
  ) {
    if (canPay(player.resources, BUY_FUNC_COST)) {
      return { type: 'buyFuncCardPermanent' };
    }
    if (
      (urgency >= 20 || rate <= 1 || buySink) &&
      _canAffordCostViaExchange(game, player, BUY_FUNC_COST)
    ) {
      const exch = _exchangeTowardCost(game, player, BUY_FUNC_COST);
      if (exch) return exch;
    }
  }

  // 4) 扩容兜底（上面已尝试；此处保留扩建卡/再兑一次）
  if (wantExpandRes) {
    if (canPay(player.resources, EXPAND_COST)) {
      markExpandedResource(botState, player);
      return { type: 'expandPermanent', payload: { direction: 'resource' } };
    }
    const exchLate = _exchangeTowardCost(game, player, EXPAND_COST);
    if (exchLate) return exchLate;
    const freeExpand = (player.funcCards || []).find((c) => c.funcType === 'expand');
    if (freeExpand) {
      markExpandedResource(botState, player);
      return {
        type: 'useFunc',
        payload: { cardId: freeExpand.id, direction: 'resource' },
      };
    }
  }

  // 5) 高压力兜底：扩建筑/功能位花木石；不轻易扩资源位
  if (urgency >= 60 && canPay(player.resources, EXPAND_COST)) {
    let dir = 'building';
    if (buildingSlotsTight(player)) {
      dir =
        (player.funcCards || []).length >= maxFuncHandFor(player)
          ? 'resource'
          : 'function';
    }
    if (dir === 'resource' && !wantExpandRes) return null;
    markExpandedResource(botState, player);
    return { type: 'expandPermanent', payload: { direction: dir } };
  }

  return null;
}

/** ????????????????2???? */
function _needsExchangeBreed(player) {
  if (player.roundBred || player.villagers >= 15) return false;
  const foodNeed = breedFoodCost(player.villagers);
  const foodHave = player.resources.food || 0;
  const gap = foodNeed - foodHave;
  return gap >= 2;
}

/** ?????? */
function _pickRobberyTarget(game, player) {
  const alive = alivePlayers(game).filter((p) => p.id !== player.id && !p.left);
  let best = null;
  let bestScore = -1;

  for (const t of alive) {
    // ??A??????????/???????????
    const funcs = t.funcCards || [];
    const unbuilt = (t.buildings || []).filter((b) => !b.built);
    const hasCards = funcs.length + unbuilt.length;

    if (hasCards === 1) {
      const card = funcs[0] || unbuilt[0];
      if (card) {
        let val = 0;
        if (card.funcType === 'enhance' || card.buildType === 'exchange') val = 80;
        else if (card.funcType === 'recruit') val = 50;
        else if (card.buildType === 'wishWell') val = 60;
        else val = 30;
        if (val > bestScore) { bestScore = val; best = { target: t, mode: 'cards' }; }
      }
    }

    // ??B????????????????????????
    const builtGroups = {};
    for (const b of t.buildings || []) {
      if (b.built) {
        builtGroups[b.buildType] = (builtGroups[b.buildType] || 0) + 1;
      }
    }
    for (const b of unbuilt) {
      if (builtGroups[b.buildType] && builtGroups[b.buildType] >= 2) {
        const val = 70;
        if (val > bestScore) { bestScore = val; best = { target: t, mode: 'cards' }; }
      }
    }

    // ??C??????????????????????
    const resN = sumRes(t.resources);
    if (resN >= 2) {
      const roundGain = t.roundGained || 0;
      const val = roundGain * 5 + resN * 2;
      if (val > bestScore) { bestScore = val; best = { target: t, mode: 'resources' }; }
    }
  }

  if (best && bestScore >= 20) return { id: best.target.id, mode: best.mode };
  return null;
}

/** ?????? */
function _pickIllegalBuildTarget(game, player) {
  const alive = alivePlayers(game).filter((p) => p.id !== player.id && !p.left);
  let best = null;
  let bestScore = -1;

  for (const t of alive) {
    const built = (t.buildings || []).filter((b) => b.built);
    if (!built.length) continue;

    for (const b of built) {
      let score = (b.score || 0) * 5;
      // ??????????/??/????
      if (b.buildType === 'score2') score += 80;   // ??
      if (b.buildType === 'exchange') score += 60;  // ??
      if (b.buildType === 'wishWell') score += 50;  // ????
      // ????
      const sameStack = built.filter((x) => x.buildType === b.buildType).length;
      if (sameStack >= 2) score += 40;

      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
  }

  return best;
}

/* ?????????? ??/???????????????????????????? */

/**
 * ??????
 * 1. ????????????????????????????/????
 * 2. ????produce ????sameRes >= 1 ??????????bug
 * 3. ????????????game ??bug
 */
function _scoreCardOptionBuilding(player, card, diff, game) {
  const built = (player.buildings || []).filter((b) => b.built);
  const builtMap = {};
  for (const b of built) {
    builtMap[b.buildType] = (builtMap[b.buildType] || 0) + 1;
  }

  // 1. 宫殿 score2：兑换越好越优先入手冲分
  if (card.buildType === 'score2') {
    const canAfford = canPay(player.resources, card.cost || {});
    let base = 50;
    if (game) {
      if (hasLosslessExchange(player, game)) base = 200;
      else if (hasEfficientExchange(player, game)) base = 100;
      const myScore = playerScore(player, game);
      const maxScore = Math.max(...alivePlayers(game).map((p) => playerScore(p, game)));
      if (canAfford && myScore >= maxScore - 4) return Math.max(500, base + 300);
      if (canAfford) return base;
      return Math.floor(base * 0.4);
    }
    if (canAfford) return base;
    return 20;
  }

  if (card.buildType === 'score1') {
    const canAfford = canPay(player.resources, card.cost || {});
    let base = 35;
    if (game) {
      if (hasLosslessExchange(player, game)) base = 120;
      else if (hasEfficientExchange(player, game)) base = 70;
    }
    return canAfford ? base : Math.floor(base * 0.4);
  }

  // 2. 集市：第 2 座冲 1:1 无损兑换最优先
  if (card.buildType === 'exchange') {
    const exCount = builtMap['exchange'] || 0;
    const afterCount = exCount + 1;

    let score = 0;
    if (exCount === 0) score = 240;
    else if (exCount === 1) score = 400; // 建成后 1:1
    else if (exCount === 2) score = 280; // 第 3 座成就
    else score = 0;

    // ??????
    if (game) {
      const rivals = alivePlayers(game).filter((p) => p.id !== player.id && !p.left);
      const rivalMaxEx = Math.max(
        0,
        ...rivals.map((p) => (p.buildings || []).filter((b) => b.built && b.buildType === 'exchange').length)
      );

      if (afterCount >= 3) {
        if (afterCount > rivalMaxEx) {
          score += 45; // ????????????????
        } else if (afterCount === rivalMaxEx) {
          // ???????????? engine ????????????
          if (game.whatYouWantPlayerId === player.id) score += 20; // ????
          else score += 5; // ???????????????
        }
      } else {
        // ???? 3 ????????>= 3 ????????1-2 ??????
        if (rivalMaxEx >= 3 && game.whatYouWantPlayerId && game.whatYouWantPlayerId !== player.id) {
          // ???????????? 1 ??????????
          score -= 50;
        }
      }
    }

    return score;
  }

  // 4. 许愿井 wishWell
  if (card.buildType === 'wishWell') {
    let score = 180;
    if (game) {
      const myTotal = built.filter((b) => b.built && (b.buildType === 'produce' || b.buildType === 'wishWell')).length;
      const afterTotal = myTotal + 1;
      if (afterTotal >= 3) {
        const rivals = alivePlayers(game).filter((p) => p.id !== player.id && !p.left);
        const rivalMax = Math.max(
          0,
          ...rivals.map((p) =>
            (p.buildings || []).filter((b) => b.built && (b.buildType === 'produce' || b.buildType === 'wishWell')).length
          )
        );
        if (afterTotal > rivalMax) score += 45;
        else if (afterTotal === rivalMax) {
          if (game.workshopMasterPlayerId === player.id) score += 20;
          else score += 5;
        }
      }
    }
    return score;
  }

  // 5. ????????????????????sameRes >= 1 ???? >=2/>=3 ??bug??
  if (card.buildType === 'produce' && card.resource) {
    const sameRes = built.filter((b) => b.built && b.buildType === 'produce' && b.resource === card.resource).length;
    const afterSameRes = sameRes + 1; // ????????????

    let score = 155;
    if (afterSameRes >= 2) score = 220; // 2 ??????
    if (afterSameRes >= 3) score = 320; // 3 ??????

    // ??????produce + wishWell >= 3 ????
    if (game) {
      const myTotal = built.filter((b) => b.built && (b.buildType === 'produce' || b.buildType === 'wishWell')).length;
      const afterTotal = myTotal + 1;
      if (afterTotal >= 3) {
        const rivals = alivePlayers(game).filter((p) => p.id !== player.id && !p.left);
        const rivalMax = Math.max(
          0,
          ...rivals.map((p) =>
            (p.buildings || []).filter((b) => b.built && (b.buildType === 'produce' || b.buildType === 'wishWell')).length
          )
        );
        if (afterTotal > rivalMax) score += 45;
        else if (afterTotal === rivalMax) {
          if (game.workshopMasterPlayerId === player.id) score += 20;
          else score += 5;
        }
      }
    }

    return score;
  }

  // ??????
  return (card.score || 0) * 30 + 50;
}

/**
 * ??????
 * ?????? > ?? > ?? > ?? > ?? > ?? > ??
 */
function _scoreCardOptionFunction(player, card, diff) {
  if (diff !== 'hard') {
    // normal ??????
    const fp = {
      robbery: 15, illegalBuild: 15, harvest: 12, redraw: 10,
      recruit: 9, enhance: 8, expand: 7, caravan: 5,
      exile: 4, remoteDice: 4, banditRaid: 3, shelter: 2, welfareHouse: 1,
    };
    return (fp[card.funcType] || 3) * 3;
  }

  // hard ????????
  if (card.funcType === 'enhance') return 350;
  if (card.funcType === 'shelter') return 300;
  if (card.funcType === 'recruit') return 250;
  if (card.funcType === 'redraw') return 200;
  if (card.funcType === 'harvest') return 150;
  if (card.funcType === 'caravan') return 120;
  if (card.funcType === 'robbery') return 100;
  if (card.funcType === 'illegalBuild') return 90;
  if (card.funcType === 'expand') return 80;
  if (card.funcType === 'exile') return 60;
  if (card.funcType === 'remoteDice') return 50;
  if (card.funcType === 'banditRaid') return 40;
  if (card.funcType === 'welfareHouse') return 30;
  return 10;
}

/* ?????????? ???????????normal/easy???????????? */

function decideUseFuncCard(game, player, diff, botState) {
  const cards = player.funcCards || [];
  if (!cards.length) return null;
  if (game.buildPassed && game.buildPassed[player.id]) return null;

  // normal / easy??????????
  const usableTypesEasy = ['harvest', 'recruit', 'enhance', 'expand', 'welfareHouse', 'shelter', 'caravan'];
  for (const c of cards) {
    if (diff === 'easy' && !usableTypesEasy.includes(c.funcType)) continue;
    if (diff === 'normal' && ['robbery', 'illegalBuild'].includes(c.funcType)) {
      // normal ??????????????
      if (c.funcType === 'robbery') {
        const target = _pickRobberyTarget(game, player);
        if (target) {
          return {
            type: 'useFunc',
            payload: { cardId: c.id, targetId: target.id, mode: target.mode },
          };
        }
      }
      if (c.funcType === 'illegalBuild') {
        const alive = alivePlayers(game).filter((p) => p.id !== player.id && !p.left);
        const target = pickRandom(alive);
        if (target) return { type: 'useFunc', payload: { cardId: c.id, targetId: target.id } };
      }
      continue;
    }

    if (c.funcType === 'recruit' && player.villagers < 10 && freeHousesFor(player) > 0) {
      return { type: 'useFunc', payload: { cardId: c.id } };
    }
    if (c.funcType === 'enhance') {
      const canEnh = Math.min(player.villagers || 0, 5) - (player.enhancedDice || 0);
      if (canEnh > 0) return { type: 'useFunc', payload: { cardId: c.id } };
    }
    if (c.funcType === 'harvest' && sumRes(player.resources) < 8) {
      return {
        type: 'useFunc',
        payload: { cardId: c.id, resources: _harvestResourcePicks(player) },
      };
    }
    if (c.funcType === 'expand') {
      const bldCap = maxBuildingsFor(player);
      if ((player.buildings || []).length >= bldCap) {
        let direction = 'building';
        if (shouldExpandResourceHand(player, game, botState)) direction = 'resource';
        else if ((player.funcCards || []).length >= maxFuncHandFor(player)) {
          direction = 'function';
        }
        return { type: 'useFunc', payload: { cardId: c.id, direction } };
      }
    }
    if (c.funcType === 'redraw' && !player.buildTurnUsedRedraw) {
      return { type: 'useFunc', payload: { cardId: c.id } };
    }
    if (['shelter', 'welfareHouse', 'caravan'].includes(c.funcType)) {
      return { type: 'useFunc', payload: { cardId: c.id } };
    }
  }

  return null;
}

/**
 * hard 建造资源检查流水线（严格按优先级，一步只返回一个行动）。
 *
 * 1 购发展卡：手牌≥12、无需兑换、每回合最多 2 次
 * 2 建房：人口已满，且付得起后仍能繁殖（含兑换，兑换不得掏空繁殖粮）
 * 3 建造筑：分数≥7，且有助于称号/分数（含兑换）
 * 4 建房：分数≥8（含兑换）
 * 5 繁殖：无需兑换
 * 6 扩资源格：进建造回合时空位≤5，无需兑换
 * 7 扩建筑格：建筑格已满（含兑换）
 * 8 建造筑：非宫殿，无需兑换
 * 9 繁殖：含兑换
 * 10 建房：分数≥6（含兑换）
 * 11 建造筑：非宫殿，含兑换
 * 12 扩资源格：进建造回合时空位≤3，含兑换
 * 13 建房：含兑换（不看分数）
 * 14 手牌≥6：依次 购卡→建造筑→建房→扩容（全都含兑换）
 *
 * 含兑换的步骤：该动作资源缺口 > 2 就不兑换（不值得做）。
 * 第 3、4 步是冲分，不看缺口。
 * 兑换时尽量留着后续动作还要用的资源，没有别的原料才动用。
 */
function decideBuildActionHard(game, player, botState) {
  botState = botState || {};

  let act =
    _buildTryBuyFunc(game, player, { allowExchange: false, minHand: 12 }) ||
    _buildTryHouseFullPopPreserveBreed(game, player) ||
    _buildTryConstruct(game, player, {
      allowExchange: true,
      ignoreExchangeGap: true,
      minScore: 7,
      requireTitleOrScore: true,
      excludePalace: false,
      step: 3,
    }) ||
    _buildTryHouse(game, player, {
      minScore: 8,
      allowExchange: true,
      ignoreExchangeGap: true,
      step: 4,
    }) ||
    _buildTryBreed(game, player, { allowExchange: false }) ||
    _buildTryExpandResource(game, player, botState, {
      allowExchange: false,
      entryFreeMax: 5,
    }) ||
    _buildTryExpandBuilding(game, player, botState, { allowExchange: true, step: 7 }) ||
    _buildTryConstruct(game, player, {
      allowExchange: false,
      excludePalace: true,
    }) ||
    _buildTryBreed(game, player, { allowExchange: true, step: 9 }) ||
    _buildTryHouse(game, player, { minScore: 6, allowExchange: true, step: 10 }) ||
    _buildTryConstruct(game, player, {
      allowExchange: true,
      excludePalace: true,
      step: 11,
    }) ||
    _buildTryExpandResource(game, player, botState, {
      allowExchange: true,
      entryFreeMax: 3,
      step: 12,
    }) ||
    _buildTryHouse(game, player, { minScore: 0, allowExchange: true, step: 13 });

  if (act) return act;

  if (sumRes(player.resources || {}) >= 6) {
    act =
      _buildTryBuyFunc(game, player, { allowExchange: true, minHand: 0, step: 14 }) ||
      _buildTryConstruct(game, player, {
        allowExchange: true,
        excludePalace: false,
        step: 15,
      }) ||
      _buildTryHouse(game, player, { minScore: 0, allowExchange: true, step: 16 }) ||
      _buildTryExpandResource(game, player, botState, {
        allowExchange: true,
        entryFreeMax: 3,
        step: 17,
      }) ||
      _buildTryExpandBuilding(game, player, botState, { allowExchange: true, step: 18 }) ||
      _buildTryExpandAny(game, player, botState, { allowExchange: true, step: 19 });
    if (act) return act;
  }

  return { type: 'pass' };
}

const BUY_FUNC_PER_TURN_MAX = 2;

function _buyFuncCountThisTurn(player) {
  return Math.max(
    0,
    Number(player.buildTurnBuyFuncCount) || 0,
    player.buildTurnUsedBuyFunc ? 1 : 0
  );
}

function _canBuyFuncThisTurn(player) {
  if (!player) return false;
  if (_buyFuncCountThisTurn(player) >= BUY_FUNC_PER_TURN_MAX) return false;
  if ((player.funcCards || []).length >= maxFuncHandFor(player)) return false;
  return true;
}

function _buildTryBuyFunc(game, player, opts) {
  const allowExchange = Boolean(opts && opts.allowExchange);
  const minHand = opts && opts.minHand != null ? Number(opts.minHand) : 0;
  if (sumRes(player.resources || {}) < minHand) return null;
  if (!_canBuyFuncThisTurn(player)) return null;
  if (canPay(player.resources, BUY_FUNC_COST)) {
    return { type: 'buyFuncCardPermanent' };
  }
  if (allowExchange && _exchangeGapWorthIt(player, BUY_FUNC_COST, opts)) {
    return _exchangeTowardCost(
      game,
      player,
      BUY_FUNC_COST,
      null,
      _laterSoftReserve(game, player, opts && opts.step)
    );
  }
  return null;
}

function _breedFoodReserve(player) {
  if (!player || player.roundBred) return {};
  if ((Number(player.villagers) || 0) >= 15) return {};
  return { food: breedFoodCost(player.villagers) };
}

/** 人口已满时建房；兑换不得掏空繁殖所需粮食 */
function _buildTryHouseFullPopPreserveBreed(game, player) {
  if (!player || player.roundBuiltHouse) return null;
  if (freeHousesFor(player) > 0) return null;
  const reserve = _breedFoodReserve(player);
  if (canPay(player.resources, BUILD_HOUSE_COST)) {
    const after = copyRes(player.resources);
    for (const k of RESOURCES) {
      after[k] = (after[k] || 0) - (Number(BUILD_HOUSE_COST[k]) || 0);
    }
    const need = Number(reserve.food) || 0;
    if (need > 0 && (after.food || 0) < need) {
      // 付完房费后粮不够，但若剩余资源仍能兑出粮则允许
      const fake = { resources: after };
      const gap = need - (after.food || 0);
      if (
        !_canExchangeTo(
          fake,
          effectiveExchangeCost(player, game),
          'food',
          gap
        )
      ) {
        return null;
      }
    }
    return { type: 'buildHousePermanent' };
  }
  if (actionResourceGap(player.resources, BUILD_HOUSE_COST) > 2) return null;
  if (!_canAffordCostViaExchange(game, player, BUILD_HOUSE_COST, reserve)) {
    return null;
  }
  return _exchangeTowardCost(
    game,
    player,
    BUILD_HOUSE_COST,
    reserve,
    _laterSoftReserve(game, player, 2)
  );
}

function _buildTryHouse(game, player, opts) {
  if (!player || player.roundBuiltHouse) return null;
  const minScore = opts && opts.minScore != null ? Number(opts.minScore) : 0;
  const allowExchange = Boolean(opts && opts.allowExchange);
  if (minScore > 0 && playerScore(player, game) < minScore) return null;
  if (canPay(player.resources, BUILD_HOUSE_COST)) {
    return { type: 'buildHousePermanent' };
  }
  if (allowExchange && _exchangeGapWorthIt(player, BUILD_HOUSE_COST, opts)) {
    return _exchangeTowardCost(
      game,
      player,
      BUILD_HOUSE_COST,
      null,
      _laterSoftReserve(game, player, opts && opts.step)
    );
  }
  return null;
}

function _buildTryBreed(game, player, opts) {
  if (!player || player.roundBred) return null;
  if ((Number(player.villagers) || 0) >= 15) return null;
  if (freeHousesFor(player) <= 0) return null;
  const allowExchange = Boolean(opts && opts.allowExchange);
  const foodNeed = breedFoodCost(player.villagers);
  if ((Number(player.resources.food) || 0) >= foodNeed) {
    return { type: 'breedPermanent' };
  }
  if (allowExchange && _exchangeGapWorthIt(player, { food: foodNeed }, opts)) {
    return _exchangeTowardCost(
      game,
      player,
      { food: foodNeed },
      null,
      _laterSoftReserve(game, player, opts && opts.step)
    );
  }
  return null;
}

function _workshopWishCount(player) {
  let n = 0;
  for (const b of player.buildings || []) {
    if (
      b.built &&
      (b.buildType === 'produce' || b.buildType === 'wishWell')
    ) {
      n += 1;
    }
  }
  return n;
}

/** 建成后有助于称号或直接加分 */
function _buildingHelpsTitleOrScore(player, b, game) {
  if (!b || b.built) return false;
  if ((Number(b.score) || 0) > 0) return true;
  if (b.buildType === 'exchange') {
    return countBuiltExchanges(player) < 3;
  }
  if (b.buildType === 'wishWell' || b.buildType === 'produce') {
    return _workshopWishCount(player) < 3;
  }
  // 其它可叠放类型：朝 3 座成就推进
  const key = b.buildType || b.id;
  const n = (player.buildings || []).filter(
    (x) => x.built && (x.buildType || x.id) === key
  ).length;
  if (n >= 1 && n < 3) return true;
  return scoreBuildingForHard(player, b, game) >= 25;
}

function _buildTryConstruct(game, player, opts) {
  const allowExchange = Boolean(opts && opts.allowExchange);
  const excludePalace = Boolean(opts && opts.excludePalace);
  const requireTitleOrScore = Boolean(opts && opts.requireTitleOrScore);
  const minScore = opts && opts.minScore != null ? Number(opts.minScore) : 0;
  if (minScore > 0 && playerScore(player, game) < minScore) return null;

  const cands = (player.buildings || []).filter((b) => {
    if (b.built) return false;
    if (excludePalace && b.buildType === 'score2') return false;
    if (requireTitleOrScore && !_buildingHelpsTitleOrScore(player, b, game)) {
      return false;
    }
    return true;
  });
  if (!cands.length) return null;

  cands.sort(
    (a, b) =>
      scoreBuildingForHard(player, b, game) -
      scoreBuildingForHard(player, a, game)
  );

  for (const b of cands) {
    const cost = b.cost || {};
    if (canPay(player.resources, cost)) {
      return { type: 'construct', payload: { buildingId: b.id } };
    }
  }
  if (!allowExchange) return null;
  for (const b of cands) {
    const cost = b.cost || {};
    if (!_exchangeGapWorthIt(player, cost, opts)) continue;
    const exch = _exchangeTowardCost(
      game,
      player,
      cost,
      null,
      _laterSoftReserve(game, player, opts && opts.step, { skipBuildingId: b.id })
    );
    if (exch) return exch;
  }
  return null;
}

function _buildTryExpandResource(game, player, botState, opts) {
  const allowExchange = Boolean(opts && opts.allowExchange);
  if (opts && opts.entryFreeMax != null) {
    const entry = ensureBuildTurnEntryFree(player);
    if (entry == null || entry > Number(opts.entryFreeMax)) return null;
  } else if (!shouldExpandResourceHand(player, game, botState)) {
    return null;
  }
  if (canPay(player.resources, EXPAND_COST)) {
    markExpandedResource(botState, player);
    return { type: 'expandPermanent', payload: { direction: 'resource' } };
  }
  const freeExpand = (player.funcCards || []).find((c) => c.funcType === 'expand');
  if (freeExpand) {
    markExpandedResource(botState, player);
    return {
      type: 'useFunc',
      payload: { cardId: freeExpand.id, direction: 'resource' },
    };
  }
  if (allowExchange && _exchangeGapWorthIt(player, EXPAND_COST, opts)) {
    const exch = _exchangeTowardCost(
      game,
      player,
      EXPAND_COST,
      null,
      _laterSoftReserve(game, player, opts && opts.step)
    );
    if (exch) return exch;
  }
  return null;
}

function _buildTryExpandBuilding(game, player, botState, opts) {
  if (!buildingSlotsTight(player)) return null;
  const allowExchange = Boolean(opts && opts.allowExchange);
  if (canPay(player.resources, EXPAND_COST)) {
    return { type: 'expandPermanent', payload: { direction: 'building' } };
  }
  const freeExpand = (player.funcCards || []).find((c) => c.funcType === 'expand');
  if (freeExpand) {
    return {
      type: 'useFunc',
      payload: { cardId: freeExpand.id, direction: 'building' },
    };
  }
  if (allowExchange && _exchangeGapWorthIt(player, EXPAND_COST, opts)) {
    const exch = _exchangeTowardCost(
      game,
      player,
      EXPAND_COST,
      null,
      _laterSoftReserve(game, player, opts && opts.step)
    );
    if (exch) return exch;
  }
  return null;
}

/** 手牌高压兜底：任意方向扩容。资源方向仍受进场空位≤3 约束，避免绕过第 12 步。 */
function _buildTryExpandAny(game, player, botState, opts) {
  const allowExchange = Boolean(opts && opts.allowExchange);
  const entry = ensureBuildTurnEntryFree(player);
  const wantResource = entry != null && entry <= 3;
  const wantBuilding = buildingSlotsTight(player);
  const wantFunc = (player.funcCards || []).length >= maxFuncHandFor(player);
  if (canPay(player.resources, EXPAND_COST)) {
    let dir = 'building';
    if (wantBuilding) dir = 'building';
    else if (wantFunc) dir = 'function';
    else if (wantResource) dir = 'resource';
    else return null;
    if (dir === 'resource') markExpandedResource(botState, player);
    return { type: 'expandPermanent', payload: { direction: dir } };
  }
  if (
    allowExchange &&
    (wantResource || wantBuilding || wantFunc) &&
    _exchangeGapWorthIt(player, EXPAND_COST, opts)
  ) {
    return _exchangeTowardCost(
      game,
      player,
      EXPAND_COST,
      null,
      _laterSoftReserve(game, player, opts && opts.step)
    );
  }
  return null;
}

/**
 * 建造行动：溢出处理 →（hard 严格流水线）/（normal·easy 简化）→ pass
 */
function decideBuildAction(game, player, diff, botState) {
  if (game.buildPassed && game.buildPassed[player.id]) return null;
  botState = botState || {};
  ensureBuildTurnEntryFree(player);

  const overflow = decideResourceOverflow(game, player, diff, botState);
  if (overflow) return overflow;

  if (diff === 'hard') {
    const useFunc = decideUseFuncCardHard(game, player, botState);
    if (useFunc) return useFunc;
    return decideBuildActionHard(game, player, botState);
  }

  const useFunc = decideUseFuncCard(game, player, diff, botState);
  if (useFunc) return useFunc;

  // normal/easy：空位≤9 也扩资源位
  if (
    shouldExpandResourceHand(player, game, botState) &&
    canPay(player.resources, EXPAND_COST)
  ) {
    markExpandedResource(botState, player);
    return { type: 'expandPermanent', payload: { direction: 'resource' } };
  }
  if (shouldExpandResourceHand(player, game, botState)) {
    const exch = _exchangeTowardCost(game, player, EXPAND_COST);
    if (exch) return exch;
  }

  const canHouse =
    canPay(player.resources, BUILD_HOUSE_COST) && !player.roundBuiltHouse;
  const canBreed =
    !player.roundBred &&
    player.villagers < 15 &&
    freeHousesFor(player) > 0 &&
    (player.resources.food || 0) >= breedFoodCost(player.villagers);

  if (diff === 'easy') {
    if (canBreed) return { type: 'breedPermanent' };
    if (canHouse) return { type: 'buildHousePermanent' };
  } else {
    if (shouldPrioritizeHouse(player, game) && !player.roundBuiltHouse) {
      if (canHouse) return { type: 'buildHousePermanent' };
      if (_canAffordCostViaExchange(game, player, BUILD_HOUSE_COST)) {
        const exch = _exchangeTowardCost(game, player, BUILD_HOUSE_COST);
        if (exch) return exch;
      }
    }
    if (canHouse) return { type: 'buildHousePermanent' };
    if (canBreed) return { type: 'breedPermanent' };
    if (_canBreedNowOrViaExchange(game, player)) {
      const foodNeed = breedFoodCost(player.villagers);
      const exch = _exchangeTowardCost(game, player, { food: foodNeed });
      if (exch) return exch;
    }
  }

  const needExpand =
    (player.buildings || []).length >= maxBuildingsFor(player) ||
    (player.funcCards || []).length >= maxFuncHandFor(player);
  if (needExpand && canPay(player.resources, EXPAND_COST)) {
    const bldOverflow =
      (player.buildings || []).length >= maxBuildingsFor(player);
    const funcOverflow =
      (player.funcCards || []).length >= maxFuncHandFor(player);
    let dir = 'building';
    if (funcOverflow && !bldOverflow) dir = 'function';
    else if (!funcOverflow && bldOverflow) dir = 'building';
    else
      dir =
        (player.buildings || []).filter((b) => !b.built).length > 0
          ? 'building'
          : 'function';
    return { type: 'expandPermanent', payload: { direction: dir } };
  }

  const buildable = (player.buildings || []).filter(
    (b) => !b.built && canPay(player.resources, b.cost || {})
  );
  if (buildable.length) {
    if (diff === 'easy') {
      buildable.sort((a, b) => (b.score || 0) - (a.score || 0));
      return { type: 'construct', payload: { buildingId: buildable[0].id } };
    }
    buildable.sort(
      (a, b) =>
        scoreBuildingForNormal(player, b) - scoreBuildingForNormal(player, a)
    );
    return { type: 'construct', payload: { buildingId: buildable[0].id } };
  }
  if (diff === 'normal' && hasEfficientExchange(player, game)) {
    const almost = (player.buildings || [])
      .filter((b) => !b.built && !canPay(player.resources, b.cost || {}))
      .filter((b) => _canAffordCostViaExchange(game, player, b.cost || {}))
      .sort(
        (a, b) =>
          scoreBuildingForNormal(player, b) - scoreBuildingForNormal(player, a)
      );
    if (almost.length) {
      const exch = _exchangeTowardCost(game, player, almost[0].cost || {});
      if (exch) return exch;
    }
  }

  if (
    diff === 'normal' &&
    _canBuyFuncThisTurn(player) &&
    (prefersBuyFuncSink(player, game) || hasLosslessExchange(player, game))
  ) {
    if (canPay(player.resources, BUY_FUNC_COST)) {
      return { type: 'buyFuncCardPermanent' };
    }
    if (_canAffordCostViaExchange(game, player, BUY_FUNC_COST)) {
      const exch = _exchangeTowardCost(game, player, BUY_FUNC_COST);
      if (exch) return exch;
    }
  }

  const spend = decideSpendBeforePass(game, player, diff, botState);
  if (spend) return spend;

  return { type: 'pass' };
}

/* ?????????? ????????????????? */

function decidePendingAction(game, player, diff, botState) {
  // pendingRedrawChoice?????????1 ????
  if (game.pendingRedrawChoice && game.pendingRedrawChoice.playerId === player.id) {
    const options = game.pendingRedrawChoice.options || [];
    if (!options.length) return { type: 'redrawPick', payload: { cardId: null } };
    // ????????????????????
    // ??????????????????
    if (diff === 'easy') {
      const pick = pickRandom(options);
      return { type: 'redrawPick', payload: { keepId: pick ? pick.id : null } };
    }
    // normal / hard?????????
    let best = options[0];
    let bestScore = -Infinity;
    for (const c of options) {
      let sc = 0;
      if (c.kind === 'building') {
        sc = _scoreCardOptionBuilding(player, c, diff, game);
      } else if (c.kind === 'function') {
        sc = _scoreCardOptionFunction(player, c, diff);
      }
      if (sc > bestScore) {
        bestScore = sc;
        best = c;
      }
    }
    return { type: 'redrawPick', payload: { keepId: best ? best.id : null } };
  }

  // pendingWelfareMinimumChoices ??????
  if (game.pendingWelfareMinimumChoices && game.pendingWelfareMinimumChoices[player.id]) {
    const count = game.pendingWelfareMinimumChoices[player.id].count || 2;
    // ??????
    const needs = estimateResourceNeeds(player);
    const needRes = pickMostNeededResource(player, needs) || 'wood';
    return { type: 'eventPickTwoResources', payload: { amounts: { [needRes]: count } } };
  }

  // pendingEventChoice ?????
  if (game.pendingEventChoice && game.pendingEventChoice.playerId === player.id) {
    return decideEventChoice(game, player, diff, botState);
  }

  // pendingIllegalBuild / pendingRobberyPick????????????????????
  if (game.pendingIllegalBuild && game.pendingIllegalBuild.targetId === player.id) {
    // 目标玩家只能选建筑；无已建造筑时返回 null，由 forceTimeout 清 pending
    const built = (player.buildings || []).filter((b) => b.built);
    if (built.length) {
      built.sort((a, b) => (a.score || 0) - (b.score || 0));
      return { type: 'illegalBuildPick', payload: { buildingId: built[0].id } };
    }
    return null;
  }

  if (game.pendingRobberyPick && game.pendingRobberyPick.targetId === player.id) {
    // 目标只能交牌；无牌时返回 null，由 forceTimeout 清 pending（cancel 仅发动者可用）
    const cards = player.funcCards || [];
    const options = game.pendingRobberyPick.options || [];
    if (options.length) {
      const ids = new Set(options.map((o) => o.id));
      const fromFunc = cards.find((c) => ids.has(c.id));
      if (fromFunc) {
        return { type: 'robberyPick', payload: { cardId: fromFunc.id } };
      }
      return { type: 'robberyPick', payload: { cardId: options[0].id } };
    }
    return null;
  }

  // pendingTrade：仅被邀请方决策；一律拒绝以免卡流程（详细估价保留在下方死代码前）
  if (game.pendingTrade && game.pendingTrade.toId === player.id) {
    if (diff === 'hard') {
      const trade = game.pendingTrade;
      const give = trade.take || {};
      const get = trade.give || {};
      const need = estimateResourceNeeds(player);
      let getVal = 0;
      let giveVal = 0;
      for (const r of RESOURCES) {
        getVal += (get[r] || 0) * ((need[r] || 0) > 0 ? 2 : 1);
        giveVal += (give[r] || 0) * ((need[r] || 0) > 0 ? 2 : 1);
      }
      if (getVal >= giveVal) return { type: 'acceptTrade' };
    }
    return { type: 'rejectTrade' };
  }

  // wish well ????????
  if (game.phase === 'wish_well' && player.pendingWishWellBonus > 0) {
    const need = player.pendingWishWellBonus;
    const needs = estimateResourceNeeds(player);
    const alloc = {};
    let left = need;
    for (const r of RESOURCES) {
      const want = Math.min(left, Math.max(0, (needs[r] || 0)));
      alloc[r] = want;
      left -= want;
    }
    if (left > 0) alloc.wood = (alloc.wood || 0) + left;
    return { type: 'allocateWishWell', payload: { alloc } };
  }

  // 结算弃牌 / 建造前爆牌：功能卡、未建建筑、超限资源
  if (
    player.pendingDiscardFunc ||
    player.pendingDiscardBuild ||
    (player.funcCards || []).length > maxFuncHandFor(player)
  ) {
    const d = decidePendingDiscard(game, player, diff, botState);
    if (d) return d;
  }
  if (player.pendingDiscardRes && game.phase === 'settle_act') {
    const over =
      sumRes(player.resources || {}) - maxResourceHandFor(player);
    if (over > 0) {
      const amounts = _pickDiscardResourceAmounts(
        game,
        player,
        over,
        botState
      );
      if (Object.keys(amounts).length) {
        return { type: 'discardResources', payload: { amounts } };
      }
    }
  }

  return null;
}

/* ?????????? ?????????????????? */

function decideEventChoice(game, player, diff, _botState) {
  const ev = game.pendingEventChoice;
  if (!ev) return null;
  const need = ev.needChoice;

  // 1. ??????????????????/???????????/??????
  if (need === 'pickTwoResources' || need === 'pickResource') {
    const needs = estimateResourceNeeds(player);
    const needRes = pickMostNeededResource(player, needs) || 'wood';
    if (need === 'pickTwoResources') {
      const count = ev.count || 2;
      return { type: 'eventPickTwoResources', payload: { amounts: { [needRes]: count } } };
    }
    return { type: 'eventPickResource', payload: { resource: needRes } };
  }

  // 2. ??????????
  if (need === 'moveNeutral') {
    return _decideEnterFrayMove(game, player, ev, diff);
  }

  // 3. ??????????????
  if (need === 'moveBarrenMarker') {
    return _decideBarrenMarkerMove(game, player, ev, diff);
  }

  // 4. ????
  if (need === 'recallDie') {
    return _decideRecallDie(game, player, ev, diff);
  }

  // 5. ??????source????target????
  if (need === 'teleportDie') {
    return _decideTeleport(game, player, ev, diff);
  }

  // 6. ??????????
  if (need === 'gatherNeutrals') {
    // ????????????????????????????????????...??
    // ?????gather ????????????????????
    return _decideGatherNeutrals(game, player, ev, diff);
  }

  // ??
  return null;
}

/**
 * 以身入局：选择中立落点（与估值同一套对冲逻辑）。
 */
function _decideEnterFrayMove(game, player, ev, diff) {
  const fromNumber = Number(ev.number) || Number(ev.fromNumber) || 1;
  const maxMove = Math.min(
    neutralCountOn(game, 'resource', fromNumber),
    Math.max(1, Number(ev.count) || 1)
  );

  if (diff !== 'easy') {
    let bestTarget = null;
    let bestScore = -Infinity;
    for (const area of BOARD_AREAS) {
      for (let num = 1; num <= 6; num++) {
        const sc = _scoreEnterFrayNeutralDrop(
          game,
          player,
          area,
          num,
          maxMove,
          fromNumber
        );
        if (sc > bestScore) {
          bestScore = sc;
          bestTarget = { area, number: num };
        }
      }
    }
    if (bestTarget && bestScore > -20) {
      return {
        type: 'eventMoveNeutral',
        payload: { area: bestTarget.area, number: bestTarget.number },
      };
    }
  }

  // 兜底：避开自己有骰的格
  for (const num of [1, 2, 3, 4, 5, 6]) {
    if (num === fromNumber) continue;
    const wk = slotWorkers(game.board && game.board.resource, num);
    let hasMe = false;
    for (const [pid, c] of Object.entries(wk)) {
      if (pid === player.id && c > 0) hasMe = true;
    }
    if (!hasMe) {
      return { type: 'eventMoveNeutral', payload: { area: 'resource', number: num } };
    }
  }

  const fallback = fromNumber === 1 ? 2 : 1;
  return { type: 'eventMoveNeutral', payload: { area: 'resource', number: fallback } };
}

/**
 * ???????????????????
 * ???????????????????
 * ????????> ?????? large ????> ??????
 */
function _decideBarrenMarkerMove(game, player, ev, diff) {
  const board = game.board && game.board.resource;
  const envs = board && board.environments;

  // ??????????????
  if (diff !== 'easy') {
    let bestTarget = null;
    let bestScore = -Infinity;

    for (const num of [1, 2, 3, 4, 5, 6]) {
      const env = envs && envs[num];
      const wk = board ? (board.workers[num] || {}) : {};
      let score = 0;

      // ??1?????????????
      // ?????? ??????????????
      if (env && env.envType === 'mercenaries') {
        // ????????????????????????????
        let hasChance = false;
        let bestRival = 0;
        for (const [pid, c] of Object.entries(wk)) {
          if (pid === '__neutral__') continue;
          if (pid === player.id) continue;
          if (c > bestRival) bestRival = c;
        }
        if (bestRival > 0) {
          score += 120; // ??????????
          // ???????????????
          const myCount = wk[player.id] || 0;
          if (bestRival > myCount) score += 40;
        }
      }

      // ??2?????? large ?????
      let rivalFirst = false;
      let bestRival = 0;
      let myCount = wk[player.id] || 0;
      for (const [pid, c] of Object.entries(wk)) {
        if (pid === '__neutral__' || pid === player.id) continue;
        if (c > bestRival) { bestRival = c; }
      }
      if (bestRival > myCount) {
        // ??????????
        rivalFirst = true;
        const tiles = tilesOnNumber(board, num);
        let largeTotal = 0;
        let smallTotal = 0;
        for (const t of tiles) {
          largeTotal += t.large || 0;
          smallTotal += t.small || 0;
        }
        // ???? ??????large+small ??0?? small ??0??
        score += (largeTotal + smallTotal) * 8 * selfGainFactor(game) + 20;
      }

      // ??3???????????????????????????
      // ????????????
      if (score === 0) {
        const tiles = tilesOnNumber(board, num);
        let value = 0;
        for (const t of tiles) value += (t.large || 0) + (t.small || 0);
        if (value > 0) score = value * 3;
      }

      if (score > bestScore) {
        bestScore = score;
        bestTarget = { area: 'resource', number: num };
      }
    }

    if (bestTarget) {
      return { type: 'eventMoveBarrenMarker', payload: bestTarget };
    }
  }

  // ????????????????
  for (const num of [1, 2, 3, 4, 5, 6]) {
    const tiles = tilesOnNumber(board, num);
    if (tiles.length) {
      return { type: 'eventMoveBarrenMarker', payload: { area: 'resource', number: num } };
    }
  }
  return { type: 'eventMoveBarrenMarker', payload: { area: 'resource', number: 1 } };
}

/**
 * ???????????????????
 */
function _decideRecallDie(game, player, ev, diff) {
  const excludeArea = ev.excludeArea;
  const excludeNumber = Number(ev.excludeNumber);
  // ???????????????
  let bestTarget = null;
  let worstScore = Infinity;
  for (const area of BOARD_AREAS) {
    for (let num = 1; num <= 6; num++) {
      if (area === excludeArea && num === excludeNumber) continue;
      const board = game.board && game.board[area];
      const wk = board && board.workers && board.workers[num];
      const myCount = (wk && wk[player.id]) || 0;
      if (myCount <= 0) continue;
      // ?????????????????
      const est = estimateProduceGain(game, player, area, num, 0, 0);
      let score = est.self * 8 * selfGainFactor(game);
      // ??????????????
      const neutral = (wk && wk.__neutral__) || 0;
      if (neutral >= myCount) score -= 30;
      if (score < worstScore) {
        worstScore = score;
        bestTarget = { area, number: num };
      }
    }
  }
  if (bestTarget) {
    return { type: 'eventRecallDie', payload: { area: bestTarget.area, number: bestTarget.number } };
  }
  return null;
}

/**
 * 传送落点评分：moverId 的 1 枚骰落到 toArea/toNumber。
 * 自己的骰：优先去「新独占」空格 / 抢功能区高价值；已是第一的格加码几乎无收益。
 * 对手骰绝不能帮对方抢第一；中立骰优先用来拆对手。
 */
function _scoreTeleportDestination(game, player, toArea, toNumber, moverId, diff) {
  const board = game.board && game.board[toArea];
  if (!board) return -Infinity;
  const tiles = tilesOnNumber(board, toNumber);
  if (!tiles.length) return -Infinity;

  const openMax =
    toArea === 'special'
      ? Math.min(6, 2 + Math.floor((Math.max(1, Number(game.round) || 1) - 1) / 2))
      : 6;
  if (toNumber > openMax) return -Infinity;

  const beforeWk = {
    ...(board.workers && board.workers[toNumber] ? board.workers[toNumber] : {}),
  };
  const boosts = { ...((board.boosts && board.boosts[toNumber]) || {}) };
  const beforeStrength = _slotStrengthLocal(beforeWk, boosts);
  const beforeRemain = _cancelEqualCountsLocal(beforeStrength);
  const beforeRanked = Object.entries(beforeRemain).sort((a, b) => b[1] - a[1]);
  const beforeAiFirst = beforeRanked[0] && beforeRanked[0][0] === player.id;

  const wk = { ...beforeWk };
  wk[moverId] = (Number(wk[moverId]) || 0) + 1;
  const strength = _slotStrengthLocal(wk, boosts);
  const remain = _cancelEqualCountsLocal(strength);
  const ranked = Object.entries(remain).sort((a, b) => b[1] - a[1]);
  let moverRank = 2;
  for (let i = 0; i < ranked.length; i++) {
    if (ranked[i][0] === moverId) {
      moverRank = i;
      break;
    }
  }
  if (!remain[moverId]) moverRank = 2;
  const afterAiFirst = ranked[0] && ranked[0][0] === player.id;
  const aiCancelled = beforeAiFirst && !remain[player.id];

  const isSelf = moverId === player.id;
  const isNeutral = moverId === '__neutral__';
  const hasEnhance = tiles.some((t) => t.funcType === 'enhance');
  const hasRecruit = tiles.some((t) => t.funcType === 'recruit');
  const hasShelter = tiles.some((t) => t.funcType === 'shelter');

  let large = 0;
  let small = 0;
  for (const t of tiles) {
    large += t.large || 0;
    small += t.small || 0;
  }

  if (!isSelf) {
    // 拆掉自己原本的第一名 → 大负分
    if (aiCancelled || (beforeAiFirst && !afterAiFirst)) {
      return -110 - large * 8;
    }

    if (!isNeutral) {
      // —— 移动对手的骰：绝不能帮对方独占/拿第一 ——
      if (moverRank === 0) {
        if (toArea === 'special') {
          return -160 - (hasEnhance ? 90 : 30);
        }
        return -100 - large * 14;
      }
      if (moverRank === 1) {
        return -20 - small * 5;
      }
      // 对冲掉 / 无名次：可接受的「寄放」
      return 6;
    }

    // —— 移动中立：用来拆对手第一 ——
    const beforeRivalFirst =
      beforeRanked[0] &&
      beforeRanked[0][0] !== player.id &&
      beforeRanked[0][0] !== '__neutral__';
    const rivalId = beforeRivalFirst ? beforeRanked[0][0] : null;
    if (rivalId && beforeRivalFirst && !remain[rivalId]) {
      return 55 + large * 6 * selfGainFactor(game);
    }
    // 中立落到空格自己「假独占」无意义
    if (moverRank === 0 && toArea === 'special') return -30;
    if (Object.keys(beforeWk).length === 0) return -8;
    return 4;
  }

  // —— 传送自己的骰 ——
  if (toArea === 'special') {
    if (moverRank !== 0) {
      return hasEnhance ? 8 : 2;
    }
    // 已是第一再加码：几乎无新增牌权
    if (beforeAiFirst) {
      return hasEnhance ? 6 : 1;
    }
    let score = estimateSpecialClaimValue(game, player, toNumber, 0, diff);
    if (hasEnhance) score += 55;
    if (hasRecruit) score += 18;
    if (hasShelter) score += 14;
    return score;
  }

  let score = 0;
  const factor = selfGainFactor(game);
  const env = envOnResourceSlot(game, toNumber);
  if (moverRank === 0) {
    if (!beforeAiFirst) {
      // 新拿到第一 / 新独占空格：计满大份
      score += large * 8 * factor;
      // 空格新独占额外加分
      const beforeOthers = Object.entries(beforeWk).filter(
        ([pid, c]) => pid !== player.id && (Number(c) || 0) > 0
      );
      if (!beforeOthers.length) score += 18;
    } else {
      // 本已是第一：大份不再重复计入，只看边际（先到先得门槛等）
      score += 3;
    }
  } else if (moverRank === 1) {
    score += small * 8 * factor;
  } else {
    score -= 12;
  }

  if (env && env.envType === 'mercenaries' && moverRank === 0 && !beforeAiFirst) {
    score += estimateMercenariesClaimValue(game, player, env, diff) * 0.85;
  }
  if (diff !== 'easy') {
    const settleRank = moverRank === 0 ? 0 : moverRank === 1 ? 1 : 2;
    // 派遣类：只有「成为最大」类首次触发才值钱；已是第一再加码通常不触发
    if (
      envTriggersDispatch(env) &&
      envHasDispatchEffect(env && env.envType) &&
      !(beforeAiFirst && moverRank === 0)
    ) {
      score += estimateEventDispatchGain(game, player, toNumber, 1, settleRank) * 0.6;
    }
    // 先到先得：差枚数时加码有边际
    if (env && env.envType === 'firstCome' && !env.stashClaimed) {
      const required =
        env.firstComeRequired != null
          ? Number(env.firstComeRequired)
          : firstComeRequiredWorkers(game.round);
      const myAfter = Number(wk[player.id]) || 0;
      const myBefore = Number(beforeWk[player.id]) || 0;
      if (myBefore < required && myAfter >= required) {
        score += estimateEventDispatchGain(game, player, toNumber, 1, settleRank);
      } else if (myAfter < required) {
        score += 4;
      }
    } else if (!(beforeAiFirst && moverRank === 0)) {
      score += estimateEventSettleGain(game, player, toNumber, settleRank) * 0.75;
    }
  }
  return score;
}

/** 从某格挪走 targetId 一枚后，对「我」的局势收益（拆对手 / 自己变第一 / 自拆独占代价） */
function _scoreTeleportFromRemoval(game, player, fromArea, fromNumber, targetId, diff) {
  void diff;
  const board = game.board && game.board[fromArea];
  if (!board) return 0;
  const tiles = tilesOnNumber(board, fromNumber);
  const beforeWk = {
    ...(board.workers && board.workers[fromNumber] ? board.workers[fromNumber] : {}),
  };
  if ((Number(beforeWk[targetId]) || 0) <= 0) return 0;
  const boosts = { ...((board.boosts && board.boosts[fromNumber]) || {}) };

  const beforeStrength = _slotStrengthLocal(beforeWk, boosts);
  const beforeRemain = _cancelEqualCountsLocal(beforeStrength);
  const beforeRanked = Object.entries(beforeRemain).sort((a, b) => b[1] - a[1]);

  const afterWk = { ...beforeWk };
  afterWk[targetId] = (Number(afterWk[targetId]) || 0) - 1;
  if (afterWk[targetId] <= 0) delete afterWk[targetId];
  const afterBoosts = { ...boosts };
  if (afterBoosts[targetId]) {
    afterBoosts[targetId] = Math.max(0, (Number(afterBoosts[targetId]) || 0) - 1);
    if (!afterBoosts[targetId]) delete afterBoosts[targetId];
  }
  const afterRemain = _cancelEqualCountsLocal(_slotStrengthLocal(afterWk, afterBoosts));
  const afterRanked = Object.entries(afterRemain).sort((a, b) => b[1] - a[1]);

  let large = 0;
  for (const t of tiles) large += t.large || 0;
  let score = 0;
  const factor = selfGainFactor(game);

  const beforeFirst = beforeRanked[0] ? beforeRanked[0][0] : null;
  const afterFirst = afterRanked[0] ? afterRanked[0][0] : null;

  // 挪自己的骰：丢掉独占/第一名要付代价
  if (targetId === player.id) {
    if (beforeFirst === player.id && afterFirst !== player.id) {
      // 失去第一 / 整格清空 → 按该格大份重罚
      score -= fromArea === 'special' ? 55 : 32 + large * 8 * factor;
      return score;
    }
    if (beforeFirst === player.id && afterFirst === player.id) {
      // 仍第一但变薄：轻罚（除非已是稳固多枚）
      const myAfter = Number(afterRemain[player.id]) || 0;
      const second = afterRanked[1] ? afterRanked[1][1] : 0;
      score -= myAfter <= second + 1 ? 10 : 3;
      return score;
    }
    // 本就不是第一：允许撤出重配
    return 6;
  }

  // 拆掉对手第一 → 自己变第一
  if (beforeFirst === targetId && afterFirst === player.id) {
    if (fromArea === 'special') score += 70;
    else score += 35 + large * 8 * factor;
  } else if (beforeFirst === targetId && afterFirst !== targetId) {
    // 仅拆掉对手独占
    score += fromArea === 'special' ? 40 : 18 + large * 4;
  } else if (afterFirst === player.id && beforeFirst !== player.id) {
    score += fromArea === 'special' ? 50 : 22 + large * 6;
  }

  return score;
}

function _listTeleportFromCandidates(game) {
  const out = [];
  for (const area of BOARD_AREAS) {
    const board = game.board && game.board[area];
    if (!board) continue;
    const workers = board.workers || {};
    for (let num = 1; num <= 6; num++) {
      const wk = workers[num] || {};
      for (const [targetId, c] of Object.entries(wk)) {
        if ((Number(c) || 0) > 0) {
          out.push({ area, number: num, targetId });
        }
      }
    }
  }
  return out;
}

/** 传送来源骰种类：混有时自己优先挪普通（留强化保强度），对手优先挪强化 */
function _pickTeleportEnhanced(game, area, number, targetId, selfId) {
  if (targetId === '__neutral__') return false;
  const board = game.board && game.board[area];
  if (!board) return false;
  const physical = Number((board.workers && board.workers[number] && board.workers[number][targetId]) || 0);
  if (physical <= 0) return false;
  const boost = Math.min(
    Math.max(
      0,
      Number(
        (board.boosts && board.boosts[number] && board.boosts[number][targetId]) || 0
      )
    ),
    physical
  );
  const normal = physical - boost;
  if (boost <= 0) return false;
  if (normal <= 0) return true;
  return targetId !== selfId;
}

function _bestTeleportDestination(game, player, fromArea, fromNumber, moverId, diff) {
  let best = null;
  let bestScore = -Infinity;
  for (const area of BOARD_AREAS) {
    for (let num = 1; num <= 6; num++) {
      if (area === fromArea && num === fromNumber) continue;
      const sc = _scoreTeleportDestination(game, player, area, num, moverId, diff);
      if (sc > bestScore) {
        bestScore = sc;
        best = { area, number: num, score: sc };
      }
    }
  }
  return best;
}

/**
 * 传送：先选来源（须带 targetId），再选落点。
 * 优先：多枚中挪一枚去新独占空格；中立对冲对手；绝不拆自己独占去加码已占优格。
 */
function _decideTeleport(game, player, ev, diff) {
  const step = ev.teleportStep || 'from';

  if (step === 'from') {
    const cands = _listTeleportFromCandidates(game);
    if (!cands.length) return null;

    let best = null;
    let bestScore = -Infinity;
    for (const from of cands) {
      const dest = _bestTeleportDestination(
        game,
        player,
        from.area,
        from.number,
        from.targetId,
        diff
      );
      let sc = dest ? dest.score : -100;
      sc += _scoreTeleportFromRemoval(
        game,
        player,
        from.area,
        from.number,
        from.targetId,
        diff
      );
      // 轻偏好：自己有余量可挪 / 中立可对冲；不再无脑 +12 自骰
      if (from.targetId === player.id) {
        const board = game.board && game.board[from.area];
        const myCnt =
          (board &&
            board.workers &&
            board.workers[from.number] &&
            Number(board.workers[from.number][player.id])) ||
          0;
        sc += myCnt >= 2 ? 8 : 1;
      } else if (from.targetId === '__neutral__') {
        sc += dest && dest.score >= 40 ? 10 : 3;
      }
      // 对手骰：若最佳落点仍是大负分，整条候选作废
      if (from.targetId !== player.id && from.targetId !== '__neutral__') {
        if (!dest || dest.score < 0) sc -= 50;
      }
      if (sc > bestScore) {
        bestScore = sc;
        best = from;
      }
    }
    if (!best) best = cands[0];
    return {
      type: 'eventTeleportFrom',
      payload: {
        area: best.area,
        number: best.number,
        targetId: best.targetId,
        enhanced: _pickTeleportEnhanced(
          game,
          best.area,
          best.number,
          best.targetId,
          player.id
        ),
      },
    };
  }

  if (step === 'to') {
    const fromArea = ev.fromArea;
    const fromNumber = Number(ev.fromNumber);
    const moverId = ev.fromTargetId;
    if (!moverId || !BOARD_AREAS.includes(fromArea)) {
      return null;
    }
    const dest = _bestTeleportDestination(
      game,
      player,
      fromArea,
      fromNumber,
      moverId,
      diff
    );
    if (!dest) return null;
    // 对手骰若所有落点都在帮对方，宁可寄放到最不糟的格（仍选 max，但已大幅为负时至少避开肥独占）
    return {
      type: 'eventTeleportTo',
      payload: { area: dest.area, number: dest.number },
    };
  }

  return null;
}

/**
 * ??????????
 */
function _decideGatherNeutrals(game, player, ev, diff) {
  // ????"??"??????????????
  // ????gatherNeutrals ????????????...
  // ???????????????
  for (const area of BOARD_AREAS) {
    for (let num = 1; num <= 6; num++) {
      const board = game.board && game.board[area];
      const wk = board && board.workers && board.workers[num];
      if (!wk || !wk.__neutral__) continue;
      let hasRival = false;
      for (const [pid, c] of Object.entries(wk)) {
        if (pid !== player.id && pid !== '__neutral__' && c > 0) hasRival = true;
      }
      if (hasRival) {
        return { type: 'eventGatherNeutrals', payload: { area, number: num } };
      }
    }
  }
  return { type: 'eventGatherNeutrals', payload: { area: 'resource', number: 1 } };
}

/* ?????????? ?????? ?????????? */

function decideProducePhase(game, player, diff, botState) {
  // ????
  if (game.awaitingProduceRoll) {
    return { type: 'produceRoll' };
  }

  // ??????????????/?????????????????
  if (diff === 'hard') {
    const funcExile = (player.funcCards || []).find((c) => c.funcType === 'exile');
    const funcBandit = (player.funcCards || []).find((c) => c.funcType === 'banditRaid');
    const funcRemote = (player.funcCards || []).find((c) => c.funcType === 'remoteDice');
    const idle = idleVillagers(player);

    // ?? ?????????????????? ??
    if (funcExile) {
      const bestExile = _decideExileHard(game, player, funcExile);
      if (bestExile) return bestExile;
    }

    // ?? ??????????????????????
    if (funcBandit && idle <= 0) {
      const bestBandit = _decideBanditHard(game, player, funcBandit);
      if (bestBandit) return bestBandit;
    }

    // ?? ????????????????????
    if (funcRemote) {
      const bestRemote = _decideRemoteHard(game, player, funcRemote);
      if (bestRemote) return bestRemote;
    }
  }

  // ????
  const place = decidePlaceDice(game, player, diff, botState);
  if (place) return place;

  return null;
}

/**
 * ????????????????????????????
 */
function _decideExileHard(game, player, funcCard) {
  const dice = game.dice && game.dice[player.id] ? game.dice[player.id] : [];
  const idle = idleVillagers(player);
  const isLast = idle <= 0; // ????????

  for (let face = 1; face <= 6; face++) {
    if (!dice.includes(face)) continue;
    for (const area of BOARD_AREAS) {
      const board = game.board && game.board[area];
      if (!board) continue;
      const wk = slotWorkers(board, face);

      // ??????face????
      let rivalTotal = 0;
      let myCount = 0;
      let bestRival = 0;
      let bestRivalId = null;
      let neutral = wk.__neutral__ || 0;
      for (const [id, n] of Object.entries(wk)) {
        if (id === '__neutral__') continue;
        if (id === player.id) { myCount += n; continue; }
        rivalTotal += n;
        if (n > bestRival) { bestRival = n; bestRivalId = id; }
      }

      // ??1????????????????????
      // ???????????? + ??????????
      if (myCount > 0 && bestRivalId && bestRival > myCount && !isLast) {
        return { type: 'useFunc', payload: { cardId: funcCard.id, area, number: face } };
      }

      // ??2??????????????????????/????????
      if (isLast && bestRivalId && bestRival >= 1) {
        const otherRival = rivalTotal - bestRival;
        // ????????????????????????
        // ??A: myCount>0, bestRival?????????
        if (myCount > 0 && bestRival >= myCount) {
          // ??????? myCount > otherRival??????
          if (myCount > otherRival + neutral) {
            return { type: 'useFunc', payload: { cardId: funcCard.id, area, number: face } };
          }
        }
        // ??B: ??????????????????
        if (otherRival > 0 && bestRival === otherRival && myCount === 0) {
          // ???????????..??????
          // ??C: myCount>0, ??? opponentCount == myCount????????
        }
      }
    }
  }
  return null;
}

/**
 * ????????????????????
 */
function _decideBanditHard(game, player, funcCard) {
  // ????????/????????
  const envs = (game.board && game.board.resource && game.board.resource.environments) || {};
  let bestTarget = null;
  let bestScore = -1;

  for (let face = 1; face <= 6; face++) {
    for (const area of BOARD_AREAS) {
      const board = game.board && game.board[area];
      if (!board) continue;
      const tiles = tilesOnNumber(board, face);
      if (!tiles.length) continue;
      const wk = slotWorkers(board, face);

      let rivalTotal = 0;
      let bestRival = 0;
      let myCount = wk[player.id] || 0;
      for (const [id, n] of Object.entries(wk)) {
        if (id === player.id || id === '__neutral__') continue;
        rivalTotal += n;
        if (n > bestRival) bestRival = n;
      }
      if (rivalTotal < 1) continue;

      let score = 0;
      // ??????????
      const env = envs[face];
      if (env && env.envType === 'mercenaries') score += 100;
      // ?????????
      if (bestRival > myCount) {
        let value = 0;
        for (const t of tiles) value += (t.large || 0) + (t.small || 0);
        score += value * 5 + rivalTotal * 3;
      }

      if (score > bestScore) {
        bestScore = score;
        bestTarget = { area, number: face };
      }
    }
  }

  if (bestTarget && bestScore >= 20) {
    return { type: 'useFunc', payload: { cardId: funcCard.id, area: bestTarget.area, number: bestTarget.number } };
  }
  return null;
}

/**
 * ??????????????????????????????
 */
function _decideRemoteHard(game, player, funcCard) {
  const dice = game.dice && game.dice[player.id] ? game.dice[player.id] : [];

  // ??1?????????????????
  let hasGood = false;
  for (const face of [...new Set(dice)]) {
    for (const area of BOARD_AREAS) {
      const board = game.board && game.board[area];
      if (!board) continue;
      if (tilesOnNumber(board, face).length && !wouldCancelWithNeutral(game, area, face, dice.filter((d) => d === face).length, player.id)) {
        hasGood = true;
        break;
      }
    }
    if (hasGood) break;
  }
  if (!hasGood) return { type: 'useFunc', payload: { cardId: funcCard.id } };

  // ??2??????(firstCome)??????
  const envs = (game.board && game.board.resource && game.board.resource.environments) || {};
  for (const num of [1, 2, 3, 4, 5, 6]) {
    const env = envs[num];
    if (!env || env.envType !== 'firstCome') continue;
    const threshold = env.firstComeRequired || 2;
    if (threshold <= 0) continue;
    // ???????
    const cap = maxResourceHandFor(player);
    const hand = sumRes(player.resources);
    if (hand + 2 <= cap) {
      return { type: 'useFunc', payload: { cardId: funcCard.id } };
    }
  }

  return null;
}

/* ?????????? ?????????????? */

/**
 * ????bot ????????action??
 * @param {object} game       ??engine ?????
 * @param {string} playerId   ??bot ?? ID
 * @param {string} difficulty ??'easy'|'normal'|'hard'
 * @param {object} botState   ?????????????hard ??????????
 * @returns {{type:string, payload?:object}|null}
 */
function decideBotAction(game, playerId, difficulty, botState = {}) {
  const player = playerById(game, playerId);
  if (!player || player.left) return null;

  const raw = String(difficulty || 'normal').toLowerCase();
  // 五子棋专属更高难度：卡拉斯坦按 hard 处理
  const diff =
    raw === 'hardplus' || raw === 'hell' ? 'hard' : raw;

  // ????????????
  const pending = decidePendingAction(game, player, diff, botState);
  if (pending) return pending;

  // 雇佣军：投掷 / 逐枚放置（勿回退到 forceTimeout 的 SkipAll）
  if (game.phase === 'event_mercenary') {
    const merc = decideMercenaryPhase(game, player, diff, botState);
    if (merc) return merc;
  }

  // ????
  if (game.phase === 'produce' && game.currentPlayerId === playerId) {
    return decideProducePhase(game, player, diff, botState);
  }

  // ?????
  if (game.phase === 'build' && game.currentPlayerId === playerId) {
    // ??????
    const discard = decidePendingDiscard(game, player, diff, botState);
    if (discard) return discard;
    return decideBuildAction(game, player, diff, botState);
  }

  // ????/?????????????????????

  return null;
}

/* ─── 雇佣军阶段 ─────────────────────────────────────── */

function _slotStrengthLocal(workers, boosts) {
  const out = {};
  for (const [pid, c] of Object.entries(workers || {})) {
    const n = Number(c) || 0;
    if (n <= 0) continue;
    const b = Math.min(Math.max(0, Number(boosts && boosts[pid]) || 0), n);
    out[pid] = n * 2 + b;
  }
  return out;
}

function _cancelEqualCountsLocal(strengthMap) {
  const entries = Object.entries(strengthMap || {}).filter(([, c]) => c > 0);
  const byCount = new Map();
  for (const [pid, c] of entries) {
    if (!byCount.has(c)) byCount.set(c, []);
    byCount.get(c).push(pid);
  }
  const remain = {};
  for (const [c, pids] of byCount) {
    if (pids.length === 1) remain[pids[0]] = c;
  }
  return remain;
}

/** 抵消后名次：1=第一，2=第二，0=无名次；share=资源大/小份数量 */
function _mercSettleSnapshot(game, player, area, face, workers, boosts, diff) {
  const playerId = player.id;
  const strength = _slotStrengthLocal(workers, boosts);
  const remain = _cancelEqualCountsLocal(strength);
  const ranked = Object.entries(remain).sort((a, b) => b[1] - a[1]);
  let rank = 0;
  for (let i = 0; i < ranked.length; i++) {
    if (ranked[i][0] === playerId) {
      rank = i + 1;
      break;
    }
  }
  const board = game.board && game.board[area];
  const tiles = tilesOnNumber(board, face);
  let share = 0;
  let specialVal = 0;
  if (area === 'resource') {
    let large = 0;
    let small = 0;
    for (const t of tiles) {
      large += t.large || 0;
      small += t.small || 0;
    }
    if (rank === 1) share = large;
    else if (rank === 2) share = small;
  } else if (area === 'special' && rank === 1) {
    specialVal = estimateSpecialClaimValue(game, player, face, 0, diff);
  }
  return { rank, share, specialVal, inRemain: Boolean(remain[playerId]) };
}

/**
 * 评估雇佣骰落到某区某点：立即大份 + 结算名次变化。
 * 若会把已有第1/2名对冲掉 → 视为不可取（-Infinity）。
 */
function scoreMercenaryPlacement(game, player, area, face, diff) {
  const board = game.board && game.board[area];
  if (!board) return -Infinity;
  const tiles = tilesOnNumber(board, face);
  if (!tiles.length) return -Infinity;

  const workers = { ...(board.workers && board.workers[face] ? board.workers[face] : {}) };
  const boosts = {
    ...((board.boosts && board.boosts[face]) || {}),
  };
  const before = _mercSettleSnapshot(game, player, area, face, workers, boosts, diff);

  const afterWorkers = { ...workers };
  afterWorkers[player.id] = (afterWorkers[player.id] || 0) + 1;
  const pdExtra = prisonersDilemmaDispatchExtraNeutral(game, area, face);
  if (pdExtra > 0) {
    afterWorkers.__neutral__ = (Number(afterWorkers.__neutral__) || 0) + pdExtra;
  }
  const after = _mercSettleSnapshot(
    game,
    player,
    area,
    face,
    afterWorkers,
    boosts,
    diff
  );

  // 已有名次被对冲清零：宁可不放这枚（跳过收益为 0）
  if (before.rank >= 1 && before.rank <= 2 && !after.inRemain) {
    return -Infinity;
  }

  const factor = selfGainFactor(game);
  let immediate = 0;
  if (area === 'resource') {
    let large = 0;
    for (const t of tiles) large += t.large || 0;
    immediate = large * 8 * factor;
  }

  // 结算大份与雇佣立即大份可叠；空格双拿很强，但不应压过「同等资源+囚徒避弃」
  let settleShareScore = (after.share - before.share) * 8 * factor;
  if (area === 'resource' && immediate > 0 && after.share > 0) {
    settleShareScore *= 0.55;
  }

  let score =
    immediate + settleShareScore + (after.specialVal - before.specialVal);

  if (area === 'resource' && diff !== 'easy') {
    const env = envOnResourceSlot(game, face);
    const evtScale = diff === 'hard' ? 1 : 0.75;
    const settleRank = after.rank === 1 ? 0 : after.rank === 2 ? 1 : 2;
    if (envTriggersDispatch(env) && envHasDispatchEffect(env && env.envType)) {
      score +=
        estimateEventDispatchGain(game, player, face, 1, settleRank) * evtScale;
    }
    score += estimateEventSettleGain(game, player, face, settleRank) * evtScale;
  }

  return score;
}

function decideMercenaryPhase(game, player, diff, botState) {
  void botState;
  if (game.phase !== 'event_mercenary') return null;
  const cur = (game.pendingMercenaryQueue || [])[0];
  if (!cur || cur.playerId !== player.id) return null;

  if (!(game.mercenaryRoll && game.mercenaryRoll.length)) {
    return { type: 'mercenaryRoll' };
  }

  const roll = game.mercenaryRoll;
  const placed = new Set(game.mercenaryPlaced || []);

  // 在未处理的骰里选收益最高的一枚（不要死板按 index 0→1）
  let bestIdx = -1;
  let bestArea = null;
  let bestScore = 0; // 跳过 = 0

  for (let i = 0; i < roll.length; i++) {
    if (placed.has(i)) continue;
    const face = Number(roll[i]);
    for (const area of BOARD_AREAS) {
      const sc = scoreMercenaryPlacement(game, player, area, face, diff);
      if (sc > bestScore) {
        bestScore = sc;
        bestIdx = i;
        bestArea = area;
      }
    }
  }

  if (diff === 'easy') {
    const legalIdx = [];
    for (let i = 0; i < roll.length; i++) {
      if (placed.has(i)) continue;
      const face = Number(roll[i]);
      for (const area of BOARD_AREAS) {
        const board = game.board && game.board[area];
        if (board && tilesOnNumber(board, face).length) {
          legalIdx.push({ i, area });
        }
      }
    }
    if (legalIdx.length) {
      const pick = pickRandom(legalIdx) || legalIdx[0];
      return {
        type: 'mercenaryPlace',
        payload: { index: pick.i, area: pick.area, skip: false },
      };
    }
    const any = [...Array(roll.length).keys()].find((i) => !placed.has(i));
    return {
      type: 'mercenaryPlace',
      payload: { index: any != null ? any : 0, skip: true },
    };
  }

  if (bestIdx >= 0 && bestArea) {
    return {
      type: 'mercenaryPlace',
      payload: { index: bestIdx, area: bestArea, skip: false },
    };
  }

  const fallback = [...Array(roll.length).keys()].find((i) => !placed.has(i));
  if (fallback == null) return null;
  return { type: 'mercenaryPlace', payload: { index: fallback, skip: true } };
}

module.exports = {
  decideBotAction,
  // 供冒烟/单测验证放骰偏好
  decidePlaceDice,
  scoreProduceMove,
  scoreVoidSkipOption,
  minDiceForSameOutcome,
  decideMercenaryPhase,
  scoreMercenaryPlacement,
  estimateEventSettleGain,
  countUnownedBoardSlots,
  countEffectiveSinglePlaceSlots,
  countEffectiveSinglePlaceSlotsMatchingDice,
  isEffectiveSinglePlaceSlot,
  estimateFutureDiceOpportunity,
  shouldOpportunityVoidSkip,
};
