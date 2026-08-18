'use strict';
module.exports = {
  id: 'anxu',
  name: '安恤',
  desc: '出牌阶段限一次，你可以选择两名手牌数不同的其他角色，令其中手牌较少的角色获得手牌较多的角色的一张手牌并展示；若此牌不为黑桃，你摸一张牌。',
  type: 'active',
  filter(ctx) {
    if (ctx.skillUsed(ctx.player, 'anxu')) return false;
    const others = ctx.alivePlayers().filter((p) => p.id !== ctx.player.id);
    for (let i = 0; i < others.length; i++) {
      for (let j = i + 1; j < others.length; j++) {
        if (others[i].hand.length !== others[j].hand.length) return true;
      }
    }
    return false;
  },
  content(ctx) {
    const ids =
      (ctx.payload && ctx.payload.targetIds) ||
      [
        ctx.payload && ctx.payload.targetA,
        ctx.payload && ctx.payload.targetB,
      ].filter(Boolean);
    if (!ids || ids.length < 2) return { ok: false };
    const p1 = ctx.getPlayer(ids[0]);
    const p2 = ctx.getPlayer(ids[1]);
    if (!p1 || !p2 || !p1.alive || !p2.alive) return { ok: false };
    if (p1.id === ctx.player.id || p2.id === ctx.player.id) return { ok: false };
    if (p1.id === p2.id) return { ok: false };
    if (p1.hand.length === p2.hand.length) return { ok: false };
    const fewer = p1.hand.length < p2.hand.length ? p1 : p2;
    const more = fewer === p1 ? p2 : p1;
    if (!more.hand.length) return { ok: false };
    ctx.markSkillUsed(ctx.player, 'anxu');
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'anxu',
      playerId: ctx.player.id,
      askId: fewer.id,
      fewerId: fewer.id,
      moreId: more.id,
      targetIds: [p1.id, p2.id],
      message:
        '安恤：从 ' +
        more.name +
        ' 的手牌中获得一张并展示（若非黑桃则 ' +
        ctx.player.name +
        ' 摸一张）',
    });
    return { ok: true };
  },
};
