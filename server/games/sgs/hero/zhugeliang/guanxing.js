'use strict';
module.exports = {
  id: 'guanxing',
  name: '观星',
  desc: '回合开始阶段，人数≥4观看牌堆顶5张，否则3张，可以任意顺序置于牌堆顶或牌堆底。',
  type: 'trigger',
  triggers: ['phasePrepare'],
  filter() {
    return true;
  },
  content(ctx) {
    const n = ctx.alivePlayers().length >= 4 ? 5 : 3;
    const cards = [];
    for (let i = 0; i < n; i++) {
      if (!ctx.game.drawPile.length) break;
      cards.push(ctx.game.drawPile.shift());
    }
    if (!cards.length) return { ok: true };
    ctx.setPending({
      type: 'pile_reorder',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      skillId: 'guanxing',
      skillName: '观星',
      cardIds: cards,
      message: '观星：将牌分配到「牌堆顶」或「牌堆底」，并可调整同区内顺序',
    });
    return { ok: true };
  },
};
