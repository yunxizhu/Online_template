'use strict';

/**
 * 先主模式（黄巾变种身份局）规则与结算
 */

function xianzhuDeck(n) {
  if (n === 5) return ['xianzhu', 'zhong', 'huangjin', 'fan', 'fan'];
  if (n === 8) {
    return [
      'xianzhu',
      'zhong',
      'zhong',
      'huangjin',
      'fan',
      'fan',
      'fan',
      'fan',
    ];
  }
  throw new Error('先主模式仅支持 5 或 8 人');
}

function maxHuangjin(n) {
  return n <= 5 ? 2 : 4;
}

/** 阵营：lord | rebel | huangjin */
function factionOf(p) {
  if (!p) return null;
  if (p.identity === 'xianzhu') return 'lord';
  if (p.identity === 'zhong') return 'lord';
  if (p.identity === 'houzhu') {
    return p.houzhuOrigin === 'fan' ? 'rebel' : 'lord';
  }
  if (p.identity === 'fan') return 'rebel';
  if (p.identity === 'huangjin') return 'huangjin';
  return null;
}

function isHuangjinViewer(p) {
  return p && p.identity === 'huangjin';
}

function aliveOfFaction(game, faction) {
  return game.players.filter((p) => p.alive && factionOf(p) === faction);
}

function countHuangjinAlive(game) {
  return aliveOfFaction(game, 'huangjin').length;
}

function shouldUprising(game) {
  const alive = game.players.filter((p) => p.alive).length;
  if (alive <= 0) return false;
  const hj = countHuangjinAlive(game);
  // 一半人数向下取整：达到该数量即起义（5人场 2 人、8人场 4 人可触发）
  return hj >= Math.floor(alive / 2) && hj >= 1;
}

function triggerUprising(game, api) {
  if (game.huangjinUprising) return;
  game.huangjinUprising = true;
  game.huangjinConvertLocked = true;
  for (const p of game.players) {
    if (p.identity === 'huangjin') {
      p.identityRevealed = true;
    }
  }
  api.pushLog(game, '【黄巾起义】黄巾势力亮明！此后不可再转变为黄巾。');
}

function maybeUprising(game, api) {
  if (game.mode !== 'xianzhu') return;
  if (game.huangjinUprising) return;
  if (shouldUprising(game)) triggerUprising(game, api);
}

function canConvertToHuangjin(game) {
  if (game.mode !== 'xianzhu') return false;
  if (game.huangjinConvertLocked || game.huangjinUprising) return false;
  const n = game.players.length;
  return countHuangjinAlive(game) < maxHuangjin(n);
}

/**
 * 黄巾对目标造成伤害或回复体力后：标记 +1，满 3 则感染
 */
function onHuangjinTouch(game, source, target, api) {
  if (game.mode !== 'xianzhu') return;
  if (!source || !target || !source.alive || !target.alive) return;
  if (source.identity !== 'huangjin') return;
  if (target.identity === 'huangjin') return;
  if (game.huangjinConvertLocked) return;

  target.huangjinMarks = (target.huangjinMarks || 0) + 1;
  if (target.huangjinMarks >= 3 && canConvertToHuangjin(game)) {
    convertToHuangjin(game, target, api);
  }
  maybeUprising(game, api);
}

function convertToHuangjin(game, target, api) {
  if (!canConvertToHuangjin(game)) return;
  if (target.identity === 'huangjin') return;
  const prev = target.identity;
  target.identity = 'huangjin';
  target.huangjinMarks = 0;
  target.houzhuOrigin = null;
  // 未起义前不对场外亮明
  if (!game.huangjinUprising) {
    target.identityRevealed = false;
  } else {
    target.identityRevealed = true;
  }
  // 仅黄巾可见的转变：写入私有提示
  game._huangjinNotices = game._huangjinNotices || [];
  game._huangjinNotices.push({
    at: Date.now(),
    text: `${target.name} 已被感染为【黄巾】（原身份 ${api.identityLabel(prev)}）`,
  });
  if (game._huangjinNotices.length > 20) game._huangjinNotices.shift();
  maybeUprising(game, api);
}

