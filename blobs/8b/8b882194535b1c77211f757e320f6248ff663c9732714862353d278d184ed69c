'use strict';
const { awakened, markAwakened, gainSkill } = require('../_infra_helpers');

module.exports = {
  id: 'ruoyu',
  name: '若愚',
  desc: '主公技，觉醒技，准备阶段，若你的体力为全场最少（或之一），你加1点体力上限，回复1点体力，并获得技能【激将】。',
  type: 'lord',
  lord: true,
  forced: true,
  triggers: ['phasePrepare'],
  filter(ctx) {
    if (awakened(ctx.player, 'ruoyu')) return false;
    const mine = ctx.player.hp;
    const min = Math.min(...ctx.alivePlayers().map((p) => p.hp));
    return mine <= min;
  },
  content(ctx) {
    markAwakened(ctx.player, 'ruoyu');
    ctx.player.maxHp += 1;
    ctx.recover(ctx.player, 1);
    gainSkill(ctx.player, {
      id: 'jijiang',
      name: '激将',
      desc: '主公技，当你需要使用或打出【杀】时，可令其他蜀势力角色打出【杀】。',
      lord: true,
    });
    ctx.log(ctx.player.name + ' 若愚觉醒：体力上限+1并获得【激将】');
    return { ok: true };
  },
};
