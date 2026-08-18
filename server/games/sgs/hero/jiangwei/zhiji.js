'use strict';
const { awakened, markAwakened, gainSkill } = require('../_infra_helpers');

module.exports = {
  id: 'zhiji',
  name: '志继',
  desc: '觉醒技，准备阶段，若你没有手牌，你回复1点体力或摸两张牌，然后减1点体力上限，并获得技能【观星】。',
  type: 'trigger',
  forced: true,
  triggers: ['phasePrepare'],
  filter(ctx) {
    if (awakened(ctx.player, 'zhiji')) return false;
    return ctx.player.hand.length === 0;
  },
  content(ctx) {
    markAwakened(ctx.player, 'zhiji');
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'zhiji',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      message: '志继：选择回复1点体力或摸两张牌',
      step: 'choose',
    });
    return { ok: true };
  },
  _gainSkill: gainSkill,
};
