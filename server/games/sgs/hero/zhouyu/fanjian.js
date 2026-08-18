'use strict';
module.exports = {
  id: 'fanjian',
  name: '反间',
  desc: '出牌阶段限一次，令一名其他角色选择花色后获得你一张手牌并展示，若花色不同则你对其造成1点伤害。',
  type: 'active',
  filter(ctx) {
    return !ctx.skillUsed(ctx.player, 'fanjian') && ctx.player.hand.length > 0;
  },
  content(ctx) {
    const tid = ctx.payload && ctx.payload.targetId;
    const target = ctx.getPlayer(tid);
    if (!target || target.id === ctx.player.id) return { ok: false };
    ctx.markSkillUsed(ctx.player, 'fanjian');
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'fanjian',
      playerId: ctx.player.id,
      askId: target.id,
      targetId: target.id,
      message: '反间：请选择一种花色',
      step: 'suit',
    });
    return { ok: true };
  },
};
