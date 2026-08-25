'use strict';

/**
 * 悲歌：一名角色受到【杀】造成的伤害后，弃一张牌令其判定。
 * 引擎应对持有悲歌者 emit afterShaDamage（含非伤害来源）。
 */
module.exports = {
  id: 'beige',
  name: '悲歌',
  desc: '当一名角色受到【杀】造成的伤害后，你可以弃置一张牌，然后令其进行判定：方块→摸两张；红桃→回复 1；梅花→伤害来源弃两张；黑桃→伤害来源翻面。',
  type: 'trigger',
  triggers: ['afterShaDamage'],
  filter(ctx) {
    const victim = ctx.getPlayer(ctx.targetId || ctx.damagedId);
    if (!victim || !victim.alive) return false;
    const mine =
      ctx.player.hand.length +
      Object.values(ctx.player.equips || {}).filter(Boolean).length;
    return mine > 0;
  },
  content(ctx) {
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'beige',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      targetId: ctx.targetId || ctx.damagedId,
      sourceId: ctx.sourceId || null,
      message: '悲歌：弃置一张牌令受伤角色判定，或取消',
      canPass: true,
    });
    return { ok: true };
  },
};
