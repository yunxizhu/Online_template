'use strict';

/**
 * 无懈可击询问 + 决斗开战（含虚拟决斗）
 * 由 engine 注入依赖后挂到流程上。
 */

const REVEAL_MIN_MS = 3000;
const WUXIE_CHAIN_PAUSE_MS = 1000;

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
    let seat = E.prevAliveSeat(game, from.seat);
    const home = from.seat;
    let guard = 0;
    while (guard++ <= game.players.length + 1) {
      if (seat === home) break;
      const p = game.players.find((x) => x.seat === seat);
      if (p && p.alive) order.push(p.id);
      seat = E.prevAliveSeat(game, seat);
    }
    return order;
  }

  function seatOrderFromSelf(game, fromPlayerId) {
    const from = E.getPlayer(game, fromPlayerId);
    if (!from || !from.alive) return seatOrderFromNext(game, fromPlayerId);
    return [from.id].concat(seatOrderFromNext(game, fromPlayerId));
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
    for (const q of E.skillBus.query(game, src, 'firstTrickUncounterable', {
      card,
    })) {
      if (q.value) return true;
    }
    return false;
  }

  function canViewAsWuxie(game, player) {
    if (!E.skillBus || typeof E.skillBus.listViewAs !== 'function') return false;
    const opts = E.skillBus.listViewAs(game, player, 'wuxie', 'respond');
    return opts.length > 0;
  }

  function playerCanWuxie(game, playerId) {
    const p = E.getPlayer(game, playerId);
    if (!p || !p.alive) return false;
    const hasCard = p.hand.some((id) => {
      const c = E.cardById(game, id);
      return c && c.name === '无懈可击';
    });
    return hasCard || canViewAsWuxie(game, p);
  }

  function buildWuxieResults(game, pend) {
    const results = [];
    for (const id of pend.order) {
      const p = E.getPlayer(game, id);
      if (!p || !p.alive) continue;
      const r = pend.responses[id] || { pass: true, auto: true };
      results.push({
        playerId: id,
        playerName: p.name,
        pass: Boolean(r.pass),
        auto: Boolean(r.auto),
        cardId: r.cardId || null,
        asWuxie: Boolean(r.asWuxie),
        skillId: r.skillId || null,
        skillName: r.skillName || null,
      });
    }
    return results;
  }

  function applyStoredWuxiePlay(game, player, resp) {
    const cardId = resp.cardId;
    if (!cardId || !player.hand.includes(cardId)) return false;
    const c = E.cardById(game, cardId);
    if (!c) return false;
    if (resp.asWuxie && resp.skillId) {
      E.pushLog(
        game,
        `${player.name} 发动【${resp.skillName || resp.skillId}】将牌当【无懈可击】`
      );
    } else {
      E.pushLog(game, `${player.name} 打出【无懈可击】`);
    }
    E.discardCard(game, player, cardId, 'hand');
    notifyAfterRespond(game, player, c);
    if (resp.asWuxie) {
      notifyAfterUseCard(game, player, {
        ...c,
        name: '无懈可击',
        type: 'trick',
        subtype: 'wuxie',
      });
    } else {
      notifyAfterUseCard(game, player, c);
    }
    return true;
  }

  function startWuxieReveal(game) {
    const pend = game.pending;
    if (!pend || pend.type !== 'wuxie') return;
    pend.results = buildWuxieResults(game, pend);
    const hasPlayedWuxie = pend.results.some((row) => !row.pass && row.cardId);
    pend.phase = 'reveal';
    pend.revealStartedAt = Date.now();
    pend.revealMinMs =
      REVEAL_MIN_MS + (hasPlayedWuxie ? WUXIE_CHAIN_PAUSE_MS : 0);
    pend.message = pend.countering
      ? '【无懈可击】响应结果'
      : `对【${pend.cardName}】的无懈响应结果`;
    pend.askId = pend.sourceId;
    pend.waiting = [];
  }

  function finishWuxieReveal(game, playerId, opts = {}) {
    const pend = game.pending;
    if (!pend || pend.type !== 'wuxie' || pend.phase !== 'reveal') {
      return { ok: false, error: '当前不是无懈展示' };
    }
    if (pend.askId && pend.askId !== playerId) {
      return { ok: false, error: '未轮到你' };
    }
    const minMs = pend.revealMinMs || REVEAL_MIN_MS;
    if (!opts.force && pend.revealStartedAt && Date.now() - pend.revealStartedAt < minMs) {
      return { ok: false, error: '展示中…' };
    }

    let wuxiePlayer = null;
    for (const id of pend.order) {
      const r = pend.responses[id];
      if (r && !r.pass && r.cardId) {
        wuxiePlayer = E.getPlayer(game, id);
        break;
      }
    }

    for (const row of pend.results || []) {
      if (row.pass) {
        E.pushLog(
          game,
          `${row.playerName}${row.auto ? '（无法无懈）' : ''} 不出无懈`
        );
      }
    }

    const countering = pend.countering;
    const effect = pend.effect;
    const parentEffect = pend.parentEffect;
    const cardName = pend.cardName;
    const cardId = pend.cardId;
    const targetIds = pend.targetIds;

    if (wuxiePlayer) {
      const r = pend.responses[wuxiePlayer.id];
      applyStoredWuxiePlay(game, wuxiePlayer, r);
    }

    E.clearPending(game);

    if (!wuxiePlayer) {
      if (countering) {
        E.pushLog(game, `【无懈可击】生效，【${cardName}】被取消`);
        if (
          parentEffect &&
          parentEffect.type === 'delayed_judge' &&
          typeof E.cancelDelayedJudge === 'function'
        ) {
          E.cancelDelayedJudge(game, parentEffect);
          return { ok: true };
        }
        if (typeof E.resumeAfterSkill === 'function') E.resumeAfterSkill(game);
        return { ok: true };
      }
      if (effect) runTrickEffect(game, effect);
      else if (typeof E.resumeAfterSkill === 'function') E.resumeAfterSkill(game);
      return { ok: true };
    }

    if (countering) {
      E.pushLog(game, `无懈被无懈，【${cardName}】继续结算`);
      if (parentEffect) runTrickEffect(game, parentEffect);
      return { ok: true };
    }

    beginWuxieWindow(game, {
      sourceId: wuxiePlayer.id,
      cardName,
      cardId,
      targetIds,
      countering: true,
      parentEffect: effect,
      effect: null,
    });
    return { ok: true };
  }

  function beginWuxieWindow(game, meta) {
    const order =
      meta.order ||
      (meta.includeSource
        ? seatOrderFromSelf(game, meta.sourceId)
        : seatOrderFromNext(game, meta.sourceId));

    const responses = {};
    const waiting = [];
    for (const id of order) {
      const p = E.getPlayer(game, id);
      if (!p || !p.alive) continue;
      if (playerCanWuxie(game, id)) {
        waiting.push(id);
      } else {
        responses[id] = { pass: true, auto: true };
      }
    }

    E.setPending(game, {
      type: 'wuxie',
      phase: waiting.length ? 'collect' : 'reveal',
      sourceId: meta.sourceId,
      cardId: meta.cardId || null,
      cardName: meta.cardName || '锦囊',
      targetIds: meta.targetIds || [],
      countering: Boolean(meta.countering),
      effect: meta.effect || null,
      parentEffect: meta.parentEffect || null,
      order,
      waiting: waiting.slice(),
      responses,
      results: null,
      askId: null,
      message: meta.countering
        ? '是否打出【无懈可击】响应上一次无懈？（全员同时询问）'
        : `是否对【${meta.cardName || '锦囊'}】使用【无懈可击】？（全员同时询问）`,
    });

    if (!waiting.length) {
      startWuxieReveal(game);
      return finishWuxieReveal(game, meta.sourceId, { force: true });
    }
  }

  function onWuxieResponse(game, playerId, cardId, pass, extra = {}) {
    const pend = game.pending;
    if (!pend || pend.type !== 'wuxie') {
      return { ok: false, error: '当前不是无懈响应' };
    }

    if (pend.phase === 'reveal') {
      return finishWuxieReveal(game, playerId, extra);
    }

    if (pend.phase !== 'collect') {
      return { ok: false, error: '当前不是无懈响应' };
    }

    if (!pend.waiting.includes(playerId)) {
      return { ok: false, error: '你无需响应无懈' };
    }
    if (pend.responses[playerId]) {
      return { ok: false, error: '你已作出选择' };
    }

    const p = E.getPlayer(game, playerId);
    if (!p || !p.alive) return { ok: false, error: '角色无效' };

    if (pass) {
      pend.responses[playerId] = { pass: true };
    } else {
      if (!cardId || !p.hand.includes(cardId)) {
        return { ok: false, error: '请选择【无懈可击】或发动转化技能' };
      }
      const c = E.cardById(game, cardId);
      const asWuxie = Boolean(extra.asWuxie);
      if (!c) return { ok: false, error: '牌无效' };
      if (!asWuxie && c.name !== '无懈可击') {
        return { ok: false, error: '必须是【无懈可击】' };
      }
      if (asWuxie) {
        const opts = E.skillBus.listViewAs(game, p, 'wuxie', 'respond');
        const ok = opts.some((o) => o.cardId === cardId);
        if (!ok) return { ok: false, error: '该牌不能当【无懈可击】' };
      }
      pend.responses[playerId] = {
        pass: false,
        cardId,
        asWuxie,
        skillId: extra.skillId || null,
        skillName: extra.skillName || null,
      };
    }

    pend.waiting = pend.waiting.filter((id) => id !== playerId);
    if (!pend.waiting.length) {
      startWuxieReveal(game);
    }
    return { ok: true };
  }

  function runTrickEffect(game, effect) {
    if (!effect || !effect.type) return;
    if (effect.type === 'juedou') {
      startJuedouFight(game, effect.a, effect.b, effect.opts || {});
      return;
    }
    if (effect.type === 'delayed_judge') {
      if (typeof E.beginDelayedJudgeReveal === 'function') {
        E.beginDelayedJudgeReveal(game, effect.playerId, effect.cardId);
      }
    }
  }

  function juedouNeedForAsker(game, askerId, opponentId) {
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
    game.drawPile = top.concat(game.drawPile).concat(bottom);
    return { ok: true };
  }

  return {
    isDelayedTrick,
    notifyAfterUseCard,
    notifyAfterRespond,
    seatOrderFromNext,
    seatOrderFromSelf,
    helpersFromNext,
    beginWuxieWindow,
    onWuxieResponse,
    finishWuxieReveal,
    startJuedou,
    startJuedouFight,
    juedouNeedForAsker,
    applyPileReorder,
    shouldSkipWuxie,
  };
}

module.exports = { createTrickFlow };
