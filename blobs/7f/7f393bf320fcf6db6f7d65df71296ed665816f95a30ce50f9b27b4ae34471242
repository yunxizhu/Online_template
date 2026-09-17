'use strict';
const { limitedUsed, markLimitedUsed } = require('../_infra_helpers');

module.exports = {
  id: 'jiefan',
  name: '解烦',
  desc: '限定技，出牌阶段，你可以指定一名角色，攻击范围内含有该角色的每名角色须弃置一张武器牌，否则该角色摸一张牌。',
  type: 'active',
  limited: true,
  filter(ctx) {
    return !limitedUsed(ctx.player, 'jiefan');
  },
  content(ctx) {
    const tid = ctx.payload && ctx.payload.targetId;
    const target = ctx.getPlayer(tid);
    if (!target || !target.alive) return { ok: false };
    markLimitedUsed(ctx.player, 'jiefan');
    const choosers = ctx
      .alivePlayers()
      .filter((p) => p.id !== target.id && ctx.inAttackRange(p.id, target.id));
    ctx.log(ctx.player.name + ' 发动解烦，指定 ' + target.name);
    if (!choosers.length) {
      ctx.draw(target, 1);
      return { ok: true };
    }
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'jiefan',
      playerId: ctx.player.id,
      askId: choosers[0].id,
      targetId: target.id,
      choosers: choosers.map((p) => p.id),
      index: 0,
      message: '解烦：弃置一张武器牌，或令 ' + target.name + ' 摸一张牌',
    });
    return { ok: true };
  },
};
