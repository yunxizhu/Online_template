'use strict';
const { gainTempSkill } = require('../_infra_helpers');

module.exports = {
  id: 'fuhun',
  name: '父魂',
  desc: '摸牌阶段，你可以放弃摸牌，改为亮出牌堆顶两张牌并获得之；若两张牌颜色不同，你获得【武圣】和【咆哮】直到回合结束。',
  type: 'trigger',
  triggers: ['phaseDraw'],
  filter() {
    return true;
  },
  content(ctx) {
    const revealed = [];
    for (let i = 0; i < 2; i++) {
      if (!ctx.game.drawPile.length) break;
      const id = ctx.game.drawPile.shift();
      revealed.push(id);
      if (!ctx.player.hand.includes(id)) ctx.player.hand.push(id);
    }
    ctx.player.skillStates = ctx.player.skillStates || {};
    ctx.player.skillStates._skipNormalDraw = true;
    let gainedSkills = false;
    if (revealed.length === 2) {
      const c1 = ctx.cardById(revealed[0]);
      const c2 = ctx.cardById(revealed[1]);
      const color1 = c1 && ctx.suitColor(c1.suit);
      const color2 = c2 && ctx.suitColor(c2.suit);
      if (color1 && color2 && color1 !== color2) {
        gainTempSkill(ctx.player, 'wusheng');
        gainTempSkill(ctx.player, 'paoxiao');
        gainedSkills = true;
      }
    }
    ctx.log(
      ctx.player.name +
        ' 发动父魂，获得牌堆顶 ' +
        revealed.length +
        ' 张牌' +
        (gainedSkills ? '，并获得武圣与咆哮直到回合结束' : '')
    );
    return { ok: true, revealed };
  },
};
