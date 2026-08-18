'use strict';

/**
 * 引擎侧技能桥接：回合阶段钩子、resume、bindApi。
 * 由 engine.js 在加载末尾调用 installSkillBridge(api)。
 */

const skillBus = require('./skillBus');
const { resolveSkillEffect } = require('./skillEffects');

function installSkillBridge(E) {
  function resumeAfterSkill(game) {
    if (game.over || game.pending) return;
    if (game._skillQueue && game._skillQueue.length) {
      const next = skillBus.promptNext(game);
      if (next.pending) return;
    }
    const tag = game._skillResume;
    game._skillResume = null;
    switch (tag) {
      case 'after_prepare':
        E.beginJudgePhase(game);
        break;
      case 'after_draw_trigger':
        finishDrawPhase(game);
        break;
      case 'apply_draw':
        applyDrawAndPlay(game);
        break;
      case 'enter_play_after_draw':
        E.enterPlayPhase(game);
        break;
      case 'after_phase_play_ask': {
        const p = E.currentPlayer(game);
        if (p && p.skipPlay) {
          E.pushLog(game, `${p.name} 跳过出牌阶段`);
          E.enterDiscardPhase(game);
        }
        break;
      }
      case 'enter_discard':
        doDiscardOrEnd(game);
        break;
      case 'after_phase_end':
        E.advanceTurn(game);
        break;
      case 'after_sha_skills':
        E.continueShaAfterSkills(game);
        break;
      default:
        E.resumeAfterPending(game);
    }
  }

  function finishDrawPhase(game) {
    const p = E.currentPlayer(game);
    if (!p) return;
    if (p.skillStates && p.skillStates._skipNormalDraw) {
      delete p.skillStates._skipNormalDraw;
      E.enterPlayPhase(game);
      return;
    }
    let n = 2;
    if (p.firstTurnDrawPenalty) {
      n = 1;
      p.firstTurnDrawPenalty = false;
    }
    if (game._tuxiSkipDraw) {
      n = Math.max(0, n - game._tuxiSkipDraw);
      game._tuxiSkipDraw = 0;
    }
    game._drawPlan = { n };
    game._skillResume = 'apply_draw';
    const r = skillBus.emit(game, 'phaseDrawBonus', {
      player: p,
      drawBonusRef: game._drawPlan,
    });
    if (r.pending) return;
    applyDrawAndPlay(game);
  }

  function applyDrawAndPlay(game) {
    const p = E.currentPlayer(game);
    const n = (game._drawPlan && game._drawPlan.n) || 0;
    game._drawPlan = null;
    if (p && n > 0) {
      E.drawCards(game, p, n);
      E.pushLog(game, `${p.name} 摸 ${n} 张牌`);
    }
    if (p && p.alive) {
      game._skillResume = 'enter_play_after_draw';
      const r = skillBus.emit(game, 'afterDraw', { player: p });
      if (r.pending) return;
    }
    E.enterPlayPhase(game);
  }

  function doDiscardOrEnd(game) {
    const p = E.currentPlayer(game);
    if (!p) {
      E.advanceTurn(game);
      return;
    }
    if (p.skillStates && p.skillStates.skipDiscard) {
      delete p.skillStates.skipDiscard;
      E.endTurn(game);
      return;
    }
    const turn = game.turnCount || 0;
    const exempt = p.hand.filter((id) => {
      const c = E.cardById(game, id);
      return c && c._jizhiMark === turn;
    }).length;
    let limit = p.hp;
    try {
      const helpers = require('./_infra_helpers');
      if (helpers && typeof helpers.handLimitOf === 'function') {
        limit = helpers.handLimitOf(game, p);
      }
    } catch (_) {
      /* ignore */
    }
    const need = p.hand.length - exempt - limit;
    if (need > 0) {
      E.setPending(game, {
        type: 'discard',
        playerId: p.id,
        count: need,
        message: `弃牌阶段：需弃 ${need} 张（手牌上限 ${limit}${
          exempt ? `，集智标记 ${exempt}` : ''
        }）`,
      });
    } else {
      E.endTurn(game);
    }
  }

  skillBus.bindApi({
    pushLog: E.pushLog,
    getPlayer: E.getPlayer,
    cardById: E.cardById,
    drawCards: E.drawCards,
    discardCard: E.discardCard,
    takeFromHand: E.takeFromHand,
    dealDamage: E.dealDamage,
    loseHp: E.loseHp,
    recoverHp: E.recoverHp,
    drawJudgeCard: E.drawJudgeCard,
    setPending: E.setPending,
    clearPending: E.clearPending,
    alivePlayers: E.alivePlayers,
    inAttackRange: E.inAttackRange,
    distance: E.distance,
    SUIT_COLOR: E.SUIT_COLOR,
    SUIT_LABEL: E.SUIT_LABEL,
    currentPlayer: E.currentPlayer,
    resumeAfterSkill,
    startJuedou: E.startJuedou,
    helpersFromNext: E.helpersFromNext,
    playWanjian: E.playWanjian,
    askAoe: E.askAoe,
    playSha: E.playSha,
    resolveShaAs: E.resolveShaAs,
  });

  return {
    skillBus,
    resolveSkillEffect,
    resumeAfterSkill,
    finishDrawPhase,
    applyDrawAndPlay,
    doDiscardOrEnd,
  };
}

module.exports = { installSkillBridge };
