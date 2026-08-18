'use strict';
module.exports = {
  id: 'zhiheng',
  name: '制衡',
  desc: '出牌阶段限一次，弃置任意张牌然后摸等量牌；若弃光所有手牌则摸牌数+1。',
  type: 'active',
  filter(ctx) {
    return !ctx.skillUsed(ctx.player, 'zhiheng');
  },
  content(ctx) {
    const ids = (ctx.payload && ctx.payload.cardIds) || [];
    if (!ids.length) return { ok: false };
    const allHand =
      ctx.player.hand.length > 0 &&
      ids.filter((id) => ctx.player.hand.includes(id)).length ===
        ctx.player.hand.length &&
      ids.every((id) => ctx.player.hand.includes(id) || true);
    let handDiscarded = 0;
    const handBefore = ctx.player.hand.length;
    for (const id of ids) {
      const z = ctx.player.hand.includes(id)
        ? 'hand'
        : Object.keys(ctx.player.equips || {}).find(
            (s) => ctx.player.equips[s] && ctx.player.equips[s].id === id
          );
      if (z === 'hand') {
        ctx.discard(ctx.player, id, 'hand');
        handDiscarded += 1;
      } else if (z) {
        ctx.discard(ctx.player, id, 'equip:' + z);
      }
    }
    let n = ids.length;
    if (handBefore > 0 && ctx.player.hand.length === 0 && handDiscarded === handBefore) {
      n += 1;
    }
    ctx.draw(ctx.player, n);
    ctx.markSkillUsed(ctx.player, 'zhiheng');
    return { ok: true };
  },
};
