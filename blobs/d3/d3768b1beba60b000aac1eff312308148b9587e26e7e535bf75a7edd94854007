'use strict';
module.exports = {
  id: 'luoshen',
  name: '洛神',
  desc: '回合开始阶段，你可以进行判定：若为黑色，你获得此牌并可继续判定；若为红色，则获得此牌并停止判定。',
  type: 'trigger',
  triggers: ['phasePrepare'],
  filter() {
    return true;
  },
  content(ctx) {
    ctx.beginJudgeReveal(ctx.player, {
      skillId: 'luoshen',
      skillName: '洛神',
      message: `${ctx.player.name} 【洛神】判定`,
    });
    return { ok: true };
  },
};
