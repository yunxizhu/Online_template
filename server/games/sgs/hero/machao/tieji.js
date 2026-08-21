'use strict';
module.exports = {
  id: 'tieji',
  name: '铁骑',
  desc: '当你使用【杀】指定目标后，你可以进行判定，目标须弃置一张与判定花色相同的牌，否则不能响应此杀。',
  type: 'trigger',
  triggers: ['afterShaSpecify'],
  filter() {
    return true;
  },
  content(ctx) {
    ctx.beginJudgeReveal(ctx.player, {
      skillId: 'tieji',
      skillName: '铁骑',
      message: `${ctx.player.name} 【铁骑】判定`,
      extra: { targetId: ctx.targetId },
    });
    return { ok: true };
  },
};
