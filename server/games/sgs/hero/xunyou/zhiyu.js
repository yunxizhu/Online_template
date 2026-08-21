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
    const handIds = ctx.player.hand.slice();
    const colors = handIds
      .map((id) => {
        const c = ctx.cardById(id);
        return c ? ctx.suitColor(c.suit) : null;
      })
      .filter(Boolean);
    const same =
      colors.length > 0 && colors.every((c) => c === colors[0]);
    ctx.log(
      `${ctx.player.name} 智愚展示手牌${same ? '（同色）' : '（异色）'}`
    );
    ctx.setPending({
      type: 'card_reveal',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      shown: handIds,
      skillId: 'zhiyu',
      skillName: '智愚',
      title: '智愚',
      message: `${ctx.player.name} 展示全部手牌${same ? '（同色）' : '（异色）'}`,
      _afterReveal: {
        kind: 'zhiyu',
        same,
        sourceId: ctx.sourceId,
        playerId: ctx.player.id,
      },
    });
    return { ok: true };
  },
};
