'use strict';

/**
 * 酒诗：正面朝上时可翻面视为用酒；背面朝上受伤后可翻回正面。
 */
module.exports = {
  id: 'jiushi',
  name: '酒诗',
  desc: '当你需要使用【酒】时，若武将牌正面朝上，可将武将牌翻面视为使用【酒】；若武将牌背面朝上时你受到伤害，可在伤害结算后将武将牌翻至正面。',
  type: 'active',
  triggers: ['afterDamage', 'needWine'],
  filter(ctx) {
    // 主动：正面朝上且本回合未用酒
    if (!ctx.trigger || ctx.trigger === 'needWine') {
      if (ctx.player.turnedOver) return false;
      if (ctx.player.wineBuff || (ctx.player.wineUsed || 0) >= 1) return false;
      return true;
    }
    if (ctx.trigger === 'afterDamage') {
      return Boolean(ctx.player.turnedOver);
    }
    return false;
  },
  content(ctx) {
    if (ctx.trigger === 'afterDamage' && ctx.player.turnedOver) {
      ctx.setPending({
        type: 'skill_effect',
        skillId: 'jiushi',
        playerId: ctx.player.id,
        askId: ctx.player.id,
        message: '酒诗：是否将武将牌翻至正面？',
        canPass: true,
      });
      return { ok: true };
    }
    // 主动 / needWine：翻面视为酒
    if (ctx.player.turnedOver) return { ok: false };
    if (ctx.player.wineBuff || (ctx.player.wineUsed || 0) >= 1) {
      return { ok: false };
    }
    ctx.player.turnedOver = true;
    ctx.player.wineBuff = true;
    ctx.player.wineUsed = 1;
    ctx.log(ctx.player.name + ' 酒诗翻面，视为使用【酒】');
    return { ok: true, asWine: true };
  },
};
