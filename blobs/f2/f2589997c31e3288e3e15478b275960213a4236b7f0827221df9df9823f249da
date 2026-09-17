'use strict';
module.exports = {
  id: 'danlao',
  name: '啖酪',
  desc: '若一名角色对你造成伤害，你可以声明一类牌（基本牌/装备牌/锦囊牌），对你造成伤害的角色在该回合内不能使用和弃置该类牌。',
  type: 'trigger',
  triggers: ['afterDamage'],
  filter(ctx) {
    return Boolean(ctx.sourceId);
  },
  content(ctx) {
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'danlao',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      sourceId: ctx.sourceId,
      options: ['basic', 'equip', 'trick'],
      message:
        '啖酪：声明一类牌（基本/装备/锦囊），伤害来源本回合不能使用和弃置该类牌',
    });
    return { ok: true };
  },
};
