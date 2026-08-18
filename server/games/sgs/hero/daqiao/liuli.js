'use strict';
module.exports = {
  id: 'liuli',
  name: '流离',
  desc: '当你成为【杀】的目标时，你可以弃置一张牌，将此【杀】转移给你攻击范围内的一名其他角色（不能是使用者）。',
  type: 'trigger',
  triggers: ['whenShaTarget'],
  filter(ctx) {
    return ctx.player.hand.length + Object.values(ctx.player.equips || {}).filter(Boolean).length > 0;
  },
  content(ctx) {
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'liuli',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      attackerId: ctx.sourceId,
      sourceId: ctx.sourceId,
      message: '流离：弃一张牌并选择转移目标，或取消',
      canPass: true,
      minTargets: 1,
      maxTargets: 1,
    });
    return { ok: true };
  },
};
