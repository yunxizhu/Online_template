'use strict';

const {
  pileCards,
  markAwakened,
  awakened,
  gainSkill,
} = require('../_infra_helpers');

module.exports = {
  id: 'zaiqi',
  name: '凿险',
  desc: '觉醒技，准备阶段，若「田」的数量不少于 3，你减 1 点体力上限，然后获得「急袭」。',
  type: 'locked',
  forced: true,
  triggers: ['phasePrepare'],
  filter(ctx) {
    if (awakened(ctx.player, 'zaiqi')) return false;
    return pileCards(ctx.player, 'tian').length >= 3;
  },
  content(ctx) {
    markAwakened(ctx.player, 'zaiqi');
    ctx.player.maxHp = Math.max(1, ctx.player.maxHp - 1);
    if (ctx.player.hp > ctx.player.maxHp) ctx.player.hp = ctx.player.maxHp;
    const jixi = require('./jixi');
    gainSkill(ctx.player, jixi);
    ctx.log(
      ctx.player.name + ' 凿险觉醒：减 1 点体力上限，获得【急袭】'
    );
    return { ok: true };
  },
};
