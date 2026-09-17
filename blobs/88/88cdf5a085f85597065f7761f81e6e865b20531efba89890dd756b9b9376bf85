'use strict';

module.exports = {
  id: 'jieming',
  name: '节命',
  desc: '当你受到 1 点伤害后，你可以令一名角色将手牌摸至体力上限（至多摸至 5 张）。',
  type: 'trigger',
  triggers: ['afterDamage'],
  filter() {
    return true;
  },
  content(ctx) {
    const times = Math.max(1, ctx.amount | 0);
    const tid = ctx.payload && ctx.payload.targetId;
    if (tid) {
      const t = ctx.getPlayer(tid);
      if (t && t.alive) {
        const cap = Math.min(t.maxHp, 5);
        const need = cap - t.hand.length;
        if (need > 0) ctx.draw(t, need);
        ctx.log(`${ctx.player.name} 节命：令 ${t.name} 将手牌摸至 ${cap}`);
      }
      return { ok: true };
    }
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'jieming',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      amount: times,
      message: `节命：令一名角色将手牌摸至体力上限（至多 5 张）${
        times > 1 ? `（可发动 ${times} 次）` : ''
      }，或取消`,
      canPass: true,
      minTargets: 1,
      maxTargets: 1,
    });
    return { ok: true };
  },
};
