'use strict';
module.exports = {
  id: 'fanjian',
  name: '反间',
  desc: '出牌阶段限一次，你可以令一名其他角色选择一种花色，然后其获得你的一张手牌并展示。若此牌花色与其所选不同，你对其造成1点伤害。',
  type: 'active',
  filter(ctx) {
    if (ctx.skillUsed(ctx.player, 'fanjian')) return false;
    if (!ctx.player.hand.length) return false;
    return ctx.alivePlayers().some((p) => p.id !== ctx.player.id);
  },
  content(ctx) {
    const tid =
      (ctx.payload && ctx.payload.targetId) ||
      (ctx.payload &&
        ctx.payload.targetIds &&
        ctx.payload.targetIds[0]);
    const target = ctx.getPlayer(tid);
    if (target && target.alive && target.id !== ctx.player.id) {
      ctx.markSkillUsed(ctx.player, 'fanjian');
      ctx.setPending({
        type: 'skill_effect',
        skillId: 'fanjian',
        skillName: '反间',
        playerId: ctx.player.id,
        askId: target.id,
        targetId: target.id,
        step: 'suit',
        message: '反间：请选择一种花色',
        canPass: false,
      });
      return { ok: true };
    }
    // 先让发动者点选一名其他角色
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'fanjian',
      skillName: '反间',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      minTargets: 1,
      maxTargets: 1,
      step: 'target',
      message: '反间：请选择一名其他角色',
      canPass: true,
    });
    return { ok: true };
  },
};
