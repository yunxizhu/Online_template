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
  s += _stackAchievementScoreLocal(p);
  if (game && game.boostedTycoonPlayerId === p.id) s += 2;
  if (game && game.workshopMasterPlayerId === p.id) s += 2;
  if (game && game.whatYouWantPlayerId === p.id) s += 2;
  return s;
}

/**
 * 追分强度：整体抬一档，且当前分越高越强（约 1.2～2.5）。
 * 用于抬高分卡/建房权重，不改变流水线步序。
 */
function scoreChaseFactor(player, game) {
  const s = Math.max(0, playerScore(player, game));
  return 1.2 + Math.min(1.3, s * 0.13);
}

/** 一般冲分建房门槛（原 6）：基础下调，分越高越早追 */
function houseChaseMinScore(player, game) {
  const s = Math.max(0, playerScore(player, game));
  return Math.max(2, 4 - Math.floor(s / 5));
}

/** 高优冲分建房门槛（原流水线第 4 步 8） */
function houseHighChaseMinScore(player, game) {
  const s = Math.max(0, playerScore(player, game));
  return Math.max(4, 6 - Math.floor(s / 4));
}

/** 冲分建造（称号/分卡）门槛（原 7） */
function constructChaseMinScore(player, game) {
  const s = Math.max(0, playerScore(player, game));
  return Math.max(3, 5 - Math.floor(s / 4));
}

