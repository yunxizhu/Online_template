'use strict';
module.exports = {
  id: 'gongqi',
  name: '弓骑',
  desc: '出牌阶段限一次，你可以弃置一张牌，本回合你的攻击范围无限；若弃置的是装备牌，你可以弃置一名其他角色的一张牌。',
  type: 'active',
  filter(ctx) {
    if (ctx.skillUsed(ctx.player, 'gongqi')) return false;
    const n =
      ctx.player.hand.length +
      Object.values(ctx.player.equips || {}).filter(Boolean).length;
    return n > 0;
  },
  content(ctx) {
    const cid = ctx.payload && ctx.payload.cardId;
    if (!cid) return { ok: false };
    let from = null;
    let wasEquip = false;
    if (ctx.player.hand.includes(cid)) {
      from = 'hand';
    } else {
      const slot = Object.keys(ctx.player.equips || {}).find(
        (s) => ctx.player.equips[s] && ctx.player.equips[s].id === cid
      );
      if (!slot) return { ok: false };
      from = 'equip:' + slot;
      wasEquip = true;
    }
    ctx.discard(ctx.player, cid, from);
    ctx.player.skillStates = ctx.player.skillStates || {};
    ctx.player.skillStates.gongqiRange = true;
    ctx.markSkillUsed(ctx.player, 'gongqi');
    ctx.log(ctx.player.name + ' 发动弓骑，本回合攻击范围无限');
    if (wasEquip) {
      const others = ctx.alivePlayers().filter((p) => {
        if (p.id === ctx.player.id) return false;
        const n =
          p.hand.length +
          Object.values(p.equips || {}).filter(Boolean).length +
          (p.judges || []).length;
        return n > 0;
      });
      if (others.length) {
        ctx.setPending({
          type: 'skill_effect',
          skillId: 'gongqi',
          playerId: ctx.player.id,
          askId: ctx.player.id,
          message: '弓骑：可弃置一名其他角色的一张牌，或取消',
          canPass: true,
        });
      }
    }
    return { ok: true };
  },
};
