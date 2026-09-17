'use strict';
module.exports = {
  id: 'rende',
  name: '仁德',
  desc: '出牌阶段，你可以将任意数量手牌交给其他角色；若你此回合首次给出的牌不少于两张，你视为使用一张基本牌。',
  type: 'active',
  filter(ctx) {
    return ctx.player.hand.length > 0;
  },
  content(ctx) {
    const ids = (ctx.payload && ctx.payload.cardIds) || [];
    const tid = ctx.payload && ctx.payload.targetId;
    if (!ids.length || !tid) {
      ctx.log('仁德需要指定目标与手牌');
      return { ok: false };
    }
    const target = ctx.getPlayer(tid);
    if (!target || target.id === ctx.player.id) return { ok: false };
    for (const id of ids) {
      if (!ctx.player.hand.includes(id)) return { ok: false };
    }
    for (const id of ids) {
      ctx.takeHand(ctx.player, id);
      target.hand.push(id);
    }
    ctx.log(ctx.player.name + ' 仁德交给 ' + target.name + ' ' + ids.length + ' 张牌');
    ctx.player.skillStates = ctx.player.skillStates || {};
    const given = (ctx.player.skillStates.rendeGiven || 0) + ids.length;
    const first = !ctx.player.skillStates.rendeTriggered;
    ctx.player.skillStates.rendeGiven = given;
    if (first && given >= 2) {
      ctx.player.skillStates.rendeTriggered = true;
      ctx.setPending({
        type: 'skill_effect',
        skillId: 'rende',
        playerId: ctx.player.id,
        askId: ctx.player.id,
        message: '仁德：视为使用一张基本牌（杀/闪/桃/酒），请选择',
        step: 'basic',
      });
    }
    return { ok: true };
  },
};
