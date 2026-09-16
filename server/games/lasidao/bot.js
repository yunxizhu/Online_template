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
  if (!env || env.trigger !== 'dispatch' || !envHasDispatchEffect(env.envType)) return 0;

  switch (env.envType) {
    case 'clearSky':
      return count * 8 * selfGainFactor(game);

    case 'prisonersDilemma': {
      // ????1 ??????????????
      // ??????????????????????
      if (selfRank === 0) return 35;
      if (selfRank === 1) return 20;
      return 10;
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
    else if (env && env.trigger === 'dispatch' && envHasDispatchEffect(env.envType)) {
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
      let score = 14; // 2 ?????????2 * 7??
      // ??????????????????
      const board = game.board && game.board.resource;
      const tiles = tilesOnNumber(board, number);
      let selfGain = 0;
      for (const t of tiles) selfGain += (t.large || 0) + (t.small || 0);
      const hand = sumRes(player.resources);
      const cap = maxResourceHandFor(player);
      // ??????????????????????
      if (hand + selfGain > cap) {
        const wouldDiscard = hand + selfGain - cap;
        score += wouldDiscard * 12; // ??????????????
      }
      // ??????????????
      if (game.phase === 'settle_end' || game.phase === 'settle') score += 5;
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
 * ????count ??????boostAdd????area/face ??????????????
 * ???????????????face ????large/small ???
 */
function estimateProduceGain(game, player, area, face, count, boostAdd) {
  const board = game.board && game.board[area];
  if (!board) return { self: 0, rivalsLoss: 0, tileCount: 0 };
  const tiles = tilesOnNumber(board, face);
  if (!tiles.length) return { self: 0, rivalsLoss: 0, tileCount: 0 };
  const wk = slotWorkers(board, face);

  // ?? ???????????????? totalAfter <= 2 ?????? ??

  // ??????????boost??????????
  const myPrev = wk[player.id] || 0;
  const myTotal = myPrev + count;
  // ??????????????"??????1.5?? myTotal + boostAdd ????
  const myPower = myTotal + (boostAdd || 0);

  // ?????????????
  let bestOtherId = null;
  let bestOtherTotal = 0;
  for (const [pid, c] of Object.entries(wk)) {
    if (pid === player.id || pid === '__neutral__') continue;
    if (c > bestOtherTotal) {
      bestOtherTotal = c;
      bestOtherId = pid;
    }
  }

  // ??????????????????????????????????
  let myRank = 0;          // 0=????large), 1=????small), 2+=??
  let rivalDropped = false; // ????????????

  if (bestOtherId) {
    if (myPower > bestOtherTotal) {
      myRank = 0;
      rivalDropped = true; // ?????????
    } else if (myPower === bestOtherTotal) {
      myRank = 2;          // ????????????
    } else {
      myRank = 1;          // ????
    }
  }

  let selfGain = 0;
  let rivalsLoss = 0;

  for (const t of tiles) {
    const large = t.large || 0;
    const small = t.small || 0;

    // ??????????
    if (myRank === 0) selfGain += large;
    else if (myRank === 1) selfGain += small;

    // ????????????large)????????small)????
    if (rivalDropped && area === 'resource') {
      rivalsLoss += large - small;
    }
  }

  if (area === 'special') {
    selfGain = Math.max(1, tiles.length);
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
 * ?????????????"??? face ??????????????????
 * ??????????????????? ????????????????
 */
function wouldCancelWithNeutral(game, area, face, count) {
  const board = game.board && game.board[area];
  if (!board) return false;
  const wk = slotWorkers(board, face);
  const neutral = wk['__neutral__'] || 0;
  return neutral > 0 && count <= neutral;
}

/**
 * ????????????????
 */
function scoreProduceMove(game, player, face, area, count, boostAdd, diff, botState) {
  // ????????????
  const est = estimateProduceGain(game, player, area, face, count, boostAdd);
  let score = est.self * 8 * selfGainFactor(game); // ??????

  // ????????????????????????????
  if (wouldCancelWithNeutral(game, area, face, count)) {
    score -= 200;
  }

  // ??????????????2?? ?????? 1??=10??
  const SKIP_BASELINE = Math.round(8 * selfGainFactor(game));
  if (area === 'special' && count > 1) {
    score -= (count - 1) * SKIP_BASELINE * 10; // special????????
  }

  // ?????????????????
  if (diff === 'hard') {
    score += est.rivalsLoss * 5;
    // ???????????????? special ????????
    const hand = sumRes(player.resources);
    const cap = maxResourceHandFor(player);
    if (hand + est.self >= cap && area === 'resource') {
      score -= 50; // ???????????????
    }
    if (area === 'special') {
      // ????/?????????special ????
      const bldCap = maxBuildingsFor(player);
      const built = (player.buildings || []).filter((b) => b.built).length;
      const unbuilt = (player.buildings || []).filter((b) => !b.built).length;
      // ????3??????????????????
      const isEarly = game.round <= 3;
      if (built + unbuilt < bldCap) {
        score += isEarly ? 8 : 25;
      }
      if ((player.funcCards || []).length < maxFuncHandFor(player)) {
        // ??????????????????
        const needsFunc = _needsExchangeBreed(player) || player.villagers < 12;
        score += needsFunc ? 15 : 8;
      }
      // ?????????????????????????????????
      const myScore = playerScore(player, game);
      const leaders = alivePlayers(game).map((p) => playerScore(p, game));
      const maxScore = Math.max(...leaders);
      if (myScore >= maxScore - 3) score += 20; // ?????special?????
    }
    // ??????????????????????????????
    if (player.skipSettleResourceDiscard) score += 15;

    // ??????????
    if (area === 'resource') {
      score += estimateEventDispatchGain(game, player, face, count, est.myRank);
      score += estimateEventSettleGain(game, player, face, est.myRank);

      // ???????????????selfRank === 2??
      const env = envOnResourceSlot(game, face);
      if (env && env.envType === 'fishermanProfit' && env.trigger === 'settle') {
        // ??????????????? + count ????????
        const board = game.board && game.board.resource;
        const wk = board && board.workers && board.workers[face];
        if (wk) {
          const myPower = (wk[player.id] || 0) + (boostAdd || 0);
          const ord = Object.entries(wk)
            .filter(([pid]) => pid !== '__neutral__' && pid !== player.id)
            .map(([, c]) => c)
            .sort((a, b) => b - a);
          // ?????????? <= ????>= ??????????
          const second = ord[0] || 0;
          const third = ord[1] || 0;
          if (myPower <= second && myPower >= third) {
            const tiles = tilesOnNumber(board, face);
            let large = 0, small = 0;
            for (const t of tiles) { large += t.large || 0; small += t.small || 0; }
            const potential = Math.min(large, 6) * 8 * selfGainFactor(game); // ????????????????
            if (potential > 0) score += potential + 15;
          }
        }
      }
    }

    // ???????????????????????????
    if (area === 'resource' && est.myRank === 0) {
      const risk = rivalCanStillInterfereOnFace(game, player, face);
      const maxRival = maxRemainingAmongRivals(game, player);
      const myRem = remainingDiceCount(player);
      // ??????????idleVillagers ??0??????????????
      if (myRem <= 0 && maxRival >= 2) {
        // ??????????????
        score -= 15;
      } else if (myRem <= 0 && maxRival === 1) {
        // ???? 1 ??????????
        score += 5;
      } else if (myRem <= 0 && maxRival === 0) {
        // ??????????????????
        score += 25;
      } else if (risk < 0.3) {
        // ?????????????
        score += 12;
      } else if (risk < 0.5) {
        score += 5;
      }
    }

    // ??????????????????????????
    if (area === 'resource' && count > 0) {
      const wk = slotWorkers(game.board && game.board.resource, face) || {};
      const myPrev = wk[player.id] || 0;
      // ??????????????????
      if (myPrev >= 1 && myPrev <= 2) {
        const maxRivalRem = maxRemainingAmongRivals(game, player);
        // ??????????????????????????
        if (maxRivalRem >= 3) {
          score -= count * 12; // ????????12??
        } else if (maxRivalRem >= 1) {
          score -= count * 5;
        }
        // ??????????????
        const tileCount = tilesOnNumber(game.board && game.board.resource, face).length;
        if (tileCount >= 2) score += 8;   // 2+????????
        if (tileCount >= 3) score += 10;  // 3+????????
        // ????????????
        const env = envOnResourceSlot(game, face);
        if (env && ['teleport', 'mercenaries', 'enterFray', 'firstCome'].includes(env.envType)) {
          score += 10;
        }
      }
    }
  }

  if (diff === 'normal') {
    const hand = sumRes(player.resources);
    const cap = maxResourceHandFor(player);
    if (hand + est.self > cap && area === 'resource') score -= 20;
    if (area === 'special') score += 8;
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
        if (wouldCancelWithNeutral(game, area, face, count)) continue;
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

function decidePendingAction(game, player, _diff, _botState) {
  // pendingRedrawChoice?????????1 ????
  if (game.pendingRedrawChoice && game.pendingRedrawChoice.playerId === player.id) {
    const options = game.pendingRedrawChoice.options || [];
    if (!options.length) return { type: 'redrawPick', payload: { cardId: null } };
    // ????????????????????
    // ??????????????????
    if (_diff === 'easy') {
      const pick = pickRandom(options);
      return { type: 'redrawPick', payload: { keepId: pick ? pick.id : null } };
    }
    // normal / hard?????????
    let best = options[0];
    let bestScore = -Infinity;
    for (const c of options) {
      let sc = 0;
      if (c.kind === 'building') {
        sc = _scoreCardOptionBuilding(player, c, _diff, game);
      } else if (c.kind === 'function') {
        sc = _scoreCardOptionFunction(player, c, _diff);
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
      if (_diff === 'hard') {
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
 * ?????????
 */
function _decideTeleport(game, player, ev, diff) {
  const step = ev.teleportStep;

  if (step === 'from') {
    // ??????????????
    // ???????????????????????
    for (const area of BOARD_AREAS) {
      for (let num = 1; num <= 6; num++) {
        const board = game.board && game.board[area];
        const wk = board && board.workers && board.workers[num];
        if (!wk) continue;
        const myCount = wk[player.id] || 0;
        const neutral = wk.__neutral__ || 0;
        let rivalCount = 0;
        for (const [pid, c] of Object.entries(wk)) {
          if (pid !== player.id && pid !== '__neutral__') rivalCount += c;
        }
        // ????????????????????
        if (rivalCount >= 1 && myCount === 0) {
          return { type: 'eventTeleportFrom', payload: { area, number: num } };
        }
        if (neutral >= 1 && myCount === 0) {
          return { type: 'eventTeleportFrom', payload: { area, number: num } };
        }
      }
    }
    return null;
  }

  if (step === 'to') {
    // ??????????
    // ?????????????????????
    // ????????????????
    const envs =
      (game.board && game.board.resource && game.board.resource.environments) || {};
    for (const num of [1, 2, 3, 4, 5, 6]) {
      const env = envs[num];
      if (env && env.envType === 'mercenaries') {
        return { type: 'eventTeleportTo', payload: { area: 'resource', number: num } };
      }
    }
    // ????????????
    for (const num of [1, 2, 3, 4, 5, 6]) {
      const tiles = tilesOnNumber(game.board && game.board.resource, num);
      if (tiles.length) {
        return { type: 'eventTeleportTo', payload: { area: 'resource', number: num } };
      }
    }
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
      if (tilesOnNumber(board, face).length && !wouldCancelWithNeutral(game, area, face, dice.filter((d) => d === face).length)) {
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

module.exports = { decideBotAction };
