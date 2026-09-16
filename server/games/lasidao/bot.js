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

const RESOURCES = ['wood', 'stone', 'food', 'iron'];
const BOARD_AREAS = ['resource', 'special'];

/* ?????????? ?????? engine ???????????????????? */

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
function estimateEventDispatchGain(game, player, number, count, selfRank) {
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
      // ????????????
      if (selfRank !== 0) return 0;
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
      const workers = (game.board && game.board.resource && game.board.resource.workers && game.board.resource.workers[number]) || {};
      const distinctOwners = Object.keys(workers).filter(pid => pid !== '__neutral__' && (workers[pid] || 0) > 0).length;
      const n = Math.max(1, distinctOwners + (workers[player.id] ? 0 : 1));
      return n * 8 * selfGainFactor(game); // n * ??????
    }

    case 'recall': {
      // ?????????????????? ????????????????????
      const wk = slotWorkers(game.board && game.board.resource, number);
      const myPrev = (wk && wk[player.id]) || 0;
      if (myPrev > 0) return 45; // ????????
      return 15; // ?????????????????? justPlaced ????????
    }

    case 'teleport': {
      if (selfRank !== 0) return 0;
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
      if (env.stashClaimed) return 0; // ??????
      const required = env.firstComeRequired != null ? Number(env.firstComeRequired) : firstComeRequiredWorkers(game.round);
      const stashCards = Array.isArray(env.stashCards) ? env.stashCards.length : firstComeStashCount(game.round);
      let cardVal = stashCards * 8.5; // ???????? 7 ??
      // ????????required > ?????????????????
      // ?? count ????????????diff
      const extraDice = Math.max(0, required - count);
      cardVal -= extraDice * 12; // ????1 ????-15 ??
      // ??????????????????????
      if (selfRank === 0) cardVal += 15;
      return Math.max(0, cardVal);
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
 * ?????????????
 * ????"??????????????????
 */
function _bestEnterFrayMoveValue(game, player, fromNumber, count) {
  const envs =
    (game.board && game.board.resource && game.board.resource.environments) || {};

  // ??1????????????????????????????
  for (const num of [1, 2, 3, 4, 5, 6]) {
    const env = envs[num];
    if (!env || env.envType !== 'mercenaries') continue;
    // ????????????????????
    // ???????????????????????????
    const wk = slotWorkers(game.board.resource, num);
    let bestOther = 0;
    let hasNeutral = false;
    for (const [pid, c] of Object.entries(wk)) {
      if (pid === '__neutral__') hasNeutral = true;
      else if (pid !== player.id && c > bestOther) bestOther = c;
    }
    if (bestOther > 0 && !hasNeutral) {
      // ???????????????????????? ???????
      return 50;
    }
    // ????????????????????????
    // ??????????/????????????????????
    return 10;
  }

  // ??2??????????????????/??????
  for (const num of [1, 2, 3, 4, 5, 6]) {
    if (num === fromNumber) continue;
    const wk = slotWorkers(game.board.resource, num);
    let bestOther = 0;
    let bestOtherId = null;
    for (const [pid, c] of Object.entries(wk)) {
      if (pid === '__neutral__') continue;
      if (pid === player.id) continue;
      if (c > bestOther) { bestOther = c; bestOtherId = pid; }
    }
    if (bestOther > 0) {
      const tiles = tilesOnNumber(game.board.resource, num);
      let large = 0, small = 0;
      for (const t of tiles) { large += t.large || 0; small += t.small || 0; }
      // ??????????????????
      return (large - small) * 4 * rivalsLossFactor(game) + 10;
    }
  }

  // ???????????????????
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
 */
function estimateEventSettleGain(game, player, number, selfRank) {
  const env = envOnResourceSlot(game, number);
  if (!env || env.trigger !== 'settle') return 0;

  switch (env.envType) {
    case 'prisonersDilemma': {
      // 最后一名弃 n 张；第一名施压且自己不用弃；低保户类 setup 事件无此效果
      const others = Math.max(0, alivePlayers(game).length - 1);
      if (selfRank === 0) {
        return 28 + others * 14;
      }
      if (selfRank === 1) {
        // 拿到第二也不是最后，显著降低自己被弃牌风险
        return 24;
      }
      // 与中立对冲搅局 / 占坑：破坏「对手唯一第一逼你弃牌」
      return 26;
    }

    case 'oneMountain':
      if (selfRank === 0) return 8 * selfGainFactor(game);
      if (selfRank === 1) return -8 * selfGainFactor(game);
      return 0;

    case 'resistBarbarians':
      if (selfRank <= 1) {
        const myScore = playerScore(player, game);
        const maxScore = Math.max(...alivePlayers(game).map((p) => playerScore(p, game)));
        if (myScore >= maxScore - 3) return 45;
        return 25;
      }
      return 0;

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
 * 估算 count 枚放到 area/face 后的结算收益（含与中立/对手的同数抵消）。
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
 */
function wouldCancelWithNeutral(game, area, face, count, playerId) {
  const board = game.board && game.board[area];
  if (!board || !playerId) return false;
  const wk = slotWorkers(board, face);
  const neutral = Number(wk.__neutral__) || 0;
  if (neutral <= 0) return false;
  const myTotal = (Number(wk[playerId]) || 0) + count;
  if (myTotal <= 0) return false;
  // 放置后己方与中立同数 → 同数抵消，己方出局
  return myTotal === neutral;
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
        enhance: 28,
        shelter: 24,
        recruit: 24,
        redraw: 20,
        harvest: 18,
        expand: 16,
        caravan: 14,
        robbery: 16,
        illegalBuild: 14,
        exile: 12,
        remoteDice: 12,
        banditRaid: 10,
        welfareHouse: 10,
      };
      return vals[tile.funcType] || 12;
    }
    const vals = {
      enhance: 18,
      recruit: 16,
      harvest: 14,
      redraw: 14,
      expand: 12,
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

/**
 * 放满 count 枚时的名次/收益，最少需要几枚就能达到同一结果。
 * 多出来的骰等价于「本可爆骰换资源 / 留给下回合重掷」。
 */
function minDiceForSameOutcome(game, player, area, face, count, boostAdd) {
  const full = estimateProduceGain(game, player, area, face, count, boostAdd);
  let best = count;
  for (let k = 1; k <= count; k++) {
    const b = Math.min(Number(boostAdd) || 0, k);
    const est = estimateProduceGain(game, player, area, face, k, b);
    if (est.myRank === full.myRank && est.self === full.self) {
      best = k;
      break;
    }
  }
  return best;
}

/** 爆 1 骰换 1 任意资源的基准分（与 1 资源 ≈ 8 同量级） */
function scoreVoidSkipOption(game, player, diff) {
  const dice = (game.dice && game.dice[player.id]) || [];
  if (!dice.length || idleVillagers(player) <= 0) return -Infinity;

  const factor = selfGainFactor(game);
  let score = Math.round(8 * factor);

  const needs = estimateResourceNeeds(player);
  const target = pickMostNeededResource(player, needs);
  const have = player.resources || {};
  if (target) {
    const gap = (needs[target] || 0) - (have[target] || 0);
    if (gap > 0) score += Math.min(3, gap);
  }

  // 开局空手：立刻拿到任意资源更值钱（幅度需低于「稳拿大份」以免误爆）
  const hand = sumRes(have);
  if (hand === 0) score += diff === 'hard' ? 4 : 3;
  else if (hand <= 2 && (Number(game.round) || 1) <= 3) score += 2;

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
 * 给某次放骰打分
 */
function scoreProduceMove(game, player, face, area, count, boostAdd, diff, botState) {
  const est = estimateProduceGain(game, player, area, face, count, boostAdd);
  let score = est.self * 8 * selfGainFactor(game);
  const env = area === 'resource' ? envOnResourceSlot(game, face) : null;

  if (wouldCancelWithNeutral(game, area, face, count, player.id)) {
    // 囚徒困境自带中立：1 枚会对冲拿不到本格资源，但仍有搅局/避弃价值，勿一票否决
    if (env && env.envType === 'prisonersDilemma') score -= 35;
    else score -= 200;
  }

  // 超额占用：同结果少放几枚即可时，按「可爆骰换资源」计价扣分
  const SKIP_BASELINE = Math.round(8 * selfGainFactor(game));
  const needed = minDiceForSameOutcome(game, player, area, face, count, boostAdd);
  const surplus = Math.max(0, count - needed);
  if (surplus > 0) {
    let penaltyMult = area === 'special' ? 10 : 1;
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

  if (area === 'special') {
    score += estimateSpecialClaimValue(game, player, face, est.myRank, diff);
  }

  // 事件收益：normal/hard 都计入（否则吃不了兜着走等会被低估）
  if (area === 'resource' && (diff === 'hard' || diff === 'normal')) {
    const evtScale = diff === 'hard' ? 1 : 0.75;
    score += estimateEventDispatchGain(game, player, face, count, est.myRank) * evtScale;
    score += estimateEventSettleGain(game, player, face, est.myRank) * evtScale;
    // 雇佣军是 preSettle，不走上面 settle/dispatch 估值
    if (env && env.envType === 'mercenaries' && est.myRank === 0) {
      score += estimateMercenariesClaimValue(game, player, env, diff) * evtScale;
    }
  }

  if (diff === 'hard') {
    score += est.rivalsLoss * 5;
    const hand = sumRes(player.resources);
    const cap = maxResourceHandFor(player);
    const keepOverflowFirst =
      env && env.envType === 'keepOverflow' && est.myRank === 0;
    // 濒临上限通常减分；但「吃不了兜着走」正是为此设计，不可误罚
    if (hand + est.self >= cap && area === 'resource' && !keepOverflowFirst) {
      score -= 50;
    }
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
            const potential = Math.min(large, 6) * 8 * selfGainFactor(game);
            if (potential > 0) score += potential + 15;
          }
        }
      }
    }

    if (area === 'resource' && est.myRank === 0) {
      const risk = rivalCanStillInterfereOnFace(game, player, face);
      const maxRival = maxRemainingAmongRivals(game, player);
      const myRem = remainingDiceCount(player);
      if (myRem <= 0 && maxRival >= 2) {
        score -= 15;
      } else if (myRem <= 0 && maxRival === 1) {
        score += 5;
      } else if (myRem <= 0 && maxRival === 0) {
        score += 25;
      } else if (risk < 0.3) {
        score += 12;
      } else if (risk < 0.5) {
        score += 5;
      }
    }

    if (area === 'resource' && count > 0) {
      const wk = slotWorkers(game.board && game.board.resource, face) || {};
      const myPrev = wk[player.id] || 0;
      if (myPrev >= 1 && myPrev <= 2) {
        const maxRivalRem = maxRemainingAmongRivals(game, player);
        if (maxRivalRem >= 3) {
          score -= count * 12;
        } else if (maxRivalRem >= 1) {
          score -= count * 5;
        }
        const tileCount = tilesOnNumber(game.board && game.board.resource, face).length;
        if (tileCount >= 2) score += 8;
        if (tileCount >= 3) score += 10;
        if (env && ['teleport', 'mercenaries', 'enterFray', 'firstCome'].includes(env.envType)) {
          score += 10;
        }
      }
    }
  }

  if (diff === 'normal') {
    const hand = sumRes(player.resources);
    const cap = maxResourceHandFor(player);
    const env = area === 'resource' ? envOnResourceSlot(game, face) : null;
    const keepOverflowFirst =
      env && env.envType === 'keepOverflow' && est.myRank === 0;
    if (hand + est.self > cap && area === 'resource' && !keepOverflowFirst) {
      score -= 20;
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
  if (diff !== 'easy') {
    const voidSc = scoreVoidSkipOption(game, player, diff);
    if (!best || voidSc > bestScore) {
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
      return { type: 'useFunc', payload: { cardId: freeExpand.id } };
    }
    if (funcN >= funcCap) {
      return { type: 'useFunc', payload: { cardId: freeExpand.id } };
    }
    // ??????????????????
    if (botState.wasOverCap && !(botState.expandedResOnce)) {
      return { type: 'useFunc', payload: { cardId: freeExpand.id } };
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

  // ????????????????????
  if (!player.roundExpanded && canPay(player.resources, EXPAND_COST)) {
    if (botState.wasOverCap && !botState.didExpand) {
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

    // ???????????????????????
    if (!player.roundExpanded && canPay(player.resources, EXPAND_COST)) {
      if (botState.wasOverCap) {
        botState.didExpand = true;
        return { type: 'expandPermanent', payload: { direction: 'resource' } };
      }
      // ?????????????????????
      const resCap = maxResourceHandFor(player);
      if (resCap <= 9 && player.expandResSlots === 0) {
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

  // 6. ??
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
 * ????????????
 * ???????????????????????????????
 * ???????????????????????????????
 */
function _decideEnterFrayMove(game, player, ev, diff) {
  const fromNumber = Number(ev.number) || Number(ev.fromNumber) || 1;
  const maxMove = Math.min(
    neutralCountOn(game, 'resource', fromNumber),
    Math.max(1, Number(ev.count) || 1)
  );
  const envs =
    (game.board && game.board.resource && game.board.resource.environments) || {};

  // ??/?????????
  if (diff !== 'easy') {
    let bestTarget = null;
    let bestScore = -Infinity;

    for (const num of [1, 2, 3, 4, 5, 6]) {
      if (num === fromNumber) continue;
      const targetEnv = envs[num];
      const board = game.board && game.board.resource;
      const wk = board ? (board.workers[num] || {}) : {};
      let score = 0;

      // ??????????????????????????????
      if (targetEnv && targetEnv.envType === 'mercenaries') {
        let rivalFirst = false;
        let bestOther = 0;
        for (const [pid, c] of Object.entries(wk)) {
          if (pid === '__neutral__' || pid === player.id) continue;
          if (c > bestOther) bestOther = c;
        }
        // ??????????????????????????
        // ????????????????????????????
        score += 100; // ????????????
        if (bestOther > 0) score += 60; // ??????????
      }

      // ????/?????????????????
      let bestOther = 0;
      let hasNeutral = false;
      let hasMe = false;
      for (const [pid, c] of Object.entries(wk)) {
        if (pid === '__neutral__') hasNeutral = true;
        else if (pid === player.id) hasMe = true;
        else if (c > bestOther) bestOther = c;
      }
      if (bestOther > 0 && !hasNeutral) {
        // ??????????????????????v1 ??????
        const tiles = tilesOnNumber(board, num);
        let gainDiff = 0;
        for (const t of tiles) {
          gainDiff += (t.large || 0) - (t.small || 0);
        }
        score += gainDiff * 5 + 20;
      }

      // ????????????????????????
      const myPrev = wk[player.id] || 0;
      if (hasMe && myPrev > bestOther) {
        score -= 80; // ??????
      }

      if (score > bestScore) {
        bestScore = score;
        bestTarget = { area: 'resource', number: num };
      }
    }

    if (bestTarget) {
      return {
        type: 'eventMoveNeutral',
        payload: { area: bestTarget.area, number: bestTarget.number },
      };
    }
  }

  // ??????????????????????
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

  // ?????????????
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
 * 自己的骰优先抢功能区高价值牌（尤其强化）；
 * 对手骰绝不能帮对方抢第一/独占；中立骰优先用来拆对手。
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
      return 28 + large * 5;
    }
    if (moverRank === 0 && toArea === 'special') return -30;
    return 4;
  }

  // —— 传送自己的骰 ——
  if (toArea === 'special') {
    if (moverRank !== 0) {
      return hasEnhance ? 8 : 2;
    }
    let score = estimateSpecialClaimValue(game, player, toNumber, 0, diff);
    if (hasEnhance) score += 55;
    if (hasRecruit) score += 18;
    if (hasShelter) score += 14;
    return score;
  }

  let score = 0;
  if (moverRank === 0) score += large * 8 * selfGainFactor(game);
  else if (moverRank === 1) score += small * 8 * selfGainFactor(game);

  const env = envOnResourceSlot(game, toNumber);
  if (env && env.envType === 'mercenaries' && moverRank === 0) {
    score += estimateMercenariesClaimValue(game, player, env, diff) * 0.85;
  }
  if (diff !== 'easy') {
    const settleRank = moverRank === 0 ? 0 : moverRank === 1 ? 1 : 2;
    if (envTriggersDispatch(env) && envHasDispatchEffect(env && env.envType)) {
      score += estimateEventDispatchGain(game, player, toNumber, 1, settleRank) * 0.6;
    }
    score += estimateEventSettleGain(game, player, toNumber, settleRank) * 0.75;
  }
  return score;
}

/** 从某格挪走 targetId 一枚后，对「我」的局势收益（拆对手 / 自己变第一） */
function _scoreTeleportFromRemoval(game, player, fromArea, fromNumber, targetId, diff) {
  void diff;
  if (targetId === player.id) return 0;
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

  const beforeFirst = beforeRanked[0] ? beforeRanked[0][0] : null;
  const afterFirst = afterRanked[0] ? afterRanked[0][0] : null;

  // 拆掉对手第一 → 自己变第一
  if (beforeFirst === targetId && afterFirst === player.id) {
    if (fromArea === 'special') score += 70;
    else score += 35 + large * 8 * selfGainFactor(game);
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
 * 优先：自己的骰去抢强化；拆对手争抢；绝不把对手骰送到能独占的肥格。
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
      // 明显偏好挪自己的骰去抢牌；挪对手必须落点不帮对方
      if (from.targetId === player.id) sc += 12;
      else if (from.targetId === '__neutral__') sc += 2;
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
};