function identityLabel(id, IDENTITY) {
  return IDENTITY[id] || id;
}

/**
 * 先主死亡且仍有忠臣 → 传位询问；返回 true 表示已挂起、勿立刻判胜
 */
function tryStartSuccession(game, dead, api) {
  if (game.mode !== 'xianzhu') return false;
  if (dead.identity !== 'xianzhu') return false;
  const zhongAlive = game.players.some(
    (p) => p.alive && p.identity === 'zhong'
  );
  if (!zhongAlive) return false;
  const candidates = game.players.filter((p) => p.alive).map((p) => p.id);
  if (!candidates.length) return false;
  api.setPending(game, {
    type: 'succession',
    playerId: dead.id,
    askId: dead.id,
    candidates,
    message: '先主传位：选择一名存活角色成为后主（回复 3 体力并摸 3 张牌）',
  });
  api.pushLog(game, `${dead.name} 阵亡，请选择传位对象…`);
  return true;
}

function applySuccession(game, chooserId, targetId, api) {
  const pend = game.pending;
  if (!pend || pend.type !== 'succession' || pend.askId !== chooserId) {
    return { ok: false, error: '当前不是传位' };
  }
  if (!(pend.candidates || []).includes(targetId)) {
    return { ok: false, error: '只能传给存活角色' };
  }
  const target = api.getPlayer(game, targetId);
  if (!target || !target.alive) return { ok: false, error: '目标无效' };

  const origin = target.identity;
  target.houzhuOrigin = origin;
  target.identity = 'houzhu';
  target.identityRevealed = true;
  target.huangjinMarks = 0;
  target.isLordSkillEnabled = true;
  // 亮出原本身份（已通过 houzhuOrigin + identityRevealed）
  const heal = Math.min(3, Math.max(0, target.maxHp - target.hp));
  target.hp += heal;
  api.drawCards(game, target, 3);
  api.clearPending(game);
  api.pushLog(
    game,
    `${target.name} 接受传位成为【后主】（原身份【${api.identityLabel(origin)}】），回复 ${heal} 点体力并摸 3 张牌`
  );

  // 后主若原黄巾：阵营变主公；原反贼：反贼阵营需护卫
  api.checkWin(game);
  if (game.over) return { ok: true };

  maybeUprising(game, api);

  const cur = api.currentPlayer(game);
  const dead = api.getPlayer(game, chooserId);
  if (!cur || (dead && cur.id === dead.id)) {
    api.clearPending(game);
    game.turnSeat = api.nextAliveSeat(game, dead ? dead.seat : game.turnSeat);
    api.startTurn(game);
  } else {
    api.resumeAfterPending(game);
  }
  return { ok: true };
}

/**
 * 后主被击杀 → 连坐灭门
 * @returns {boolean} 是否触发了连坐
 */
function onHouzhuDeath(game, dead, api) {
  if (game.mode !== 'xianzhu') return false;
  if (dead.identity !== 'houzhu') return false;
  const origin = dead.houzhuOrigin;
  if (origin === 'fan') {
    api.pushLog(game, `反贼后主阵亡！反贼阵营全员阵亡！`);
    massacre(game, (p) => factionOf(p) === 'rebel' && p.id !== dead.id, api);
  } else {
    // 忠臣后主 / 黄巾后主：主公阵营全灭
    api.pushLog(game, `后主阵亡！主公阵营全员阵亡！`);
    massacre(game, (p) => factionOf(p) === 'lord' && p.id !== dead.id, api);
  }
  return true;
}

