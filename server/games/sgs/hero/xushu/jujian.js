'use strict';

module.exports = {
  id: 'jujian',
  name: '举荐',
  desc: '出牌阶段限一次，你可以弃置至多三张牌，令一名其他角色摸等量的牌；若弃置的牌均为同一类别且不少于三张，你回复 1 点体力。',
  type: 'active',
  filter(ctx) {
    if (ctx.skillUsed(ctx.player, 'jujian')) return false;
    const n =
      ctx.player.hand.length +
      Object.values(ctx.player.equips || {}).filter(Boolean).length;
    return n > 0;
  },
  content(ctx) {
    const ids = (ctx.payload && ctx.payload.cardIds) || [];
    const tid = ctx.payload && ctx.payload.targetId;
    if (!ids.length || ids.length > 3 || !tid) {
      ctx.setPending({
        type: 'skill_effect',
        skillId: 'jujian',
        playerId: ctx.player.id,
        askId: ctx.player.id,
        message: '举荐：弃置 1~3 张牌并选择一名其他角色摸等量牌',
        canPass: true,
        minTargets: 1,
        maxTargets: 1,
      });
      return { ok: true };
    }
    const target = ctx.getPlayer(tid);
    if (!target || !target.alive || target.id === ctx.player.id) {
      return { ok: false };
    }

    const types = [];
    for (const id of ids) {
      let from = null;
      if (ctx.player.hand.includes(id)) from = 'hand';
      else {
        const slot = Object.keys(ctx.player.equips || {}).find(
          (s) => ctx.player.equips[s] && ctx.player.equips[s].id === id
        );
        if (slot) from = 'equip:' + slot;
      }
      if (!from) return { ok: false };
      const c = ctx.cardById(id);
      types.push(c ? c.type : null);
      ctx.discard(ctx.player, id, from);
    }

    ctx.draw(target, ids.length);
    ctx.markSkillUsed(ctx.player, 'jujian');
    ctx.log(
      ctx.player.name +
        ' 举荐令 ' +
        target.name +
        ' 摸 ' +
        ids.length +
        ' 张牌'
    );

    if (
      ids.length >= 3 &&
      types[0] &&
      types.every((t) => t === types[0])
    ) {
      ctx.recover(ctx.player, 1);
      ctx.log(ctx.player.name + ' 举荐回复 1 点体力');
    }
    return { ok: true };
  },
};
