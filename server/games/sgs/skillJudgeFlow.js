'use strict';

const { addToPile, effectiveSuit } = require('./hero/_infra_helpers');

function computeSkillJudgeOutcome(skillId, player, jc, extra, api) {
  const suit = jc.suit;
  const color = api.SUIT_COLOR[suit];
  const label = api.SUIT_LABEL[suit] + jc.number;

  switch (skillId) {
    case 'tuntian': {
      const eff = effectiveSuit(player, jc);
      const ok = eff !== 'heart';
      return {
        effective: ok,
        message: ok ? '非红桃，置于武将牌上作为「田」' : '红桃，屯田失败',
        kind: ok ? 'tuntian_ok' : 'tuntian_fail',
      };
    }
    case 'ganglie':
      return {
        effective: color === 'red',
        message:
          color === 'red'
            ? '红色，对伤害来源造成 1 点伤害'
            : '黑色，选择令其弃置一张牌',
        kind: color === 'red' ? 'ganglie_red' : 'ganglie_black',
      };
    case 'tieji':
      return {
        effective: true,
        message: `目标须弃置一张${api.SUIT_LABEL[suit]}牌，否则不能出闪`,
        kind: 'tieji',
      };
    case 'luoshen':
      return {
        effective: color === 'black',
        message: color === 'black'
          ? '黑色，获得此牌并可继续判定'
          : '红色，获得此牌并停止判定',
        kind: color === 'black' ? 'luoshen_black' : 'luoshen_red',
      };
    case 'shuangxiong': {
      const opposite = color === 'red' ? '黑' : '红';
      return {
        effective: true,
        message: `获得判定牌，本回合可将${opposite}色牌当【决斗】使用`,
        kind: 'shuangxiong',
      };
    }
    case 'beige': {
      let message = `判定 ${label}`;
      if (suit === 'diamond') message = '方块：目标摸两张牌';
      else if (suit === 'heart') message = '红桃：目标回复 1 点体力';
      else if (suit === 'club') message = '梅花：伤害来源弃置两张牌';
      else if (suit === 'spade') message = '黑桃：伤害来源翻面';
      return { effective: true, message, kind: 'beige_' + suit };
    }
    default:
      return { effective: true, message: `判定 ${label}`, kind: 'skill_judge' };
  }
}

function applySkillJudgeOutcome(game, ctx, api) {
  const { skillId, playerId, resultCardId, extra } = ctx;
  const player = api.getPlayer(game, playerId);
  const jc = api.cardById(game, resultCardId);
  if (!player || !jc) return;

  const color = api.SUIT_COLOR[jc.suit];
  const label = api.SUIT_LABEL[jc.suit] + jc.number;

  switch (skillId) {
    case 'tuntian': {
      api.pushLog(game, `${player.name} 屯田判定 ${label}`);
      const eff = effectiveSuit(player, jc);
      if (eff !== 'heart') {
        game.discardPile = game.discardPile.filter((id) => id !== resultCardId);
        addToPile(player, 'tian', resultCardId);
        api.pushLog(game, `${player.name} 将判定牌置于武将牌上作为「田」`);
      }
      break;
    }
    case 'ganglie': {
      api.pushLog(
        game,
        `${player.name} 刚烈判定 ${label} → ${color === 'red' ? '红色' : '黑色'}`
      );
      const src =
        extra && extra.sourceId ? api.getPlayer(game, extra.sourceId) : null;
      if (!src || !src.alive) break;
      if (color === 'red') {
        api.dealDamage(game, player.id, src.id, 1);
      } else {
        api.setPending(game, {
          type: 'skill_effect',
          skillId: 'ganglie',
          playerId: player.id,
          askId: player.id,
          sourceId: src.id,
          message: '刚烈：选择令伤害来源弃置的一张牌',
        });
      }
      break;
    }
    case 'tieji': {
      api.pushLog(game, `${player.name} 铁骑判定 ${label}`);
      const targetId = extra && extra.targetId;
      api.setPending(game, {
        type: 'skill_effect',
        skillId: 'tieji',
        playerId: player.id,
        askId: targetId,
        suit: jc.suit,
        shaPendingResume: true,
        message: `铁骑：请弃置一张${api.SUIT_LABEL[jc.suit]}牌，否则不能出闪`,
        canPass: true,
      });
      break;
    }
    case 'luoshen': {
      game.discardPile = game.discardPile.filter((id) => id !== resultCardId);
      if (!player.hand.includes(resultCardId)) player.hand.push(resultCardId);
      api.pushLog(game, `${player.name} 洛神判定 ${label} → 获得`);
      if (color === 'black') {
        api.setPending(game, {
          type: 'skill_effect',
          skillId: 'luoshen',
          playerId: player.id,
          askId: player.id,
          message: '洛神：黑色，是否继续判定？',
          canPass: true,
          continue: true,
        });
      }
      break;
    }
    case 'shuangxiong': {
      game.discardPile = game.discardPile.filter((id) => id !== resultCardId);
      if (!player.hand.includes(resultCardId)) player.hand.push(resultCardId);
      const opposite = color === 'red' ? 'black' : 'red';
      player.skillStates = player.skillStates || {};
      player.skillStates.shuangxiongColor = opposite;
      player.skillStates._skipNormalDraw = true;
      api.pushLog(game, `${player.name} 双雄判定为 ${label}`);
      api.pushLog(
        game,
        `${player.name} 本回合可将${opposite === 'red' ? '红' : '黑'}色牌当【决斗】使用`
      );
      break;
    }
    case 'beige': {
      const victim =
        extra && extra.targetId ? api.getPlayer(game, extra.targetId) : null;
      const src =
        extra && extra.sourceId ? api.getPlayer(game, extra.sourceId) : null;
      api.pushLog(game, `${player.name} 悲歌判定 ${label}`);
      if (jc.suit === 'diamond' && victim) {
        api.drawCards(game, victim, 2);
      } else if (jc.suit === 'heart' && victim) {
        if (typeof api.recoverHp === 'function') {
          api.recoverHp(game, player, victim, 1);
        } else if (victim.hp < victim.maxHp) {
          victim.hp += 1;
        }
      } else if (jc.suit === 'club' && src && src.alive) {
        let left = 2;
        while (left > 0 && src.hand.length) {
          api.discardCard(game, src, src.hand[0], 'hand');
          left -= 1;
        }
        for (const slot of Object.keys(src.equips || {})) {
          if (left <= 0) break;
          if (src.equips[slot]) {
            api.discardCard(game, src, src.equips[slot].id, 'equip:' + slot);
            left -= 1;
          }
        }
      } else if (jc.suit === 'spade' && src && src.alive) {
        src.turnedOver = !src.turnedOver;
        api.pushLog(
          game,
          `${src.name} 因悲歌翻至${src.turnedOver ? '背面' : '正面'}`
        );
      }
      break;
    }
    default:
      break;
  }
}

module.exports = {
  computeSkillJudgeOutcome,
  applySkillJudgeOutcome,
};