function massacre(game, pred, api) {
  const victims = game.players.filter((p) => p.alive && pred(p));
  for (const v of victims) {
    v.alive = false;
    v.hp = 0;
    v.identityRevealed = true;
    for (const id of api.allCardsOf(v)) {
      const z = api.findCardZone(v, id);
      if (!z) continue;
      if (z.zone === 'hand') api.discardCard(game, v, id, 'hand');
      else if (z.zone === 'judge') api.discardCard(game, v, id, 'judge');
      else if (z.zone === 'equip') {
        v.equips[z.slot] = null;
        game.discardPile.push(id);
      }
    }
    v.hand = [];
    v.judges = [];
    api.pushLog(game, `${v.name} 因连坐而阵亡（【${api.identityLabel(v.identity)}】）`);
  }
}

function checkWinXianzhu(game, api) {
  const alive = game.players.filter((p) => p.alive);
  if (game.pending && game.pending.type === 'succession') return;

  const lords = alive.filter((p) => factionOf(p) === 'lord');
  const rebels = alive.filter((p) => factionOf(p) === 'rebel');
  const hj = alive.filter((p) => factionOf(p) === 'huangjin');

  // 黄巾：除黄巾外无人
  if (hj.length > 0 && lords.length === 0 && rebels.length === 0) {
    api.endGame(
      game,
      hj.map((p) => p.id),
      '黄巾阵营胜利'
    );
    return;
  }

  // 主公阵营：反贼与黄巾全灭
  if (lords.length > 0 && rebels.length === 0 && hj.length === 0) {
    api.endGame(
      game,
      lords.map((p) => p.id),
      '主公阵营胜利'
    );
    return;
  }

  // 反贼阵营：主公与黄巾全灭
  if (rebels.length > 0 && lords.length === 0 && hj.length === 0) {
    api.endGame(
      game,
      rebels.map((p) => p.id),
      '反贼阵营胜利'
    );
    return;
  }

  // 先主已死且无后主、无传位 → 视同主公阵营无领袖且无忠可传，若主公阵营已空
  // 若先主死、无忠臣、无后主：lords 可能只剩忠臣… 若忠臣也无了则 lords 空
  // 若仅剩多方僵持则不结束
}

function publicIdentityFor(game, p, viewer) {
  const IDENTITY = game._IDENTITY || {};
  const isSelf = viewer && viewer.id === p.id;
  const uprising = Boolean(game.huangjinUprising);

  // 后主：全员可见后主，并可知原身份
  if (p.identity === 'houzhu' && p.identityRevealed) {
    return {
      identity: 'houzhu',
      identityLabel: `后主（原${IDENTITY[p.houzhuOrigin] || p.houzhuOrigin}）`,
      identityRevealed: true,
      houzhuOrigin: p.houzhuOrigin,
      isZhu: true,
    };
  }

  // 先主：始终亮明
  if (p.identity === 'xianzhu') {
    return {
      identity: 'xianzhu',
      identityLabel: IDENTITY.xianzhu || '先主',
      identityRevealed: true,
      isZhu: true,
    };
  }

  // 黄巾可见性
  if (p.identity === 'huangjin') {
    const show =
      isSelf ||
      uprising ||
      game.over ||
      (viewer && isHuangjinViewer(viewer));
    if (show) {
      return {
        identity: 'huangjin',
        identityLabel: IDENTITY.huangjin || '黄巾',
        identityRevealed: uprising || p.identityRevealed || isSelf,
        isZhu: false,
      };
    }
    return {
      identity: null,
      identityLabel: '？',
      identityRevealed: false,
      isZhu: false,
    };
  }

  // 常规
  const showId =
    p.identityRevealed || isSelf || game.over;
  return {
    identity: showId ? p.identity : null,
    identityLabel: showId ? IDENTITY[p.identity] || p.identity : '？',
    identityRevealed: Boolean(p.identityRevealed) || showId,
    isZhu: false,
  };
}

module.exports = {
  xianzhuDeck,
  maxHuangjin,
  factionOf,
  isHuangjinViewer,
  shouldUprising,
  maybeUprising,
  onHuangjinTouch,
  tryStartSuccession,
  applySuccession,
  onHouzhuDeath,
  checkWinXianzhu,
  publicIdentityFor,
  convertToHuangjin,
};
