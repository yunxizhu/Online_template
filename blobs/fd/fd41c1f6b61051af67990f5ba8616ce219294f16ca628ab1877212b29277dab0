'use strict';

const { resolvePinDian } = require('../_infra_helpers');

module.exports = {
  id: 'quhu',
  name: '驱虎',
  desc: '出牌阶段限一次，你可以与一名体力值大于你的角色拼点：若你赢，该角色对其攻击范围内你指定的一名角色造成 1 点伤害；若你没赢，其对你造成 1 点伤害。',
  type: 'active',
  filter(ctx) {
    if (ctx.player.skillStates && ctx.player.skillStates['quhu:phase']) {
      return false;
    }
    if (!ctx.player.hand.length) return false;
    return ctx.alivePlayers().some(
      (p) => p.id !== ctx.player.id && p.hp > ctx.player.hp && p.hand.length > 0
    );
  },
  content(ctx) {
    const tid = ctx.payload && ctx.payload.targetId;
    const target = ctx.getPlayer(tid);
    if (!target || target.id === ctx.player.id) return { ok: false };
    if (target.hp <= ctx.player.hp) return { ok: false };
    if (!ctx.player.hand.length || !target.hand.length) return { ok: false };

    const myCard = ctx.payload && ctx.payload.cardId;
    const theirCard = ctx.payload && ctx.payload.targetCardId;
    const dmgTargetId = ctx.payload && ctx.payload.damageTargetId;

    if (!myCard || !theirCard) {
      ctx.setPending({
        type: 'skill_effect',
        skillId: 'quhu',
        playerId: ctx.player.id,
        askId: ctx.player.id,
        targetId: target.id,
        step: 'pindian',
        message: '驱虎：双方各选一张手牌拼点',
        canPass: true,
      });
      return { ok: true };
    }

    if (!ctx.player.hand.includes(myCard) || !target.hand.includes(theirCard)) {
      return { ok: false };
    }

    const api = {
      cardById: (g, id) => ctx.cardById(id),
      takeFromHand: (player, cardId) => ctx.takeHand(player, cardId),
      pushLog: (g, text) => ctx.log(text),
    };
    const result = resolvePinDian(
      ctx.game,
      ctx.player,
      myCard,
      target,
      theirCard,
      api
    );

    ctx.player.skillStates = ctx.player.skillStates || {};
    ctx.player.skillStates['quhu:phase'] = true;

    // 「若你赢」
    if (result.winnerId === ctx.player.id) {
      if (dmgTargetId) {
        const dt = ctx.getPlayer(dmgTargetId);
        if (dt && dt.alive && ctx.inAttackRange(target.id, dt.id)) {
          ctx.dealDamage(target.id, dt.id, 1, { reason: '驱虎' });
          return { ok: true };
        }
      }
      ctx.setPending({
        type: 'skill_effect',
        skillId: 'quhu',
        playerId: ctx.player.id,
        askId: ctx.player.id,
        targetId: target.id,
        step: 'damage',
        message: '驱虎：选择其攻击范围内的一名角色承受伤害',
        canPass: false,
        minTargets: 1,
        maxTargets: 1,
      });
      return { ok: true };
    }

    // 「若你没赢」：输或平局均触发
    ctx.dealDamage(target.id, ctx.player.id, 1, { reason: '驱虎' });
    return { ok: true };
  },
};
