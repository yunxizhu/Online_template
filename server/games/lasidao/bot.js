'use strict';

/**
 * 卡拉斯坦 AI（Bot）决策模块
 *
 * 提供 decideBotAction(game, playerId, difficulty, botState) → { type, payload }|null
 * 由服务端在 bot 玩家需要行动时调用（思考时间超时或专门 tick）。
 *
 * 难度：
 *   easy   – 简易：优先造房/繁殖，随机派遣，会用已有功能卡但不主动买
 *   normal – 普通：按阶段调整策略，合理兑换，会买功能卡并优先拿分
 *   hard   – 困难：计算性价比，全面使用功能卡，动态阻止领先者，精确资源管理
 */

const RESOURCES = ['wood', 'stone', 'food', 'iron'];
const BOARD_AREAS = ['resource', 'special'];

/* ────────── 轻量辅助（从 engine 搬运最小必要逻辑） ────────── */

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
function breedFoodCost(villagers) {
  // 与 engine 一致：0→2，1→2，2→2，3→3，4→3，5→4，6→4，...
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

/* ────────── 通用随机工具 ────────── */

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

/* ────────── 生产阶段：测算收益 ────────── */

/**
 * 模拟把 count 个骰子（含 boostAdd）放到 area/face 格，返回预估自己获得的资源量
 * 简化模型：不算精确名次，只按 face 与板块 large/small 算。
 */
function estimateProduceGain(game, player, area, face, count, boostAdd) {
  const board = game.board && game.board[area];
  if (!board) return { self: 0, rivalsLoss: 0, tileCount: 0 };
  const tiles = tilesOnNumber(board, face);
  if (!tiles.length) return { self: 0, rivalsLoss: 0, tileCount: 0 };
  const wk = slotWorkers(board, face);
  const currentHere = Object.values(wk).reduce((s, v) => s + (Number(v) || 0), 0);
  // 放置后的总数
  const totalAfter = currentHere + count + (boostAdd || 0);
  let selfGain = 0;
  let rivalsLoss = 0;
  for (const t of tiles) {
    const isLarge = totalAfter <= 2; // 大约简化：前2名拿 large
    const amt = isLarge ? (t.large || 0) : (t.small || 0);
    selfGain += amt;
    if (area === 'resource' && t.resource) {
      // 粗估：如果别人本来能拿到这里，现在可能被挤掉
      rivalsLoss += isLarge ? (t.small || 0) : 0;
    }
  }
  // special 区拿功能/建筑卡 -> 折算为"资源等价"
  if (area === 'special') {
    selfGain = Math.max(1, tiles.length); // 至少 1 张卡的价值
  }
  return { self: selfGain, rivalsLoss, tileCount: tiles.length };
}

/**
 * 判断 face 上是否有中立工人（会被对冲掉）
 */
function hasNeutralOnFace(game, area, face) {
  const board = game.board && game.board[area];
  if (!board) return false;
  const wk = slotWorkers(board, face);
  return Object.keys(wk).some((id) => id === '__neutral__' && (wk[id] || 0) > 0);
}

/**
 * 检查放置时是否会产生"对冲"（同一 face 上已有中立骰子，导致自己骰子被抵消）
 * 简化：如果已有中立骰子，且我们放的数量 ≤ 中立骰子数，则会被全部对冲
 */
function wouldCancelWithNeutral(game, area, face, count) {
  const board = game.board && game.board[area];
  if (!board) return false;
  const wk = slotWorkers(board, face);
  const neutral = wk['__neutral__'] || 0;
  return neutral > 0 && count <= neutral;
}

/**
 * 生产阶段：对每种合法派遣方案打分
 */
function scoreProduceMove(game, player, face, area, count, boostAdd, diff, botState) {
  // 基础分：自己的预估收益
  const est = estimateProduceGain(game, player, area, face, count, boostAdd);
  let score = est.self * 10; // 放大为整数分

  // 扣除对冲风险：如果会被中立骰子部分/全部抵消，严重扣分
  if (wouldCancelWithNeutral(game, area, face, count)) {
    score -= 200;
  }

  // 扣减自身花费的骰子数（少放=保留更多骰子，但这里所有该 face 骰子都会放）
  // 默认模式：同 face 的骰子会全部放，所以 count 固定为 matching 数量

  // 困难模式：考虑对手损失、资源利用率
  if (diff === 'hard') {
    score += est.rivalsLoss * 5;
    // 考虑手牌上限：如果资源快满了，去 special 区拿卡更有价值
    const hand = sumRes(player.resources);
    const cap = maxResourceHandFor(player);
    if (hand + est.self >= cap && area === 'resource') {
      score -= 50; // 快要溢出，去资源区的价值下降
    }
    if (area === 'special') {
      // 手牌建筑/功能卡未达上限时，special 区价值高
      const bldCap = maxBuildingsFor(player);
      const built = (player.buildings || []).filter((b) => b.built).length;
      const unbuilt = (player.buildings || []).filter((b) => !b.built).length;
      if (built + unbuilt < bldCap) score += 30;
      if ((player.funcCards || []).length < maxFuncHandFor(player)) score += 25;
      // 快要赢的时候，分数卡更有价值（但这里不知道翻开的是啥，只能大概估计）
      const myScore = playerScore(player, game);
      const leaders = alivePlayers(game).map((p) => playerScore(p, game));
      const maxScore = Math.max(...leaders);
      if (myScore >= maxScore - 3) score += 20; // 冲刺阶段，special价值上升
    }
    // 吃不了兜着走：如果已有该事件豁免，资源区价值上升（不怕溢出）
    if (player.skipSettleResourceDiscard) score += 15;
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
 * 生产阶段：选一个最优的 face + area 进行 placeDice
 * 返回 { type:'placeDice', payload:{ face, area, count? } } 或 null
 */
function decidePlaceDice(game, player, diff, botState) {
  const dice = game.dice && game.dice[player.id] ? game.dice[player.id] : [];
  if (!dice.length) return null;

  // 按 face 分组
  const byFace = {};
  for (const d of dice) {
    byFace[d] = (byFace[d] || 0) + 1;
  }

  let best = null;
  let bestScore = -Infinity;

  for (const faceStr of Object.keys(byFace)) {
    const face = Number(faceStr);
    const count = byFace[faceStr];
    // boostAdd 计算
    const boostFlags = (game.diceBoosted && game.diceBoosted[player.id]) || [];
    let boostAdd = 0;
    for (let i = 0; i < dice.length; i++) {
      if (dice[i] === face && boostFlags[i]) boostAdd++;
    }

    for (const area of BOARD_AREAS) {
      const board = game.board && game.board[area];
      const tiles = board ? tilesOnNumber(board, face) : [];
      if (!tiles.length) continue;
      // 简易模式：只要不与中立对冲即可，随机选
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

  // 如果没有合法放置（比如全部会被中立对冲），尝试 remoteDice / exile
  if (!best) {
    // 如果有遥控骰子或驱逐，尝试清掉中立骰子后再放；否则爆骰换资源
    const funcRemote = (player.funcCards || []).find((c) => c.funcType === 'remoteDice');
    const funcExile = (player.funcCards || []).find((c) => c.funcType === 'exile');
    if (funcRemote && game.phase === 'produce' && game.currentPlayerId === player.id) {
      // 困难/普通尽量用remote来放
      if (diff !== 'easy') {
        return { type: 'useFunc', payload: { cardId: funcRemote.id } };
      }
    }
    // 爆骰换资源：voidSkip
    return decideVoidSkip(game, player, diff, botState);
  }

  return best;
}

/**
 * 爆骰换资源
 */
function decideVoidSkip(game, player, diff, botState) {
  const dice = game.dice && game.dice[player.id] ? game.dice[player.id] : [];
  if (!dice.length) return null;
  if (idleVillagers(player) <= 0) return null;

  // 模式判断：如果有可跳过骰子，决定是 pay(消耗额外村民) 还是 burn(换1资源)
  const mode = 'burn'; // 简化：总是选择爆掉换1资源（因为 pay 需要额外村民且通常不划算）

  // 选择换什么资源
  let targetRes = 'wood';
  if (diff === 'hard') {
    // 选当前最缺的资源（按建造需求）
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

/* ────────── 建造阶段决策 ────────── */

/**
 * 粗略估计玩家缺哪些资源（用于兑换、爆骰选择）
 * 基于手牌建筑的成本与常驻功能成本
 */
function estimateResourceNeeds(player) {
  const needs = { wood: 0, stone: 0, food: 0, iron: 0 };
  // 造房需求
  const houseCost = { wood: 2, stone: 1, iron: 1 };
  for (const k of RESOURCES) needs[k] += houseCost[k] || 0;
  // 繁殖需求（不一定马上就繁殖）
  // 手牌未建造建筑
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
 * 资源溢出时：优先兑换成需要的资源，其次弃牌
 */
function decideResourceOverflow(game, player, diff, botState) {
  const hand = sumRes(player.resources);
  const cap = maxResourceHandFor(player);
  const over = hand - cap;
  if (over <= 0) return null;

  const exchCost = effectiveExchangeCost(player, game);

  // 先尝试兑换
  if (diff !== 'easy') {
    const needs = estimateResourceNeeds(player);
    const needRes = pickMostNeededResource(player, needs);
    if (needRes) {
      for (const from of RESOURCES) {
        if (from === needRes) continue;
        const available = player.resources[from] || 0;
        if (available >= exchCost) {
          const maxCount = Math.floor(available / exchCost);
          // 兑换到不溢出为止，但不超过 maxCount
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

  // easy 模式：随机兑换
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

  // 兑换不了：弃牌
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
 * 先处理功能卡/建筑爆牌
 */
function decidePendingDiscard(game, player, diff, botState) {
  // 建筑爆牌 pendingDiscardBuild
  if (player.pendingDiscardBuild) {
    // 随机弃一张最早入手但未建造的
    const unbuilt = (player.buildings || []).filter((b) => !b.built);
    if (unbuilt.length) {
      const target = unbuilt[0];
      return { type: 'discardUnbuilt', payload: { buildingId: target.id } };
    }
  }
  // 功能卡超上限
  if (player.pendingDiscardFunc || (player.funcCards || []).length > maxFuncHandFor(player)) {
    const cards = player.funcCards || [];
    if (cards.length) {
      if (diff === 'hard') {
        // 优先弃掉最不缺的功能卡；保留 robbery/illegalBuild/harvest/redraw 等强力卡
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
 * 困难模式：给手牌建筑打分（建造价值）
 */
function scoreBuildingForHard(player, b, game) {
  if (!b.cost) return 0;
  // 基础分：直接分数
  let score = (b.score || 0) * 15;
  // 资源产出建筑：根据当前资源紧缺程度打分
  if (b.buildType === 'produce' && b.resource) {
    const needs = estimateResourceNeeds(player);
    const gap = Math.max(0, (needs[b.resource] || 0) - (player.resources[b.resource] || 0));
    score += gap * 8;
    // 已建成的同类型建筑数量（叠建成就要3座=成就）
    const stackKey = buildingStackKey(b);
    const sameBuilt = countBuiltByStackKey(player, stackKey);
    if (sameBuilt === 2) score += 40; // 即将达成成就
    else if (sameBuilt === 1) score += 15;
  }
  // 集市（exchange）优先级随已有集市数量递减
  if (b.buildType === 'exchange') {
    const exCount = countBuiltExchanges(player);
    if (exCount === 0) score += 35; // 第一座集市很重要
    else if (exCount === 1) score += 20;
    else score += 8;
  }
  // 许愿井：通用价值
  if (b.buildType === 'wishWell') score += 25;
  // 宫殿 score2 / 学堂 score1
  if (b.buildType === 'score2') score += 30;
  if (b.buildType === 'score1') score += 18;
  // 性价比：成本越低分数越高
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
  // 简易：只看分数和是否是房子之外的建筑（简易不会常驻造房繁殖）
  if (!b.cost) return 0;
  return (b.score || 0) * 10 - sumRes(b.cost) * 2;
}

/**
 * 建造阶段：使用功能卡
 */
function decideUseFuncCard(game, player, diff, botState) {
  const cards = player.funcCards || [];
  if (!cards.length) return null;
  if (game.buildPassed && game.buildPassed[player.id]) return null;

  // 困难模式：精心选择使用时机和目标
  if (diff === 'hard') {
    for (const c of cards) {
      const ft = c.funcType;
      // 远征军（recruit）没满村民时用
      if (ft === 'recruit' && player.villagers < 12 && freeHousesFor(player) > 0) {
        return { type: 'useFunc', payload: { cardId: c.id } };
      }
      // 强化（enhance）身上有未强化的骰子时用
      if (ft === 'enhance') {
        const canEnh = Math.min(
          (player.villagers || 0),
          5
        ) - (player.enhancedDice || 0);
        if (canEnh > 0) return { type: 'useFunc', payload: { cardId: c.id } };
      }
      // 丰收（harvest）资源紧缺时用
      if (ft === 'harvest') {
        const hand = sumRes(player.resources);
        if (hand < 6) return { type: 'useFunc', payload: { cardId: c.id } };
      }
      // 扩建（expand）：建筑格满了且手牌建筑多时用
      if (ft === 'expand') {
        const bldCap = maxBuildingsFor(player);
        const totalBld = (player.buildings || []).length;
        if (totalBld >= bldCap) return { type: 'useFunc', payload: { cardId: c.id } };
      }
      // 抢劫（robbery）：找资源最多的对手
      if (ft === 'robbery') {
        const alive = alivePlayers(game).filter((p) => p.id !== player.id && !p.left);
        let bestTarget = null;
        let bestRes = -1;
        for (const t of alive) {
          const r = sumRes(t.resources);
          if (r > bestRes) {
            bestRes = r;
            bestTarget = t;
          }
        }
        if (bestTarget && bestRes >= 3) {
          return { type: 'useFunc', payload: { cardId: c.id, targetId: bestTarget.id } };
        }
      }
      // 拆迁（illegalBuild）：找分数领先且有建筑的对手
      if (ft === 'illegalBuild') {
        const alive = alivePlayers(game).filter((p) => p.id !== player.id && !p.left);
        let bestTarget = null;
        let bestScore = -1;
        for (const t of alive) {
          const s = playerScore(t, game);
          const hasBuilt = (t.buildings || []).some((b) => b.built);
          if (hasBuilt && s > bestScore) {
            bestScore = s;
            bestTarget = t;
          }
        }
        if (bestTarget) {
          return { type: 'useFunc', payload: { cardId: c.id, targetId: bestTarget.id } };
        }
      }
      // 重抽（redraw）：有位置放手牌、且还没用过重抽时用
      if (ft === 'redraw' && !player.buildTurnUsedRedraw) {
        const funcCap = maxFuncHandFor(player);
        const bldCap = maxBuildingsFor(player);
        const funcN = (player.funcCards || []).length;
        const bldN = (player.buildings || []).filter((b) => !b.built).length;
        if (funcN < funcCap || bldN < bldCap) {
          return { type: 'useFunc', payload: { cardId: c.id } };
        }
      }
      // 收留（shelter）：村民被清掉后的一轮？这里简化：有就吃
      if (ft === 'shelter') {
        return { type: 'useFunc', payload: { cardId: c.id } };
      }
      // 福利房（welfareHouse）
      if (ft === 'welfareHouse') {
        return { type: 'useFunc', payload: { cardId: c.id } };
      }
      // 商队来临（caravan）：回合早期用（让后续兑换/建造更便宜）
      if (ft === 'caravan') {
        if (!player.buildTurnUsedBuyFunc && !player.caravanPending) {
          return { type: 'useFunc', payload: { cardId: c.id } };
        }
      }
    }
  }

  // normal / easy：简单使用部分功能卡
  const usableTypesEasy = ['harvest', 'recruit', 'enhance', 'expand', 'welfareHouse', 'shelter', 'caravan'];
  for (const c of cards) {
    if (diff === 'easy' && !usableTypesEasy.includes(c.funcType)) continue;
    if (diff === 'normal' && ['robbery', 'illegalBuild'].includes(c.funcType)) {
      // normal 也会用抢劫/拆迁，但目标随机
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
 * 建造阶段：常驻操作 + 建造手牌 + 买卡 + 跳过
 */
function decideBuildAction(game, player, diff, botState) {
  if (game.buildPassed && game.buildPassed[player.id]) return null;

  // 0. 资源溢出处理
  const overflow = decideResourceOverflow(game, player, diff, botState);
  if (overflow) return overflow;

  // 1. 使用功能卡（所有难度都会用已有卡，但 easy 不主动买）
  const useFunc = decideUseFuncCard(game, player, diff, botState);
  if (useFunc) return useFunc;

  // 常驻功能造价
  const BUILD_HOUSE_COST = { wood: 2, stone: 1, iron: 1 };
  const EXPAND_COST = { wood: 1, stone: 1 };

  // 2. 简易/普通/困难 都优先造房子和繁殖（用户要求）
  const canHouse = canPay(player.resources, BUILD_HOUSE_COST) && !player.roundBuiltHouse;
  const canBreed =
    !player.roundBred &&
    player.villagers < 15 &&
    freeHousesFor(player) > 0 &&
    (player.resources.food || 0) >= breedFoodCost(player.villagers);

  // 简易优先繁殖再房子（先有村民才能派遣）
  if (diff === 'easy') {
    if (canBreed) return { type: 'breedPermanent' };
    if (canHouse) return { type: 'buildHousePermanent' };
  } else {
    // normal/hard：按策略决定顺序
    const myScore = playerScore(player, game);
    const allScores = alivePlayers(game).map((p) => playerScore(p, game));
    const maxScore = Math.max(...allScores);
    const isLateGame = myScore >= 8 || maxScore >= 10;

    if (diff === 'hard') {
      if (isLateGame) {
        if (canHouse) return { type: 'buildHousePermanent' };
        if (canBreed) return { type: 'breedPermanent' };
      } else {
        // 前期优先繁殖扩充劳动力
        if (canBreed) return { type: 'breedPermanent' };
        if (canHouse) return { type: 'buildHousePermanent' };
      }
    } else {
      // normal
      if (canHouse) return { type: 'buildHousePermanent' };
      if (canBreed) return { type: 'breedPermanent' };
    }
  }

  // 3. 扩建（需要时）
  const needExpand =
    (player.buildings || []).length >= maxBuildingsFor(player) ||
    (player.funcCards || []).length >= maxFuncHandFor(player);
  if (needExpand && canPay(player.resources, EXPAND_COST) && !player.roundExpanded) {
    // 选择扩什么
    const bldOverflow = (player.buildings || []).length >= maxBuildingsFor(player);
    const funcOverflow = (player.funcCards || []).length >= maxFuncHandFor(player);
    let dir = 'building';
    if (funcOverflow && !bldOverflow) dir = 'function';
    else if (!funcOverflow && bldOverflow) dir = 'building';
    else if (diff === 'hard') {
      // 都满时，看更需要哪边
      dir = (player.buildings || []).filter((b) => !b.built).length > 0 ? 'building' : 'function';
    }
    return { type: 'expandPermanent', payload: { direction: dir } };
  }

  // 4. 建造手牌建筑
  const buildable = (player.buildings || []).filter((b) => !b.built && canPay(player.resources, b.cost || {}));
  if (buildable.length) {
    if (diff === 'easy') {
      // 随机建一个分数最高的
      buildable.sort((a, b) => (b.score || 0) - (a.score || 0));
      return { type: 'construct', payload: { buildingId: buildable[0].id } };
    }
    if (diff === 'normal') {
      buildable.sort((a, b) => scoreBuildingForNormal(player, b) - scoreBuildingForNormal(player, a));
      return { type: 'construct', payload: { buildingId: buildable[0].id } };
    }
    // hard
    buildable.sort((a, b) => scoreBuildingForHard(player, b, game) - scoreBuildingForHard(player, a, game));
    return { type: 'construct', payload: { buildingId: buildable[0].id } };
  }

  // 5. 买功能卡（normal/hard）
  const BUY_FUNC_COST = { wood: 1, stone: 1, food: 1, iron: 1 };
  if (diff !== 'easy' && canPay(player.resources, BUY_FUNC_COST) && !player.buildTurnUsedBuyFunc) {
    const funcCap = maxFuncHandFor(player);
    if ((player.funcCards || []).length < funcCap) {
      return { type: 'buyFuncCardPermanent' };
    }
  }

  // 6. 跳过
  return { type: 'pass' };
}

/* ────────── 等待状态处理 ────────── */

function decidePendingAction(game, player, _diff, _botState) {
  // pendingRedrawChoice（买卡/重抽后选 1 张保留）
  if (game.pendingRedrawChoice && game.pendingRedrawChoice.playerId === player.id) {
    const options = game.pendingRedrawChoice.options || [];
    if (!options.length) return { type: 'redrawPick', payload: { cardId: null } };
    // 挑一张：优先建筑（可冲分），其次功能卡
    // 简易随机；普通优先分数；困难精细计算
    if (_diff === 'easy') {
      const pick = pickRandom(options);
      return { type: 'redrawPick', payload: { keepId: pick ? pick.id : null } };
    }
    // normal / hard：优先分数类建筑和高分建筑
    let best = options[0];
    let bestScore = -Infinity;
    for (const c of options) {
      let sc = 0;
      if (c.kind === 'building') {
        sc = (c.score || 0) * 20;
        if (c.buildType === 'score2') sc += 30;
        if (c.buildType === 'score1') sc += 15;
        if (c.buildType === 'exchange') sc += (_diff === 'hard' ? 25 : 12);
        if (c.buildType === 'produce' && c.resource) {
          const needs = estimateResourceNeeds(player);
          sc += Math.max(0, (needs[c.resource] || 0) - (player.resources[c.resource] || 0)) * 5;
        }
      } else if (c.kind === 'function') {
        // 功能卡优先级
        const fp = {
          robbery: 15,
          illegalBuild: 15,
          harvest: 12,
          redraw: 10,
          recruit: 9,
          enhance: 8,
          expand: 7,
          caravan: 5,
          exile: 4,
          remoteDice: 4,
          banditRaid: 3,
          shelter: 2,
          welfareHouse: 1,
        };
        sc = (fp[c.funcType] || 3) * 3;
      }
      if (sc > bestScore) {
        bestScore = sc;
        best = c;
      }
    }
    return { type: 'redrawPick', payload: { keepId: best ? best.id : null } };
  }

  // pendingWelfareMinimumChoices 低保户补偿
  if (game.pendingWelfareMinimumChoices && game.pendingWelfareMinimumChoices[player.id]) {
    const count = game.pendingWelfareMinimumChoices[player.id].count || 2;
    // 选最缺的资源
    const needs = estimateResourceNeeds(player);
    const needRes = pickMostNeededResource(player, needs) || 'wood';
    return { type: 'eventPickTwoResources', payload: { amounts: { [needRes]: count } } };
  }

  // pendingEventChoice 事件牌选择
  if (game.pendingEventChoice && game.pendingEventChoice.playerId === player.id) {
    const ev = game.pendingEventChoice;
    const et = ev.eventType; // 需要看 engine 具体的事件类型
    // 这里用最通用的兜底：如果要求选资源，选最缺的
    if (et === 'pickResource' || ev.label && ev.label.includes('资源')) {
      const needs = estimateResourceNeeds(player);
      const needRes = pickMostNeededResource(player, needs) || 'wood';
      return { type: 'eventPickResource', payload: { resource: needRes } };
    }
    if (et === 'pickTwoResources' || (ev.options && ev.options.length)) {
      const needs = estimateResourceNeeds(player);
      const needRes = pickMostNeededResource(player, needs) || 'wood';
      return { type: 'eventPickTwoResources', payload: { amounts: { [needRes]: 2 } } };
    }
    // 其他事件先返回一个兜底 pass（实际不会走到这里，因为服务端会等 human）
    return null;
  }

  // pendingIllegalBuild / pendingRobberyPick（等待别人选的时候不用管；如果是自己选）
  if (game.pendingIllegalBuild && game.pendingIllegalBuild.targetId === player.id) {
    // 被拆迁选一张自己的建筑弃掉，优先弃最没用的（分数最低的）
    const built = (player.buildings || []).filter((b) => b.built);
    if (built.length) {
      built.sort((a, b) => (a.score || 0) - (b.score || 0));
      return { type: 'illegalBuildPick', payload: { buildingId: built[0].id } };
    }
    return { type: 'cancelIllegalBuild' };
  }

  if (game.pendingRobberyPick && game.pendingRobberyPick.targetId === player.id) {
    // 被抢劫选一张手牌功能卡交出
    const cards = player.funcCards || [];
    if (cards.length) {
      // 优先交最没用的
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
    if (game.pendingTrade.toId === player.id) {
      // 收到交易请求：简单逻辑接受或拒绝
      // normal/hard 评估交易是否划算
      const trade = game.pendingTrade;
      if (_diff === 'hard') {
        const give = trade.take || {}; // 我们给的是 take（从发起方角度）
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
      return { type: 'rejectTrade' };
    }
  }

  // wish well 许愿井资源分配
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

/* ────────── 生产阶段入口 ────────── */

function decideProducePhase(game, player, diff, botState) {
  // 先投骰
  if (game.awaitingProduceRoll) {
    return { type: 'produceRoll' };
  }

  // 使用生产阶段功能卡（遥控骰子/驱逐/强盗），在困难模式精心判断
  if (diff === 'hard') {
    const funcExile = (player.funcCards || []).find((c) => c.funcType === 'exile');
    const funcBandit = (player.funcCards || []).find((c) => c.funcType === 'banditRaid');
    const funcRemote = (player.funcCards || []).find((c) => c.funcType === 'remoteDice');

    // 驱逐：当某 face 上有很多别人的骰子且我们想放那里时
    if (funcExile) {
      const dice = game.dice && game.dice[player.id] ? game.dice[player.id] : [];
      for (let face = 1; face <= 6; face++) {
        if (!dice.includes(face)) continue;
        for (const area of BOARD_AREAS) {
          const board = game.board && game.board[area];
          if (!board) continue;
          const wk = slotWorkers(board, face);
          let rivalTotal = 0;
          for (const [id, n] of Object.entries(wk)) {
            if (id !== player.id && id !== '__neutral__') rivalTotal += n;
          }
          if (rivalTotal >= 2) {
            // 收益高：驱逐该 face 的别人骰子
            return { type: 'useFunc', payload: { cardId: funcExile.id, area, number: face } };
          }
        }
      }
    }

    // 强盗来袭：在资源贫瘠的 face 放，干扰别人
    if (funcBandit) {
      // 找一个别人有很多骰子、且板块价值高的 face
      for (let face = 1; face <= 6; face++) {
        for (const area of BOARD_AREAS) {
          const board = game.board && game.board[area];
          if (!board) continue;
          const tiles = tilesOnNumber(board, face);
          if (!tiles.length) continue;
          const wk = slotWorkers(board, face);
          let rivalTotal = 0;
          for (const [id, n] of Object.entries(wk)) {
            if (id !== player.id && id !== '__neutral__') rivalTotal += n;
          }
          if (rivalTotal >= 2) {
            return { type: 'useFunc', payload: { cardId: funcBandit.id, area, number: face } };
          }
        }
      }
    }

    // 遥控骰子：如果当前骰子组合很差，或者想精准放到高价值 face
    if (funcRemote) {
      const dice = game.dice && game.dice[player.id] ? game.dice[player.id] : [];
      // 如果当前骰子只有很差的选项（比如全被中立占或没有板块），用遥控
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
      if (!hasGood) {
        return { type: 'useFunc', payload: { cardId: funcRemote.id } };
      }
    }
  }

  // 放置骰子
  const place = decidePlaceDice(game, player, diff, botState);
  if (place) return place;

  return null;
}

/* ────────── 主入口 ────────── */

/**
 * 为指定 bot 玩家生成下一个 action。
 * @param {object} game       – engine 游戏状态
 * @param {string} playerId   – bot 玩家 ID
 * @param {string} difficulty – 'easy'|'normal'|'hard'
 * @param {object} botState   – 可选，持久化状态（如 hard 模式记忆对手暗置卡）
 * @returns {{type:string, payload?:object}|null}
 */
function decideBotAction(game, playerId, difficulty, botState = {}) {
  const player = playerById(game, playerId);
  if (!player || player.left) return null;

  const diff = String(difficulty || 'normal').toLowerCase();

  // 各种待处理状态优先处理
  const pending = decidePendingAction(game, player, diff, botState);
  if (pending) return pending;

  // 生产阶段
  if (game.phase === 'produce' && game.currentPlayerId === playerId) {
    return decideProducePhase(game, player, diff, botState);
  }

  // 建造阶段
  if (game.phase === 'build' && game.currentPlayerId === playerId) {
    // 先处理弃牌
    const discard = decidePendingDiscard(game, player, diff, botState);
    if (discard) return discard;
    return decideBuildAction(game, player, diff, botState);
  }

  // 结算动画/结算阶段：不需要操作（由服务端自动推进）

  return null;
}

module.exports = { decideBotAction };
