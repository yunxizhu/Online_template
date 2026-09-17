'use strict';

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
    ctx.beginJudgeReveal(ctx.player, {
      skillId: 'tuntian',
      skillName: '屯田',
      message: `${ctx.player.name} 【屯田】判定`,
    });
    return { ok: true };
  },
};
