'use strict';

/**
 * 事件牌效果
 * - setupEnvironmentOnBoard：上场初始化
 * - applyEnvironmentOnDispatch：派遣触发（可能返回 needChoice）
 * - applyEnvironmentOnSettleSlot：结算抵消后（资源发放前/穿插）
 */

const {
  getEnvironmentDef,
  RESOURCE_LABELS,
  RESOURCES,
  NEUTRAL_WORKER_ID,
} = require('./decks');

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

/**
 * 上场初始化（抽到 4/5/6 后立刻执行）
 */
function setupEnvironmentOnBoard(game, env, number, helpers) {
  if (!env) return;
  const setup = env.setup || (getEnvironmentDef(env.envType) || {}).setup;
  switch (setup) {
    case 'marker':
      game.barrenMarkerNumber = number;
      if (helpers && helpers.pushLog) {
        helpers.pushLog(game, `「${env.label}」：标记物放在资源格 ${number}`);
      }
      break;
    case 'neutral6':
      addNeutral(game, 'resource', number, 6);
      if (helpers && helpers.pushLog) {
        helpers.pushLog(game, `「${env.label}」：资源格 ${number} 放置 6 枚中立骰`);
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
    case 'stashResources':
      env.stash = { wood: 2, stone: 2, food: 2, iron: 2 };
      env.stashClaimed = false;
      if (helpers && helpers.pushLog) {
        helpers.pushLog(
          game,
          `「${env.label}」：资源格 ${number} 放置每种资源各 2 个`
        );
      }
      break;
    default:
      break;
  }
}

/**
 * 派遣触发
 * @returns {null|{ needChoice, envType, label, number }|object}
 */
function applyEnvironmentOnDispatch(game, ctx) {
  if (!game || !ctx || ctx.area !== 'resource') return null;
  const num = Number(ctx.number);
  if (num < 4 || num > 6) return null;
  const env = envOnResourceSlot(game, num);
  if (!env || env.trigger !== 'dispatch') return null;
  const player = ctx.player;
  if (!player) return null;

  switch (env.envType) {
    case 'barrenHarvest':
      return {
        needChoice: 'moveBarrenMarker',
        envType: env.envType,
        label: env.label,
        number: num,
        playerId: player.id,
      };

    case 'clearSky':
      return {
        needChoice: 'pickResource',
        envType: env.envType,
        label: env.label,
        number: num,
        playerId: player.id,
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
      return {
        needChoice: 'moveNeutral',
        envType: env.envType,
        label: env.label,
        number: num,
        playerId: player.id,
        fromArea: 'resource',
        fromNumber: num,
      };
    }

    case 'firstCome': {
      if (env.stashClaimed) return null;
      const physical =
        ((game.board.resource.workers[num] || {})[player.id]) || 0;
      if (physical < 5) return null;
      const stash = env.stash || { wood: 2, stone: 2, food: 2, iron: 2 };
      const got = grantMap(player, stash);
      env.stashClaimed = true;
      env.stash = { wood: 0, stone: 0, food: 0, iron: 0 };
      if (ctx.pushLog) {
        ctx.pushLog(
          game,
          `${player.name} 触发「${env.label}」：本格农民达 ${physical}，立即获得 ` +
            got.detail
              .map((d) => `${d.amount} ${RESOURCE_LABELS[d.resource]}`)
              .join('、')
        );
      }
      if (ctx.syncResourceHandPending) ctx.syncResourceHandPending(player, game);
      return { envType: env.envType, label: env.label, claimed: true };
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
        ctx.pushLog(game, `「${env.label}」：第二名不获得本格小份资源`);
      }
      break;
    }

    case 'resistBarbarians':
      // 改在全部分发资源后、弃牌前由 applyResistBarbariansAfterSettle 处理
      break;

    case 'prisonersDilemma': {
      const top = ranked.find((r) => r.pid !== NEUTRAL_WORKER_ID) || ranked[0];
      const n = top ? Number(top.count) || 0 : 0;
      const alive = (ctx.alivePlayers && ctx.alivePlayers(game)) || [];
      let min = Infinity;
      for (const p of alive) {
        const c = Number(remain[p.id]) || 0;
        if (c < min) min = c;
      }
      if (!alive.length || !Number.isFinite(min)) break;
      const victims = alive.filter((p) => (Number(remain[p.id]) || 0) === min);
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
            : `「${env.label}」：${victims.map((p) => p.name).join('、')}（最少 ${min}）各需弃 ${n} 张（弃牌阶段后）`
        );
      }
      break;
    }

    case 'luckyDraw': {
      const top = ranked.find((r) => r.pid !== NEUTRAL_WORKER_ID);
      if (top && env.sideCard && ctx.playerById) {
        const p = ctx.playerById(game, top.pid);
        if (p) {
          const card = { ...env.sideCard, faceDown: false };
          env.sideCard = null;
          if (typeof ctx.takeEventSideCard === 'function') {
            ctx.takeEventSideCard(game, p, card);
          }
          if (ctx.pushLog) {
            ctx.pushLog(
              game,
              `「${env.label}」：${p.name} 获得暗置牌「${card.label || card.funcType || card.buildType}」`
            );
          }
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
    const ranked = slot.ranked || [];
    let any = false;
    for (const r of ranked) {
      if (game.over) return;
      if (!r || r.pid === NEUTRAL_WORKER_ID) continue;
      if ((Number(remain[r.pid]) || 0) < 2) continue;
      const p = playerById(game, r.pid);
      if (!p || p.left) continue;
      p.bonusScore = (Number(p.bonusScore) || 0) + 1;
      any = true;
      if (pushLog) {
        pushLog(
          game,
          `「${env.label}」：${p.name}（第 ${ranked.indexOf(r) + 1} 名）+1 胜利点`
        );
      }
      if (typeof checkWin === 'function' && checkWin(game)) return;
    }
    if (!any && pushLog) {
      pushLog(game, `「${env.label}」：无人拥有 ≥2 骰，未生效`);
    }
  }
}

/** 有标记的格不发资源 */
function isBarrenSlot(game, number) {
  return Number(game && game.barrenMarkerNumber) === Number(number);
}

module.exports = {
  setupEnvironmentOnBoard,
  applyEnvironmentOnDispatch,
  applyEnvironmentOnSettleSlot,
  applyEnvironmentAfterShare,
  applyResistBarbariansAfterSettle,
  envOnResourceSlot,
  isBarrenSlot,
  grantOne,
  grantMap,
  addNeutral,
  neutralCountOn,
};
