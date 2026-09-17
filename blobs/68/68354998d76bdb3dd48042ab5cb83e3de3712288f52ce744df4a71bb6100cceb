'use strict';
module.exports = {
  id: 'qingnang',
  name: '青囊',
  desc: '出牌阶段，弃置一张手牌，令一名已受伤角色回复1点体力。',
  type: 'active',
  filter(ctx) {
    return !ctx.skillUsed(ctx.player, 'qingnang') && ctx.player.hand.length > 0;
  },
  content(ctx) {
    const cid = ctx.payload && ctx.payload.cardId;
    const tid = ctx.payload && ctx.payload.targetId;
    const target = ctx.getPlayer(tid);
    if (!cid || !target || target.hp >= target.maxHp) return { ok: false };
    if (!ctx.player.hand.includes(cid)) return { ok: false };
    ctx.discard(ctx.player, cid, 'hand');
    ctx.recover(target, 1);
    ctx.markSkillUsed(ctx.player, 'qingnang');
    return { ok: true };
  },
};
