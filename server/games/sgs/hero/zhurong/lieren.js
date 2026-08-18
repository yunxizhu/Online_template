'use strict';
const { resolvePinDian } = require('../_infra_helpers');

module.exports = {
  id: 'lieren',
  name: '烈刃',
  desc: '当你使用【杀】对目标角色造成伤害后，你可以与其拼点，若你赢，你获得其一张牌。',
  type: 'trigger',
  triggers: ['afterShaDamage'],
  filter(ctx) {
    const t = ctx.getPlayer(ctx.targetId);
    if (!t || !t.alive) return false;
    if (!ctx.player.hand.length || !t.hand.length) return false;
    return true;
  },
  content(ctx) {
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'lieren',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      targetId: ctx.targetId,
      step: 'pindian',
      message: '烈刃：选择一张手牌拼点，或取消',
      canPass: true,
    });
    return { ok: true };
  },
  // resolvePinDian 供 skillEffects 使用
  _resolvePinDian: resolvePinDian,
};
