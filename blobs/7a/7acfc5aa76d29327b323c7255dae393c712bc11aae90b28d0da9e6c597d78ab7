'use strict';
module.exports = {
  id: 'tiaoxin',
  name: '挑衅',
  desc: '出牌阶段限一次，你可以令攻击范围内含有你的一名角色选择一项：对你使用一张【杀】，或令你弃置其一张牌。',
  type: 'active',
  filter(ctx) {
    if (ctx.skillUsed(ctx.player, 'tiaoxin')) return false;
    return ctx.alivePlayers().some((p) => {
      if (p.id === ctx.player.id) return false;
      return ctx.inAttackRange(p.id, ctx.player.id);
    });
  },
  content(ctx) {
    const tid = ctx.payload && ctx.payload.targetId;
    const target = ctx.getPlayer(tid);
    if (!target || target.id === ctx.player.id) return { ok: false };
    if (!ctx.inAttackRange(target.id, ctx.player.id)) return { ok: false };
    ctx.markSkillUsed(ctx.player, 'tiaoxin');
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'tiaoxin',
      skillName: '挑衅',
      playerId: ctx.player.id,
      askId: target.id,
      targetId: target.id,
      message: '挑衅：对 ' + ctx.player.name + ' 使用一张【杀】，或令其弃置你一张牌',
      canPass: true,
    });
    ctx.log(ctx.player.name + ' 对 ' + target.name + ' 发动【挑衅】');
    return { ok: true };
  },
};
