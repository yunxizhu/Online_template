'use strict';
module.exports = {
  id: 'weidi',
  name: '伪帝',
  desc: '锁定技，你拥有当前主公的主公技。',
  type: 'locked',
  forced: true,
  triggers: ['phasePrepare'],
  content(ctx) {
    ctx.player.isLordSkillEnabled = true;
    return null;
  },
};
