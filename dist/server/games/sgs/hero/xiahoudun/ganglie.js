'use strict';
module.exports = {
  id: 'ganglie',
  name: '刚烈',
  desc: '你每受到一次伤害，你可以进行判定：若结果为红色，则伤害来源受到你造成的1点伤害；若结果为黑色，你选择令伤害来源弃置一张牌。',
  type: 'trigger',
  triggers: ['afterDamage'],
  filter(ctx) {
    return Boolean(ctx.sourceId && ctx.getPlayer(ctx.sourceId));
  },
  content(ctx) {
    ctx.beginJudgeReveal(ctx.player, {
      skillId: 'ganglie',
      skillName: '刚烈',
      message: `${ctx.player.name} 【刚烈】判定`,
      extra: { sourceId: ctx.sourceId },
    });
    return { ok: true };
  },
};
