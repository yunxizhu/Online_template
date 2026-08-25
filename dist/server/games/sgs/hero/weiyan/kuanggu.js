'use strict';

const { distance } = require('../../distance');

module.exports = {
  id: 'kuanggu',
  name: '狂骨',
  desc: '锁定技，当你使用【杀】对距离 1 以内的角色造成伤害后，你回复等量体力并摸等量牌。',
  type: 'locked',
  triggers: ['afterShaDamage'],
  filter(ctx) {
    const target = ctx.getPlayer(ctx.targetId);
    if (!target || !target.alive) return false;
    return distance(ctx.game, ctx.player.id, target.id) <= 1;
  },
  content(ctx) {
    const n = Math.max(1, ctx.amount | 0);
    const got = ctx.recover(ctx.player, n);
    ctx.draw(ctx.player, n);
    ctx.log(
      `${ctx.player.name} 狂骨：回复 ${got || 0} 点体力并摸 ${n} 张牌`
    );
    return { ok: true };
  },
};
