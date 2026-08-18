'use strict';
module.exports = {
  id: 'luoshen',
  name: '洛神',
  desc: '回合开始阶段，你可以进行判定：若为黑色，你获得此牌并可继续判定；若为红色，则获得此牌并停止判定。',
  type: 'trigger',
  triggers: ['phasePrepare'],
  filter() {
    return true;
  },
  content(ctx) {
    const loop = () => {
      const jid = ctx.judge(ctx.player);
      if (!jid) return;
      const jc = ctx.cardById(jid);
      const color = ctx.suitColor(jc.suit);
      ctx.game.discardPile = ctx.game.discardPile.filter((id) => id !== jid);
      ctx.gainToHand(ctx.player, jid);
      ctx.log(
        ctx.player.name +
          ' 洛神判定 ' +
          ctx.suitLabel(jc.suit) +
          jc.number +
          ' → 获得'
      );
      if (color === 'black') {
        ctx.player.skillStates = ctx.player.skillStates || {};
        ctx.setPending({
          type: 'skill_effect',
          skillId: 'luoshen',
          playerId: ctx.player.id,
          askId: ctx.player.id,
          message: '洛神：黑色，是否继续判定？',
          canPass: true,
          continue: true,
        });
      }
    };
    loop();
    return { ok: true };
  },
};
