'use strict';
const { limitedUsed, markLimitedUsed } = require('../_infra_helpers');

module.exports = {
  id: 'luanwu',
  name: '乱武',
  desc: '限定技，出牌阶段，你可令所有其他角色依次选择：对距离最近的另一名角色使用【杀】，或失去1点体力。',
  type: 'active',
  filter(ctx) {
    return !limitedUsed(ctx.player, 'luanwu');
  },
  content(ctx) {
    markLimitedUsed(ctx.player, 'luanwu');
    const others = ctx.alivePlayers().filter((p) => p.id !== ctx.player.id);
    if (!others.length) return { ok: true };
    const order = others
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((p) => p.id);
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'luanwu',
      playerId: ctx.player.id,
      askId: order[0],
      order,
      index: 0,
      message: '乱武：对距离最近的角色出【杀】，或失去1点体力',
    });
    return { ok: true };
  },
};
