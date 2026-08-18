'use strict';

/**
 * 无懈可击询问 + 决斗开战（含虚拟决斗）
 * 由 engine 注入依赖后挂到流程上。
 */

function createTrickFlow(E) {
  function isDelayedTrick(card) {
    if (!card) return false;
    return (
      card.subtype === 'lebu' ||
      card.subtype === 'bingliang' ||
      card.subtype === 'shandian'
    );
  }

  function notifyAfterUseCard(game, player, card) {
    if (!player || !card) return;
    if (card.type === 'trick') {
      E.skillBus.emit(game, 'afterUseTrick', {
        player,
        card,
        cardId: card.id,
      });
    }
    E.skillBus.emit(game, 'afterUseHand', {
      player,
      cardId: card.id,
      card,
    });
  }

  function notifyAfterRespond(game, player, card) {
    if (!player || !card) return;
    E.skillBus.emit(game, 'afterRespondCard', {
      player,
      cardId: card.id,
      card,
    });
  }

  function seatOrderFromNext(game, fromPlayerId) {
    const from = E.getPlayer(game, fromPlayerId);
    if (!from) return [];
    const order = [];
    let seat = E.nextAliveSeat(game, from.seat);
    let guard = 0;
    while (guard++ < 20) {
      if (seat === from.seat) break;
      const p = game.players.find((x) => x.seat === seat);
      if (p && p.alive) order.push(p.id);
      seat = E.nextAliveSeat(game, seat);
    }
    return order;
  }

  function helpersFromNext(game, lordId, country) {
    return seatOrderFromNext(game, lordId).filter((id) => {
      const p = E.getPlayer(game, id);
      return p && p.alive && p.country === country;
    });
  }

  function shouldSkipWuxie(game, sourceId, card) {
    const src = E.getPlayer(game, sourceId);
    if (!src) return false;
    // 奇才：本回合第一张锦囊不可被无懈
    for (const q of E.skillBus.query(game, src, 'firstTrickUncounterable', {
      card,
    })) {
      if (q.value) return true;
    }
    return false;
  }

  function beginWuxieWindow(game, meta) {
    const order = seatOrderFromNext(game, meta.sourceId);
    E.setPending(game, {
      type: 'wuxie',
      sourceId: meta.sourceId,
      cardId: meta.cardId || null,
      cardName: meta.cardName || '锦囊',
      targetIds: meta.targetIds || [],
      countering: Boolean(meta.countering),
      // 结算载荷
      effect: meta.effect || null,
      // 若本窗是对上一张无懈的无懈，命中后应执行 parentEffect
      parentEffect: meta.parentEffect || null,
      order,
      index: 0,
      askId: null,
      message: '',
    });
    advanceWuxie(game);
  }

  function advanceWuxie(game) {
    const pend = game.pending;
    if (!pend || pend.type !== 'wuxie') return;
    while (pend.index < pend.order.length) {
      const id = pend.order[pend.index];
      const p = E.getPlayer(game, id);
      if (p && p.alive) {
        pend.askId = id;
        pend.message = pend.countering
          ? `${p.name}：是否打出【无懈可击】响应上一次无懈？`
          : `${p.name}：是否对【${pend.cardName}】使用【无懈可击】？`;
        return;
      }
      pend.index += 1;
    }
    // 无人再无懈
    E.clearPending(game);
    if (pend.countering) {
      // 无懈生效 → 取消原锦囊
      E.pushLog(game, `【无懈可击】生效，【${pend.cardName}】被取消`);
      // parentEffect 不执行；若还有更外层，此处简化为取消即可
      if (typeof E.resumeAfterSkill === 'function') E.resumeAfterSkill(game);
      return;
    }
    // 原锦囊未被无懈 → 执行效果
    if (pend.effect) runTrickEffect(game, pend.effect);
    else if (typeof E.resumeAfterSkill === 'function') E.resumeAfterSkill(game);
  }

  function onWuxieResponse(game, playerId, cardId, pass) {
    const pend = game.pending;
    if (!pend || pend.type !== 'wuxie' || pend.askId !== playerId) {
      return { ok: false, error: '当前不是无懈响应' };
    }
    const p = E.getPlayer(game, playerId);
    if (pass) {
      pend.index += 1;
      advanceWuxie(game);
      return { ok: true };
    }
    if (!cardId || !p.hand.includes(cardId)) {
      return { ok: false, error: '请选择【无懈可击】' };
    }
    const c = E.cardById(game, cardId);
    if (!c || c.name !== '无懈可击') {
      return { ok: false, error: '必须是【无懈可击】' };
    }
    E.discardCard(game, p, cardId, 'hand');
    E.pushLog(game, `${p.name} 打出【无懈可击】`);
    notifyAfterRespond(game, p, c);
    notifyAfterUseCard(game, p, c);

    if (pend.countering) {
      // 无懈被无懈 → 原锦囊继续
      E.pushLog(game, `无懈被无懈，【${pend.cardName}】继续结算`);
      const effect = pend.parentEffect;
      E.clearPending(game);
      if (effect) runTrickEffect(game, effect);
      return { ok: true };
    }

    // 对原锦囊的无懈：开启「无懈无懈」窗；原 effect 挂到 parentEffect
    const effect = pend.effect;
    const cardName = pend.cardName;
    beginWuxieWindow(game, {
      sourceId: playerId,
      cardName,
      cardId: pend.cardId,
      targetIds: pend.targetIds,
      countering: true,
      parentEffect: effect,
      effect: null,
    });
    return { ok: true };
  }

  function runTrickEffect(game, effect) {
    if (!effect || !effect.type) return;
    if (effect.type === 'juedou') {
      startJuedouFight(game, effect.a, effect.b, effect.opts || {});
    }
  }

  function juedouNeedForAsker(game, askerId, opponentId) {
    // 与拥有无双者决斗时，你每次须打出两张杀
    let need = 1;
    const opp = E.getPlayer(game, opponentId);
    if (opp) {
      for (const q of E.skillBus.query(game, opp, 'juedouNeedShaCount')) {
        if (typeof q.value === 'number') need = Math.max(need, q.value);
      }
    }
    return need;
  }

  function startJuedouFight(game, aId, bId, opts = {}) {
    const a = E.getPlayer(game, aId);
    const b = E.getPlayer(game, bId);
    if (!a || !b || !a.alive || !b.alive) {
      if (typeof E.resumeAfterSkill === 'function') E.resumeAfterSkill(game);
      return { ok: true };
    }
    const needSha = juedouNeedForAsker(game, bId, aId);
    E.setPending(game, {
      type: 'juedou',
      a: aId,
      b: bId,
      askId: bId,
      needSha,
      shaGot: 0,
      luoyi: Boolean(a.skillStates && a.skillStates.luoyiBuff),
      virtual: Boolean(opts.virtual),
      fromTrick: true,
      message:
        needSha > 1
          ? `决斗（无双）：${b.name} 请连续打出 ${needSha} 张【杀】`
          : `决斗：${b.name} 请打出【杀】`,
    });
    return { ok: true };
  }

  /**
   * 使用实体或虚拟【决斗】
   * @param opts.noWuxie 不可被无懈（离间）
   * @param opts.virtual 虚拟牌（利驭等）
   * @param opts.skipNotify 已通知过使用
   * @param opts.card 实体牌（可空）
   */
  function startJuedou(game, sourceId, targetId, opts = {}) {
    const source = E.getPlayer(game, sourceId);
    const target = E.getPlayer(game, targetId);
    if (!source || !target || !target.alive) {
      return { ok: false, error: '目标无效' };
    }
    const blocked = E.skillBus.query(game, target, 'canBeTarget', {
      cardName: '决斗',
      card: opts.card || null,
    });
    if (blocked.some((x) => x.value === false)) {
      return { ok: false, error: '目标不能成为【决斗】的目标' };
    }

    let card = opts.card || null;
    if (opts.virtual && !card) {
      const vid = `virt_juedou_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      card = {
        id: vid,
        name: '决斗',
        type: 'trick',
        subtype: 'juedou',
        virtual: true,
      };
      game.cards[vid] = card;
    }

    if (card && !opts.virtual && !opts.alreadyDiscarded) {
      if (source.hand.includes(card.id)) {
        E.takeFromHand(source, card.id);
        game.discardPile.push(card.id);
      }
    }

    E.pushLog(
      game,
      `${source.name} 对 ${target.name} 使用【决斗】` +
        (opts.virtual ? '（虚拟）' : '')
    );

    if (!opts.skipNotify && card) {
      notifyAfterUseCard(game, source, card);
    }

    const effect = {
      type: 'juedou',
      a: sourceId,
      b: targetId,
      opts: { virtual: Boolean(opts.virtual) },
    };

    const noWuxie =
      Boolean(opts.noWuxie) || shouldSkipWuxie(game, sourceId, card);
    if (noWuxie) {
      if (opts.noWuxie) {
        E.pushLog(game, '此【决斗】不能被【无懈可击】响应');
      }
      return startJuedouFight(game, sourceId, targetId, effect.opts);
    }

    beginWuxieWindow(game, {
      sourceId,
      cardId: card ? card.id : null,
      cardName: '决斗',
      targetIds: [targetId],
      effect,
    });
    return { ok: true };
  }

  function applyPileReorder(game, topIds, bottomIds, poolIds) {
    const pool = poolIds.slice();
    const top = topIds || [];
    const bottom = bottomIds || [];
    const used = [...top, ...bottom];
    if (used.length !== pool.length) return { ok: false, error: '须分配全部观看的牌' };
    if (new Set(used).size !== used.length) {
      return { ok: false, error: '牌重复' };
    }
    for (const id of used) {
      if (!pool.includes(id)) return { ok: false, error: '含非法牌' };
    }
    // 观看时已从牌堆顶抽出；放回：顶 + 剩余牌堆 + 底
    game.drawPile = top.concat(game.drawPile).concat(bottom);
    return { ok: true };
  }

  return {
    isDelayedTrick,
    notifyAfterUseCard,
    notifyAfterRespond,
    seatOrderFromNext,
    helpersFromNext,
    beginWuxieWindow,
    advanceWuxie,
    onWuxieResponse,
    startJuedou,
    startJuedouFight,
    juedouNeedForAsker,
    applyPileReorder,
    shouldSkipWuxie,
  };
}

module.exports = { createTrickFlow };