/** 中后段建房门槛（原流水线第 10 步 2） */
function houseSoftChaseMinScore(player, game) {
  const s = Math.max(0, playerScore(player, game));
  return Math.max(0, 1 - Math.floor(s / 4));
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
    // 派遣事件收益：仅当传送「自己的骰」落到该格时才会触发
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
    const stashCards = Array.isArray(env.stashCards)
      ? env.stashCards.length
      : firstComeStashCount(game.round);
    const fullVal = stashCards * 8.5 + (selfRank === 0 ? 12 : 0);
    const deficit = required - after;
    // 同点骰够当场补齐：按进度给追梦分
    if (diceRich || remAfter >= Math.max(1, deficit)) {
      let bonus = fullVal * (after / Math.max(1, required)) * 0.5;
      if (remAfter >= deficit + 2) bonus += 12;
      else if (remAfter >= deficit) bonus += 8;
      else if (diceRich) bonus += 5;
      else bonus *= 0.35;
      if (after <= 0) bonus = Math.max(bonus, diceRich ? 8 : 0);
      else if (myPrev === 0 && placed > 0) bonus += 4;
      return Math.round(Math.max(0, bonus));
    }
    // 1 骰即可独占、库存仍有 5 张以上：占坑分要压过丰收（3 任意资源），不能当成空格
    if (selfRank === 0 && stashCards >= 5 && after > 0) {
      return Math.round(stashCards * 6 * selfGainFactor(game));
    }
    return 0;
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
    // 4 任意资源大份作参照；丰收实际只给 3 个任意资源（建造阶段用，不进本轮弃牌），按 3 个计价，不再抬成 4
    const res4 = Math.round(32 * selfGainFactor(game));
    const res3 = Math.round(24 * selfGainFactor(game));
    if (diff === 'hard') {
      const vals = {
        // 强化/征召/庇护/换牌仍须压过丰收
        enhance: Math.max(40, res4 + 8),
        // 征召：同等 1 骰可独占时，应压过「仅 2 资源、无事件」的空资源格
        recruit: Math.max(40, res4 + 8),
        shelter: Math.max(36, res4 + 4),
        redraw: Math.max(34, res4 + 2),
        harvest: res3,
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
      enhance: Math.max(36, res4 + 6),
      recruit: Math.max(36, res4 + 6),
      shelter: Math.max(34, res4 + 2),
      redraw: Math.max(33, res4 + 1),
      harvest: res3,
      expand: 10,
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
  return _slotRivalDiceCount(game, area, face, playerId) > 0;
}

/** 本格其他玩家骰子总数（不含自己、不含中立） */
function _slotRivalDiceCount(game, area, face, playerId) {
  const board = game.board && game.board[area];
  const wk = board && board.workers && board.workers[face];
  if (!wk) return 0;
  let sum = 0;
  for (const [pid, c] of Object.entries(wk)) {
    if (pid === '__neutral__' || pid === playerId) continue;
    sum += Math.max(0, Number(c) || 0);
  }
  return sum;
}

/** 本格其他玩家中，单家骰子最多者数量（不含中立） */
function _slotMaxRivalDice(game, area, face, playerId) {
  const board = game.board && game.board[area];
  const wk = board && board.workers && board.workers[face];
  if (!wk) return 0;
  let max = 0;
  for (const [pid, c] of Object.entries(wk)) {
    if (pid === '__neutral__' || pid === playerId) continue;
    max = Math.max(max, Math.max(0, Number(c) || 0));
  }
  return max;
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

  const target = pickProduceAnyResource(player);
  const have = player.resources || {};
  if (target === 'iron' && (Number(have.iron) || 0) === 0) score += 2;
  else if (target === 'food') score += 1;
  else score += 1;

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
  // 「巩固第一」只看本格其他玩家骰量，不看全局剩余骰。
  if (area === 'resource') {
    const wkNow = slotWorkers(game.board && game.board.resource, face) || {};
    const myPrevNow = Number(wkNow[player.id]) || 0;
    if (myPrevNow >= 1) {
      if (!canIgnoreRivalScarceStackPenalty(game, player, face, count, env, boostAdd)) {
        score -= rivalScarceStackPenalty(game, player, count);
      }
      const rivalOnSlot = _slotRivalDiceCount(game, area, face, player.id);
      const maxRivalOnSlot = _slotMaxRivalDice(game, area, face, player.id);
      // 本格无敌手骰：再加码不是巩固，下面用超额惩罚打掉
      // 本格有对手且领先很薄（领先 ≤1）时，才给一点点防抢
      if (
        rivalOnSlot > 0 &&
        alreadyFirstBefore &&
        myPrevNow <= maxRivalOnSlot + 1 &&
        myPrevNow <= 3 &&
        (diff === 'hard' || diff === 'normal')
      ) {
        score += Math.round(
          Math.min(rivalOnSlot, 3) * 2 * selfGainFactor(game)
        );
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
    // 雇佣军要求唯一第一：仅当本格已有对手骰、且本次并非纯浪费堆叠时，减轻超额惩罚
    if (
      env &&
      env.envType === 'mercenaries' &&
      _slotHasRivalWorkers(game, area, face, player.id) &&
      !alreadyFirstBefore
    ) {
      penaltyMult = 0.25;
    }
    // 已是唯一第一且本格无对手：加码纯浪费，加重惩罚
    if (
      alreadyFirstBefore &&
      !_slotHasRivalWorkers(game, area, face, player.id)
    ) {
      penaltyMult = Math.max(penaltyMult, 2.5);
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
    // 雇佣军是 preSettle，不走上面 settle/dispatch 估值；仅「新成为」唯一第一才计雇佣价值
    if (
      env &&
      env.envType === 'mercenaries' &&
      est.myRank === 0 &&
      !alreadyFirstBefore
    ) {
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
      const rivalOnSlot = _slotRivalDiceCount(game, area, face, player.id);
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
      } else if (alreadyFirstBefore && rivalOnSlot <= 0) {
        // 本格无对手：巩固第一无意义，不加安全独占分
      } else if (!hollowFirst && risk < 0.3) {
        score += alreadyFirstBefore ? 3 : 12;
      } else if (!hollowFirst && risk < 0.5) {
        score += alreadyFirstBefore ? 1 : 5;
      }
    }

    if (area === 'resource' && count > 0) {
      const wk = slotWorkers(game.board && game.board.resource, face) || {};
      const myPrev = wk[player.id] || 0;
      const maxRivalOnSlot = _slotMaxRivalDice(game, area, face, player.id);
      const rivalOnSlot = _slotRivalDiceCount(game, area, face, player.id);
      // 本格有对手、尚未第一、领先将变薄时，加码抢第一才有占坑价值
      if (
        rivalOnSlot > 0 &&
        myPrev >= 1 &&
        myPrev <= maxRivalOnSlot + 1 &&
        !alreadyFirstBefore
      ) {
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

  return score;
}

/**
 * 生产放骰：选 face + area。同点必须一次全派（含强化骰），不可拆开。
 * 返回 { type:'placeDice', payload:{ face, area } } 或 null
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
    // 该点数上全部强化骰都必须一起派出
    const boostFlags = (game.diceBoosted && game.diceBoosted[player.id]) || [];
    let totalBoost = 0;
    for (let i = 0; i < dice.length; i++) {
      if (dice[i] === face && boostFlags[i]) totalBoost += 1;
    }

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
      // normal/hard：同点一次评满分（全派），再选落点区
      const sc = scoreProduceMove(
        game,
        player,
        face,
        area,
        maxCount,
        totalBoost,
        diff,
        botState
      );
      if (sc > bestScore) {
        bestScore = sc;
        best = { type: 'placeDice', payload: { face, area } };
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
    targetRes = pickProduceAnyResource(player) || 'wood';
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

/** 某造价相对现有资源的缺口列表 */
function _costGaps(have, cost) {
  const missing = [];
  for (const r of RESOURCES) {
    const need = Number(cost && cost[r]) || 0;
    const n = Number(have && have[r]) || 0;
    if (n < need) missing.push({ r, gap: need - n });
  }
  return missing;
}

/** 缺口中优先缺口最大的；并列优先铁 */
function _pickAmongGaps(missing) {
  if (!missing || !missing.length) return null;
  let best = missing[0];
  for (let i = 1; i < missing.length; i++) {
    const m = missing[i];
    if (
      m.gap > best.gap ||
      (m.gap === best.gap && m.r === 'iron' && best.r !== 'iron')
    ) {
      best = m;
    }
  }
  return best.r;
}

/** 手里最少的资源；数量相同优先铁矿 */
function _pickLeastHeldPreferIron(have) {
  let best = 'iron';
  let bestN = Infinity;
  for (const r of RESOURCES) {
    const n = Number(have && have[r]) || 0;
    if (n < bestN || (n === bestN && r === 'iron')) {
      bestN = n;
      best = r;
    }
  }
  return best;
}

/**
 * 生产回合「任选资源」：按建造缺口优先补。
 * 1 建房（无住房空位）→ 2 繁殖 → 3 购功能卡 → 4 建房（有空位）；
 * 到哪一步缺就拿缺的；都不缺则拿手里最少的，并列优先铁。
 */
function pickProduceAnyResource(player) {
  const have = (player && player.resources) || {};
  const free = freeHousesFor(player);

  if (player && !player.roundBuiltHouse && free <= 0) {
    const miss = _costGaps(have, BUILD_HOUSE_COST);
    if (miss.length) return _pickAmongGaps(miss);
  }
  if (
    player &&
    !player.roundBred &&
    (Number(player.villagers) || 0) < 15 &&
    free > 0
  ) {
    const need = breedFoodCost(player.villagers);
    if ((Number(have.food) || 0) < need) return 'food';
  }
  {
    const miss = _costGaps(have, BUY_FUNC_COST);
    if (miss.length) return _pickAmongGaps(miss);
  }
  if (player && !player.roundBuiltHouse && free > 0) {
    const miss = _costGaps(have, BUILD_HOUSE_COST);
    if (miss.length) return _pickAmongGaps(miss);
  }
  return _pickLeastHeldPreferIron(have);
}

/** 连续任选 count 张（每张按当前手牌重新算缺口） */
function pickProduceAnyResourceAmounts(player, count) {
  const sim = copyRes((player && player.resources) || {});
  const fake = Object.assign({}, player || {}, { resources: sim });
  const amounts = { wood: 0, stone: 0, food: 0, iron: 0 };
  const n = Math.max(0, Math.floor(Number(count) || 0));
  for (let i = 0; i < n; i++) {
    const r = pickProduceAnyResource(fake);
    amounts[r] = (amounts[r] || 0) + 1;
    sim[r] = (sim[r] || 0) + 1;
  }
  return amounts;
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

  // 只把超出保留量的资源兑进还没凑齐的保留量（勿把小麦兑成多余木石）
  if (diff !== 'easy') {
    const protect = _overflowProtectedCounts(game, player, botState);
    const haveNow = player.resources || {};
    let needRes = null;
    let bestGap = 0;
    for (const r of RESOURCES) {
      const gap = Math.max(0, (protect[r] || 0) - (Number(haveNow[r]) || 0));
      if (gap > bestGap) {
        bestGap = gap;
        needRes = r;
      }
    }
    if (needRes && bestGap > 0) {
      for (const from of RESOURCES) {
        if (from === needRes) continue;
        const surplus =
          (Number(haveNow[from]) || 0) - (Number(protect[from]) || 0);
        if (surplus < exchCost) continue;
        const maxCount = Math.floor(surplus / exchCost);
        const want = Math.min(maxCount, bestGap);
        if (want > 0) {
          const payload = { from, to: needRes, count: want };
          if (!_isOscillatingExchange(player, payload)) {
            const rate = exchCost;
            const sim = copyRes(player.resources);
            const total = rate * want;
            if ((sim[from] || 0) >= total) {
              sim[from] -= total;
              sim[needRes] = (sim[needRes] || 0) + want;
              if (!_isBadExchange(player, payload, player.resources, sim)) {
                _rememberExchange(player, payload, player.resources, sim);
                return {
                  type: 'exchange',
                  payload,
                };
              }
            }
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
          const payload = { from, to, count: 1 };
          if (!_isOscillatingExchange(player, payload)) {
            const sim = copyRes(player.resources);
            sim[from] -= exchCost;
            sim[to] = (sim[to] || 0) + 1;
            if (!_isBadExchange(player, payload, player.resources, sim)) {
              _rememberExchange(player, payload, player.resources, sim);
              return { type: 'exchange', payload };
            }
          }
        }
      }
    }
  }

  // 建造阶段不能弃资源（仅 settle_act 合法）。这里若返回弃牌，
  // 引擎会拒绝，托管超时会直接跳过整个建造回合，资源一点不花。
  // 超上限交给后面的流水线继续花（繁殖/建房/建造/购卡/再扩手牌）。
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
  const chase = scoreChaseFactor(player, game);
  const houseMin = houseChaseMinScore(player, game);
  const houseHigh = houseHighChaseMinScore(player, game);
  const constructMin = constructChaseMinScore(player, game);
  const canBreed =
    !player.roundBred &&
    (Number(player.villagers) || 0) < 15 &&
    freeHousesFor(player) > 0;
  if (canBreed) {
    needs.breed = _populationBehind(game, player) ? 120 : 100;
  }

  if (shouldExpandResourceHand(player, game, botState)) needs.expandRes = 92;
  if (buildingSlotsTight(player)) needs.expandBld = 88;

  if (!player.roundBuiltHouse) {
    const free = freeHousesFor(player);
    if (free <= 0) needs.house = 110;
    else if (free <= 1 || _populationBehind(game, player)) {
      needs.house = Math.round(95 * Math.min(chase, 1.5));
    } else if (score >= houseHigh) needs.house = Math.round(88 * chase);
    else if (score >= houseMin) needs.house = Math.round(78 * chase);
    else needs.house = Math.round((58 + score * 4) * Math.min(chase, 1.35));
  }

  const unbuilt = (player.buildings || []).filter((b) => !b.built);
  const valuable = unbuilt.filter((b) =>
    _buildingHelpsTitleOrScore(player, b, game)
  );
  if (valuable.length) {
    needs.construct =
      score >= constructMin
        ? Math.round(96 * chase)
        : Math.round(72 * Math.min(chase, 1.4));
  } else if (unbuilt.length) {
    needs.construct = Math.round(44 * Math.min(chase, 1.3));
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
  const chase = scoreChaseFactor(player, game);
  let score = (Number(b.score) || 0) * 24 * chase;
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
    score += 90 * chase;
  } else if (b.buildType === 'score1') {
    score += 70 * chase;
  } else if (_buildingHelpsTitleOrScore(player, b, game)) {
    score += 52 * Math.min(chase, 1.6);
  }
  // 造价越高略减（更难立刻建成）
  score -= Math.min(24, sumRes(b.cost || {}) * 2);
  return score;
}

/**
 * 弃资源时各色「保留权重」：流水线急需的原料权重大，优先丢掉多余色。
 * 木石权重只覆盖扩建/建房定额，避免把小麦和铁整色弃掉。
 */
function _resourceKeepWeights(game, player, botState) {
  const w = { wood: 1, stone: 1, food: 1, iron: 1 };
  const needs = _buildPipelineKeepNeeds(game, player, botState);
  if (_shouldReserveBreedFood(player)) {
    w.food += 8 + Math.min(6, breedFoodCost(player.villagers));
  }
  if (needs.expandRes > 0 || needs.expandBld > 0 || needs.house > 0) {
    w.wood += 4;
    w.stone += 4;
  }
  if (needs.house > 0) {
    w.iron += (BUILD_HOUSE_COST.iron || 0) * 3;
  }
  return w;
}

/** 下一建造回合还要繁殖（有空位，或建完房就能繁殖） */
function _shouldReserveBreedFood(player) {
  if (!player || player.roundBred) return false;
  const villagers = Number(player.villagers) || 0;
  if (villagers <= 0 || villagers >= 15) return false;
  if (freeHousesFor(player) > 0) return true;
  return !player.roundBuiltHouse;
}

function _reserveShadow(player) {
  const s = Object.assign({}, player);
  s.resources = copyRes(player.resources || {});
  s.buildings = (player.buildings || []).map((b) => Object.assign({}, b));
  s.funcCards = (player.funcCards || []).slice();
  s.buildTurnBuyFuncCount = _buyFuncCountThisTurn(player);
  s.buildTurnUsedBuyFunc = false;
  s.buildTurnFinaleExpanded = false;
  return s;
}

function _costFitsReserve(keep, cost, cap, holdings) {
  let sum = sumRes(keep);
  for (const k of RESOURCES) {
    const add = Number(cost && cost[k]) || 0;
    if ((keep[k] || 0) + add > (Number(holdings[k]) || 0)) return false;
    sum += add;
  }
  return sum <= cap;
}

function _wantExpandResourceReserve(shadow) {
  if (!shadow || shadow.roundExpandedResource) return false;
  if (resourceHandExpandCapped(shadow)) return false;
  if (resourceHandCapBelow18(shadow)) return true;
  const entry = shadow.buildTurnEntryFreeRes;
  const n = entry == null ? 0 : Number(entry);
  return n <= 5;
}

/** 斩杀若整段花费装得进手牌上限，就整段预留；装不下则交给后面的正常优先级 */
function _killReserveAction(game, shadow) {
  if (!shadow || shadow.__reserveWon) return null;
  const need = _killLinePointsNeeded(game, shadow);
  if (need <= 0) return null;
  const buildings = _killLineScoreBuildings(shadow, game);
  let maxVp = shadow.roundBuiltHouse ? 0 : 1;
  const plannedProbe = [];
  for (const b of buildings) {
    maxVp += _constructVpGain(shadow, game, b, plannedProbe);
    plannedProbe.push(b.id);
  }
  if (maxVp < need) return null;

  const steps = [];
  const planned = [];
  let gained = 0;
  const pool = buildings.slice();
  while (gained < need && pool.length) {
    let bestIdx = 0;
    let bestVp = -1;
    for (let i = 0; i < pool.length; i++) {
      const vp = _constructVpGain(shadow, game, pool[i], planned);
      if (vp > bestVp) {
        bestVp = vp;
        bestIdx = i;
      }
    }
    if (bestVp <= 0) break;
    const b = pool.splice(bestIdx, 1)[0];
    steps.push({ kind: 'construct', buildingId: b.id, cost: b.cost || {} });
    planned.push(b.id);
    gained += bestVp;
  }
  if (gained < need) {
    if (shadow.roundBuiltHouse) return null;
    steps.push({ kind: 'house', cost: BUILD_HOUSE_COST });
    gained += 1;
  }
  if (gained < need || !steps.length) return null;
  const cost = _blankNeed();
  for (const step of steps) _addNeed(cost, step.cost);
  if (sumRes(cost) <= 0) return null;
  return {
    cost,
    apply() {
      shadow.__reserveWon = true;
      for (const step of steps) {
        if (step.kind === 'house') {
          shadow.roundBuiltHouse = true;
          shadow.houses = (Number(shadow.houses) || 0) + 1;
          shadow.houseScore = (Number(shadow.houseScore) || 0) + 1;
        } else {
          const b = (shadow.buildings || []).find((x) => x.id === step.buildingId);
          if (b) b.built = true;
        }
      }
    },
  };
}

function _houseReserveAction(shadow) {
  if (!shadow || shadow.roundBuiltHouse) return null;
  return {
    cost: copyRes(BUILD_HOUSE_COST),
    apply() {
      shadow.roundBuiltHouse = true;
      shadow.houses = (Number(shadow.houses) || 0) + 1;
      shadow.houseScore = (Number(shadow.houseScore) || 0) + 1;
    },
  };
}

function _breedReserveAction(shadow) {
  if (!shadow || shadow.roundBred) return null;
  if ((Number(shadow.villagers) || 0) >= 15) return null;
  if (freeHousesFor(shadow) <= 0) return null;
  const food = breedFoodCost(shadow.villagers);
  if (food <= 0) return null;
  return {
    cost: { wood: 0, stone: 0, food, iron: 0 },
    apply() {
      shadow.roundBred = true;
      shadow.villagers = (Number(shadow.villagers) || 0) + 1;
    },
  };
}

function _buyReserveAction(shadow, maxBuys) {
  if (!_canBuyFuncThisTurn(shadow, maxBuys)) return null;
  if (buildingSlotsTight(shadow)) return null;
  return {
    cost: copyRes(BUY_FUNC_COST),
    apply() {
      shadow.buildTurnBuyFuncCount = _buyFuncCountThisTurn(shadow) + 1;
      shadow.buildTurnUsedBuyFunc = true;
    },
  };
}

function _expandResourceReserveAction(shadow) {
  if (!_wantExpandResourceReserve(shadow)) return null;
  return {
    cost: copyRes(EXPAND_COST),
    apply() {
      shadow.roundExpandedResource = true;
      shadow.expandResSlots = (Number(shadow.expandResSlots) || 0) + 1;
    },
  };
}

function _expandBuildingReserveAction(shadow) {
  if (!shadow || shadow.roundExpandedBuilding) return null;
  if (!buildingSlotsTight(shadow)) return null;
  return {
    cost: copyRes(EXPAND_COST),
    apply() {
      shadow.roundExpandedBuilding = true;
      shadow.expandSlots = (Number(shadow.expandSlots) || 0) + 1;
    },
  };
}

function _bestReserveBuilding(shadow, game, pred) {
  const cands = (shadow.buildings || []).filter(
    (b) => b && !b.built && (!pred || pred(b))
  );
  if (!cands.length) return null;
  cands.sort(
    (a, b) =>
      scoreBuildingForHard(shadow, b, game) - scoreBuildingForHard(shadow, a, game)
  );
  return cands[0];
}

function _constructReserveAction(shadow, game, pred) {
  const b = _bestReserveBuilding(shadow, game, pred);
  if (!b) return null;
  const cost = copyRes(b.cost || {});
  if (sumRes(cost) <= 0) return null;
  return {
    cost,
    apply() {
      const t = (shadow.buildings || []).find((x) => x.id === b.id);
      if (t) t.built = true;
    },
  };
}

/**
 * 与 decideBuildAction / decideBuildActionHard 同一优先级，列出「这一步会尝试」的动作。
 * 手牌张数按弃到上限后的剩余来估，不用爆牌前的 18 张去误判购卡。
 */
function _reserveActionCandidates(game, shadow, botState, handNow) {
  const list = [];
  const push = (act) => {
    if (act && sumRes(act.cost || {}) > 0) list.push(act);
  };
  if (shadow.__reserveWon) return list;

  push(_killReserveAction(game, shadow));

  const vil = Number(shadow.villagers) || 0;
  const free = freeHousesFor(shadow);
  const behind = _populationBehind(game, shadow);
  if (vil < 15) {
    if (free <= 0 && !shadow.roundBuiltHouse) push(_houseReserveAction(shadow));
    if (free > 0 && !shadow.roundBred) push(_breedReserveAction(shadow));
    if (!shadow.roundBuiltHouse && (free <= 1 || behind)) {
      push(_houseReserveAction(shadow));
    }
  }

  push(
    _constructReserveAction(shadow, game, (b) => _constructVpGain(shadow, game, b, []) > 0)
  );

  if (_shouldBoostBuyForNearWin(game, shadow)) {
    push(_buyReserveAction(shadow, BUY_FUNC_FINALE_UNLIMITED));
  }

  if (handNow >= 12) push(_buyReserveAction(shadow, BUY_FUNC_PER_TURN_MAX));
  if (free <= 0) push(_houseReserveAction(shadow));
  push(_breedReserveAction(shadow));
  if (playerScore(shadow, game) >= constructChaseMinScore(shadow, game)) {
    push(
      _constructReserveAction(
        shadow,
        game,
        (b) => _buildingHelpsTitleOrScore(shadow, b, game)
      )
    );
  }
  if (playerScore(shadow, game) >= houseHighChaseMinScore(shadow, game)) {
    push(_houseReserveAction(shadow));
  }
  push(_expandResourceReserveAction(shadow));
  push(_expandBuildingReserveAction(shadow));
  push(
    _constructReserveAction(shadow, game, (b) => b.buildType !== 'score2')
  );
  push(_breedReserveAction(shadow));
  if (playerScore(shadow, game) >= houseSoftChaseMinScore(shadow, game)) {
    push(_houseReserveAction(shadow));
  }
  push(
    _constructReserveAction(shadow, game, (b) => b.buildType !== 'score2')
  );
  push(_expandResourceReserveAction(shadow));
  push(_houseReserveAction(shadow));
  if (handNow >= 6) {
    push(_buyReserveAction(shadow, BUY_FUNC_PER_TURN_MAX));
    push(_constructReserveAction(shadow, game));
    push(_houseReserveAction(shadow));
    push(_expandResourceReserveAction(shadow));
    push(_expandBuildingReserveAction(shadow));
  }
  return list;
}

/**
 * 先按建造回合优先级把装得进手牌上限的动作花费加总，得到要预留的资源。
 * 装不下一整步的不留半套；最后仍有空位时才用小麦和铁补满，避免多囤木石。
 */
function _planBuildReserve(game, player, botState, cap) {
  const keep = _blankNeed();
  const holdings = copyRes((player && player.resources) || {});
  const limit = Math.max(0, Number(cap) || 0);
  if (!player || limit <= 0) return keep;
  const shadow = _reserveShadow(player);
  let guard = 0;
  while (sumRes(keep) < limit && guard++ < 16) {
    const handNow = limit - sumRes(keep);
    const cands = _reserveActionCandidates(game, shadow, botState, handNow);
    let picked = null;
    for (const act of cands) {
      if (_costFitsReserve(keep, act.cost, limit, holdings)) {
        picked = act;
        break;
      }
    }
    if (!picked) break;
    _addNeed(keep, picked.cost);
    picked.apply();
    if (shadow.__reserveWon) break;
  }

  let slots = limit - sumRes(keep);
  while (slots > 0) {
    const foodLeft = (holdings.food || 0) - keep.food;
    const ironLeft = (holdings.iron || 0) - keep.iron;
    if (foodLeft <= 0 && ironLeft <= 0) break;
    if (foodLeft > 0) {
      keep.food += 1;
      slots -= 1;
      if (slots <= 0) break;
    }
    if (ironLeft > 0 && slots > 0) {
      keep.iron += 1;
      slots -= 1;
    }
  }
  while (slots > 0) {
    const woodLeft = (holdings.wood || 0) - keep.wood;
    const stoneLeft = (holdings.stone || 0) - keep.stone;
    if (woodLeft <= 0 && stoneLeft <= 0) break;
    if (woodLeft >= stoneLeft && woodLeft > 0) {
      keep.wood += 1;
      slots -= 1;
    } else if (stoneLeft > 0) {
      keep.stone += 1;
      slots -= 1;
    } else break;
  }
  return keep;
}

/**
 * 超限时要保住的数量：建造回合实际会做的动作，按优先级提前算好。
 */
function _overflowProtectedCounts(game, player, botState) {
  return _planBuildReserve(game, player, botState, maxResourceHandFor(player));
}

/**
 * 超限弃资源：只丢掉计划预留之外的部分。
 */
function _pickDiscardResourceAmounts(game, player, over, botState) {
  const have = copyRes((player && player.resources) || {});
  const total = sumRes(have);
  const stillOver = Math.max(0, Number(over) || 0);
  const keepSlots = Math.max(0, total - stillOver);
  if (keepSlots <= 0 || stillOver <= 0) {
    const amounts = {};
    if (stillOver > 0) {
      const weights = _resourceKeepWeights(game, player, botState);
      const left = copyRes(have);
      let n = stillOver;
      while (n > 0) {
        let best = null;
        let bestKey = Infinity;
        for (const r of RESOURCES) {
          if ((left[r] || 0) <= 0) continue;
          const key = weights[r] * 10 - left[r];
          if (key < bestKey) {
            bestKey = key;
            best = r;
          }
        }
        if (!best) break;
        amounts[best] = (amounts[best] || 0) + 1;
        left[best] -= 1;
        n -= 1;
      }
    }
    return amounts;
  }

  const keep = _planBuildReserve(game, player, botState, keepSlots);
  const amounts = {};
  let dropped = 0;
  for (const r of RESOURCES) {
    const drop = Math.max(0, (have[r] || 0) - (keep[r] || 0));
    if (drop > 0) {
      amounts[r] = drop;
      dropped += drop;
    }
  }
  const left = copyRes(have);
  for (const r of RESOURCES) left[r] = Math.max(0, (left[r] || 0) - (amounts[r] || 0));
  while (dropped < stillOver) {
    let best = null;
    let bestN = -1;
    for (const r of ['wood', 'stone', 'iron', 'food']) {
      const n = left[r] || 0;
      if (n > bestN) {
        bestN = n;
        best = r;
      }
    }
    if (!best || bestN <= 0) break;
    amounts[best] = (amounts[best] || 0) + 1;
    left[best] -= 1;
    dropped += 1;
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
  const chase = scoreChaseFactor(player, game);
  let score = (b.score || 0) * 18 * chase;
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
  // 分数卡：兑换越好越该优先建成冲分；当前分越高越追
  if (b.buildType === 'score2') {
    score += (38 + (rate <= 1 ? 32 : rate <= 2 ? 14 : 0)) * chase;
  }
  if (b.buildType === 'score1') {
    score += (24 + (rate <= 1 ? 18 : rate <= 2 ? 10 : 0)) * chase;
  }
  const costSum = sumRes(b.cost);
  // 兑换好时造价惩罚降低（可无损/低损凑齐）
  score -= costSum * (rate <= 1 ? 1.2 : rate <= 2 ? 2 : 3);
  return score;
}

function scoreBuildingForNormal(player, b, game) {
  if (!b.cost) return 0;
  const chase = game ? scoreChaseFactor(player, game) : 1.2;
  let score = (b.score || 0) * 13 * chase;
  if (b.buildType === 'exchange') {
    const exCount = countBuiltExchanges(player);
    score += exCount === 0 ? 18 : exCount === 1 ? 28 : 8;
  }
  if (b.buildType === 'score2') score += 28 * chase;
  if (b.buildType === 'score1') score += 16 * chase;
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

/** 丰收三选：按生产任选资源优先级逐张补 */
function _harvestResourcePicks(player) {
  const amounts = pickProduceAnyResourceAmounts(player, 3);
  const picks = [];
  for (const r of RESOURCES) {
    for (let i = 0; i < (amounts[r] || 0); i++) picks.push(r);
  }
  while (picks.length < 3) picks.push('iron');
  return picks.slice(0, 3);
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
    if (unbuilt >= bldCap && !player.roundExpandedBuilding) {
      return {
        type: 'useFunc',
        payload: { cardId: freeExpand.id, direction: 'building' },
      };
    }
    if (funcN >= funcCap && !player.roundExpandedFunction) {
      return {
        type: 'useFunc',
        payload: { cardId: freeExpand.id, direction: 'function' },
      };
    }
    // 资源扩容交给建造流水线（空位≤9 顺序）
  }

  // 丰收：缺口 1～2 张时发动，必须带上 3 个资源（否则引擎拒绝，超时会直接跳过建造）
  // 已经超过手牌上限就不要再拿，否则下一拍更超、更难花完
  const harvest = cards.find((c) => c.funcType === 'harvest');
  if (harvest && needTotal > 0 && !resourceHandOverCap(player)) {
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

  // 进场空位≤5 才规划资源扩建；上限<18 时不看进场空位差；到 24 后不再扩资源手牌
  ensureBuildTurnEntryFree(player);
  if (
    !resourceHandExpandCapped(player) &&
    (resourceHandCapBelow18(player) || player.buildTurnEntryFreeRes <= 5)
  ) {
    needs.expand = true;
    needs.expandDir = 'resource';
  } else if (buildingSlotsTight(player) && !player.roundExpandedBuilding) {
    needs.expand = true;
    needs.expandDir = 'building';
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
    const houseMin = houseChaseMinScore(player, game);
    const houseHigh = houseHighChaseMinScore(player, game);
    const want =
      (step < 4 && score >= houseHigh) ||
      (step < 10 && score >= houseMin && gapOk) ||
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
  // 空位≥12 时末尾改购卡，不再为「额外扩建」预留木石
  const finaleBuysInstead = freeResourceSlots(player) >= 12;
  const capLow =
    resourceHandCapBelow18(player) && !resourceHandExpandCapped(player);
  if (
    !finaleBuysInstead &&
    step !== 12 &&
    step !== 17 &&
    !player.roundExpandedResource
  ) {
    const wantRes =
      (step < 6 &&
        (capLow || (entry != null && entry <= 5)) &&
        canPay(player.resources, EXPAND_COST)) ||
      (step < 12 &&
        (capLow || (entry != null && entry <= 3)) &&
        expandGapOk) ||
      (step < 17 &&
        hand >= 6 &&
        (capLow || (entry != null && entry <= 3)) &&
        expandGapOk);
    if (wantRes) _addNeed(reserve, EXPAND_COST);
  }
  if (
    !finaleBuysInstead &&
    step !== 7 &&
    step !== 18 &&
    !player.roundExpandedBuilding &&
    buildingSlotsTight(player)
  ) {
    const wantBld = step < 7 || (step < 18 && hand >= 6 && expandGapOk);
    if (wantBld) _addNeed(reserve, EXPAND_COST);
  }

  // 手牌≥6 的购卡，以及空位≥12 时末尾购卡，都尽量留着四色；
  // 建筑格已满时还要留木石给购卡前扩建（不占扩建次数）
  if (hand >= 6 && _canBuyFuncThisTurn(player)) {
    const wantBuy =
      step < 14 || (finaleBuysInstead && step < 17);
    if (wantBuy) {
      if (buildingSlotsTight(player)) {
        const expandOk =
          canPay(player.resources, EXPAND_COST) ||
          actionResourceGap(player.resources, EXPAND_COST) <= 2;
        if (expandOk) _addNeed(reserve, EXPAND_COST);
      }
      const buyOk =
        canPay(player.resources, BUY_FUNC_COST) ||
        actionResourceGap(player.resources, BUY_FUNC_COST) <= 2;
      if (buyOk) _addNeed(reserve, BUY_FUNC_COST);
    }
  }

  const constructSpecs = [];
  const constructMin = constructChaseMinScore(player, game);
  if (step < 3 && score >= constructMin) {
    constructSpecs.push({
      minScore: constructMin,
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
 * 为凑齐 cost 兑换：仅当「一笔兑完后立刻付得起该动作」才兑。
 * 兑不满 / 兑完仍做不了 → 不兑（避免浪费、避免多步对兑卡死）。
 * softReserve：优先不动后续动作原料；兑不满再放开。
 * 另有防循环：禁止反向来回、禁止回到已出现资源面、每建造回合最多兑 3 次。
 * @returns {{type:string,payload:object}|null}
 */
const BOT_EXCHANGE_MAX_PER_BUILD = 3;

function _resFingerprint(resources) {
  return RESOURCES.map((r) => String(Math.max(0, Number(resources && resources[r]) || 0))).join(',');
}

function _exchangeEndpoints(payload) {
  const froms = [];
  const tos = [];
  if (!payload) return { froms, tos };
  if (typeof payload.from === 'string') froms.push(payload.from);
  else if (payload.from && typeof payload.from === 'object') {
    for (const r of RESOURCES) {
      if ((Number(payload.from[r]) || 0) > 0) froms.push(r);
    }
  }
  if (typeof payload.to === 'string') tos.push(payload.to);
  else if (payload.to && typeof payload.to === 'object') {
    for (const r of RESOURCES) {
      if ((Number(payload.to[r]) || 0) > 0) tos.push(r);
    }
  }
  froms.sort();
  tos.sort();
  return { froms, tos };
}

function _ensureExchGuard(player) {
  if (!player) return null;
  if (!player.__botExchGuard) {
    player.__botExchGuard = {
      dirs: [],
      seenRes: [],
      count: 0,
    };
  }
  return player.__botExchGuard;
}

/** 是否会形成循环兑换（反向 / 回到旧资源面 / 超次） */
function _isBadExchange(player, payload, haveBefore, simAfter) {
  const guard = _ensureExchGuard(player);
  if (!guard) return true;
  if (guard.count >= BOT_EXCHANGE_MAX_PER_BUILD) return true;

  const cur = _exchangeEndpoints(payload);
  if (!cur.froms.length || !cur.tos.length) return true;

  // 与本回合任意一次兑换方向相反（含三角兑里的任一边）
  for (const last of guard.dirs) {
    if (!last || !last.froms || !last.tos) continue;
    const revOut = cur.froms.every((f) => last.tos.includes(f));
    const revIn = cur.tos.every((t) => last.froms.includes(t));
    if (revOut && revIn) return true;
  }

  const afterFp = _resFingerprint(simAfter);
  const beforeFp = _resFingerprint(haveBefore);
  // 兑完回到本回合兑换链上出现过的资源面 → 循环
  if (guard.seenRes.includes(afterFp)) return true;
  // 兑完等于兑前（无损空转）
  if (afterFp === beforeFp) return true;

  return false;
}

function _rememberExchange(player, payload, haveBefore, simAfter) {
  if (!player || !payload) return;
  const guard = _ensureExchGuard(player);
  const cur = _exchangeEndpoints(payload);
  guard.dirs.push(cur);
  if (guard.dirs.length > 8) guard.dirs.shift();
  const beforeFp = _resFingerprint(haveBefore);
  const afterFp = _resFingerprint(simAfter);
  if (!guard.seenRes.includes(beforeFp)) guard.seenRes.push(beforeFp);
  if (!guard.seenRes.includes(afterFp)) guard.seenRes.push(afterFp);
  guard.count += 1;
  // 兼容旧字段
  player.__botLastExchange = cur;
}

function _clearExchangeMemory(player) {
  if (!player) return;
  player.__botLastExchange = null;
  player.__botExchGuard = null;
}

function _isOscillatingExchange(player, payload) {
  // 溢出兑等无 sim 时：仅看反向
  const guard = player && player.__botExchGuard;
  if (!guard || !guard.dirs || !guard.dirs.length) {
    const last = player && player.__botLastExchange;
    if (!last || !last.froms || !last.tos) return false;
    const cur = _exchangeEndpoints(payload);
    if (!cur.froms.length || !cur.tos.length) return false;
    return (
      cur.froms.every((f) => last.tos.includes(f)) &&
      cur.tos.every((t) => last.froms.includes(t))
    );
  }
  const cur = _exchangeEndpoints(payload);
  for (const last of guard.dirs) {
    if (
      cur.froms.every((f) => last.tos.includes(f)) &&
      cur.tos.every((t) => last.froms.includes(t))
    ) {
      return true;
    }
  }
  if (guard.count >= BOT_EXCHANGE_MAX_PER_BUILD) return true;
  return false;
}

/** 一次规划：用 surplus 兑满 cost 的全部缺口 */
function _planFullExchangeForCost(have, cost, reserveExtra, softReserve, exchCost, useSoft) {
  const rate = Math.max(1, Math.floor(Number(exchCost) || 0));
  const deficits = {};
  let totalDef = 0;
  for (const r of RESOURCES) {
    const need = Number(cost[r]) || 0;
    const n = Number(have[r]) || 0;
    if (n < need) {
      deficits[r] = need - n;
      totalDef += need - n;
    }
  }
  if (totalDef <= 0) return null;

  const surplus = {};
  let totalSurplus = 0;
  for (const r of RESOURCES) {
    if (deficits[r]) continue;
    const reserve =
      (Number(cost[r]) || 0) +
      (Number(reserveExtra && reserveExtra[r]) || 0) +
      (useSoft ? Number(softReserve && softReserve[r]) || 0 : 0);
    const avail = Math.max(0, (Number(have[r]) || 0) - reserve);
    if (avail > 0) {
      surplus[r] = avail;
      totalSurplus += avail;
    }
  }
  const needFrom = totalDef * rate;
  if (totalSurplus < needFrom) return null;

  const fromObj = {};
  let left = needFrom;
  const fromOrder = RESOURCES.filter((r) => (surplus[r] || 0) > 0).sort(
    (a, b) => (surplus[b] || 0) - (surplus[a] || 0)
  );
  for (const r of fromOrder) {
    if (left <= 0) break;
    const take = Math.min(surplus[r], left);
    if (take > 0) {
      fromObj[r] = take;
      left -= take;
    }
  }
  if (left > 0) return null;

  const toObj = {};
  for (const r of RESOURCES) {
    if (deficits[r]) toObj[r] = deficits[r];
  }

  const fromKeys = RESOURCES.filter((r) => (fromObj[r] || 0) > 0);
  const toKeys = RESOURCES.filter((r) => (toObj[r] || 0) > 0);
  if (
    fromKeys.length === 1 &&
    toKeys.length === 1 &&
    fromObj[fromKeys[0]] === toObj[toKeys[0]] * rate
  ) {
    return { from: fromKeys[0], to: toKeys[0], count: toObj[toKeys[0]] };
  }
  return { from: fromObj, to: toObj };
}

/** 模拟兑换后的资源（与 engine 单笔兑换一致） */
function _simulateExchangePayload(have, payload, exchCost) {
  const sim = copyRes(have);
  const rate = Math.max(1, Math.floor(Number(exchCost) || 0));
  if (typeof payload.from === 'string' && typeof payload.to === 'string') {
    const count = Math.max(1, Math.floor(Number(payload.count) || 1));
    const total = rate * count;
    if ((sim[payload.from] || 0) < total) return null;
    sim[payload.from] -= total;
    sim[payload.to] = (sim[payload.to] || 0) + count;
    return sim;
  }
  if (!payload.from || !payload.to) return null;
  let totalFrom = 0;
  let totalTo = 0;
  for (const r of RESOURCES) {
    const fc = Math.max(0, Math.floor(Number(payload.from[r]) || 0));
    const tc = Math.max(0, Math.floor(Number(payload.to[r]) || 0));
    if (fc > 0 && tc > 0) return null;
    if ((sim[r] || 0) < fc) return null;
    totalFrom += fc;
    totalTo += tc;
  }
  if (totalFrom <= 0 || totalTo <= 0) return null;
  if (totalFrom % rate !== 0) return null;
  if (totalFrom / rate !== totalTo) return null;
  for (const r of RESOURCES) {
    const fc = Math.max(0, Math.floor(Number(payload.from[r]) || 0));
    const tc = Math.max(0, Math.floor(Number(payload.to[r]) || 0));
    if (fc > 0) sim[r] -= fc;
    if (tc > 0) sim[r] = (sim[r] || 0) + tc;
  }
  return sim;
}

function _exchangeTowardCost(game, player, cost, reserveExtra, softReserve) {
  if (!player || !cost) return null;
  if (canPay(player.resources, cost)) return null;
  const exchCost = effectiveExchangeCost(player, game);
  if (exchCost <= 0) return null;

  const have = player.resources || {};
  if (actionResourceGap(have, cost) <= 0) return null;

  // 兑换前就定好：必须存在「一笔兑完 → 立刻付得起本动作」的方案；兑不满就不要兑
  const keepSoft = Boolean(
    softReserve && RESOURCES.some((k) => (Number(softReserve[k]) || 0) > 0)
  );
  const payload =
    (keepSoft &&
      _planFullExchangeForCost(have, cost, reserveExtra, softReserve, exchCost, true)) ||
    _planFullExchangeForCost(have, cost, reserveExtra, softReserve, exchCost, false);
  if (!payload) return null;

  const sim = _simulateExchangePayload(have, payload, exchCost);
  if (!sim) return null;
  // 兑完必须立刻能执行该动作（含 reserveExtra）；否则根本不该兑
  if (!canPay(sim, cost)) return null;
  if (reserveExtra) {
    const afterPay = copyRes(sim);
    for (const k of RESOURCES) {
      afterPay[k] = (afterPay[k] || 0) - (Number(cost[k]) || 0);
    }
    for (const k of RESOURCES) {
      if ((afterPay[k] || 0) < (Number(reserveExtra[k]) || 0)) return null;
    }
  }

  if (_isBadExchange(player, payload, have, sim)) return null;

  _rememberExchange(player, payload, have, sim);
  return { type: 'exchange', payload };
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
    // 新建造回合：清空兑换防循环状态与近胜购卡偏好
    _clearExchangeMemory(player);
    player.__botBuyRedrawPrefer = null;
    player.__botBuildTurnScorePush = false;
  }
  return player.buildTurnEntryFreeRes;
}

/** 资源手牌上限是否仍低于 18（未扩满前无脑扩，不看进场空位差） */
function resourceHandCapBelow18(player) {
  return maxResourceHandFor(player) < 18;
}

/**
 * 资源手牌扩到 24 后就停。
 * 生产建筑的产出不参与本轮弃牌，等于变相提高进建造的资源量，继续扩手牌不如扩建筑格。
 */
const RESOURCE_HAND_EXPAND_CAP = 24;

function resourceHandExpandCapped(player) {
  return maxResourceHandFor(player) >= RESOURCE_HAND_EXPAND_CAP;
}

function resourceHandOverCap(player) {
  if (!player) return false;
  return sumRes(player.resources || {}) > maxResourceHandFor(player);
}

/**
 * 是否还应扩资源手牌上限。
 * normal/easy 仍看当前空位 ≤ 9。hard 第 6/12 步改看进场空位（上限≥18 后），不走这里。
 */
function shouldExpandResourceHand(player, game, botState) {
  if (!player) return false;
  if (resourceHandExpandCapped(player)) {
    player.__botWantExpandRes = false;
    return false;
  }
  if (player.roundExpandedResource) {
    player.__botWantExpandRes = false;
    return false;
  }
  // 上限未到 18：有木石就愿意扩（具体是否在流水线该步出手另说）
  if (resourceHandCapBelow18(player)) {
    player.__botWantExpandRes = true;
    return true;
  }
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
  if (playerScore(player, game) >= houseChaseMinScore(player, game)) return true;
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

  // 1) 村民已满房 或 达到冲分门槛：优先建房冲分/腾空位（付得起才建；空位紧时先扩容）
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
          return scoreBuildingForNormal(player, b, game) - scoreBuildingForNormal(player, a, game);
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

  // 3) 买功能卡花牌（建筑格满则先扩建，不占次数）
  if (
    diff !== 'easy' &&
    _canBuyFuncThisTurn(player) &&
    (buySink ||
      urgency >= 40 ||
      (Number(player.expandResSlots) || 0) >= 2 ||
      rate <= 1)
  ) {
    if (buildingSlotsTight(player)) {
      const pre = _buildTryExpandBuildingBeforeBuy(game, player, {
        allowExchange: true,
      });
      if (pre) return pre;
    } else if (canPay(player.resources, BUY_FUNC_COST)) {
      return { type: 'buyFuncCardPermanent' };
    } else if (
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

  // 1. 宫殿 score2：兑换越好越优先入手冲分；当前分越高越追；近胜再加码
  if (card.buildType === 'score2') {
    const canAfford = canPay(player.resources, card.cost || {});
    const chase = game ? scoreChaseFactor(player, game) : 1.2;
    const near = game ? _shouldBoostBuyForNearWin(game, player) : false;
    let base = Math.round(60 * chase);
    if (near) base = Math.round(base * 1.35);
    if (game) {
      if (hasLosslessExchange(player, game)) base = Math.round(230 * chase);
      else if (hasEfficientExchange(player, game)) base = Math.round(115 * chase);
      if (near) base = Math.round(base * 1.25);
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
    const chase = game ? scoreChaseFactor(player, game) : 1.2;
    const near = game ? _shouldBoostBuyForNearWin(game, player) : false;
    let base = Math.round(42 * chase);
    if (game) {
      if (hasLosslessExchange(player, game)) base = Math.round(140 * chase);
      else if (hasEfficientExchange(player, game)) base = Math.round(82 * chase);
    }
    if (near) base = Math.round(base * 1.4);
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
 * 1 购发展卡：手牌≥12、无需兑换；空位<12 时本回合最多 2 次，空位≥12 时第 1 步最多 1 次；
 *   建筑格已满则先扩建建筑格（不占扩建次数）再买
 * 2 建房：人口已满则建（含兑换；不预留繁殖粮）
 * 3 建造筑：达冲分门槛且有助于称号/分数（含兑换；门槛随当前分下调）
 * 4 建房：达高优冲分门槛（含兑换；门槛随当前分下调）
 * 5 繁殖：无需兑换
 * 5b 若本回合已繁殖且人口已满：decideBuildActionHard 入口额外优先建房（含兑换）
 * 6 扩资源格：手牌上限<18 则无视进场空位差（有木石就扩）；上限≥18 后进场空位≤5，无需兑换
 * 7 扩建筑格：建筑格已满（含兑换）
 * 8 建造筑：非宫殿，无需兑换
 * 9 繁殖：含兑换
 * 10 建房：达软冲分门槛（含兑换；分越高门槛越低）
 * 11 建造筑：非宫殿，含兑换
 * 12 扩资源格：上限<18 无视进场空位；上限≥18 后进场空位≤3（含兑换）
 * 13 建房：含兑换（不看分数）
 * 14 手牌≥6：依次 购卡→建造筑→建房→（空位≥12 则末尾继续购卡，否则可额外扩容）（全都含兑换）；
 *   购卡前若建筑格已满先扩建（不占次数）
 *
 * 每 tick 两轮：先整表只做「现货够就做」（无需兑换语义），再按原标记含兑换凑缺口。
 * 含兑换：资源缺口 > 2 就不兑（第 3、4 步冲分除外）。
 * 兑换时尽量留着后续动作还要用的资源。
 * 建房/繁殖本回合最多一次；资源/建筑扩建分开各最多一次；
 * 第 14 步手牌≥6：空位≥12 时购卡偏功能卡（含学堂），并连买到手牌 < 6；否则可再扩建一次（不占次数）。
 * 第 1 步购卡偏建筑卡（学堂不算建筑）；空位≥12 时第 1 步最多买 1 次，留给末段连买。
 * 建造筑可建多座。引擎购卡不要求功能手未满、不设次数硬上限。
 * 追分：整体意愿抬高，且当前分越高追分越强（门槛下调 + 分卡权重上调）。
 * 斩杀：入口若「分卡/称号建筑+建房」本回合可到胜利分，则压过购卡等一切步骤。
 * 近胜：仅距胜利 ≤1 分才加大购卡摸斩杀；分卡建造优先于购卡。
 * 人口：繁殖/建房优先于普通工坊建造；按回合期望村民数落后时更积极（含兑换）。
 */
function _hardBuildPipeline(game, player, botState, cashOnly) {
  const ex = (want) => (cashOnly ? false : want);
  const freePlenty = freeResourceSlots(player) >= 12;
  const constructMin = constructChaseMinScore(player, game);
  const houseHighMin = houseHighChaseMinScore(player, game);
  const houseSoftMin = houseSoftChaseMinScore(player, game);

  let act =
    _buildTryBuyFunc(game, player, {
      allowExchange: ex(false),
      minHand: 12,
      preferKind: 'building',
      // 空位宽时第 1 步最多 1 次，留给末段连买到手牌 < 6
      maxBuys: freePlenty ? 1 : BUY_FUNC_PER_TURN_MAX,
      botState,
    }) ||
    _buildTryHouse(game, player, {
      requireFullPop: true,
      allowExchange: ex(true),
      step: 2,
    }) ||
    // 有空位先繁殖（现货），避免被冲分建造抢走粮食
    _buildTryBreed(game, player, { allowExchange: false }) ||
    _buildTryConstruct(game, player, {
      allowExchange: ex(true),
      ignoreExchangeGap: true,
      minScore: constructMin,
      requireTitleOrScore: true,
      excludePalace: false,
      step: 3,
    }) ||
    _buildTryHouse(game, player, {
      minScore: houseHighMin,
      allowExchange: ex(true),
      ignoreExchangeGap: true,
      step: 4,
    }) ||
    _buildTryExpandResource(game, player, botState, {
      allowExchange: false,
      entryFreeMax: 5,
    }) ||
    _buildTryExpandBuilding(game, player, botState, {
      allowExchange: ex(true),
      step: 7,
    }) ||
    _buildTryConstruct(game, player, {
      allowExchange: false,
      excludePalace: true,
    }) ||
    _buildTryBreed(game, player, { allowExchange: ex(true), step: 9 }) ||
    _buildTryHouse(game, player, {
      minScore: houseSoftMin,
      allowExchange: ex(true),
      step: 10,
    }) ||
    _buildTryConstruct(game, player, {
      allowExchange: ex(true),
      excludePalace: true,
      step: 11,
    }) ||
    _buildTryExpandResource(game, player, botState, {
      allowExchange: ex(true),
      entryFreeMax: 3,
      step: 12,
    }) ||
    _buildTryHouse(game, player, {
      minScore: 0,
      allowExchange: ex(true),
      step: 13,
    });

  if (act) return act;

  if (sumRes(player.resources || {}) >= 6) {
    // 空位≥12：末段不限额，连买到手牌 < 6；否则仍受每回合 2 次限制
    const finaleBuyOpts = {
      allowExchange: ex(true),
      minHand: 0,
      preferKind: freePlenty ? 'function' : 'building',
      maxBuys: freePlenty ? BUY_FUNC_FINALE_UNLIMITED : BUY_FUNC_PER_TURN_MAX,
      botState,
    };
    const finaleTail = freePlenty
      ? _buildTryBuyFunc(game, player, { ...finaleBuyOpts, step: 17 })
      : _buildTryExpandResource(game, player, botState, {
          allowExchange: ex(true),
          entryFreeMax: 3,
          step: 17,
          finaleBonus: true,
        }) ||
        _buildTryExpandBuilding(game, player, botState, {
          allowExchange: ex(true),
          step: 18,
          finaleBonus: true,
        }) ||
        _buildTryExpandAny(game, player, botState, {
          allowExchange: ex(true),
          step: 19,
          finaleBonus: true,
        });
    act =
      _buildTryBuyFunc(game, player, { ...finaleBuyOpts, step: 14 }) ||
      _buildTryConstruct(game, player, {
        allowExchange: ex(true),
        excludePalace: false,
        step: 15,
      }) ||
      _buildTryHouse(game, player, {
        minScore: 0,
        allowExchange: ex(true),
        step: 16,
      }) ||
      finaleTail;
    if (act) return act;
  }

  return null;
}

/** 与 engine.WIN_SCORE / TEAM_WIN_SCORE / 称号分一致 */
const BOT_WIN_SCORE = 10;
const BOT_TEAM_WIN_SCORE = 15;
const BOT_TITLE_VP = 2;
const BOT_TITLE_NEED = 3;
const BOT_STACK_ACHIEVE_EXCLUDED = new Set([
  'score1',
  'score2',
  'produce',
  'exchange',
  'wishWell',
]);
/** 近胜购卡：选学堂/宫殿/冲称号建筑的加分（压过一般功能卡） */
const BUY_REDRAW_SCORE_TITLE_BIAS = 640;

function _botWinScoreOf(game) {
  return game && (game.teamMode || game.mode === 'h2h')
    ? BOT_TEAM_WIN_SCORE
    : BOT_WIN_SCORE;
}

/** 距胜利还差几分（组队看队伍总分） */
function _killLinePointsNeeded(game, player) {
  const winAt = _botWinScoreOf(game);
  if (game && (game.teamMode || game.mode === 'h2h')) {
    const team = player.team === 'B' ? 'B' : player.team === 'A' ? 'A' : null;
    if (team) {
      let s = 0;
      for (const p of alivePlayers(game)) {
        const pt = p.team === 'B' ? 'B' : p.team === 'A' ? 'A' : null;
        if (pt === team) s += playerScore(p, game);
      }
      return winAt - s;
    }
  }
  return winAt - playerScore(player, game);
}

/** 与 engine.buildingStackKey 对齐（叠放成就判定） */
function _engineBuildingStackKey(b) {
  if (!b) return '';
  if (b.buildType === 'produce') {
    return `produce:${b.resource}:${b.rich ? 'rich' : 'poor'}`;
  }
  return String(b.buildType || '');
}

function _isStackAchieveKey(key) {
  if (!key) return false;
  const buildType = String(key).split(':')[0];
  return !BOT_STACK_ACHIEVE_EXCLUDED.has(buildType);
}

function _stackAchievementScoreLocal(player) {
  const counts = {};
  for (const b of player.buildings || []) {
    if (!b.built) continue;
    const key = _engineBuildingStackKey(b);
    if (!_isStackAchieveKey(key)) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  let n = 0;
  for (const k of Object.keys(counts)) {
    if (counts[k] >= BOT_TITLE_NEED) n += 1;
  }
  return n * BOT_TITLE_VP;
}

function _buildingVp(b) {
  return Math.max(0, Number(b && b.score) || 0);
}

function _countBuiltWithPlan(player, plannedIds, pred) {
  const planned = plannedIds instanceof Set ? plannedIds : new Set(plannedIds || []);
  let n = 0;
  for (const b of player.buildings || []) {
    if (!b) continue;
    if (!(b.built || planned.has(b.id))) continue;
    if (pred(b)) n += 1;
  }
  return n;
}

/**
 * 建造该未建建筑相对「当前 + 已规划建成」额外带来的胜利分
 * （卡面分 + 叠放成就 + 商业巨擘/工坊主独占称号）。
 */
function _constructVpGain(player, game, building, plannedIds) {
  if (!player || !building || building.built) return 0;
  const planned = new Set(plannedIds || []);
  let vp = _buildingVp(building);

  const key = _engineBuildingStackKey(building);
  if (_isStackAchieveKey(key)) {
    const before = _countBuiltWithPlan(
      player,
      planned,
      (b) => _engineBuildingStackKey(b) === key
    );
    if (before === BOT_TITLE_NEED - 1) vp += BOT_TITLE_VP;
  }

  if (building.buildType === 'exchange') {
    const before = _countBuiltWithPlan(
      player,
      planned,
      (b) => b.buildType === 'exchange'
    );
    const after = before + 1;
    if (after >= BOT_TITLE_NEED) {
      const hold = Boolean(game && game.whatYouWantPlayerId === player.id);
      if (!hold) {
        const rivals = alivePlayers(game).filter(
          (p) => p.id !== player.id && !p.left
        );
        const rivalMax = Math.max(
          0,
          ...rivals.map((p) => countBuiltExchanges(p))
        );
        if (after > rivalMax) vp += BOT_TITLE_VP;
        else if (after === rivalMax && !game.whatYouWantPlayerId) {
          vp += BOT_TITLE_VP;
        }
      }
    }
  }

  if (building.buildType === 'produce' || building.buildType === 'wishWell') {
    const before = _countBuiltWithPlan(
      player,
      planned,
      (b) => b.buildType === 'produce' || b.buildType === 'wishWell'
    );
    const after = before + 1;
    if (after >= BOT_TITLE_NEED) {
      const hold = Boolean(game && game.workshopMasterPlayerId === player.id);
      if (!hold) {
        const rivals = alivePlayers(game).filter(
          (p) => p.id !== player.id && !p.left
        );
        const rivalMax = Math.max(
          0,
          ...rivals.map((p) => _workshopWishCount(p))
        );
        if (after > rivalMax) vp += BOT_TITLE_VP;
        else if (after === rivalMax && !game.workshopMasterPlayerId) {
          vp += BOT_TITLE_VP;
        }
      }
    }
  }

  return vp;
}

/** 可贡献斩杀分的未建建筑（分卡或冲称号） */
function _killLineScoreBuildings(player, game) {
  return (player.buildings || [])
    .filter((b) => b && !b.built && _constructVpGain(player, game, b, []) > 0)
    .slice()
    .sort((a, b) => {
      const d =
        _constructVpGain(player, game, b, []) -
        _constructVpGain(player, game, a, []);
      if (d) return d;
      return sumRes(a.cost || {}) - sumRes(b.cost || {});
    });
}

/** 在 sim 资源上付 cost（必要时按兑换率模拟凑齐）；成功则扣款并返回 true */
function _killSimPay(game, player, sim, cost) {
  if (canPay(sim, cost)) {
    pay(sim, cost);
    return true;
  }
  const fake = Object.assign({}, player, { resources: copyRes(sim) });
  if (!_canAffordCostViaExchange(game, fake, cost, null)) return false;
  const exchCost = effectiveExchangeCost(player, game);
  if (exchCost <= 0) return false;
  for (let guard = 0; guard < 20; guard++) {
    if (canPay(sim, cost)) {
      pay(sim, cost);
      return true;
    }
    let progressed = false;
    for (const needRes of RESOURCES) {
      const need = Number(cost[needRes]) || 0;
      if (need <= 0 || (sim[needRes] || 0) >= need) continue;
      for (const from of RESOURCES) {
        if (from === needRes) continue;
        const reserve = Number(cost[from]) || 0;
        const available = (sim[from] || 0) - reserve;
        if (available >= exchCost) {
          sim[from] -= exchCost;
          sim[needRes] = (sim[needRes] || 0) + 1;
          progressed = true;
          break;
        }
      }
      if (progressed) break;
      if (_exchangePoolAvailable(sim, cost, needRes) >= exchCost) {
        let left = exchCost;
        for (const from of RESOURCES) {
          if (from === needRes || left <= 0) continue;
          const reserve = Number(cost[from]) || 0;
          const take = Math.min(left, Math.max(0, (sim[from] || 0) - reserve));
          if (take > 0) {
            sim[from] -= take;
            left -= take;
          }
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
  pay(sim, cost);
  return true;
}

/** 仅距胜利 ≤1 分时才强力购卡摸学堂等斩杀；不要提早狂买 */
function _shouldBoostBuyForNearWin(game, player) {
  if (!player) return false;
  const need = _killLinePointsNeeded(game, player);
  return need > 0 && need <= 1;
}

function _noteScorePushFromAction(game, player, act) {
  if (!player || !act) return;
  if (act.type === 'buildHousePermanent') {
    player.__botBuildTurnScorePush = true;
    return;
  }
  if (act.type !== 'construct' || !act.payload || !act.payload.buildingId) return;
  const b = (player.buildings || []).find((x) => x.id === act.payload.buildingId);
  if (!b) return;
  if (_constructVpGain(player, game, b, []) > 0) {
    player.__botBuildTurnScorePush = true;
  }
}

function _isRedrawScoreOrTitleCard(player, card) {
  if (!card) return false;
  if (card.buildType === 'score1' || card.buildType === 'score2' || card.instantScore) {
    return true;
  }
  if (card.buildType === 'exchange' && countBuiltExchanges(player) < BOT_TITLE_NEED) {
    return true;
  }
  if (
    (card.buildType === 'wishWell' || card.buildType === 'produce') &&
    _workshopWishCount(player) < BOT_TITLE_NEED
  ) {
    return true;
  }
  return false;
}

/** 现货付得起且能加分/冲称号的未建建筑立刻建造（不含普通工坊，避免挤掉繁殖） */
function _tryConstructPayableScoreNow(game, player) {
  if (!game || !player) return null;
  const cands = _killLineScoreBuildings(player, game);
  for (const b of cands) {
    if (canPay(player.resources, b.cost || {})) {
      return { type: 'construct', payload: { buildingId: b.id } };
    }
  }
  return null;
}

/**
 * 人口增长期望：约 2 + ceil(round*0.55)，第 11 轮约 8 人。
 * 落后或空位紧时，繁殖/建房压过普通建造与购卡。
 */
function _expectedVillagersForRound(game) {
  const round = Math.max(1, Number(game && game.round) || 1);
  return Math.min(15, 2 + Math.ceil(round * 0.55));
}

function _populationBehind(game, player) {
  if (!player) return false;
  const vil = Number(player.villagers) || 0;
  return vil < _expectedVillagersForRound(game);
}

/** 满房建房 → 有空位繁殖 → 空位紧/人口落后时建房腾位 */
function _tryPopulationGrowthAction(game, player) {
  if (!game || !player) return null;
  const vil = Number(player.villagers) || 0;
  if (vil >= 15) return null;
  const free = freeHousesFor(player);
  const behind = _populationBehind(game, player);

  // 1) 满房：先建房（含兑换），否则无法繁殖
  if (free <= 0 && !player.roundBuiltHouse) {
    const fullHouse = _buildTryHouse(game, player, {
      requireFullPop: true,
      allowExchange: true,
      ignoreExchangeGap: true,
      step: 2,
    });
    if (fullHouse) return fullHouse;
  }

  // 2) 有空位：优先繁殖（落后时含兑换凑粮）
  if (free > 0 && !player.roundBred) {
    const breedCash = _buildTryBreed(game, player, { allowExchange: false });
    if (breedCash) return breedCash;
    if (behind || free <= 2) {
      const breedEx = _buildTryBreed(game, player, {
        allowExchange: true,
        ignoreExchangeGap: behind,
        step: 5,
      });
      if (breedEx) return breedEx;
    }
  }

  // 3) 空位紧或人口落后：即使未满房也积极建房，给后续繁殖留空位
  if (!player.roundBuiltHouse && (free <= 1 || behind)) {
    if (canPay(player.resources, BUILD_HOUSE_COST)) {
      return { type: 'buildHousePermanent' };
    }
    if (
      (behind || free <= 0) &&
      _canAffordCostViaExchange(game, player, BUILD_HOUSE_COST, null)
    ) {
      const exch = _exchangeTowardCost(game, player, BUILD_HOUSE_COST, null, null);
      if (exch) return exch;
    }
  }

  return null;
}

/**
 * 斩杀线：本回合靠「建分卡/冲称号建筑 + 建房」即可达胜利分时，返回第一步。
 * 必须压过购卡/繁殖/扩容等常规流水线（满手资源时尤甚）。
 */
function _tryKillLineAction(game, player) {
  if (!game || !player) return null;
  const need = _killLinePointsNeeded(game, player);
  if (need <= 0) return null;

  const buildings = _killLineScoreBuildings(player, game);
  let maxVp = player.roundBuiltHouse ? 0 : 1;
  const plannedProbe = [];
  for (const b of buildings) {
    maxVp += _constructVpGain(player, game, b, plannedProbe);
    plannedProbe.push(b.id);
  }
  if (maxVp < need) return null;

  // 贪心点满：高贡献（含称号）优先，不够再补建房
  const steps = [];
  const planned = [];
  let gained = 0;
  const pool = buildings.slice();
  while (gained < need && pool.length) {
    let bestIdx = 0;
    let bestVp = -1;
    for (let i = 0; i < pool.length; i++) {
      const vp = _constructVpGain(player, game, pool[i], planned);
      if (vp > bestVp) {
        bestVp = vp;
        bestIdx = i;
      }
    }
    if (bestVp <= 0) break;
    const b = pool.splice(bestIdx, 1)[0];
    steps.push({
      kind: 'construct',
      buildingId: b.id,
      cost: b.cost || {},
      vp: bestVp,
    });
    planned.push(b.id);
    gained += bestVp;
  }
  if (gained < need) {
    if (player.roundBuiltHouse) return null;
    steps.push({ kind: 'house', cost: BUILD_HOUSE_COST, vp: 1 });
    gained += 1;
  }
  if (gained < need || !steps.length) return null;

  const sim = copyRes(player.resources || {});
  for (const step of steps) {
    if (!_killSimPay(game, player, sim, step.cost)) return null;
  }

  const first = steps[0];
  if (first.kind === 'house') {
    if (canPay(player.resources, BUILD_HOUSE_COST)) {
      return { type: 'buildHousePermanent' };
    }
    return _exchangeTowardCost(game, player, BUILD_HOUSE_COST, null, null);
  }
  if (canPay(player.resources, first.cost)) {
    return { type: 'construct', payload: { buildingId: first.buildingId } };
  }
  return _exchangeTowardCost(game, player, first.cost, null, null);
}

/** 近胜时：先落一手能加分/冲称号的建造或建房，再考虑购卡 */
function _tryNearWinScoreAction(game, player) {
  if (!game || !player) return null;
  const need = _killLinePointsNeeded(game, player);
  if (need <= 0) return null;
  if (!_shouldBoostBuyForNearWin(game, player)) return null;

  const cands = _killLineScoreBuildings(player, game);
  for (const b of cands) {
    const cost = b.cost || {};
    if (canPay(player.resources, cost)) {
      return { type: 'construct', payload: { buildingId: b.id } };
    }
  }
  for (const b of cands) {
    const cost = b.cost || {};
    if (!_canAffordCostViaExchange(game, player, cost, null)) continue;
    const exch = _exchangeTowardCost(game, player, cost, null, null);
    if (exch) return exch;
  }
  if (!player.roundBuiltHouse && need <= 1) {
    if (canPay(player.resources, BUILD_HOUSE_COST)) {
      return { type: 'buildHousePermanent' };
    }
    if (_canAffordCostViaExchange(game, player, BUILD_HOUSE_COST, null)) {
      const exch = _exchangeTowardCost(game, player, BUILD_HOUSE_COST, null, null);
      if (exch) return exch;
    }
  }
  return null;
}

/**
 * 建造阶段手里资源已经超过上限：不能弃牌，也不能结束回合。
 * 流水线因「本回合已扩过 / 兑换缺口>2 / 购卡次数」停下来时，仍按
 * 繁殖 → 建房 → 建造 → 购卡 → 再扩资源手牌 继续花，直到不超上限。
 * 资源手牌扩到 24 后不再扩手牌，改继续花在建造或建筑格上。
 */
function _trySpendWhileOverCap(game, player, botState) {
  if (!resourceHandOverCap(player)) return null;
  const loose = { allowExchange: true, ignoreExchangeGap: true };

  const breed = _buildTryBreed(game, player, loose);
  if (breed) return breed;

  const house = _buildTryHouse(game, player, { ...loose, minScore: 0 });
  if (house) return house;

  if (!buildingSlotsTight(player)) {
    const built = _buildTryConstruct(game, player, {
      ...loose,
      excludePalace: false,
    });
    if (built) return built;
  }

  const buy = _buildTryBuyFunc(game, player, {
    ...loose,
    minHand: 0,
    preferKind: 'building',
    maxBuys: BUY_FUNC_FINALE_UNLIMITED,
    botState,
  });
  if (buy) return buy;

  if (!resourceHandExpandCapped(player)) {
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
    const exch = _exchangeTowardCost(game, player, EXPAND_COST, null, null);
    if (exch) return exch;
  }

  if (canPay(player.resources, EXPAND_COST)) {
    return { type: 'expandPermanent', payload: { direction: 'building' } };
  }
  return _exchangeTowardCost(game, player, EXPAND_COST, null, null);
}

function decideBuildActionHard(game, player, botState) {
  botState = botState || {};
  const kill = _tryKillLineAction(game, player);
  if (kill) return kill;

  // 人口增长优先于普通建造/购卡（满房建房、繁殖、落后时腾房）
  const pop = _tryPopulationGrowthAction(game, player);
  if (pop) return pop;

  // 仅现货分卡/称号建筑先建（普通工坊走流水线，不再抢繁殖）
  const scoreBuild = _tryConstructPayableScoreNow(game, player);
  if (scoreBuild) return scoreBuild;

  // 先做所有「现货已够」的动作，避免靠前含兑换步骤抢走后面本可直接做的繁殖/扩建
  const cash = _hardBuildPipeline(game, player, botState, true);
  if (cash) return cash;
  const withEx = _hardBuildPipeline(game, player, botState, false);
  if (withEx) return withEx;
  return { type: 'pass' };
}

const BUY_FUNC_PER_TURN_MAX = 2;
/** 空位≥12 末段连买：不设次数上限（仍受手牌≥6 / 费用约束） */
const BUY_FUNC_FINALE_UNLIMITED = 99;
/** 购卡翻开选牌时，对偏好 kind 的加分（压过集市/强化等基础分） */
const BUY_REDRAW_KIND_BIAS = 520;

function _buyFuncCountThisTurn(player) {
  return Math.max(
    0,
    Number(player.buildTurnBuyFuncCount) || 0,
    player.buildTurnUsedBuyFunc ? 1 : 0
  );
}

function _canBuyFuncThisTurn(player, maxBuys) {
  if (!player) return false;
  const cap =
    maxBuys != null && Number.isFinite(Number(maxBuys))
      ? Math.max(0, Number(maxBuys))
      : BUY_FUNC_PER_TURN_MAX;
  if (_buyFuncCountThisTurn(player) >= cap) return false;
  return true;
}

/** 学堂等：标识为建筑，但立刻生效，选牌时按功能卡偏好 */
function _isRedrawFunctionLike(card) {
  if (!card) return false;
  if (card.kind === 'function') return true;
  if (card.buildType === 'score1' || card.instantScore) return true;
  return false;
}

/** 真正占格建造的建筑（不含学堂） */
function _isRedrawBuildingLike(card) {
  if (!card || card.kind !== 'building') return false;
  if (card.buildType === 'score1' || card.instantScore) return false;
  return true;
}

function _buildTryBuyFunc(game, player, opts) {
  const allowExchange = Boolean(opts && opts.allowExchange);
  const minHand = opts && opts.minHand != null ? Number(opts.minHand) : 0;
  const maxBuys =
    opts && opts.maxBuys != null ? Number(opts.maxBuys) : BUY_FUNC_PER_TURN_MAX;
  if (sumRes(player.resources || {}) < minHand) return null;
  if (!_canBuyFuncThisTurn(player, maxBuys)) return null;

  // 建筑格已满：购卡前先扩建建筑格（不计入本回合扩建次数）
  if (buildingSlotsTight(player)) {
    const preExpand = _buildTryExpandBuildingBeforeBuy(game, player, opts);
    if (preExpand) return preExpand;
    // 格满又扩不了：先不买，避免入手建筑无处安放
    return null;
  }

  const preferKind = opts && opts.preferKind;
  const botState = opts && opts.botState;
  const markPrefer = () => {
    if (
      botState &&
      (preferKind === 'building' ||
        preferKind === 'function' ||
        preferKind === 'scoreTitle')
    ) {
      botState.buyRedrawPrefer = preferKind;
    }
    if (
      player &&
      (preferKind === 'building' ||
        preferKind === 'function' ||
        preferKind === 'scoreTitle')
    ) {
      player.__botBuyRedrawPrefer = preferKind;
    }
  };
  if (canPay(player.resources, BUY_FUNC_COST)) {
    markPrefer();
    return { type: 'buyFuncCardPermanent' };
  }
  if (allowExchange && _exchangeGapWorthIt(player, BUY_FUNC_COST, opts)) {
    markPrefer();
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

/**
 * 购卡前扩建建筑格：不检查 roundExpandedBuilding（不占本回合扩建次数）。
 * 兑换时尽量留着购卡四色；留不住再放开。
 */
function _buildTryExpandBuildingBeforeBuy(game, player, opts) {
  if (!player || !buildingSlotsTight(player)) return null;
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
  if (!allowExchange) return null;
  if (!_exchangeGapWorthIt(player, EXPAND_COST, opts)) return null;
  const soft = _laterSoftReserve(game, player, opts && opts.step);
  // 优先不动购卡原料；否则放开再兑
  return (
    _exchangeTowardCost(game, player, EXPAND_COST, BUY_FUNC_COST, soft) ||
    _exchangeTowardCost(game, player, EXPAND_COST, null, soft)
  );
}

/** 建房；requireFullPop 时仅人口已满才建（不预留繁殖粮） */
function _buildTryHouse(game, player, opts) {
  if (!player || player.roundBuiltHouse) return null;
  if (opts && opts.requireFullPop && freeHousesFor(player) > 0) return null;
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
  if (resourceHandExpandCapped(player)) return null;
  const finaleBonus = Boolean(opts && opts.finaleBonus);
  if (finaleBonus) {
    if (player && player.buildTurnFinaleExpanded) return null;
  } else if (player && player.roundExpandedResource) {
    return null;
  }
  const allowExchange = Boolean(opts && opts.allowExchange);
  // 手牌上限 < 18：无视进建造回合空位差，有资源就扩；≥18 后才看 entryFreeMax
  if (opts && opts.entryFreeMax != null) {
    if (!resourceHandCapBelow18(player)) {
      const entry = ensureBuildTurnEntryFree(player);
      if (entry == null || entry > Number(opts.entryFreeMax)) return null;
    }
  } else if (!shouldExpandResourceHand(player, game, botState)) {
    return null;
  }
  if (canPay(player.resources, EXPAND_COST)) {
    if (finaleBonus) player.buildTurnFinaleExpanded = true;
    markExpandedResource(botState, player);
    return { type: 'expandPermanent', payload: { direction: 'resource' } };
  }
  const freeExpand = (player.funcCards || []).find((c) => c.funcType === 'expand');
  if (freeExpand) {
    if (finaleBonus) player.buildTurnFinaleExpanded = true;
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
  const finaleBonus = Boolean(opts && opts.finaleBonus);
  if (finaleBonus) {
    if (player && player.buildTurnFinaleExpanded) return null;
  } else if (player && player.roundExpandedBuilding) {
    return null;
  }
  if (!buildingSlotsTight(player)) return null;
  const allowExchange = Boolean(opts && opts.allowExchange);
  if (canPay(player.resources, EXPAND_COST)) {
    if (finaleBonus) player.buildTurnFinaleExpanded = true;
    return { type: 'expandPermanent', payload: { direction: 'building' } };
  }
  const freeExpand = (player.funcCards || []).find((c) => c.funcType === 'expand');
  if (freeExpand) {
    if (finaleBonus) player.buildTurnFinaleExpanded = true;
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

/** 手牌高压兜底：任意方向扩容。上限≥18 时资源方向仍受进场空位≤3 约束。 */
function _buildTryExpandAny(game, player, botState, opts) {
  const allowExchange = Boolean(opts && opts.allowExchange);
  const finaleBonus = Boolean(opts && opts.finaleBonus);
  if (finaleBonus && player && player.buildTurnFinaleExpanded) return null;
  const entry = ensureBuildTurnEntryFree(player);
  const wantResource =
    !resourceHandExpandCapped(player) &&
    (finaleBonus || !player.roundExpandedResource) &&
    (resourceHandCapBelow18(player) || (entry != null && entry <= 3));
  const wantBuilding =
    buildingSlotsTight(player) && (finaleBonus || !player.roundExpandedBuilding);
  const wantFunc =
    (player.funcCards || []).length >= maxFuncHandFor(player) &&
    (finaleBonus || !player.roundExpandedFunction);
  if (!wantResource && !wantBuilding && !wantFunc) return null;
  if (canPay(player.resources, EXPAND_COST)) {
    let dir = 'building';
    if (wantBuilding) dir = 'building';
    else if (wantFunc) dir = 'function';
    else if (wantResource) dir = 'resource';
    else return null;
    if (finaleBonus) player.buildTurnFinaleExpanded = true;
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
 * 注意：兑换防循环状态不能在「扩建/购卡」时清掉，否则木↔石会隔一步继续抖。
 * 只在 pass / 新建造回合清空。
 */
function _finishBuildAct(player, act) {
  if (!act || act.type === 'pass') _clearExchangeMemory(player);
  return act;
}

function decideBuildAction(game, player, diff, botState) {
  if (game.buildPassed && game.buildPassed[player.id]) return null;
  botState = botState || {};
  ensureBuildTurnEntryFree(player);

  const overflow = decideResourceOverflow(game, player, diff, botState);
  if (overflow) return _finishBuildAct(player, overflow);

  // 斩杀线优先于功能卡与常规流水线（满手时尤防购卡插队）
  const kill = _tryKillLineAction(game, player);
  if (kill) {
    _noteScorePushFromAction(game, player, kill);
    return _finishBuildAct(player, kill);
  }

  // 人口增长优先：繁殖/建房压过近胜购卡与普通建造
  const pop = _tryPopulationGrowthAction(game, player);
  if (pop) {
    _noteScorePushFromAction(game, player, pop);
    return _finishBuildAct(player, pop);
  }

  // 近胜购卡前：现货分卡/称号建筑先建掉
  if (_shouldBoostBuyForNearWin(game, player)) {
    const buildNow = _tryConstructPayableScoreNow(game, player);
    if (buildNow) {
      _noteScorePushFromAction(game, player, buildNow);
      return _finishBuildAct(player, buildNow);
    }
    const nearScore = _tryNearWinScoreAction(game, player);
    if (nearScore) {
      _noteScorePushFromAction(game, player, nearScore);
      return _finishBuildAct(player, nearScore);
    }
    const nearBuy = _buildTryBuyFunc(game, player, {
      allowExchange: true,
      minHand: 0,
      preferKind: 'scoreTitle',
      maxBuys: BUY_FUNC_FINALE_UNLIMITED,
      ignoreExchangeGap: true,
      botState,
    });
    if (nearBuy) return _finishBuildAct(player, nearBuy);
  }

  if (diff === 'hard') {
    const useFunc = decideUseFuncCardHard(game, player, botState);
    if (useFunc) return _finishBuildAct(player, useFunc);
    let hardAct = decideBuildActionHard(game, player, botState);
    if (!hardAct || hardAct.type === 'pass') {
      const dump = _trySpendWhileOverCap(game, player, botState);
      if (dump) hardAct = dump;
    }
    _noteScorePushFromAction(game, player, hardAct);
    return _finishBuildAct(player, hardAct);
  }

  const useFunc = decideUseFuncCard(game, player, diff, botState);
  if (useFunc) return _finishBuildAct(player, useFunc);

  // normal/easy：空位≤9 也扩资源位
  if (
    shouldExpandResourceHand(player, game, botState) &&
    canPay(player.resources, EXPAND_COST)
  ) {
    markExpandedResource(botState, player);
    return _finishBuildAct(player, {
      type: 'expandPermanent',
      payload: { direction: 'resource' },
    });
  }
  if (shouldExpandResourceHand(player, game, botState)) {
    const exch = _exchangeTowardCost(game, player, EXPAND_COST);
    if (exch) return _finishBuildAct(player, exch);
  }

  const canHouse =
    canPay(player.resources, BUILD_HOUSE_COST) && !player.roundBuiltHouse;
  const canBreed =
    !player.roundBred &&
    player.villagers < 15 &&
    freeHousesFor(player) > 0 &&
    (player.resources.food || 0) >= breedFoodCost(player.villagers);

  if (diff === 'easy') {
    if (canBreed) return _finishBuildAct(player, { type: 'breedPermanent' });
    if (canHouse) {
      return _finishBuildAct(player, { type: 'buildHousePermanent' });
    }
  } else {
    if (shouldPrioritizeHouse(player, game) && !player.roundBuiltHouse) {
      if (canHouse) {
        return _finishBuildAct(player, { type: 'buildHousePermanent' });
      }
      if (_canAffordCostViaExchange(game, player, BUILD_HOUSE_COST)) {
        const exch = _exchangeTowardCost(game, player, BUILD_HOUSE_COST);
        if (exch) return _finishBuildAct(player, exch);
      }
    }
    if (canHouse) {
      return _finishBuildAct(player, { type: 'buildHousePermanent' });
    }
    if (canBreed) return _finishBuildAct(player, { type: 'breedPermanent' });
    if (_canBreedNowOrViaExchange(game, player)) {
      const foodNeed = breedFoodCost(player.villagers);
      const exch = _exchangeTowardCost(game, player, { food: foodNeed });
      if (exch) return _finishBuildAct(player, exch);
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
    return _finishBuildAct(player, {
      type: 'expandPermanent',
      payload: { direction: dir },
    });
  }

  const buildable = (player.buildings || []).filter(
    (b) => !b.built && canPay(player.resources, b.cost || {})
  );
  if (buildable.length) {
    if (diff === 'easy') {
      buildable.sort((a, b) => (b.score || 0) - (a.score || 0));
      return _finishBuildAct(player, {
        type: 'construct',
        payload: { buildingId: buildable[0].id },
      });
    }
    buildable.sort(
      (a, b) =>
        scoreBuildingForNormal(player, b, game) - scoreBuildingForNormal(player, a, game)
    );
    return _finishBuildAct(player, {
      type: 'construct',
      payload: { buildingId: buildable[0].id },
    });
  }
  if (diff === 'normal' && hasEfficientExchange(player, game)) {
    const almost = (player.buildings || [])
      .filter((b) => !b.built && !canPay(player.resources, b.cost || {}))
      .filter((b) => _canAffordCostViaExchange(game, player, b.cost || {}))
      .sort(
        (a, b) =>
          scoreBuildingForNormal(player, b, game) - scoreBuildingForNormal(player, a, game)
      );
    if (almost.length) {
      const exch = _exchangeTowardCost(game, player, almost[0].cost || {});
      if (exch) return _finishBuildAct(player, exch);
    }
  }

  if (
    diff === 'normal' &&
    _canBuyFuncThisTurn(player) &&
    (prefersBuyFuncSink(player, game) || hasLosslessExchange(player, game))
  ) {
    if (canPay(player.resources, BUY_FUNC_COST)) {
      return _finishBuildAct(player, { type: 'buyFuncCardPermanent' });
    }
    if (_canAffordCostViaExchange(game, player, BUY_FUNC_COST)) {
      const exch = _exchangeTowardCost(game, player, BUY_FUNC_COST);
      if (exch) return _finishBuildAct(player, exch);
    }
  }

  const spend = decideSpendBeforePass(game, player, diff, botState);
  if (spend) return _finishBuildAct(player, spend);

  const dump = _trySpendWhileOverCap(game, player, botState);
  if (dump) return _finishBuildAct(player, dump);

  return _finishBuildAct(player, { type: 'pass' });
}

/* ?????????? ????????????????? */

function decidePendingAction(game, player, diff, botState) {
  // pendingRedrawChoice：翻开 3 选 1
  if (game.pendingRedrawChoice && game.pendingRedrawChoice.playerId === player.id) {
    const options = game.pendingRedrawChoice.options || [];
    if (!options.length) return { type: 'redrawPick', payload: { cardId: null } };
    if (diff === 'easy') {
      const pick = pickRandom(options);
      return { type: 'redrawPick', payload: { keepId: pick ? pick.id : null } };
    }
    // buyFunc：第 1 步偏建筑（学堂除外），末尾空位≥12 偏功能（含学堂）；
    // 近胜时偏学堂/宫殿/冲称号建筑（偏好写在 player 上，跨 tick 仍有效）
    const source = game.pendingRedrawChoice.source || 'redraw';
    let preferKind = null;
    if (source === 'buyFunc') {
      preferKind =
        (botState && botState.buyRedrawPrefer) ||
        player.__botBuyRedrawPrefer ||
        null;
      if (!preferKind && _shouldBoostBuyForNearWin(game, player)) {
        preferKind = 'scoreTitle';
      }
    }
    const nearWinPick = _shouldBoostBuyForNearWin(game, player);
    let best = options[0];
    let bestScore = -Infinity;
    for (const c of options) {
      let sc = 0;
      if (c.kind === 'building') {
        sc = _scoreCardOptionBuilding(player, c, diff, game);
      } else if (c.kind === 'function') {
        sc = _scoreCardOptionFunction(player, c, diff);
      }
      if (preferKind === 'function' && _isRedrawFunctionLike(c)) {
        sc += BUY_REDRAW_KIND_BIAS;
      } else if (preferKind === 'building' && _isRedrawBuildingLike(c)) {
        sc += BUY_REDRAW_KIND_BIAS;
      }
      if (
        (preferKind === 'scoreTitle' || nearWinPick) &&
        _isRedrawScoreOrTitleCard(player, c)
      ) {
        sc += BUY_REDRAW_SCORE_TITLE_BIAS;
      }
      if (sc > bestScore) {
        bestScore = sc;
        best = c;
      }
    }
    if (source === 'buyFunc') {
      if (botState) botState.buyRedrawPrefer = null;
      player.__botBuyRedrawPrefer = null;
    }
    return { type: 'redrawPick', payload: { keepId: best ? best.id : null } };
  }

  // pendingWelfareMinimumChoices ??????
  if (game.pendingWelfareMinimumChoices && game.pendingWelfareMinimumChoices[player.id]) {
    const count = game.pendingWelfareMinimumChoices[player.id].count || 2;
    return {
      type: 'eventPickTwoResources',
      payload: { amounts: pickProduceAnyResourceAmounts(player, count) },
    };
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
    return {
      type: 'allocateWishWell',
      payload: { alloc: pickProduceAnyResourceAmounts(player, need) },
    };
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
    if (need === 'pickTwoResources') {
      const count = ev.count || 2;
      return {
        type: 'eventPickTwoResources',
        payload: { amounts: pickProduceAnyResourceAmounts(player, count) },
      };
    }
    return {
      type: 'eventPickResource',
      payload: { resource: pickProduceAnyResource(player) || 'iron' },
    };
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
      // 非己方骰不触发落点派遣事件（晴空/以身入局等无收益）
      if (moverRank === 0) {
        if (toArea === 'special') {
          return -160 - (hasEnhance ? 90 : 30);
        }
        return -100 - large * 14;
      }

      const rFactor = rivalsLossFactor(game);
      // 落点原先的第一名（须是「另一名」对手，不是被挪的 A）
      const beforeRivalFirst =
        beforeRanked[0] &&
        beforeRanked[0][0] !== player.id &&
        beforeRanked[0][0] !== '__neutral__' &&
        beforeRanked[0][0] !== moverId
          ? beforeRanked[0][0]
          : null;

      // 砸掉 B 的独占/第一：按大份计对手损失；A 也被对冲掉则纯赚双毁
      if (beforeRivalFirst && !remain[beforeRivalFirst]) {
        let deny = toArea === 'special' ? 70 : 48 + large * 8 * rFactor;
        if (!remain[moverId]) {
          // A 与 B 同归于尽：无第三人接手，压过「自骰去占空格」（自占有被超风险）
          deny += 38 + large * 4 * rFactor;
        } else if (moverRank === 1) {
          deny += 6;
        }
        return deny;
      }
      if (beforeRivalFirst && afterFirst !== beforeRivalFirst) {
        // B 降级但格上仍有第一（第三人接手）
        const demote =
          toArea === 'special'
            ? 32
            : 18 + Math.max(0, large - small) * 8 * rFactor;
        return demote;
      }

      if (moverRank === 1) {
        return -20 - small * 5;
      }
      // 对冲掉 / 无名次：可接受的「寄放」
      return 6;
    }

    // —— 移动中立：用来拆对手第一（中立亦不触发派遣事件）——
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
    if (hasRecruit) score += 28;
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
    // 派遣类：仅自己的骰触发；只有「成为最大」类首次触发才值钱；已是第一再加码通常不触发
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

/** 抵消后某玩家名次：1=第一，2=第二，0=无名次（含对冲掉） */
function _rankAfterCancel(remain, ranked, playerId) {
  if (!remain || !(Number(remain[playerId]) > 0)) return 0;
  for (let i = 0; i < ranked.length; i++) {
    if (ranked[i][0] === playerId) return i + 1;
  }
  return 0;
}

/** 抵消后非中立的 1/2 名玩家 id 列表（稳定排序） */
function _topNonNeutralPids(ranked) {
  const out = [];
  for (const [pid] of ranked || []) {
    if (pid === '__neutral__') continue;
    out.push(pid);
    if (out.length >= 2) break;
  }
  return out;
}

/**
 * 从 from 格挪走自己 1 枚后，是否「不影响自己名次」：
 * - 挪后仍是第一；或
 * - 本就已对冲掉（无名次），挪后仍无名次，且非中立 1/2 名集合不变
 *   （避免 A=B=1 对冲时撤走自己送给对方独占）
 */
function _teleportOwnRemovalPreservesStanding(game, player, fromArea, fromNumber) {
  const board = game.board && game.board[fromArea];
  if (!board || !player) return false;
  const beforeWk = {
    ...(board.workers && board.workers[fromNumber] ? board.workers[fromNumber] : {}),
  };
  if ((Number(beforeWk[player.id]) || 0) <= 0) return false;
  const boosts = { ...((board.boosts && board.boosts[fromNumber]) || {}) };

  const beforeRemain = _cancelEqualCountsLocal(_slotStrengthLocal(beforeWk, boosts));
  const beforeRanked = Object.entries(beforeRemain).sort((a, b) => b[1] - a[1]);
  const beforeRank = _rankAfterCancel(beforeRemain, beforeRanked, player.id);

  const afterWk = { ...beforeWk };
  afterWk[player.id] = (Number(afterWk[player.id]) || 0) - 1;
  if (afterWk[player.id] <= 0) delete afterWk[player.id];
  const afterBoosts = { ...boosts };
  if (afterBoosts[player.id]) {
    afterBoosts[player.id] = Math.max(0, (Number(afterBoosts[player.id]) || 0) - 1);
    if (!afterBoosts[player.id]) delete afterBoosts[player.id];
  }
  const afterRemain = _cancelEqualCountsLocal(_slotStrengthLocal(afterWk, afterBoosts));
  const afterRanked = Object.entries(afterRemain).sort((a, b) => b[1] - a[1]);
  const afterRank = _rankAfterCancel(afterRemain, afterRanked, player.id);

  if (beforeRank === 1 && afterRank === 1) return true;

  if (beforeRank === 0 && afterRank === 0) {
    const beforeTops = _topNonNeutralPids(beforeRanked);
    const afterTops = _topNonNeutralPids(afterRanked);
    if (beforeTops.length !== afterTops.length) return false;
    for (let i = 0; i < beforeTops.length; i++) {
      if (beforeTops[i] !== afterTops[i]) return false;
    }
    return true;
  }
  return false;
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

  // 挪自己的骰：丢掉独占/第一名要付代价；名次不变则可轻奖（便于重配到独占格）
  if (targetId === player.id) {
    if (beforeFirst === player.id && afterFirst !== player.id) {
      // 失去第一 / 整格清空 → 按该格大份重罚
      score -= fromArea === 'special' ? 55 : 32 + large * 8 * factor;
      return score;
    }
    if (_teleportOwnRemovalPreservesStanding(game, player, fromArea, fromNumber)) {
      // 仍第一或本就对冲且不送出 1/2 名：鼓励挪去别处独占
      return playerCount(game) >= 3 ? 28 : 14;
    }
    if (beforeFirst === player.id && afterFirst === player.id) {
      // 仍第一但变薄（未被判定为「安全」的边角）
      const myAfter = Number(afterRemain[player.id]) || 0;
      const second = afterRanked[1] ? afterRanked[1][1] : 0;
      score -= myAfter <= second + 1 ? 10 : 3;
      return score;
    }
    // 本就不是第一：允许撤出重配
    return 6;
  }

  // 拆掉对手第一 → 自己变第一
  const rFactor = rivalsLossFactor(game);
  if (beforeFirst === targetId && afterFirst === player.id) {
    if (fromArea === 'special') score += 70;
    else score += 35 + large * 8 * factor;
  } else if (beforeFirst === targetId && afterFirst !== targetId) {
    // 拆掉对手独占（按大份计对手损失；无人接手再奖）
    score += fromArea === 'special' ? 55 : 32 + large * 8 * rFactor;
    if (!afterFirst || afterFirst === '__neutral__') score += 14;
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
 * 优先：拆 A 独占再砸 B 独占（双毁纯赚）> 名次不变的自骰重配 > 中立对冲。
 */
function _decideTeleport(game, player, ev, diff) {
  const step = ev.teleportStep || 'from';

  if (step === 'from') {
    const cands = _listTeleportFromCandidates(game);
    if (!cands.length) return null;

    const multi = playerCount(game) >= 3;

    const removalStripsRivalFirst = (from) => {
      if (
        !from ||
        from.targetId === player.id ||
        from.targetId === '__neutral__'
      ) {
        return false;
      }
      const board = game.board && game.board[from.area];
      if (!board) return false;
      const beforeWk = {
        ...((board.workers && board.workers[from.number]) || {}),
      };
      const boosts = { ...((board.boosts && board.boosts[from.number]) || {}) };
      const beforeRemain = _cancelEqualCountsLocal(
        _slotStrengthLocal(beforeWk, boosts)
      );
      const beforeRanked = Object.entries(beforeRemain).sort(
        (a, b) => b[1] - a[1]
      );
      if (!beforeRanked[0] || beforeRanked[0][0] !== from.targetId) return false;
      const afterWk = { ...beforeWk };
      afterWk[from.targetId] = (Number(afterWk[from.targetId]) || 0) - 1;
      if (afterWk[from.targetId] <= 0) delete afterWk[from.targetId];
      const afterBoosts = { ...boosts };
      if (afterBoosts[from.targetId]) {
        afterBoosts[from.targetId] = Math.max(
          0,
          (Number(afterBoosts[from.targetId]) || 0) - 1
        );
        if (!afterBoosts[from.targetId]) delete afterBoosts[from.targetId];
      }
      const afterRemain = _cancelEqualCountsLocal(
        _slotStrengthLocal(afterWk, afterBoosts)
      );
      const afterRanked = Object.entries(afterRemain).sort(
        (a, b) => b[1] - a[1]
      );
      const afterFirst = afterRanked[0] ? afterRanked[0][0] : null;
      return afterFirst !== from.targetId;
    };

    // 预扫描：双毁（拆 A + 砸 B）与安全自撤
    let bestDualDenyCombo = -Infinity;
    let bestSafeSelfDest = -Infinity;
    for (const from of cands) {
      const dest = _bestTeleportDestination(
        game,
        player,
        from.area,
        from.number,
        from.targetId,
        diff
      );
      if (
        from.targetId === player.id &&
        _teleportOwnRemovalPreservesStanding(
          game,
          player,
          from.area,
          from.number
        ) &&
        dest &&
        dest.score > bestSafeSelfDest
      ) {
        bestSafeSelfDest = dest.score;
      }
      if (removalStripsRivalFirst(from) && dest && dest.score >= 48) {
        const remSc = _scoreTeleportFromRemoval(
          game,
          player,
          from.area,
          from.number,
          from.targetId,
          diff
        );
        const combo = dest.score + remSc;
        if (combo > bestDualDenyCombo) bestDualDenyCombo = combo;
      }
    }
    const preferDualDeny = bestDualDenyCombo >= 90;
    const preferSafeSelfRedeploy =
      multi && !preferDualDeny && bestSafeSelfDest >= 24;

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
      if (from.targetId === player.id) {
        const board = game.board && game.board[from.area];
        const myCnt =
          (board &&
            board.workers &&
            board.workers[from.number] &&
            Number(board.workers[from.number][player.id])) ||
          0;
        const safe = _teleportOwnRemovalPreservesStanding(
          game,
          player,
          from.area,
          from.number
        );
        if (safe) {
          sc += multi ? 22 : 10;
          if (dest && dest.score >= 24) sc += multi ? 55 : 28;
          // 有双毁时自占空格让路（自占有被超风险，双毁纯赚）
          if (preferDualDeny) sc -= multi ? 70 : 40;
        } else {
          sc += myCnt >= 2 ? 8 : 1;
        }
      } else if (from.targetId === '__neutral__') {
        let neuBonus = dest && dest.score >= 40 ? 10 : 3;
        if (preferDualDeny || preferSafeSelfRedeploy) neuBonus -= 50;
        else if (multi) neuBonus = Math.floor(neuBonus * 0.5);
        sc += neuBonus;
      } else if (removalStripsRivalFirst(from) && dest && dest.score >= 48) {
        sc += multi ? 45 : 28;
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
  estimateSpecialTilePlaceValue,
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
  pickProduceAnyResource,
  pickProduceAnyResourceAmounts,
};
