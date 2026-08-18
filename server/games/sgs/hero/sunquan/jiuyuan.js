'use strict';
module.exports = {
  id: 'jiuyuan',
  name: '救援',
  desc: '主公技锁定技，其他吴势力角色在你濒死时对你使用【桃】，你额外回复1点体力。',
  type: 'locked',
  lord: true,
  onTaoHealBonus(ctx) {
    const user = ctx.taoUser;
    if (!user || user.id === ctx.player.id) return 0;
    if (user.country !== '吴') return 0;
    return 1;
  },
};
