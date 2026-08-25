'use strict';
module.exports = {
  id: 'jieyin',
  name: '结姻',
  desc: '出牌阶段限一次，弃置1张手牌并指定一名男性角色：体力较低者回复1点，较高者摸1张；相等则无事发生。',
  type: 'active',
  filter(ctx) {
    return !ctx.skillUsed(ctx.player, 'jieyin') && ctx.player.hand.length > 0;
  },
  content(ctx) {
    const cid = ctx.payload && ctx.payload.cardId;
    const tid = ctx.payload && ctx.payload.targetId;
    if (!cid || !tid) return { ok: false };
    const target = ctx.getPlayer(tid);
    if (!target || target.gender !== 'male') return { ok: false };
    if (!ctx.player.hand.includes(cid)) return { ok: false };
    ctx.discard(ctx.player, cid, 'hand');
    ctx.markSkillUsed(ctx.player, 'jieyin');
    if (ctx.player.hp < target.hp) {
      ctx.recover(ctx.player, 1);
      ctx.draw(target, 1);
    } else if (ctx.player.hp > target.hp) {
      ctx.recover(target, 1);
      ctx.draw(ctx.player, 1);
    }
    return { ok: true };
  },
};
