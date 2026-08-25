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
    ctx.beginJudgeReveal(ctx.player, {
      skillId: 'shuangxiong',
      skillName: '双雄',
      message: `${ctx.player.name} 【双雄】判定`,
    });
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
