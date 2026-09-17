'use strict';
module.exports = {
  id: 'yiji',
  name: '遗计',
  desc: '你每受到一次伤害，你可以摸两张牌，并可以把这两张分配给任意角色。',
  type: 'trigger',
  triggers: ['afterDamage'],
  filter() {
    return true;
  },
  content(ctx) {
    const got = ctx.draw(ctx.player, 2);
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'yiji',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      cardIds: got.slice(),
      message: '遗计：可将摸到的牌分配给任意角色（点目标交给其一张，或取消留给自己）',
      canPass: true,
      minTargets: 1,
      maxTargets: 1,
      allowSelf: true,
    });
    return { ok: true };
  },
};
