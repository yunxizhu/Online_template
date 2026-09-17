'use strict';

const { pileCards, addToPile } = require('../_infra_helpers');

/**
 * 不屈：濒死时亮出牌堆顶一张牌置于武将牌上（不屈牌）。
 * 若与已有不屈牌点数均不同，则体力回复至 1；否则弃置该牌。
 * 引擎应在濒死流程中调用 onDying(ctx)。
 */
function onDying(ctx) {
  if (!ctx.player || !ctx.player.alive) return { ok: false };
  if (ctx.player.hp > 0) return { ok: true };

  if (!ctx.game.drawPile.length) {
    ctx.log(`${ctx.player.name} 不屈：牌堆已空`);
    return { ok: false };
  }

  const cardId = ctx.game.drawPile.shift();
  const card = ctx.cardById(cardId);
  if (!card) return { ok: false };

  const pile = pileCards(ctx.player, 'buqu');
  const dup = pile.some((id) => {
    const c = ctx.cardById(id);
    return c && c.number === card.number;
  });

  ctx.log(
    `${ctx.player.name} 不屈亮出 ${ctx.suitLabel(card.suit)}${card.number}`
  );

  if (dup) {
    ctx.game.discardPile.push(cardId);
    ctx.log(`${ctx.player.name} 不屈：点数重复，弃置该牌`);
    return { ok: false, duplicate: true };
  }

  addToPile(ctx.player, 'buqu', cardId);
  if (ctx.player.hp < 1) {
    ctx.player.hp = 1;
  }
  ctx.log(`${ctx.player.name} 不屈：置于武将牌上，体力回复至 1`);
  return { ok: true };
}

module.exports = {
  id: 'buqu',
  name: '不屈',
  desc:
    '锁定技，当你处于濒死状态时，将牌堆顶一张牌置于你的武将牌上（不屈牌）：若所有不屈牌点数均不同，你将体力回复至 1 点；否则弃置该牌。有不屈牌时手牌上限等于不屈牌数。',
  type: 'locked',
  forced: true,
  triggers: ['whenDying'],
  onDying,
  content(ctx) {
    return onDying(ctx);
  },
};
