'use strict';

const DELAYED = new Set(['乐不思蜀', '兵粮寸断', '闪电']);

function isNonDelayedTrick(cardName, card) {
  if (card && card.type === 'delayed') return false;
  if (card && card.type === 'trick' && DELAYED.has(card.name)) return false;
  if (DELAYED.has(cardName)) return false;
  if (card && card.type === 'trick') return true;
  const tricks = new Set([
    '过河拆桥',
    '顺手牵羊',
    '无中生有',
    '决斗',
    '南蛮入侵',
    '万箭齐发',
    '桃园结义',
    '五谷丰登',
    '借刀杀人',
    '铁索连环',
    '火攻',
    '无懈可击',
  ]);
  return tricks.has(cardName);
}

/**
 * 无言：非延时锦囊互无效（canBeTarget + trickInvalid）。
 */
module.exports = {
  id: 'wuyan',
  name: '无言',
  desc: '锁定技，你使用的非延时类锦囊对其他角色无效；其他角色使用的非延时类锦囊对你无效。',
  type: 'locked',
  forced: true,
  canBeTarget(ctx) {
    if (!isNonDelayedTrick(ctx.cardName, ctx.card)) return true;
    // 其他角色的非延时锦囊不能指定你
    if (ctx.sourceId && ctx.sourceId !== ctx.player.id) return false;
    return true;
  },
  /** 你使用非延时锦囊指定其他角色时无效 */
  trickInvalid(ctx) {
    if (!isNonDelayedTrick(ctx.cardName, ctx.card)) return false;
    if (ctx.targetId && ctx.targetId !== ctx.player.id) return true;
    return false;
  },
};
