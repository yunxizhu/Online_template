'use strict';
module.exports = {
  id: 'zhiyu',
  name: '智愚',
  desc: '每当你受到一次伤害后，可以摸一张牌，然后展示所有手牌；若颜色相同，伤害来源弃一张手牌。',
  type: 'trigger',
  triggers: ['afterDamage'],
  filter(ctx) {
    return Boolean(ctx.player && ctx.player.alive);
  },
  content(ctx) {
    ctx.draw(ctx.player, 1);
    const colors = ctx.player.hand.map((id) => {
      const c = ctx.cardById(id);
      return c ? ctx.suitColor(c.suit) : null;
    }).filter(Boolean);
    const same =
      colors.length > 0 && colors.every((c) => c === colors[0]);
    ctx.log(
      `${ctx.player.name} 智愚展示手牌${same ? '（同色）' : '（异色）'}`
    );
    if (same && ctx.sourceId) {
      const src = ctx.getPlayer(ctx.sourceId);
      if (src && src.alive && src.hand.length) {
        ctx.setPending({
          type: 'skill_effect',
          skillId: 'zhiyu',
          playerId: ctx.player.id,
          askId: src.id,
          sourceId: src.id,
          message: '智愚：请弃置一张手牌',
          cardIds: src.hand.slice(),
        });
      }
    }
    return { ok: true };
  },
};
