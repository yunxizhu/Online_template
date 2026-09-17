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
      type: 'card_reveal',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      shown,
      skillId: 'luoyi',
      skillName: '裸衣',
      title: '裸衣',
      message: `${ctx.player.name} 翻开牌堆顶 ${shown.length} 张牌`,
      _afterReveal: {
        kind: 'luoyi_choice',
        playerId: ctx.player.id,
        shown,
      },
    });
    return { ok: true };
  },
};
