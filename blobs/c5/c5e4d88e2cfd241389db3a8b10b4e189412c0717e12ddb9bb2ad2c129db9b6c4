'use strict';
module.exports = {
  id: 'fangquan',
  name: '放权',
  desc: '你可以跳过出牌阶段，若如此做，本回合手牌上限等于体力上限，并在回合结束时令一名其他角色获得一个额外的回合。',
  type: 'trigger',
  triggers: ['phasePlay', 'phaseEnd'],
  filter(ctx) {
    if (ctx.trigger === 'phasePlay') return true;
    return Boolean(
      ctx.player.skillStates && ctx.player.skillStates.fangquanPending
    );
  },
  content(ctx) {
    if (ctx.trigger === 'phasePlay') {
      ctx.player.skillStates = ctx.player.skillStates || {};
      ctx.player.skillStates.fangquanHandLimit = true;
      ctx.player.skillStates.fangquanPending = true;
      ctx.player.skipPlay = true;
      ctx.log(ctx.player.name + ' 发动放权，跳过出牌阶段');
      return { ok: true };
    }
    // phaseEnd：选择一名其他角色获得额外回合
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'fangquan',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      message: '放权：选择一名其他角色获得一个额外回合',
      canPass: false,
      minTargets: 1,
      maxTargets: 1,
    });
    return { ok: true };
  },
};
