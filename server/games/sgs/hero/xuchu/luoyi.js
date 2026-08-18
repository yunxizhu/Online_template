'use strict';
module.exports = {
  id: 'luoyi',
  name: '裸衣',
  desc: '摸牌阶段时，你可以翻开牌堆顶3张牌，然后你可以放弃摸牌并获得其中所有武器牌与基本牌，若如此做，本回合你使用【杀】或【决斗】伤害+1。',
  type: 'trigger',
  triggers: ['phaseDraw'],
  filter() {
    return true;
  },
  content(ctx) {
    const shown = [];
    for (let i = 0; i < 3; i++) {
      if (!ctx.game.drawPile.length) break;
      shown.push(ctx.game.drawPile.shift());
    }
    ctx.player.skillStates = ctx.player.skillStates || {};
    ctx.player.skillStates._luoyiShown = shown;
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'luoyi',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      shown,
      message: '裸衣：是否放弃摸牌，获得翻开的武器与基本牌？（本回合杀/决斗伤害+1）',
      canPass: true,
    });
    return { ok: true };
  },
};
