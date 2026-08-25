'use strict';

/**
 * 木牛流马：宝物装备。牌置于其上视为手牌使用，弃牌阶段不计入手牌上限。
 */

function hasMuniu(player) {
  return Boolean(
    player &&
      player.equips &&
      player.equips.treasure &&
      player.equips.treasure.subtype === 'muniu'
  );
}

function getMuniuPile(player) {
  if (!player.skillPiles) player.skillPiles = {};
  if (!Array.isArray(player.skillPiles.muniu)) player.skillPiles.muniu = [];
  return player.skillPiles.muniu;
}

function syncMuniuSkill(player) {
  if (!player) return;
  player.extraSkillIds = player.extraSkillIds || [];
  const idx = player.extraSkillIds.indexOf('muniu');
  if (hasMuniu(player)) {
    if (idx < 0) player.extraSkillIds.push('muniu');
  } else if (idx >= 0) {
    player.extraSkillIds.splice(idx, 1);
  }
}

/** 木牛被弃置：上面所有牌进入弃牌堆 */
function clearMuniuPile(player, game) {
  if (!player || !player.skillPiles || !player.skillPiles.muniu) return;
  for (const id of player.skillPiles.muniu) {
    if (!game.discardPile.includes(id)) game.discardPile.push(id);
  }
  player.skillPiles.muniu = [];
}

function removeFromMuniuPile(player, cardId) {
  const pile = getMuniuPile(player);
  const i = pile.indexOf(cardId);
  if (i < 0) return false;
  pile.splice(i, 1);
  return true;
}

/** 转移目标：宝物栏为空的其他存活角色（不判距离、不要求对方已有木牛） */
function transferTargets(game, fromId) {
  const out = [];
  for (const p of game.players) {
    if (!p.alive || p.id === fromId) continue;
    if (p.equips && p.equips.treasure) continue;
    out.push(p.id);
  }
  return out;
}

/**
 * 将木牛流马装备（及上面所有牌）交给目标。
 * 视为失去/获得装备，触发枭姬等 afterLoseEquip。
 */
function transferMuniuEquip(game, from, to, emitLoseEquip) {
  if (!from || !to || !to.alive) return false;
  const equip = from.equips && from.equips.treasure;
  if (!equip || equip.subtype !== 'muniu') return false;
  if (to.equips && to.equips.treasure) return false;

  const pile = getMuniuPile(from).slice();
  from.equips.treasure = null;
  to.equips = to.equips || {};
  to.equips.treasure = equip;
  from.skillPiles.muniu = [];
  if (!to.skillPiles) to.skillPiles = {};
  to.skillPiles.muniu = pile;

  syncMuniuSkill(from);
  syncMuniuSkill(to);

  if (typeof emitLoseEquip === 'function') {
    emitLoseEquip(from, equip.id);
  }
  return true;
}

/** 获得他人木牛装备时，连上面的牌一并拿走 */
function gainMuniuEquipFrom(game, from, to, emitLoseEquip) {
  return transferMuniuEquip(game, from, to, emitLoseEquip);
}

module.exports = {
  id: 'muniu',
  name: '木牛流马',
  desc:
    '出牌阶段，你可以将一张手牌置于木牛流马上，然后可将木牛流马转移给宝物栏为空的其他角色。木牛上的牌视为你手牌使用，弃牌阶段不计入手牌上限。',
  type: 'active',
  filter(ctx) {
    return hasMuniu(ctx.player) && (ctx.player.hand || []).length > 0;
  },
  content(ctx) {
    const player = ctx.player;
    const game = ctx.game;
    if (!hasMuniu(player)) return { ok: false, error: '未装备木牛流马' };
    const cardId =
      (ctx.payload && ctx.payload.cardId) ||
      ((ctx.payload && ctx.payload.cardIds && ctx.payload.cardIds[0]) || null);
    if (!cardId) return { ok: false, error: '请选择一张手牌' };
    if (!player.hand.includes(cardId)) {
      return { ok: false, error: '手牌中没有此牌' };
    }

    ctx.takeHand(player, cardId);
    const pile = getMuniuPile(player);
    for (const old of pile) {
      if (!game.discardPile.includes(old)) game.discardPile.push(old);
    }
    pile.length = 0;
    pile.push(cardId);

    const card = ctx.cardById(cardId);
    ctx.log(
      `${player.name} 将【${card ? card.name : '牌'}】置于木牛流马`
    );

    const candidates = transferTargets(game, player.id);
    if (!candidates.length) return { ok: true };

    ctx.setPending({
      type: 'skill_effect',
      skillId: 'muniu',
      skillName: '木牛流马',
      step: 'transfer',
      playerId: player.id,
      askId: player.id,
      candidateIds: candidates,
      minTargets: 0,
      maxTargets: 1,
      canPass: true,
      message: '是否将木牛流马转移给宝物栏为空的其他角色？',
    });
    return { ok: true };
  },
  hasMuniu,
  getMuniuPile,
  syncMuniuSkill,
  clearMuniuPile,
  removeFromMuniuPile,
  transferTargets,
  transferMuniuEquip,
  gainMuniuEquipFrom,
};
