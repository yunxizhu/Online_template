'use strict';
module.exports = {
  id: 'liyu',
  name: '利驭',
  desc: '当你的【杀】对其他角色造成伤害后，你可以获得其区域一张牌；非装备则其摸1张，装备则视为你对另一名角色使用【决斗】。',
  type: 'trigger',
  triggers: ['afterShaDamage'],
  filter(ctx) {
    const t = ctx.getPlayer(ctx.targetId);
    if (!t || !t.alive) return false;
    return (
      t.hand.length +
        Object.values(t.equips || {}).filter(Boolean).length +
        t.judges.length >
      0
    );
  },
  content(ctx) {
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'liyu',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      targetId: ctx.targetId,
      message: '利驭：获得目标区域一张牌，或取消',
      canPass: true,
    });
    return { ok: true };
  },
};
