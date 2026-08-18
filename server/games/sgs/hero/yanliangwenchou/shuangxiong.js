'use strict';
module.exports = {
  id: 'shuangxiong',
  name: '双雄',
  desc: '摸牌阶段，你可以放弃摸牌并进行一次判定，你获得生效后的判定牌，然后本回合你可以将一张与判定结果颜色不同的牌当【决斗】使用。',
  type: 'viewAs',
  triggers: ['phaseDraw'],
  filter(ctx) {
    if (ctx.trigger === 'phaseDraw') return true;
    const color =
      ctx.player.skillStates && ctx.player.skillStates.shuangxiongColor;
    return Boolean(color);
  },
  content(ctx) {
    const jc = ctx.judge(ctx.player);
    if (!jc) return { ok: true };
    ctx.log(
      ctx.player.name +
        ' 双雄判定为 ' +
        (ctx.suitLabel(jc.suit) || jc.suit) +
        jc.number
    );
    ctx.game.discardPile = ctx.game.discardPile.filter((id) => id !== jc.id);
    ctx.gainToHand(ctx.player, jc.id);
    const color = ctx.suitColor(jc.suit) || jc.color;
    const opposite = color === 'red' ? 'black' : 'red';
    ctx.player.skillStates = ctx.player.skillStates || {};
    ctx.player.skillStates.shuangxiongColor = opposite;
    ctx.player.skillStates._skipNormalDraw = true;
    ctx.log(
      ctx.player.name +
        ' 本回合可将' +
        (opposite === 'red' ? '红' : '黑') +
        '色牌当【决斗】使用'
    );
    return { ok: true };
  },
  viewAs: {
    to: 'juedou',
    includeEquip: true,
    cardFilter(card, ctx) {
      if (!card) return false;
      const color =
        card.suit === 'heart' || card.suit === 'diamond' ? 'red' : 'black';
      if (ctx && ctx.player && ctx.player.skillStates) {
        return color === ctx.player.skillStates.shuangxiongColor;
      }
      return true;
    },
  },
};
