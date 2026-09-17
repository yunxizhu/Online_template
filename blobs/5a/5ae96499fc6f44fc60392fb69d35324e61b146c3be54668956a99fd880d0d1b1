'use strict';

/**
 * 补益：一名角色濒死时，展示其一张手牌；非基本则弃置并回复 1。
 * 引擎应对持有补益者 emit otherDying / whenDying。
 */
module.exports = {
  id: 'buyi',
  name: '补益',
  desc: '当一名角色进入濒死状态时，你可以展示该角色的一张手牌：若不为基本牌，则弃置之并令其回复 1 点体力。',
  type: 'trigger',
  triggers: ['whenDying', 'otherDying'],
  filter(ctx) {
    const dying = ctx.getPlayer(ctx.dyingId || ctx.targetId) || ctx.player;
    if (!dying || dying.hp > 0) return false;
    // whenDying on self: player is dying; otherDying: dyingId set
    if (ctx.trigger === 'whenDying' && ctx.player.id !== dying.id) {
      // 若引擎把 whenDying 直接发给吴国太且带 dyingId
      if (!ctx.dyingId) return false;
    }
    return dying.hand && dying.hand.length > 0;
  },
  content(ctx) {
    const dying =
      ctx.getPlayer(ctx.dyingId || ctx.targetId) ||
      (ctx.player.hp <= 0 ? ctx.player : null);
    if (!dying || !dying.hand.length) return { ok: false };
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'buyi',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      dyingId: dying.id,
      message:
        '补益：展示 ' + dying.name + ' 的一张手牌（非基本则弃置并回复 1）',
      canPass: true,
    });
    return { ok: true };
  },
};
