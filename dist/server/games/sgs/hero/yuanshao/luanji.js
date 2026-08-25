'use strict';
module.exports = {
  id: 'luanji',
  name: '乱击',
  desc: '出牌阶段，你可以将两张相同花色的手牌当【万箭齐发】使用。',
  type: 'active',
  filter(ctx) {
    const hand = ctx.player.hand || [];
    if (hand.length < 2) return false;
    const bySuit = {};
    for (const id of hand) {
      const c = ctx.cardById(id);
      if (!c) continue;
      bySuit[c.suit] = (bySuit[c.suit] || 0) + 1;
      if (bySuit[c.suit] >= 2) return true;
    }
    return false;
  },
  content(ctx) {
    const ids = (ctx.payload && ctx.payload.cardIds) || [];
    if (ids.length !== 2) return { ok: false };
    const cards = ids.map((id) => ctx.cardById(id));
    if (cards.some((c) => !c)) return { ok: false };
    if (!ids.every((id) => ctx.player.hand.includes(id))) return { ok: false };
    if (cards[0].suit !== cards[1].suit) return { ok: false };
    for (const id of ids) ctx.discard(ctx.player, id, 'hand');
    ctx.log(ctx.player.name + ' 发动乱击，视为使用【万箭齐发】');
    if (typeof ctx.playWanjian === 'function') {
      const vid = 'virt_wanjian_' + Date.now();
      ctx.game.cards[vid] = {
        id: vid,
        name: '万箭齐发',
        type: 'trick',
        subtype: 'wanjian',
        suit: cards[0].suit,
        number: cards[0].number,
        virtual: true,
        _viewAs: 'luanji',
      };
      ctx.player.hand.push(vid);
      return ctx.playWanjian(ctx.player, ctx.game.cards[vid]);
    }
    const me = ctx.player;
    const alive = ctx.alivePlayers().slice().sort((a, b) => a.seat - b.seat);
    const idx = alive.findIndex((p) => p.id === me.id);
    const victims = [];
    for (let i = 1; i < alive.length; i++) {
      const p = alive[(idx - i + alive.length) % alive.length];
      if (p.id === me.id) break;
      victims.push(p.id);
    }
    ctx.setPending({
      type: 'aoe_shan',
      sourceId: me.id,
      victims,
      index: 0,
      cardName: '万箭齐发',
      message: '万箭齐发：请打出【闪】',
      askId: victims[0] || null,
    });
    if (typeof ctx.askAoe === 'function') ctx.askAoe();
    else if (victims[0] && ctx.game.pending) {
      const t = ctx.getPlayer(victims[0]);
      ctx.game.pending.askId = victims[0];
      ctx.game.pending.message =
        '万箭齐发：' + (t ? t.name : '') + ' 请响应';
    }
    return { ok: true };
  },
};
