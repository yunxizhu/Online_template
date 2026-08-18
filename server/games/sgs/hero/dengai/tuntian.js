'use strict';

const { addToPile, effectiveSuit } = require('../_infra_helpers');

/**
 * 屯田：回合外失去牌后判定，非红桃置于武将牌上为「田」。
 * 每有一张田，计算与其他角色距离 -1（见 distanceOffBonus）。
 */
module.exports = {
  id: 'tuntian',
  name: '屯田',
  desc: '当你于回合外失去牌时，你可以进行判定：若结果不为红桃，将判定牌置于你的武将牌上，称为「田」。你计算与其他角色的距离 -X（X 为田的数量）。',
  type: 'trigger',
  triggers: ['afterLoseCard'],
  filter(ctx) {
    const cur = ctx.game.players.find((p) => p.seat === ctx.game.turnSeat);
    if (cur && cur.id === ctx.player.id) return false;
    return true;
  },
  content(ctx) {
    const jid = ctx.judge(ctx.player);
    if (!jid) return { ok: false };
    const jc = ctx.cardById(jid);
    const suit = effectiveSuit(ctx.player, jc);
    ctx.log(
      ctx.player.name +
        ' 屯田判定 ' +
        ctx.suitLabel(jc.suit) +
        jc.number
    );
    if (suit === 'heart') {
      ctx.game.discardPile.push(jid);
      return { ok: true };
    }
    ctx.game.discardPile = ctx.game.discardPile.filter((id) => id !== jid);
    addToPile(ctx.player, 'tian', jid);
    ctx.log(ctx.player.name + ' 将判定牌置于武将牌上作为「田」');
    return { ok: true };
  },
};
