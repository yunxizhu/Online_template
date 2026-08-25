'use strict';
module.exports = {
  id: 'qicai',
  name: '奇才',
  desc: '锁定技，使用锦囊无距离限制；每回合使用的第一张锦囊不可被无懈。',
  type: 'locked',
  trickNoDistance() {
    return true;
  },
  firstTrickUncounterable(ctx) {
    ctx.player.skillStates = ctx.player.skillStates || {};
    if (ctx.player.skillStates.qicaiUsed) return false;
    ctx.player.skillStates.qicaiUsed = true;
    return true;
  },
};
