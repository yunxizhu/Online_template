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

const RESOURCES = ['wood', 'stone', 'food', 'iron'];
const BOARD_AREAS = ['resource', 'special'];

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
function freeHousesFor(player) {
  const cap =
    (Number(player.houses) || 0) +
    (Number(player.welfareHouses) || 0) +
    (Number(player.expandSlots) || 0) * 3;
  return Math.max(0, cap - (Number(player.villagers) || 0));
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
 */
function canIgnoreRivalScarceStackPenalty(game, player, face, count, env) {
  if (!env || !player) return false;
  const wk = slotWorkers(game.board && game.board.resource, face) || {};
  const myPrev = Number(wk[player.id]) || 0;
  const after = myPrev + Math.max(0, Number(count) || 0);
  if (env.envType === 'firstCome' && !env.stashClaimed) {
    const required =
      env.firstComeRequired != null
        ? Number(env.firstComeRequired)
        : firstComeRequiredWorkers(game.round);
    return myPrev < required && after > myPrev;
  }
  if (env.envType === 'resistBarbarians') {
    const need = _resistBarbariansNeedDice(game.round);
    return myPrev < need && after > myPrev;
  }
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

function markExpandedResource(botState) {
  if (!botState) return;
  // 清掉本次标记；下轮再生产若再爆牌可再扩
  botState.needExpandRes = false;
  botState.wasOverCap = false;
  botState.didExpand = true;
  botState.expandedResOnce = true;
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
  if (game && game.caravanPlayerId === player.id) return 1;
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

/** ????????????2??00%, 3??0%, 4??7.5%, 5??5% */
function rivalsLossFactor(game) {
  const n = playerCount(game);
  if (n <= 2) return 1.0;
  if (n === 3) return 0.50;
  if (n === 4) return 0.375;
  return 0.25;
}

/** ????????????2??00%, 3??15%, 4??30%, 5??45% */
function selfGainFactor(game) {
  const n = playerCount(game);
  if (n <= 2) return 1.0;
  if (n === 3) return 1.15;
  if (n === 4) return 1.30;
  return 1.45;
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
 * 核心分 = 对手因此丢掉的资源收益（大份/降级），而非固定低额奖励。
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
      score += 70 + (hasEnhance ? 45 : 18);
    } else if (rivalDemoted) {
      score += 32;
    }
  } else if (rivalCancelled) {
    // 对手失去第一名大份（全额按对手损失计）
    score += large * 8 * rFactor;
    // 额外：拆独占/搅局溢价
    score += 18;
    if (env && env.envType === 'mercenaries') score += 50;
  } else if (rivalDemoted) {
    // 第一→第二：损失大份与小份之差
    score += Math.max(0, large - small) * 8 * rFactor + 10;
  } else if (rivalId && (Number(beforeWk[rivalId]) || 0) > 0) {
    score += 8 + Math.min(n, 2) * 4;
  }

  // 砸完后自己变第一：额外拿到该格大份
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
 * 以身入局派遣估值 = 最佳中立对冲（含对手损失大份）+ 保底。
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
  if (!Number.isFinite(bestDrop)) bestDrop = 0;

  // 有可对冲目标时：对冲分 + 发动溢价；无目标时给低保底
  if (bestDrop > 0) {
    return Math.round(bestDrop + 16 + Math.min(moveN, 3) * 3);
  }
  return 10;
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
 * 剩余空闲村民较多时，占坑降低后续触发难度；库存已领走 / 南蛮格对手骰过多则不加。
 */
function estimateThresholdChaseBonus(game, player, number, count, selfRank) {
  const env = envOnResourceSlot(game, number);
  if (!env) return 0;
  const wk = slotWorkers(game.board && game.board.resource, number) || {};
  const myPrev = Number(wk[player.id]) || 0;
  const placed = Math.max(0, Number(count) || 0);
  const after = myPrev + placed;
  const remAfter = Math.max(0, remainingDiceCount(player) - placed);
  const villagers = Number(player.villagers) || 0;
  // 剩余较多才值得追：≥3，或村民池大且仍有 ≥2
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

function breedFoodCost(villagers) {
  // ??engine ???0????????????????????????????..
  if (villagers <= 2) return 2;
  if (villagers <= 4) return 3;
  return 4;
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
        enhance: 26,
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
 * 场上无主板块数：有牌且无任何玩家骰（中立不算有主）。
 */
function countUnownedBoardSlots(game) {
  let n = 0;
  const openMax = _specialOpenMax(game);
  for (const area of BOARD_AREAS) {
    const board = game.board && game.board[area];
    if (!board) continue;
    const maxFace = area === 'special' ? openMax : 6;
    for (let face = 1; face <= maxFace; face++) {
      if (!tilesOnNumber(board, face).length) continue;
      const wk = slotWorkers(board, face);
      let owned = false;
      for (const [pid, c] of Object.entries(wk)) {
        if (pid === '__neutral__') continue;
        if ((Number(c) || 0) > 0) {
          owned = true;
          break;
        }
      }
      if (!owned) n += 1;
    }
  }
  return n;
}

/**
 * 无主板块机会成本：数量越多负分越高。
 * @param {number} weight 权重（多骰可用 count-1；跳过用 1）
 */
function unownedBoardOpportunityPenalty(game, weight) {
  const w = Math.max(0, Number(weight) || 0);
  if (w <= 0) return 0;
  const n = countUnownedBoardSlots(game);
  if (n <= 0) return 0;
  const per = Math.round(4 * selfGainFactor(game));
  return n * per * w;
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

/** 爆 1 骰换 1 任意资源的基准分（与 1 资源 ≈ 8 同量级）
 * 注意：不把「结束本回合后剩余村民下回合重掷」算进收益——
 * 放置某一面点数后同样会结束回合并重掷剩余空闲，两边对称；
 * 若只加在爆骰上，会把单骰占坑（幸运一抽等）误判成去爆骰。
 */
function scoreVoidSkipOption(game, player, diff) {
  const dice = (game.dice && game.dice[player.id]) || [];
  if (!dice.length || idleVillagers(player) <= 0) return -Infinity;

  const factor = selfGainFactor(game);
  // 仅计「立刻拿到 1 任意资源」，不含延后重掷
  let score = Math.round(6 * factor);

  const needs = estimateResourceNeeds(player);
  const target = pickMostNeededResource(player, needs);
  const have = player.resources || {};
  if (target) {
    const gap = (needs[target] || 0) - (have[target] || 0);
    if (gap > 0) score += Math.min(2, gap);
  }

  // 开局空手：立刻拿到任意资源更值钱（幅度需低于「稳拿大份」以免误爆）
  const hand = sumRes(have);
  if (hand === 0) score += diff === 'hard' ? 3 : 2;
  else if (hand <= 2 && (Number(game.round) || 1) <= 3) score += 1;

  // 场上无主板块越多，跳过浪费落子机会 → 负分越高
  score -= unownedBoardOpportunityPenalty(game, 1);

  return score;
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
      if (!canIgnoreRivalScarceStackPenalty(game, player, face, count, env)) {
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
    // 以身入局会移走中立：即使本格对冲掉自己，事件对冲收益通常更值
    else if (env && env.envType === 'enterFray') score += 28;
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

  // 非先到先得/抵抗南蛮：单次多枚时，场上无主板块越多惩罚越重
  if (count >= 2 && !isMultiDiceThresholdEnv(env)) {
    score -= unownedBoardOpportunityPenalty(game, count - 1);
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
    score += est.rivalsLoss * 5;
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
      if (myRemAfter <= 0 && maxRival >= 2) {
        score -= 15;
      } else if (myRemAfter <= 0 && maxRival === 1) {
        score += 5;
      } else if (myRemAfter <= 0 && maxRival === 0) {
        // 超额堆骰 / 已是第一再加码：安全独占不是本步新收益
        score += surplus > 0 || alreadyFirstBefore ? 0 : 25;
      } else if (risk < 0.3) {
        score += alreadyFirstBefore ? 3 : 12;
      } else if (risk < 0.5) {
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
 * ??????????? face + area ?? placeDice
 * ?? { type:'placeDice', payload:{ face, area, count? } } ??null
 */
function decidePlaceDice(game, player, diff, botState) {
  const dice = game.dice && game.dice[player.id] ? game.dice[player.id] : [];
  if (!dice.length) return null;
  botState = botState || {};
  // 当前已超/顶格也算爆牌风险
  noteResourceOverflowRisk(player, botState, 0);

  // ??face ??
  const byFace = {};
  for (const d of dice) {
    byFace[d] = (byFace[d] || 0) + 1;
  }

  let best = null;
  let bestScore = -Infinity;

  for (const faceStr of Object.keys(byFace)) {
    const face = Number(faceStr);
    const count = byFace[faceStr];
    // boostAdd ??
    const boostFlags = (game.diceBoosted && game.diceBoosted[player.id]) || [];
    let boostAdd = 0;
    for (let i = 0; i < dice.length; i++) {
      if (dice[i] === face && boostFlags[i]) boostAdd++;
    }

    for (const area of BOARD_AREAS) {
      const board = game.board && game.board[area];
      const tiles = board ? tilesOnNumber(board, face) : [];
      if (!tiles.length) continue;
      // ????????????????????
      if (diff === 'easy') {
        if (wouldCancelWithNeutral(game, area, face, count, player.id)) continue;
        // random accept first valid
        if (Math.random() < 0.5 || !best) {
          best = { type: 'placeDice', payload: { face, area } };
          bestScore = 0;
        }
        continue;
      }
      const sc = scoreProduceMove(game, player, face, area, count, boostAdd, diff, botState);
      if (sc > bestScore) {
        bestScore = sc;
        best = { type: 'placeDice', payload: { face, area } };
      }
    }
  }

  // normal/hard：把「爆骰换任意资源」纳入比较，避免无脑全放同点
  // 爆骰分不含「延后重掷」；单骰且放骰评分为正时，禁止被爆骰基准分反超
  if (diff !== 'easy') {
    const voidSc = scoreVoidSkipOption(game, player, diff);
    const onlyOneDie = dice.length === 1;
    const placeBeatsVoidGuard =
      best && bestScore > 0 && onlyOneDie && voidSc <= bestScore + 25;
    if ((!best || voidSc > bestScore) && !placeBeatsVoidGuard) {
      const voidAct = decideVoidSkip(game, player, diff, botState);
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
 * ??????
 */
function decideVoidSkip(game, player, diff, botState) {
  const dice = game.dice && game.dice[player.id] ? game.dice[player.id] : [];
  if (!dice.length) return null;
  if (idleVillagers(player) <= 0) return null;

  // ??????????????????pay(??????? ?? burn(????)
  const mode = 'burn'; // ?????????????????pay ?????????????

  // ????????
  let targetRes = 'wood';
  if (diff === 'hard') {
    // ???????????????
    const needs = estimateResourceNeeds(player);
    targetRes = pickMostNeededResource(player, needs) || 'wood';
  } else if (diff === 'normal') {
    const needs = estimateResourceNeeds(player);
    targetRes = pickMostNeededResource(player, needs) || 'wood';
  } else {
    targetRes = pickRandom(RESOURCES) || 'wood';
  }

  return { type: 'voidSkip', payload: { mode, resource: targetRes } };
}

/* ?????????? ????????????????? */

/**
 * ???????????????????????
 * ????????????????
 */
function estimateResourceNeeds(player) {
  const needs = { wood: 0, stone: 0, food: 0, iron: 0 };
  // ?????
  const houseCost = { wood: 2, stone: 1, iron: 1 };
  for (const k of RESOURCES) needs[k] += houseCost[k] || 0;
  // ???????????????
  // ????????
  for (const b of player.buildings || []) {
    if (!b.built && b.cost) {
      for (const k of RESOURCES) needs[k] += (b.cost[k] || 0);
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

  // ????????
  const amounts = {};
  let stillOver = over;
  for (const r of shuffle(RESOURCES)) {
    const n = Math.min(stillOver, player.resources[r] || 0);
    if (n > 0) {
      amounts[r] = n;
      stillOver -= n;
      if (stillOver <= 0) break;
    }
  }
  if (Object.keys(amounts).length) {
    return { type: 'discardResources', payload: { amounts } };
  }
  return null;
}

/**
 * ??????/????
 */
function decidePendingDiscard(game, player, diff, botState) {
  // ???? pendingDiscardBuild
  if (player.pendingDiscardBuild) {
    // ??????????????
    const unbuilt = (player.buildings || []).filter((b) => !b.built);
    if (unbuilt.length) {
      const target = unbuilt[0];
      return { type: 'discardUnbuilt', payload: { buildingId: target.id } };
    }
  }
  // ??????
  if (player.pendingDiscardFunc || (player.funcCards || []).length > maxFuncHandFor(player)) {
    const cards = player.funcCards || [];
    if (cards.length) {
      if (diff === 'hard') {
        // ???????????????robbery/illegalBuild/harvest/redraw ????
        const priority = {
          robbery: 10,
          illegalBuild: 10,
          harvest: 9,
          redraw: 8,
          expand: 7,
          enhance: 6,
          recruit: 6,
          exile: 5,
          remoteDice: 4,
          banditRaid: 4,
          caravan: 3,
          shelter: 2,
          welfareHouse: 1,
        };
        let worst = cards[0];
        let worstScore = Infinity;
        for (const c of cards) {
          const sc = priority[c.funcType] || 0;
          if (sc < worstScore) {
            worstScore = sc;
            worst = c;
          }
        }
        return { type: 'discardFunc', payload: { cardId: worst.id } };
      }
      return { type: 'discardFunc', payload: { cardId: cards[cards.length - 1].id } };
    }
  }
  return null;
}

/**
 * ??????????????????
 */
function scoreBuildingForHard(player, b, game) {
  if (!b.cost) return 0;
  // ????????
  let score = (b.score || 0) * 15;
  // ????????????????????
  if (b.buildType === 'produce' && b.resource) {
    const needs = estimateResourceNeeds(player);
    const gap = Math.max(0, (needs[b.resource] || 0) - (player.resources[b.resource] || 0));
    score += gap * 8 * selfGainFactor(game);
    // ???produce ???????????STACK_ACHIEVEMENT_EXCLUDED_BUILD_TYPES??
    // ????sameBuilt === 2 ????
  }
  // ???exchange?????????????
  if (b.buildType === 'exchange') {
    const exCount = countBuiltExchanges(player);
    if (exCount === 0) score += 35; // ????????
    else if (exCount === 1) score += 45;
    else score += 40;
  }
  // ?????????
  if (b.buildType === 'wishWell') score += 25;
  // ?? score2 / ?? score1
  if (b.buildType === 'score2') score += 30;
  if (b.buildType === 'score1') score += 18;
  // ????????????
  const costSum = sumRes(b.cost);
  score -= costSum * 3;
  return score;
}

function scoreBuildingForNormal(player, b) {
  if (!b.cost) return 0;
  let score = (b.score || 0) * 10;
  if (b.buildType === 'exchange') score += 15;
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
    // ??????????????????
    if (wantsExpandResource(botState)) {
      markExpandedResource(botState);
      return {
        type: 'useFunc',
        payload: { cardId: freeExpand.id, direction: 'resource' },
      };
    }
  }

  // ?? 3. ???harvest??????????1~2???? ??
  const harvest = cards.find((c) => c.funcType === 'harvest');
  if (harvest && needTotal > 0) {
    // ??????????????????
    const shortfall = _shortfallForNeeds(player, needs);
    // ???? 1~2??????
    if (shortfall > 0 && shortfall <= 2) {
      return { type: 'useFunc', payload: { cardId: harvest.id } };
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
  if (caravan && !player.caravanPending && !player.buildTurnUsedBuyFunc) {
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

  const BUILD_HOUSE_COST = { wood: 2, stone: 1, iron: 1 };
  const EXPAND_COST = { wood: 1, stone: 1 };

  // ??????< 6 ??????????
  if (!player.roundBred && player.villagers < 6 && player.villagers < 15) {
    const foodNeed = breedFoodCost(player.villagers);
    if ((player.resources.food || 0) >= foodNeed) {
      needs.breed = true;
    } else {
      // ??????????????
      const exchCost = effectiveExchangeCost(player, game);
      const foodShort = foodNeed - (player.resources.food || 0);
      if (_canExchangeTo(player, exchCost, 'food', foodShort)) {
        needs.breed = true; // ????????
      }
    }
  }

  // ??????????7????8?????
  const myScore = playerScore(player, game);
  const maxScore = Math.max(...alivePlayers(game).map((p) => playerScore(p, game)));
  if (!player.roundBuiltHouse && canPay(player.resources, BUILD_HOUSE_COST)) {
    if (myScore >= 7 || player.villagers >= 8) {
      needs.house = true;
    }
  }

  // 生产阶段曾识别爆牌风险：资源够则优先扩容资源手牌上限一次
  if (!player.roundExpanded && canPay(player.resources, EXPAND_COST)) {
    if (wantsExpandResource(botState)) {
      needs.expand = true;
      needs.expandDir = 'resource';
    }
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
    if ((player.resources.wood || 0) < 2) short += (2 - (player.resources.wood || 0));
    if ((player.resources.stone || 0) < 1) short += (1 - (player.resources.stone || 0));
    if ((player.resources.iron || 0) < 1) short += (1 - (player.resources.iron || 0));
  }
  if (needs.expand) {
    if ((player.resources.wood || 0) < 1) short++;
    if ((player.resources.stone || 0) < 1) short++;
  }
  return short;
}

/** ??????????????*/
function _canExchangeTo(player, exchCost, targetRes, need) {
  if (need <= 0) return true;
  let can = 0;
  for (const r of RESOURCES) {
    if (r === targetRes) continue;
    can += Math.floor((player.resources[r] || 0) / exchCost);
  }
  return can >= need;
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

/** 模拟兑换后能否付得起 cost（如扩容 1 木 1 石） */
function _canAffordCostViaExchange(game, player, cost) {
  if (!player || !cost) return false;
  if (canPay(player.resources, cost)) return true;
  const exchCost = effectiveExchangeCost(player, game);
  if (exchCost <= 0) return false;
  const sim = copyRes(player.resources);
  for (let guard = 0; guard < 12; guard++) {
    if (canPay(sim, cost)) return true;
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
    }
    if (!progressed) break;
  }
  return canPay(sim, cost);
}

/**
 * 为凑齐 cost 兑换一次（优先补缺口；保留 cost 里仍需要的原料）
 * @returns {{type:string,payload:object}|null}
 */
function _exchangeTowardCost(game, player, cost) {
  if (!player || !cost) return null;
  if (canPay(player.resources, cost)) return null;
  const exchCost = effectiveExchangeCost(player, game);
  if (exchCost <= 0) return null;
  const have = player.resources || {};
  for (const needRes of RESOURCES) {
    const need = Number(cost[needRes]) || 0;
    if (need <= 0) continue;
    const haveN = Number(have[needRes]) || 0;
    if (haveN >= need) continue;
    const short = need - haveN;
    for (const from of RESOURCES) {
      if (from === needRes) continue;
      const reserve = Number(cost[from]) || 0;
      const available = (Number(have[from]) || 0) - reserve;
      if (available < exchCost) continue;
      const maxGet = Math.floor(available / exchCost);
      const count = Math.min(short, maxGet);
      if (count > 0) {
        return {
          type: 'exchange',
          payload: { from, to: needRes, count },
        };
      }
    }
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
        if (val > bestScore) { bestScore = val; best = { target: t, mode: 'card' }; }
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
        if (val > bestScore) { bestScore = val; best = { target: t, mode: 'card' }; }
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

  // 1. ???score2??????????????????
  if (card.buildType === 'score2') {
    const canAfford = canPay(player.resources, card.cost || {});
    if (game) {
      const myScore = playerScore(player, game);
      const maxScore = Math.max(...alivePlayers(game).map((p) => playerScore(p, game)));
      if (canAfford && myScore >= maxScore - 4) return 500; // ????????
      if (canAfford) return 50; // ????????
      return 20; // ??????????
    }
    if (canAfford) return 50;
    return 20;
  }

  // 2. ???exchange?????????????????????? >= 3 ????????
  if (card.buildType === 'exchange') {
    const exCount = builtMap['exchange'] || 0;
    const afterCount = exCount + 1;

    // ?????????
    let score = 0;
    if (exCount === 0) score = 220;
    else if (exCount === 1) score = 320;
    else if (exCount === 2) score = 420;
    else score = 0; // ?? 2+ ????????????

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

  // 3. ???score1????????????
  if (card.buildType === 'score1') return 205;

  // 4. ????wishWell????+???????????????
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
        const alive = alivePlayers(game).filter((p) => p.id !== player.id && !p.left);
        const target = pickRandom(alive);
        if (target) return { type: 'useFunc', payload: { cardId: c.id, targetId: target.id } };
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
      return { type: 'useFunc', payload: { cardId: c.id } };
    }
    if (c.funcType === 'expand') {
      const bldCap = maxBuildingsFor(player);
      if ((player.buildings || []).length >= bldCap) {
        return { type: 'useFunc', payload: { cardId: c.id } };
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
 * ????????? + ?????+ ?? + ??
 */
function decideBuildAction(game, player, diff, botState) {
  if (game.buildPassed && game.buildPassed[player.id]) return null;
  botState = botState || {};

  // 0. ??????
  const overflow = decideResourceOverflow(game, player, diff, botState);
  if (overflow) return overflow;

  // 1. ??????
  if (diff === 'hard') {
    const useFunc = decideUseFuncCardHard(game, player, botState);
    if (useFunc) return useFunc;
  } else {
    const useFunc = decideUseFuncCard(game, player, diff, botState);
    if (useFunc) return useFunc;
  }

  // ??????
  const BUILD_HOUSE_COST = { wood: 2, stone: 1, iron: 1 };
  const EXPAND_COST = { wood: 1, stone: 1 };

  // 2. ????????6??????????????????????/??
  if (diff === 'hard') {
    // ????????6????5??????????
    if (!player.roundBred && player.villagers < 6 && player.villagers < 15) {
      const foodNeed = breedFoodCost(player.villagers);
      const foodHave = player.resources.food || 0;
      if (foodHave >= foodNeed) {
        return { type: 'breedPermanent' };
      }
      // ??????????????????????????????????
      // ?????????
      const exchCost = effectiveExchangeCost(player, game);
      const gap = foodNeed - foodHave;
      if (_canExchangeTo(player, exchCost, 'food', gap)) {
        // ??????????????
        // ?bot???????action?????????????tick????
        for (const r of RESOURCES) {
          if (r === 'food') continue;
          if ((player.resources[r] || 0) >= exchCost) {
            return { type: 'exchange', payload: { from: r, to: 'food', count: Math.ceil(gap / 1) } };
          }
        }
      }
    }

    // 生产阶段爆牌风险标记：资源够则扩容资源上限一次
    if (!player.roundExpanded && canPay(player.resources, EXPAND_COST)) {
      if (wantsExpandResource(botState)) {
        markExpandedResource(botState);
        return { type: 'expandPermanent', payload: { direction: 'resource' } };
      }
      // 尚未扩过资源位时，保底扩一次（开局上限 9）
      const resCap = maxResourceHandFor(player);
      if (resCap <= 9 && player.expandResSlots === 0) {
        markExpandedResource(botState);
        return { type: 'expandPermanent', payload: { direction: 'resource' } };
      }
    }

    // ??????????????
    const canHouse = canPay(player.resources, BUILD_HOUSE_COST) && !player.roundBuiltHouse;
    if (canHouse) {
      const myScore = playerScore(player, game);
      if (myScore >= 6 || player.villagers >= 8 || freeHousesFor(player) <= 1) {
        return { type: 'buildHousePermanent' };
      }
    }

    // ????????~14??????
    if (!player.roundBred && player.villagers < 15) {
      const foodNeed = breedFoodCost(player.villagers);
      if ((player.resources.food || 0) >= foodNeed) {
        return { type: 'breedPermanent' };
      }
    }
  } else {
    // normal/easy：先处理生产阶段记下的爆牌扩容
    if (
      !player.roundExpanded &&
      canPay(player.resources, EXPAND_COST) &&
      wantsExpandResource(botState)
    ) {
      markExpandedResource(botState);
      return { type: 'expandPermanent', payload: { direction: 'resource' } };
    }

    // normal/easy ??????
    const canHouse = canPay(player.resources, BUILD_HOUSE_COST) && !player.roundBuiltHouse;
    const canBreed =
      !player.roundBred &&
      player.villagers < 15 &&
      freeHousesFor(player) > 0 &&
      (player.resources.food || 0) >= breedFoodCost(player.villagers);

    if (diff === 'easy') {
      if (canBreed) return { type: 'breedPermanent' };
      if (canHouse) return { type: 'buildHousePermanent' };
    } else {
      if (canHouse) return { type: 'buildHousePermanent' };
      if (canBreed) return { type: 'breedPermanent' };
    }
  }

  // 3. ???????normal/easy???hard????????
  if (diff !== 'hard') {
    const needExpand =
      (player.buildings || []).length >= maxBuildingsFor(player) ||
      (player.funcCards || []).length >= maxFuncHandFor(player);
    if (needExpand && canPay(player.resources, EXPAND_COST) && !player.roundExpanded) {
      const bldOverflow = (player.buildings || []).length >= maxBuildingsFor(player);
      const funcOverflow = (player.funcCards || []).length >= maxFuncHandFor(player);
      let dir = 'building';
      if (funcOverflow && !bldOverflow) dir = 'function';
      else if (!funcOverflow && bldOverflow) dir = 'building';
      else dir = (player.buildings || []).filter((b) => !b.built).length > 0 ? 'building' : 'function';
      return { type: 'expandPermanent', payload: { direction: dir } };
    }
  }

  // 4. ???????
  const buildable = (player.buildings || []).filter((b) => !b.built && canPay(player.resources, b.cost || {}));
  if (buildable.length) {
    if (diff === 'easy') {
      buildable.sort((a, b) => (b.score || 0) - (a.score || 0));
      return { type: 'construct', payload: { buildingId: buildable[0].id } };
    }
    if (diff === 'normal') {
      buildable.sort((a, b) => scoreBuildingForNormal(player, b) - scoreBuildingForNormal(player, a));
      return { type: 'construct', payload: { buildingId: buildable[0].id } };
    }
    buildable.sort((a, b) => scoreBuildingForHard(player, b, game) - scoreBuildingForHard(player, a, game));
    return { type: 'construct', payload: { buildingId: buildable[0].id } };
  }

  // 5. ????
  const BUY_FUNC_COST = { wood: 1, stone: 1, food: 1, iron: 1 };
  if (diff !== 'easy' && canPay(player.resources, BUY_FUNC_COST) && !player.buildTurnUsedBuyFunc) {
    const funcCap = maxFuncHandFor(player);
    if ((player.funcCards || []).length < funcCap) {
      return { type: 'buyFuncCardPermanent' };
    }
  }

  // 6. 即将离开建造：无法繁殖（含兑换模拟）且有扩容需求 → 先兑换凑齐 1木1石再扩容
  if (wantsExpandResource(botState) && !player.roundExpanded) {
    const expandCost = { wood: 1, stone: 1 };
    if (!_canBreedNowOrViaExchange(game, player)) {
      if (canPay(player.resources, expandCost)) {
        markExpandedResource(botState);
        return { type: 'expandPermanent', payload: { direction: 'resource' } };
      }
      if (_canAffordCostViaExchange(game, player, expandCost)) {
        const exch = _exchangeTowardCost(game, player, expandCost);
        if (exch) return exch;
      }
      // 有免费扩建卡时也扩资源位
      const freeExpand = (player.funcCards || []).find((c) => c.funcType === 'expand');
      if (freeExpand) {
        markExpandedResource(botState);
        return {
          type: 'useFunc',
          payload: { cardId: freeExpand.id, direction: 'resource' },
        };
      }
    }
  }

  // 7. ??
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
    // ?????????????????????????????
    const built = (player.buildings || []).filter((b) => b.built);
    if (built.length) {
      built.sort((a, b) => (a.score || 0) - (b.score || 0));
      return { type: 'illegalBuildPick', payload: { buildingId: built[0].id } };
    }
    return { type: 'cancelIllegalBuild' };
  }

  if (game.pendingRobberyPick && game.pendingRobberyPick.targetId === player.id) {
    // ?????????????
    const cards = player.funcCards || [];
    if (cards.length) {
      // ????????
      const priority = {
        welfareHouse: 1, shelter: 2, caravan: 3, banditRaid: 4,
        exile: 5, remoteDice: 5, expand: 6, enhance: 7, recruit: 8,
        redraw: 9, harvest: 10, illegalBuild: 11, robbery: 12,
      };
      const sorted = [...cards].sort((a, b) =>
        (priority[a.funcType] || 5) - (priority[b.funcType] || 5)
      );
      return { type: 'robberyPick', payload: { cardId: sorted[0].id } };
    }
    return { type: 'cancelRobberyPick' };
  }

  // pendingTrade
  if (game.pendingTrade) {
    return { type: 'rejectTrade' };
    if (game.pendingTrade.toId === player.id) {
      // ?????????????????
      // normal/hard ????????
      const trade = game.pendingTrade;
      if (diff === 'hard') {
        const give = trade.take || {}; // ??????take????????
        const get = trade.give || {};
        const need = estimateResourceNeeds(player);
        let getVal = 0;
        let giveVal = 0;
        for (const r of RESOURCES) {
          getVal += (get[r] || 0) * ((need[r] || 0) > 0 ? 2 : 1);
          giveVal += (give[r] || 0) * ((need[r] || 0) > 0 ? 2 : 1);
        }
        if (getVal >= giveVal) return { type: 'acceptTrade' };
        return { type: 'rejectTrade' };
      }
      
    }
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

  const diff = String(difficulty || 'normal').toLowerCase();

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
};
