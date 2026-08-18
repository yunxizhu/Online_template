'use strict';
module.exports = {
  id: 'tuxi',
  name: '突袭',
  desc: '摸牌阶段，你可以少摸1~2张牌，然后获得1~2名其他角色的各一张手牌。',
  type: 'trigger',
  triggers: ['phaseDraw'],
  filter(ctx) {
    return ctx.alivePlayers().some(
      (p) => p.id !== ctx.player.id && p.hand.length > 0
    );
  },
  content(ctx) {
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'tuxi',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      message: '突袭：选择 1~2 名有手牌的其他角色（将少摸等量牌并获得其各1张手牌），或取消',
      canPass: true,
      minTargets: 1,
      maxTargets: 2,
    });
    return { ok: true };
  },
};
