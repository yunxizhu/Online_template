'use strict';
module.exports = {
  id: 'xiangle',
  name: '享乐',
  desc: '锁定技，当其他角色使用【杀】指定你为目标时，需弃置一张基本牌，否则此【杀】对你无效。',
  type: 'locked',
  forced: true,
  triggers: ['whenShaTarget'],
  filter(ctx) {
    return Boolean(ctx.sourceId && ctx.sourceId !== ctx.player.id);
  },
  content(ctx) {
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'xiangle',
      playerId: ctx.player.id,
      askId: ctx.sourceId,
      sourceId: ctx.sourceId,
      targetId: ctx.player.id,
      message: '享乐：弃置一张基本牌，否则此【杀】无效',
      canPass: true,
    });
    return { ok: true };
  },
};
