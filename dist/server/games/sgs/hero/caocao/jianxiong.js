'use strict';
module.exports = {
  id: 'jianxiong',
  name: '奸雄',
  desc: '你每受到一次伤害，你可以摸一张牌并获得对你造成伤害的牌。',
  type: 'trigger',
  triggers: ['afterDamage'],
  filter(ctx) {
    return true;
  },
  content(ctx) {
    ctx.draw(ctx.player, 1);
    const ids = [];
    if (ctx.cardId) {
      const c = ctx.cardById(ctx.cardId);
      if (c && Array.isArray(c._qiceBundle) && c._qiceBundle.length) {
        ids.push(...c._qiceBundle);
      } else {
        ids.push(ctx.cardId);
      }
    }
    if (Array.isArray(ctx.cardIds)) ids.push(...ctx.cardIds);

    const gained = [];
    for (const id of [...new Set(ids)]) {
      if (!ctx.game.discardPile.includes(id)) continue;
      const c = ctx.cardById(id);
      if (!c) continue;
      ctx.game.discardPile = ctx.game.discardPile.filter((x) => x !== id);
      if (c._qiceOrig) {
        const o = c._qiceOrig;
        c.name = o.name;
        c.type = o.type;
        c.subtype = o.subtype;
        c.nature = o.nature;
        c.slot = o.slot;
        c.range = o.range;
        delete c._qiceOrig;
        delete c._viewAs;
      }
      delete c._qiceBundle;
      ctx.gainToHand(ctx.player, id);
      gained.push(c.name);
    }
    if (gained.length) {
      ctx.log(
        ctx.player.name +
          ' 获得了伤害牌' +
          (gained.length > 1 ? `（共 ${gained.length} 张）` : '')
      );
    }
    return { ok: true };
  },
};
