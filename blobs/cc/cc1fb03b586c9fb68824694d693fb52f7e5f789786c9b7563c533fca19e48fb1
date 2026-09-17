'use strict';
module.exports = {
  id: 'lijian',
  name: '离间',
  desc: '出牌阶段限一次，弃置一张牌并选择两名男性角色，视为前者对后者使用【决斗】（不可被无懈）。',
  type: 'active',
  filter(ctx) {
    return !ctx.skillUsed(ctx.player, 'lijian');
  },
  content(ctx) {
    const cid = ctx.payload && ctx.payload.cardId;
    const a = ctx.payload && (ctx.payload.targetA || (ctx.payload.targetIds || [])[0]);
    const b = ctx.payload && (ctx.payload.targetB || (ctx.payload.targetIds || [])[1]);
    const pa = ctx.getPlayer(a);
    const pb = ctx.getPlayer(b);
    if (!cid || !pa || !pb || pa.gender !== 'male' || pb.gender !== 'male') {
      return { ok: false };
    }
    if (pa.id === pb.id) return { ok: false };
    if (ctx.player.hand.includes(cid)) ctx.discard(ctx.player, cid, 'hand');
    else {
      const slot = Object.keys(ctx.player.equips || {}).find(
        (s) => ctx.player.equips[s] && ctx.player.equips[s].id === cid
      );
      if (slot) ctx.discard(ctx.player, cid, 'equip:' + slot);
      else return { ok: false };
    }
    ctx.markSkillUsed(ctx.player, 'lijian');
    ctx.startJuedou(pa.id, pb.id, { virtual: true, noWuxie: true });
    return { ok: true };
  },
};
