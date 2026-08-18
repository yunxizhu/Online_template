'use strict';

function equipCount(p) {
  return Object.values((p && p.equips) || {}).filter(Boolean).length;
}

function snapshotEquips(p) {
  const out = {};
  for (const slot of Object.keys(p.equips || {})) {
    out[slot] = p.equips[slot] || null;
  }
  return out;
}

module.exports = {
  id: 'ganlu',
  name: '甘露',
  desc: '出牌阶段限一次，你可以选择两名角色，交换其装备区的牌（装备数之差不能超过你已损失的体力值）。',
  type: 'active',
  filter(ctx) {
    if (ctx.skillUsed(ctx.player, 'ganlu')) return false;
    return ctx.alivePlayers().length >= 2;
  },
  content(ctx) {
    const aId =
      ctx.payload &&
      (ctx.payload.targetA || (ctx.payload.targetIds || [])[0]);
    const bId =
      ctx.payload &&
      (ctx.payload.targetB || (ctx.payload.targetIds || [])[1]);
    if (!aId || !bId || aId === bId) {
      ctx.setPending({
        type: 'skill_effect',
        skillId: 'ganlu',
        playerId: ctx.player.id,
        askId: ctx.player.id,
        message: '甘露：选择两名角色交换装备（数量差 ≤ 已损失体力）',
        canPass: true,
        minTargets: 2,
        maxTargets: 2,
      });
      return { ok: true };
    }
    const a = ctx.getPlayer(aId);
    const b = ctx.getPlayer(bId);
    if (!a || !b || !a.alive || !b.alive) return { ok: false };
    const lost = Math.max(0, ctx.player.maxHp - ctx.player.hp);
    const diff = Math.abs(equipCount(a) - equipCount(b));
    if (diff > lost) {
      ctx.log('甘露：装备数之差超过已损失体力');
      return { ok: false };
    }
    const ea = snapshotEquips(a);
    const eb = snapshotEquips(b);
    const slots = new Set([...Object.keys(ea), ...Object.keys(eb)]);
    for (const slot of slots) {
      a.equips[slot] = eb[slot] || null;
      b.equips[slot] = ea[slot] || null;
    }
    ctx.markSkillUsed(ctx.player, 'ganlu');
    ctx.log(
      ctx.player.name + ' 甘露交换 ' + a.name + ' 与 ' + b.name + ' 的装备'
    );
    return { ok: true };
  },
};
