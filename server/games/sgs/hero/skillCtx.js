'use strict';

/**
 * 技能上下文 API（由 skillBus.bindApi 注入引擎能力，技能文件只依赖本模块约定）
 */

function createCtx(api, game, base) {
  const ctx = {
    game,
    ...base,
    log(text) {
      api.pushLog(game, text);
    },
    getPlayer(id) {
      return api.getPlayer(game, id);
    },
    cardById(id) {
      return api.cardById(game, id);
    },
    draw(player, n) {
      return api.drawCards(game, player, n);
    },
    discard(player, cardId, from) {
      return api.discardCard(game, player, cardId, from || 'hand');
    },
    takeHand(player, cardId) {
      return api.takeFromHand(player, cardId);
    },
    /** 将牌加入手牌（从弃牌堆/其它区域移除由调用方保证） */
    gainToHand(player, cardId) {
      if (!player.hand.includes(cardId)) player.hand.push(cardId);
      game.discardPile = game.discardPile.filter((id) => id !== cardId);
      game.drawPile = game.drawPile.filter((id) => id !== cardId);
    },
    dealDamage(sourceId, targetId, amount, meta) {
      return api.dealDamage(game, sourceId, targetId, amount, meta || {});
    },
    loseHp(targetId, amount, meta) {
      return api.loseHp(game, targetId, amount, meta || {});
    },
    recover(player, n) {
      if (typeof api.recoverHp === 'function') {
        return api.recoverHp(game, base.player || player, player, n);
      }
      const add = Math.min(n, player.maxHp - player.hp);
      if (add > 0) player.hp += add;
      return add;
    },
    judge(player) {
      return api.drawJudgeCard(game);
    },
    setPending(pending) {
      api.setPending(game, pending);
    },
    clearPending() {
      api.clearPending(game);
    },
    alivePlayers() {
      return api.alivePlayers(game);
    },
    inAttackRange(fromId, toId) {
      return api.inAttackRange(game, fromId, toId);
    },
    suitColor(suit) {
      return api.SUIT_COLOR[suit];
    },
    suitLabel(suit) {
      return api.SUIT_LABEL[suit];
    },
    startJuedou(a, b, opts) {
      return api.startJuedou(game, a, b, opts || {});
    },
    helpersFromNext(lordId, country) {
      return api.helpersFromNext(game, lordId, country);
    },
    playWanjian(player, card) {
      if (typeof api.playWanjian === 'function') {
        return api.playWanjian(game, player, card);
      }
      return null;
    },
    askAoe() {
      if (typeof api.askAoe === 'function') return api.askAoe(game);
      return null;
    },
    distance(fromId, toId) {
      if (typeof api.distance === 'function') {
        return api.distance(game, fromId, toId);
      }
      return 99;
    },
    skillUsed(player, skillId) {
      if (!player.skillStates) player.skillStates = {};
      return Boolean(player.skillStates[skillId]);
    },
    markSkillUsed(player, skillId) {
      if (!player.skillStates) player.skillStates = {};
      player.skillStates[skillId] = true;
    },
    resetPhaseSkills(player) {
      if (!player.skillStates) return;
      for (const k of Object.keys(player.skillStates)) {
        if (k.endsWith(':phase') || player.skillStates[k] === 'phase') {
          delete player.skillStates[k];
        }
      }
      // 阶段限一次：存 skillId
      const phaseOnce = [
        'zhiheng',
        'fanjian',
        'jieyin',
        'lijian',
        'qingnang',
        'rende',
        'dimeng',
        'tiaoxin',
        'haoshi',
        'ganlu',
        'jujian',
        'xuanhuo',
      ];
      for (const id of phaseOnce) delete player.skillStates[id];
    },
  };
  return ctx;
}

module.exports = { createCtx };
