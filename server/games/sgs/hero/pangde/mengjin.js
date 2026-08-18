'use strict';

module.exports = {
  id: 'mengjin',
  name: '猛进',
  desc: '当你使用的【杀】被【闪】抵消后，你可以弃置目标角色的一张牌。',
  type: 'trigger',
  triggers: ['afterShaMissed'],
  filter(ctx) {
    const t = ctx.getPlayer(ctx.targetId);
    if (!t || !t.alive) return false;
    const eqs = Object.values(t.equips || {}).filter(Boolean).length;
    return t.hand.length + eqs > 0;
  },
  content(ctx) {
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'mengjin',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      targetId: ctx.targetId,
      message: '猛进：弃置目标一张牌，或取消',
      canPass: true,
    });
    return { ok: true };
  },
};
