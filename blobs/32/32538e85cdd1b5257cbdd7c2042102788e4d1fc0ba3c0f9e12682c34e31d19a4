'use strict';
module.exports = {
  id: 'guicai',
  name: '鬼才',
  desc: '在判定牌生效前，你可以打出一张牌代替之。',
  type: 'trigger',
  triggers: ['beforeJudge'],
  filter(ctx) {
    const p = ctx.player;
    if (p.hand.length) return true;
    return Object.values(p.equips || {}).some(Boolean);
  },
  content(ctx) {
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'guicai',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      judgeOwnerId: ctx.judgeOwnerId,
      message: '鬼才：打出一张牌替换判定牌，或取消',
      canPass: true,
    });
    return { ok: true };
  },
};
