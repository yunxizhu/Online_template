'use strict';

/**
 * 新武将共用助手：翻面、拼点、武将牌区、有效花色（红颜）、虚拟八卦等
 */

function ensureSkillPiles(player) {
  if (!player.skillPiles) player.skillPiles = {};
  return player.skillPiles;
}

function pileCards(player, key) {
  const piles = ensureSkillPiles(player);
  if (!Array.isArray(piles[key])) piles[key] = [];
  return piles[key];
}

function addToPile(player, key, cardId) {
  const arr = pileCards(player, key);
  if (!arr.includes(cardId)) arr.push(cardId);
  return arr;
}

function removeFromPile(player, key, cardId) {
  const arr = pileCards(player, key);
  const i = arr.indexOf(cardId);
  if (i >= 0) arr.splice(i, 1);
  return arr;
}

/** 红颜：黑桃视为红桃 */
function effectiveSuit(player, card) {
  if (!card) return null;
  if (
    player &&
    player.skills &&
    player.skills.some((s) => s.id === 'hongyan') &&
    card.suit === 'spade'
  ) {
    return 'heart';
  }
  return card.suit;
}

function effectiveColor(player, card, SUIT_COLOR) {
  const suit = effectiveSuit(player, card);
  return SUIT_COLOR[suit] || card.color;
}

function hasSkill(player, skillId) {
  return Boolean(
    player && player.skills && player.skills.some((s) => s.id === skillId)
  );
}

/** 八阵：未装备防具时视为八卦 */
function effectiveArmor(player) {
  if (player.equips && player.equips.armor) return player.equips.armor;
  if (hasSkill(player, 'bazhen')) {
    return {
      id: `virtual-bagua-${player.id}`,
      name: '八卦阵',
      type: 'equip',
      slot: 'armor',
      subtype: 'bagua',
      virtual: true,
      mark: '虚',
    };
  }
  return null;
}

function distanceOffBonus(player) {
  let off = 0;
  if (!player) return 0;
  if (hasSkill(player, 'mashu')) off += 1;
  const tian = pileCards(player, 'tian');
  off += tian.length;
  return off;
}

function handLimitOf(game, player) {
  // 基础：体力值
  let limit = player.hp;
  // 不屈：有不屈牌时手牌上限 = 不屈牌数
  const buqu = pileCards(player, 'buqu');
  if (buqu.length > 0 && hasSkill(player, 'buqu')) {
    limit = buqu.length;
  }
  // 放权跳过出牌：手牌上限 = 体力上限
  if (player.skillStates && player.skillStates.fangquanHandLimit) {
    limit = player.maxHp;
  }
  // 血裔：每名其他群雄 +2
  if (hasSkill(player, 'xueyi') && player.isLordSkillEnabled) {
    const n = (game.players || []).filter(
      (p) => p.alive && p.id !== player.id && p.country === '群'
    ).length;
    limit += n * 2;
  }
  // 宗室：体力 + 场上势力数
  if (hasSkill(player, 'zongshi')) {
    const factions = new Set(
      (game.players || [])
        .filter((p) => p.alive && p.country)
        .map((p) => p.country)
    );
    limit = player.hp + factions.size;
  }
  // 庸肆：-X 势力数
  if (hasSkill(player, 'yongsi')) {
    const factions = new Set(
      (game.players || [])
        .filter((p) => p.alive && p.country)
        .map((p) => p.country)
    );
    limit = Math.max(0, limit - factions.size);
  }
  return Math.max(0, limit);
}

function factionCount(game) {
  return new Set(
    (game.players || [])
      .filter((p) => p.alive && p.country)
      .map((p) => p.country)
  ).size;
}

/**
 * 拼点：双方各出一张手牌比点数。
 * - 平局 = 没人赢也没人输（winnerId/loserId 均为 null，draw=true）
 * - 技能文案「若你赢」用 pinDianWon；「若你没赢」用 pinDianNotWon（含平局）；
 *   「若你输」用 pinDianLost（不含平局）。平局是否另有效果，由各技能自己写。
 * @returns {{ winnerId: string|null, loserId: string|null, draw: boolean, cardA, cardB }}
 */
