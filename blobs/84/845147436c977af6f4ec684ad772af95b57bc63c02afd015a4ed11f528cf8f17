'use strict';
module.exports = {
  id: 'dimeng',
  name: '缔盟',
  desc: '出牌阶段限一次，你可以选择两名其他角色，弃置X张牌（X为两人手牌数之差），然后交换他们的手牌。',
  type: 'active',
  filter(ctx) {
    return (
      !ctx.skillUsed(ctx.player, 'dimeng') &&
      ctx.alivePlayers().filter((p) => p.id !== ctx.player.id).length >= 2
    );
  },
  content(ctx) {
    const tids =
      (ctx.payload && ctx.payload.targetIds) ||
      [
        ctx.payload && ctx.payload.targetA,
        ctx.payload && ctx.payload.targetB,
      ].filter(Boolean);
    if (!tids || tids.length !== 2) return { ok: false };
    const a = ctx.getPlayer(tids[0]);
    const b = ctx.getPlayer(tids[1]);
    if (!a || !b || a.id === ctx.player.id || b.id === ctx.player.id) {
      return { ok: false };
    }
    if (a.id === b.id) return { ok: false };
    const diff = Math.abs(a.hand.length - b.hand.length);
    const discards = (ctx.payload && ctx.payload.cardIds) || [];
    if (discards.length !== diff) return { ok: false };
    for (const id of discards) {
      if (ctx.player.hand.includes(id)) ctx.discard(ctx.player, id, 'hand');
      else {
        const slot = Object.keys(ctx.player.equips || {}).find(
          (s) => ctx.player.equips[s] && ctx.player.equips[s].id === id
        );
        if (slot) ctx.discard(ctx.player, id, 'equip:' + slot);
        else return { ok: false };
      }
    }
    const ha = a.hand.slice();
    const hb = b.hand.slice();
    a.hand = hb;
    b.hand = ha;
    ctx.markSkillUsed(ctx.player, 'dimeng');
    ctx.log(
      ctx.player.name + ' 缔盟：' + a.name + ' 与 ' + b.name + ' 交换手牌'
    );
    return { ok: true };
  },
};
