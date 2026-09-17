'use strict';
module.exports = {
  id: 'paoxiao',
  name: '咆哮',
  desc: '锁定技，出牌阶段可无限次使用【杀】；当你使用杀后，本回合使用杀无距离限制。',
  type: 'locked',
  triggers: ['shaLimit', 'afterUseSha'],
  shaLimit() {
    return 99;
  },
  content(ctx) {
    if (ctx.trigger === 'afterUseSha') {
      ctx.player.skillStates = ctx.player.skillStates || {};
      ctx.player.skillStates.paoxiaoNoDistance = true;
    }
    return null;
  },
};