function resolvePinDian(game, playerA, cardIdA, playerB, cardIdB, api) {
  const cardA = api.cardById(game, cardIdA);
  const cardB = api.cardById(game, cardIdB);
  if (!cardA || !cardB) {
    return {
      winnerId: null,
      loserId: null,
      draw: true,
      cardA,
      cardB,
    };
  }
  api.takeFromHand(playerA, cardIdA);
  api.takeFromHand(playerB, cardIdB);
  game.discardPile.push(cardIdA, cardIdB);
  api.pushLog(
    game,
    `${playerA.name} 拼点【${cardA.name}${cardA.number}】vs ${playerB.name}【${cardB.name}${cardB.number}】`
  );
  if (cardA.number > cardB.number) {
    api.pushLog(game, `${playerA.name} 拼点赢`);
    return {
      winnerId: playerA.id,
      loserId: playerB.id,
      draw: false,
      cardA,
      cardB,
    };
  }
  if (cardB.number > cardA.number) {
    api.pushLog(game, `${playerB.name} 拼点赢`);
    return {
      winnerId: playerB.id,
      loserId: playerA.id,
      draw: false,
      cardA,
      cardB,
    };
  }
  api.pushLog(game, '拼点平局（双方皆未赢）');
  return {
    winnerId: null,
    loserId: null,
    draw: true,
    cardA,
    cardB,
  };
}

/** 若该角色拼点赢 */
function pinDianWon(result, playerId) {
  return Boolean(result && result.winnerId === playerId);
}

/** 若该角色拼点输（不含平局） */
function pinDianLost(result, playerId) {
  return Boolean(result && result.loserId === playerId);
}

/** 若该角色拼点平局 */
function pinDianDraw(result) {
  return Boolean(result && result.draw);
}

/**
 * 若该角色「没赢」（输或平）。
 * 对应文案「若你没赢」——平局算没赢。
 */
function pinDianNotWon(result, playerId) {
  return !pinDianWon(result, playerId);
}

function flipPlayer(game, player, api) {
  player.turnedOver = !player.turnedOver;
  api.pushLog(
    game,
    `${player.name} 将武将牌翻至${player.turnedOver ? '背面' : '正面'}`
  );
}

function markLimitedUsed(player, skillId) {
  player.skillStates = player.skillStates || {};
  player.skillStates[skillId] = true;
  player.skillStates[`${skillId}:limited`] = true;
}

function limitedUsed(player, skillId) {
  return Boolean(
    player.skillStates &&
      (player.skillStates[`${skillId}:limited`] || player.skillStates[skillId])
  );
}

function markAwakened(player, skillId) {
  player.skillStates = player.skillStates || {};
  player.skillStates[`${skillId}:awaken`] = true;
}

function awakened(player, skillId) {
  return Boolean(player.skillStates && player.skillStates[`${skillId}:awaken`]);
}

/** 动态获得技能（永久） */
function gainSkill(player, skillMeta) {
  player.skills = player.skills || [];
  if (player.skills.some((s) => s.id === skillMeta.id)) return;
  player.skills.push({
    id: skillMeta.id,
    name: skillMeta.name,
    desc: skillMeta.desc || '',
    lord: Boolean(skillMeta.lord),
  });
  player.extraSkillIds = player.extraSkillIds || [];
  if (!player.extraSkillIds.includes(skillMeta.id)) {
    player.extraSkillIds.push(skillMeta.id);
  }
}

/** 本回合临时技能 */
function gainTempSkill(player, skillId) {
  player.skillStates = player.skillStates || {};
  player.skillStates[`temp:${skillId}`] = true;
}

function hasTempSkill(player, skillId) {
  return Boolean(player.skillStates && player.skillStates[`temp:${skillId}`]);
}

function clearTempSkills(player) {
  if (!player.skillStates) return;
  for (const k of Object.keys(player.skillStates)) {
    if (k.startsWith('temp:')) delete player.skillStates[k];
  }
}

module.exports = {
  ensureSkillPiles,
  pileCards,
  addToPile,
  removeFromPile,
  effectiveSuit,
  effectiveColor,
  hasSkill,
  effectiveArmor,
  distanceOffBonus,
  handLimitOf,
  factionCount,
  resolvePinDian,
  pinDianWon,
  pinDianLost,
  pinDianDraw,
  pinDianNotWon,
  flipPlayer,
  markLimitedUsed,
  limitedUsed,
  markAwakened,
  awakened,
  gainSkill,
  gainTempSkill,
  hasTempSkill,
  clearTempSkills,
};
