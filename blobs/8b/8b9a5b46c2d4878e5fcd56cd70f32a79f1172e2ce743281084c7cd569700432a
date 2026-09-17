'use strict';

const { effectiveSuit } = require('../_infra_helpers');

module.exports = {
  id: 'tianxiang',
  name: '天香',
  desc: '当你受到伤害时，你可以弃置一张红桃手牌，防止此伤害并将相同伤害转移给一名其他角色。',
  type: 'trigger',
  triggers: ['afterDamage'],
  filter(ctx) {
    return ctx.player.hand.some((id) => {
      const c = ctx.cardById(id);
      return c && effectiveSuit(ctx.player, c) === 'heart';
    });
  },
  content(ctx) {
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'tianxiang',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      sourceId: ctx.sourceId || null,
      amount: ctx.amount || 1,
      nature: ctx.nature || null,
      message:
        '天香：弃置一张红桃手牌并选择一名其他角色转移伤害，或取消',
      canPass: true,
      minTargets: 1,
      maxTargets: 1,
    });
    return { ok: true };
  },
};
