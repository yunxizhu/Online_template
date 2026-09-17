'use strict';

const {
  pileCards,
  removeFromPile,
  awakened,
} = require('../_infra_helpers');
const { distance } = require('../../distance');

module.exports = {
  id: 'jixi',
  name: '急袭',
  desc: '出牌阶段，你可以将一张「田」当【顺手牵羊】使用。',
  type: 'active',
  filter(ctx) {
    if (
      !awakened(ctx.player, 'zaiqi') &&
      !(ctx.player.extraSkillIds || []).includes('jixi')
    ) {
      return false;
    }
    return pileCards(ctx.player, 'tian').length > 0;
  },
  content(ctx) {
    if (
      !awakened(ctx.player, 'zaiqi') &&
      !(ctx.player.extraSkillIds || []).includes('jixi')
    ) {
      return { ok: false };
    }
    const cardId = ctx.payload && ctx.payload.cardId;
    const tid = ctx.payload && ctx.payload.targetId;
    const tian = pileCards(ctx.player, 'tian');

    if (!cardId || !tian.includes(cardId) || !tid) {
      ctx.setPending({
        type: 'skill_effect',
        skillId: 'jixi',
        playerId: ctx.player.id,
        askId: ctx.player.id,
        step: 'pick',
        tianIds: tian.slice(),
        message: '急袭：选择一张「田」当【顺手牵羊】，并选择距离为 1 的目标',
        canPass: true,
      });
      return { ok: true };
    }

    const target = ctx.getPlayer(tid);
    if (!target || !target.alive || target.id === ctx.player.id) {
      return { ok: false };
    }
    if (distance(ctx.game, ctx.player.id, target.id) !== 1) {
      ctx.log('急袭：目标距离须为 1');
      return { ok: false };
    }

    const cards = [];
    for (const id of target.hand) cards.push(id);
    for (const slot of Object.keys(target.equips || {})) {
      if (target.equips[slot]) cards.push(target.equips[slot].id);
    }
    for (const id of target.judges || []) cards.push(id);
    if (!cards.length) return { ok: false };

    removeFromPile(ctx.player, 'tian', cardId);
    ctx.game.discardPile.push(cardId);
    ctx.log(
      ctx.player.name +
        ' 急袭将「田」当【顺手牵羊】对 ' +
        target.name +
        ' 使用'
    );
    ctx.setPending({
      type: 'choose_gain_target_card',
      playerId: ctx.player.id,
      targetId: target.id,
      cardIds: cards,
      message: '急袭：选择获得目标一张牌',
    });
    return { ok: true };
  },
};
