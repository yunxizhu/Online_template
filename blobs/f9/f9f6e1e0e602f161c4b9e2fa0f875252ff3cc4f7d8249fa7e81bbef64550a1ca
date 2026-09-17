'use strict';
module.exports = {
  id: 'keji',
  name: '克己',
  desc: '若你于出牌阶段未使用或打出过【杀】，你可以跳过弃牌阶段。',
  type: 'trigger',
  triggers: ['phaseDiscard'],
  filter(ctx) {
    return !ctx.player.skillStates || !ctx.player.skillStates.usedShaInPlay;
  },
  content(ctx) {
    ctx.player.skillStates = ctx.player.skillStates || {};
    ctx.player.skillStates.skipDiscard = true;
    ctx.log(ctx.player.name + ' 发动克己，跳过弃牌阶段');
    return { ok: true };
  },
};
