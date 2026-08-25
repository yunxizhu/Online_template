'use strict';
module.exports = {
  id: 'jizhi',
  name: '集智',
  desc: '当你使用非转化锦囊时，你可以摸一张牌；以此法摸的牌本回合不计入手牌上限。',
  type: 'trigger',
  triggers: ['afterUseTrick'],
  filter(ctx) {
    if (!ctx.card || ctx.card.type !== 'trick') return false;
    // 转化技打出的锦囊（奇袭/国色等）不触发
    if (ctx.card._viewAs) return false;
    return true;
  },
  content(ctx) {
    const got = ctx.draw(ctx.player, 1);
    const turn = ctx.game.turnCount || 0;
    for (const id of got) {
      const c = ctx.cardById(id);
      if (c) c._jizhiMark = turn;
    }
    return { ok: true };
  },
};
