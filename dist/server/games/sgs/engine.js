'use strict';

const {
  IDENTITY,
  identityDeck,
  xianzhuIdentityDeck,
  shuffle,
  uid,
  SUIT_LABEL,
  SUIT_COLOR,
} = require('./constants');
const { buildStandardDeck } = require('./deck');
const { getGeneral, dealGeneralChoices, GENERALS, getHero } = require('./generals');
const { installSkillBridge } = require('./hero/skillBridge');
const { createTrickFlow } = require('./trickFlow');
const skillJudgeFlow = require('./skillJudgeFlow');
const xz = require('./xianzhuMode');
let skillBus;
let resolveSkillEffect;
let resumeAfterSkill;
let finishDrawPhase;
let doDiscardOrEnd;
let trickFlow;
const {
  alivePlayers,
  distance,
  inAttackRange,
  attackRange,
} = require('./distance');

function cardById(game, id) {
  return game.cards[id] || null;
}

function isShaName(name) {
  return name === '杀' || name === '火杀' || name === '雷杀';
}

function pushLog(game, text) {
  game.log.push({ at: Date.now(), text });
  if (game.log.length > 60) game.log.shift();
}

function ensureAnnounceStats(player) {
  if (!player) return null;
  if (player.announceKills == null) player.announceKills = 0;
  if (player.announceSaves == null) player.announceSaves = 0;
  if (player.announceRecover == null) player.announceRecover = 0;
  return player;
}

/** 击杀连破播报标签（1～7） */
const KILL_ANNOUNCE_LABEL = [
  null,
  '一破',
  '双连',
  '三连',
  '四连',
  '五连',
  '六连',
  '七连',
];

function pushAnnounce(game, player, label) {
  if (!player || !label) return;
  pushLog(game, `${player.name} 【播报】${label}`);
}

/** 阈值：首次 first，之后每 every 次再播 */
function hitAnnounceThreshold(count, first, every) {
  if (count < first) return false;
  if (count === first) return true;
  return (count - first) % every === 0;
}

function noteKillAnnounce(game, killer) {
  ensureAnnounceStats(killer);
  if (!killer) return 0;
  killer.announceKills += 1;
  const n = killer.announceKills;
  const label = KILL_ANNOUNCE_LABEL[Math.min(n, 7)];
  if (n <= 7 && label) pushAnnounce(game, killer, label);
  return n;
}

function noteDyingSaveAnnounce(game, saver) {
  ensureAnnounceStats(saver);
  if (!saver) return;
  saver.announceSaves += 1;
  if (hitAnnounceThreshold(saver.announceSaves, 3, 2)) {
    pushAnnounce(game, saver, '妙手回春');
  }
}

function noteRecoverAnnounce(game, target, amount) {
  ensureAnnounceStats(target);
  if (!target || !(amount > 0)) return;
  const before = target.announceRecover;
  target.announceRecover += amount;
  // 跨越阈值时播报（一次回复可能跨过多个阈值，逐个播）
  let check = before + 1;
  while (check <= target.announceRecover) {
    if (hitAnnounceThreshold(check, 5, 3)) {
      pushAnnounce(game, target, '医术高超');
    }
    check += 1;
  }
}

function makeEmptyPlayer(p, seat, identity, team) {
  return {
    id: p.id,
    name: p.name,
    tag: p.tag || null,
    left: false,
    seat,
    alive: true,
    identity,
    team: team || null,
    identityRevealed: identity === 'zhu' || identity === 'xianzhu',
    generalId: null,
    generalName: null,
    country: null,
    gender: null,
    portrait: null,
    skills: [],
    skillStates: {},
    isLordSkillEnabled: false,
    maxHp: 0,
    hp: 0,
    huangjinMarks: 0,
    houzhuOrigin: null,
    hand: [],
    equips: {
      weapon: null,
      armor: null,
      horseMinus: null,
      horsePlus: null,
      treasure: null,
    },
    judges: [],
    skillPiles: {},
    extraSkillIds: [],
    shaUsed: 0,
    wineUsed: 0,
    wineBuff: false,
    chained: false,
    turnedOver: false,
    skipPlay: false,
    skipDraw: false,
    firstTurnDrawPenalty: false,
    feiyangUsed: false,
    announceKills: 0,
    announceSaves: 0,
    announceRecover: 0,
  };
}

function createIdentityGame(room) {
  const n = room.players.length;
  if (n !== 5 && n !== 8) {
    throw new Error('标准身份模式仅支持 5 或 8 人开局');
  }

  const ids = shuffle(identityDeck(n));
  const players = room.players.map((p, seat) =>
    makeEmptyPlayer(p, seat, ids[seat], null)
  );

  const zhuIdx = players.findIndex((p) => p.identity === 'zhu');
  if (zhuIdx > 0) {
    const rotated = players.slice(zhuIdx).concat(players.slice(0, zhuIdx));
    rotated.forEach((p, i) => {
      p.seat = i;
    });
    players.splice(0, players.length, ...rotated);
  }

  const deckCards = buildStandardDeck();
  const cards = {};
  for (const c of deckCards) cards[c.id] = c;

  const game = {
    type: 'sgs',
    mode: 'identity',
    modeLabel: '标准身份',
    phase: 'select_general',
    selectGeneralPhase: 'lord',
    over: false,
    winners: [],
    winReason: '',
    cards,
    drawPile: shuffle(deckCards.map((c) => c.id)),
    discardPile: [],
    players,
    turnSeat: 0,
    turnPhase: null,
    shaCountLimit: 1,
    pending: null,
    stack: [],
    log: [],
    generalChoices: {},
    selectedGenerals: new Set(),
    teamPools: null,
    banState: null,
    turnCount: 0,
    turnDamageTotal: 0,
    _skillResume: null,
    _skillQueue: null,
    _shaPend: null,
    _generalDealUsed: [],
  };

  const zhu = players.find((p) => p.identity === 'zhu');
  const used = game._generalDealUsed;
  game.generalChoices[zhu.id] = dealGeneralChoices(5, used).map((g) => g.id);
  used.push(...game.generalChoices[zhu.id]);

  pushLog(
    game,
    `标准身份开局（${n} 人）。主公已亮明，主公 5 选 1；其余角色随后 3 选 1。`
  );
  return game;
}

function createXianzhuGame(room) {
  const n = room.players.length;
  if (n !== 5 && n !== 8) {
    throw new Error('先主模式仅支持 5 或 8 人开局');
  }

  const ids = shuffle(xianzhuIdentityDeck(n));
  const players = room.players.map((p, seat) =>
    makeEmptyPlayer(p, seat, ids[seat], null)
  );

  const zhuIdx = players.findIndex((p) => p.identity === 'xianzhu');
  if (zhuIdx > 0) {
    const rotated = players.slice(zhuIdx).concat(players.slice(0, zhuIdx));
    rotated.forEach((p, i) => {
      p.seat = i;
    });
    players.splice(0, players.length, ...rotated);
  }

  const deckCards = buildStandardDeck();
  const cards = {};
  for (const c of deckCards) cards[c.id] = c;

  const game = {
    type: 'sgs',
    mode: 'xianzhu',
    modeLabel: '先主·黄巾',
    phase: 'select_general',
    selectGeneralPhase: 'lord',
    over: false,
    winners: [],
    winReason: '',
    cards,
    drawPile: shuffle(deckCards.map((c) => c.id)),
    discardPile: [],
    players,
    turnSeat: 0,
    turnPhase: null,
    shaCountLimit: 1,
    pending: null,
    stack: [],
    log: [],
    generalChoices: {},
    selectedGenerals: new Set(),
    teamPools: null,
    banState: null,
    turnCount: 0,
    turnDamageTotal: 0,
    _skillResume: null,
    _skillQueue: null,
    _shaPend: null,
    huangjinUprising: false,
    huangjinConvertLocked: false,
    _huangjinNotices: [],
    _IDENTITY: IDENTITY,
    _generalDealUsed: [],
  };

  const lord = players.find((p) => p.identity === 'xianzhu');
  const used = game._generalDealUsed;
  game.generalChoices[lord.id] = dealGeneralChoices(5, used).map((g) => g.id);
  used.push(...game.generalChoices[lord.id]);

  pushLog(
    game,
    `先主模式开局（${n} 人）。先主已亮明（体力+1）；先主 5 选 1，其余角色随后 3 选 1。`
  );
  return game;
}

/**
 * 2V2：座位 1+4 一队，2+3 一队（0-index: 0+3 / 1+2）
 */
function createH2hGame(room) {
  const n = room.players.length;
  if (n !== 4) {
    throw new Error('2V2 模式仅支持 4 人开局');
  }

  const teamAId = Math.random() < 0.5 ? 'zhong' : 'fan';
  const teamBId = teamAId === 'zhong' ? 'fan' : 'zhong';

  const players = room.players.map((p, seat) => {
    const team = seat === 0 || seat === 3 ? 'A' : 'B';
    const identity = team === 'A' ? teamAId : teamBId;
    const pl = makeEmptyPlayer(p, seat, identity, team);
    pl.identityRevealed = true; // 2v2 座位即阵营，身份对全员可见
    if (seat === 0) pl.firstTurnDrawPenalty = true;
    return pl;
  });

  const deckCards = buildStandardDeck();
  const cards = {};
  for (const c of deckCards) cards[c.id] = c;

  const allGen = shuffle(GENERALS.map((g) => g.id));
  const poolA = allGen.slice(0, 8);
  const poolB = allGen.slice(8, 16);

  const game = {
    type: 'sgs',
    mode: 'h2h',
    modeLabel: '2V2',
    phase: 'ban_general',
    over: false,
    winners: [],
    winReason: '',
    cards,
    drawPile: shuffle(deckCards.map((c) => c.id)),
    discardPile: [],
    players,
    turnSeat: 0,
    turnPhase: null,
    shaCountLimit: 1,
    pending: null,
    stack: [],
    log: [],
    generalChoices: {},
    selectedGenerals: new Set(),
    teamPools: { A: poolA, B: poolB },
    banState: {
      order: players.map((p) => p.id),
      index: 0,
      banned: [],
    },
    turnCount: 0,
    turnDamageTotal: 0,
    _skillResume: null,
    _skillQueue: null,
    _shaPend: null,
  };

  for (const p of players) {
    game.generalChoices[p.id] = game.teamPools[p.team].slice();
  }

  pushLog(
    game,
    `2V2 开局：1·4 号为【${IDENTITY[teamAId]}】，2·3 号为【${IDENTITY[teamBId]}】。先 Ban 将，再选将。`
  );
  pushLog(
    game,
    `请 ${players[0].name} Ban 对方阵营 1 名武将`
  );
  return game;
}

function createGameState(room) {
  const mode = room.gameMode || 'identity';
  if (mode === 'h2h' || mode === '2v2') {
    return createH2hGame(room);
  }
  if (mode === '1v2' || mode === 'landlord') {
    return create1v2Game(room);
  }
  if (mode === 'xianzhu') {
    return createXianzhuGame(room);
  }
  return createIdentityGame(room);
}

/**
 * 1v2 地主：先叫分确定主公，再选将。
 */
function create1v2Game(room) {
  const n = room.players.length;
  if (n !== 3) {
    throw new Error('1v2 模式仅支持 3 人开局');
  }

  const players = room.players.map((p, seat) =>
    makeEmptyPlayer(p, seat, null, null)
  );

  const deckCards = buildStandardDeck();
  const cards = {};
  for (const c of deckCards) cards[c.id] = c;

  const game = {
    type: 'sgs',
    mode: '1v2',
    modeLabel: '1V2',
    phase: 'bid_lord',
    over: false,
    winners: [],
    winReason: '',
    cards,
    drawPile: shuffle(deckCards.map((c) => c.id)),
    discardPile: [],
    players,
    turnSeat: 0,
    turnPhase: null,
    shaCountLimit: 1,
    pending: null,
    stack: [],
    log: [],
    generalChoices: {},
    selectedGenerals: new Set(),
    teamPools: null,
    banState: null,
    bidState: {
      order: players.map((p) => p.id),
      index: 0,
      currentBid: 0,
      currentBidder: null,
      firstSpeaker: players[0].id,
      passesInRow: 0,
      multiplier: 1,
    },
  };

  pushLog(game, '1V2 开局：请叫地主（可叫 1/2/3 倍，或跳过）');
  pushLog(game, `请 ${players[0].name} 叫分`);
  return game;
}

function finalize1v2Lord(game, lordId, multiplier) {
  const lord = getPlayer(game, lordId);
  const others = game.players.filter((p) => p.id !== lordId);
  // seats: lord 0, rebels 1, 2
  const ordered = [lord, others[0], others[1]];
  ordered.forEach((p, i) => {
    p.seat = i;
    if (i === 0) {
      p.identity = 'zhu';
      p.identityRevealed = true;
      p.team = 'lord';
    } else {
      p.identity = 'fan';
      p.identityRevealed = true;
      p.team = 'rebel';
    }
  });
  game.players.splice(0, game.players.length, ...ordered);
  game.bidState = {
    ...game.bidState,
    multiplier: multiplier || 1,
    resolved: true,
  };

  const used = [];
  const lordChoices = dealGeneralChoices(5, used).map((g) => g.id);
  used.push(...lordChoices);
  game.generalChoices[lord.id] = lordChoices;
  for (const r of others) {
    const choices = dealGeneralChoices(3, used).map((g) => g.id);
    used.push(...choices);
    game.generalChoices[r.id] = choices;
  }

  game.phase = 'select_general';
  game.selectGeneralPhase = 'all';
  pushLog(
    game,
    `${lord.name} 成为主公（${multiplier} 倍）。主公 5 选 1，反贼各 3 选 1（同时选将，武将对他人暗置）。主公拥有【跋扈】【飞扬】。`
  );
}

function bidLord(game, playerId, value) {
  if (game.phase !== 'bid_lord') {
    return { ok: false, error: '当前不是叫分阶段' };
  }
  const bid = game.bidState;
  if (!bid || bid.order[bid.index] !== playerId) {
    return { ok: false, error: '未轮到你叫分' };
  }
  const p = getPlayer(game, playerId);
  const v = Number(value);

  if (v === 0) {
    // 不叫 / 不抢
    pushLog(game, `${p.name} 不叫`);
    bid.passesInRow += 1;
    if (bid.currentBid === 0) {
      // everyone might pass
      if (bid.passesInRow >= 3) {
        finalize1v2Lord(game, bid.firstSpeaker, 1);
        return { ok: true };
      }
    } else if (bid.passesInRow >= 2) {
      // others passed after a bid
      finalize1v2Lord(game, bid.currentBidder, bid.currentBid);
      return { ok: true };
    }
    bid.index = (bid.index + 1) % bid.order.length;
    const next = getPlayer(game, bid.order[bid.index]);
    pushLog(game, `请 ${next.name} 叫分`);
    return { ok: true };
  }

  if (![1, 2, 3].includes(v)) {
    return { ok: false, error: '叫分只能是 1/2/3' };
  }
  if (v <= bid.currentBid) {
    return { ok: false, error: `必须高于当前 ${bid.currentBid} 倍` };
  }

  bid.currentBid = v;
  bid.currentBidder = playerId;
  bid.passesInRow = 0;
  pushLog(game, `${p.name} 叫 ${v} 倍`);

  if (v === 3) {
    finalize1v2Lord(game, playerId, 3);
    return { ok: true };
  }

  bid.index = (bid.index + 1) % bid.order.length;
  const next = getPlayer(game, bid.order[bid.index]);
  pushLog(game, `请 ${next.name} 叫分`);
  return { ok: true };
}

function sameTeam(a, b) {
  if (!a || !b) return false;
  if (a.team && b.team) return a.team === b.team;
  return false;
}

function enemyTeam(team) {
  return team === 'A' ? 'B' : 'A';
}

function getPlayer(game, id) {
  return game.players.find((p) => p.id === id) || null;
}

function currentPlayer(game) {
  return game.players.find((p) => p.seat === game.turnSeat && p.alive) || null;
}

function nextAliveSeat(game, fromSeat) {
  const n = game.players.length;
  for (let i = 1; i <= n; i++) {
    const seat = (fromSeat + i) % n;
    const p = game.players.find((x) => x.seat === seat);
    if (p && p.alive) return seat;
  }
  return fromSeat;
}

function prevAliveSeat(game, fromSeat) {
  const n = game.players.length;
  for (let i = 1; i <= n; i++) {
    const seat = (fromSeat - i + n) % n;
    const p = game.players.find((x) => x.seat === seat);
    if (p && p.alive) return seat;
  }
  return fromSeat;
}

/** 从某角色起按逆时针（与回合顺序一致）收集存活角色 id */
function resolveOrderFromPlayer(game, fromPlayerId, { includeSelf = true } = {}) {
  const from = getPlayer(game, fromPlayerId);
  if (!from) return [];
  const order = [];
  let seat = includeSelf ? from.seat : prevAliveSeat(game, from.seat);
  const home = from.seat;
  let guard = 0;
  while (guard++ <= game.players.length + 1) {
    if (!includeSelf && seat === home) break;
    const p = game.players.find((x) => x.seat === seat);
    if (p && p.alive) order.push(p.id);
    seat = prevAliveSeat(game, seat);
    if (includeSelf && seat === home) break;
  }
  return order;
}

function chainDamageOrder(game, targetId, anchorSeat) {
  const out = [];
  const n = game.players.length;
  let seat = ((anchorSeat % n) + n) % n;
  for (let i = 0; i < n; i++) {
    const p = game.players.find((x) => x.seat === seat);
    if (p && p.alive && p.id !== targetId && p.chained) out.push(p);
    seat = prevAliveSeat(game, seat);
  }
  return out;
}

function nextTurnSeat(game, fromSeat) {
  return prevAliveSeat(game, fromSeat);
}

function reshuffleIfNeeded(game) {
  if (game.drawPile.length > 0) return;
  if (game.discardPile.length === 0) return;
  game.drawPile = shuffle(game.discardPile);
  game.discardPile = [];
  pushLog(game, '牌堆耗尽，弃牌堆已洗混重用');
}

function drawCards(game, player, n) {
  const got = [];
  for (let i = 0; i < n; i++) {
    reshuffleIfNeeded(game);
    if (!game.drawPile.length) break;
    const id = game.drawPile.shift();
    player.hand.push(id);
    got.push(id);
  }
  return got;
}

function onEquipRemoved(game, player, cardId) {
  const card = cardById(game, cardId);
  if (!card || card.subtype !== 'muniu') return;
  const muniuEquip = require('./equip/muniu');
  muniuEquip.clearMuniuPile(player, game);
  muniuEquip.syncMuniuSkill(player);
}

function discardCard(game, player, cardId, from = 'hand') {
  let lostEquip = false;
  const card = cardById(game, cardId);
  if (from === 'hand') {
    const i = player.hand.indexOf(cardId);
    if (i >= 0) player.hand.splice(i, 1);
  } else if (from === 'judge') {
    player.judges = player.judges.filter((c) => c !== cardId);
  } else if (from.startsWith('equip:')) {
    const slot = from.slice(6);
    if (player.equips[slot] && player.equips[slot].id === cardId) {
      player.equips[slot] = null;
      lostEquip = true;
    }
  }
  game.discardPile.push(cardId);
  if (lostEquip) {
    onEquipRemoved(game, player, cardId);
    if (skillBus) {
      skillBus.emit(game, 'afterLoseEquip', { player, cardId });
    }
  }
  if (skillBus) {
    skillBus.emit(game, 'afterLoseCard', {
      player,
      cardId,
      from,
      card,
    });
    // 落英：其他角色梅花因弃置进入弃牌堆
    if (card && card.suit === 'club') {
      for (const p of alivePlayers(game)) {
        if (p.id === player.id) continue;
        if (!p.skills || !p.skills.some((s) => s.id === 'luoying')) continue;
        skillBus.emit(game, 'afterClubToDiscard', {
          player: p,
          cardIds: [cardId],
          fromPlayerId: player.id,
          reason: 'discard',
        });
        if (game.pending) break;
      }
    }
  }
}

function moveToDiscard(game, cardIds) {
  for (const id of cardIds) {
    if (!game.discardPile.includes(id)) game.discardPile.push(id);
  }
}

function findCardZone(player, cardId) {
  if (player.hand.includes(cardId)) return { zone: 'hand' };
  if (player.judges.includes(cardId)) return { zone: 'judge' };
  for (const slot of Object.keys(player.equips)) {
    if (player.equips[slot] && player.equips[slot].id === cardId) {
      return { zone: 'equip', slot };
    }
  }
  const muniu = player.skillPiles && player.skillPiles.muniu;
  if (Array.isArray(muniu) && muniu.includes(cardId)) {
    return { zone: 'muniu' };
  }
  return null;
}

function allCardsOf(player) {
  const ids = [...player.hand, ...player.judges];
  for (const slot of Object.keys(player.equips)) {
    if (player.equips[slot]) ids.push(player.equips[slot].id);
  }
  const muniu = player.skillPiles && player.skillPiles.muniu;
  if (Array.isArray(muniu)) ids.push(...muniu);
  return ids;
}

const REVEAL_MIN_MS = 3000;

function setPending(game, pending) {
  if (
    pending &&
    (pending.type === 'card_reveal' ||
      pending.type === 'judge_reveal' ||
      (pending.type === 'wuxie' && pending.phase === 'reveal'))
  ) {
    pending.revealStartedAt = pending.revealStartedAt || Date.now();
    pending.revealMinMs = pending.revealMinMs || REVEAL_MIN_MS;
  }
  game.pending = pending;
}

function clearPending(game) {
  game.pending = null;
}

function beginCardReveal(game, opts) {
  setPending(game, {
    type: 'card_reveal',
    playerId: opts.playerId,
    askId: opts.askId != null ? opts.askId : opts.playerId,
    shown: opts.shown || [],
    message: opts.message || '展示',
    title: opts.title || null,
    skillId: opts.skillId || null,
    skillName: opts.skillName || null,
    canPass: false,
    _afterReveal: opts.afterReveal || null,
  });
}

function revealElapsedOk(pend, force) {
  if (force) return true;
  const minMs = pend.revealMinMs || REVEAL_MIN_MS;
  const started = pend.revealStartedAt || 0;
  return Date.now() - started >= minMs;
}

function runAfterCardReveal(game, after) {
  if (!after || !after.kind) {
    return;
  }
  switch (after.kind) {
    case 'zhiyu': {
      if (after.same && after.sourceId) {
        const src = getPlayer(game, after.sourceId);
        if (src && src.alive && src.hand.length) {
          setPending(game, {
            type: 'skill_effect',
            skillId: 'zhiyu',
            playerId: after.playerId,
            askId: src.id,
            sourceId: src.id,
            message: '智愚：请弃置一张手牌',
          });
        }
      }
      return;
    }
    case 'huogong': {
      const source = getPlayer(game, after.sourceId);
      const hasSameSuit =
        source &&
        source.hand.some((id) => {
          const c = cardById(game, id);
          return c && c.suit === after.suit;
        });
      if (!hasSameSuit) {
        pushLog(
          game,
          `${source ? source.name : '来源角色'} 没有同花色手牌，火攻无效`
        );
        return;
      }
      setPending(game, {
        type: 'huogong',
        playerId: after.sourceId,
        askId: after.sourceId,
        sourceId: after.sourceId,
        targetId: after.targetId,
        shown: after.shownId ? [after.shownId] : [],
        suit: after.suit,
        message: `火攻：弃一张${SUIT_LABEL[after.suit]}牌造成火焰伤害，或取消`,
      });
      return;
    }
    case 'luoyi_choice': {
      const me = getPlayer(game, after.playerId);
      const shown =
        after.shown ||
        (me && me.skillStates && me.skillStates._luoyiShown) ||
        [];
      if (!me) return;
      setPending(game, {
        type: 'skill_effect',
        skillId: 'luoyi',
        playerId: me.id,
        askId: me.id,
        shown,
        message:
          '裸衣：是否放弃摸牌，获得翻开的武器与基本牌？（本回合杀/决斗伤害+1）',
        canPass: true,
      });
      return;
    }
    case 'luoying_choice': {
      const me = getPlayer(game, after.playerId);
      if (!me) return;
      setPending(game, {
        type: 'skill_effect',
        skillId: 'luoying',
        playerId: me.id,
        askId: me.id,
        cardIds: after.cardIds || [],
        shown: after.cardIds || [],
        message: '落英：是否获得这些梅花牌？',
        canPass: true,
      });
      return;
    }
    case 'fanjian': {
      const me = getPlayer(game, after.playerId);
      const target = getPlayer(game, after.targetId);
      const card = cardById(game, after.cardId);
      if (!card) return;
      const shown =
        (SUIT_LABEL[card.suit] || '') +
        card.number +
        '【' +
        card.name +
        '】';
      pushLog(
        game,
        (target ? target.name : '目标') + ' 获得并展示 ' + shown
      );
      if (card.suit !== after.suit) {
        dealDamage(game, me.id, target.id, 1);
      }
      return;
    }
    case 'anxu': {
      const me = getPlayer(game, after.playerId);
      const card = cardById(game, after.cardId);
      const fewer = getPlayer(game, after.fewerId);
      pushLog(
        game,
        `${fewer ? fewer.name : '角色'} 安恤获得并展示【${card ? card.name : after.cardId}】`
      );
      if (card && card.suit !== 'spade' && me) {
        drawCards(game, me, 1);
      }
      return;
    }
    case 'buyi': {
      const dying = getPlayer(game, after.dyingId);
      const card = cardById(game, after.cardId);
      pushLog(
        game,
        dying.name + ' 展示手牌【' + (card ? card.name : after.cardId) + '】'
      );
      if (card && card.type !== 'basic') {
        discardCard(game, dying, after.cardId, 'hand');
        const owner = getPlayer(game, after.playerId);
        recoverHp(game, owner, dying, 1);
        pushLog(game, dying.name + ' 因补益弃置非基本牌并回复 1 点体力');
      }
      return;
    }
    default:
      return;
  }
}

function resumeAfterCardReveal(game) {
  if (game.over || game.pending) return;
  if (typeof resumeAfterSkill === 'function') {
    resumeAfterSkill(game);
  }
  if (!game.pending) {
    resumeAfterPending(game);
  }
}

function finishCardReveal(game, playerId, opts = {}) {
  const pend = game.pending;
  if (!pend || pend.type !== 'card_reveal') {
    return { ok: false, error: '当前不是展示' };
  }
  if (pend.askId !== playerId) return { ok: false, error: '未轮到你' };
  if (!revealElapsedOk(pend, opts.force)) {
    return { ok: false, error: '展示中…' };
  }
  const after = pend._afterReveal;
  clearPending(game);
  runAfterCardReveal(game, after);
  resumeAfterCardReveal(game);
  return { ok: true };
}

function tryFinishGeneralSelect(game) {
  if (!game.players.every((p) => p.generalId)) return;

  for (const p of game.players) {
    const n = game.mode === 'h2h' && p.seat === 3 ? 5 : 4;
    drawCards(game, p, n);
  }
  game.phase = 'playing';
  game.selectGeneralPhase = null;
  if (game.mode === 'h2h') {
    game.turnSeat = 0;
    pushLog(game, '武将选定完毕。1 号位先手（首回合摸牌-1）；4 号位起手 5 张。');
  } else if (game.mode === 'xianzhu') {
    const lord = game.players.find((p) => p.identity === 'xianzhu');
    game.turnSeat = lord ? lord.seat : 0;
    pushLog(game, '武将选定完毕，先主回合开始');
  } else {
    game.turnSeat = game.players.find((p) => p.identity === 'zhu').seat;
    pushLog(game, '武将选定完毕，主公回合开始');
  }
  game.generalChoices = {};
  game.banState = null;
  startTurn(game);
}

function isSelectLordSeat(game, p) {
  if (!p) return false;
  if (game.mode === 'identity' && p.identity === 'zhu') return true;
  if (game.mode === 'xianzhu' && p.identity === 'xianzhu') return true;
  return false;
}

/** 选将阶段结束后开放其余角色选将（身份 / 先主） */
function openOthersGeneralSelect(game) {
  game.selectGeneralPhase = 'others';
  const used = game._generalDealUsed || [];
  for (const id of game.selectedGenerals) {
    if (!used.includes(id)) used.push(id);
  }
  game._generalDealUsed = used;
  for (const p of game.players) {
    if (p.generalId) continue;
    const choices = dealGeneralChoices(3, used).map((g) => g.id);
    used.push(...choices);
    game.generalChoices[p.id] = choices;
  }
  const lordLabel = game.mode === 'xianzhu' ? '先主' : '主公';
  pushLog(game, `${lordLabel}已选定武将并亮明，其余角色开始选将`);
}

/**
 * 选将阶段武将是否对观看者可见。
 * - 自己始终可见
 * - 对局进行中 / 结束：全员可见
 * - 身份/先主的主公（先主）：选定后即对全员亮明
 * - 1v2 / 其余角色：选将阶段仅自己可见（他人见将背）
 */
function canViewerSeeGeneral(game, viewer, p) {
  if (!p || !p.generalId) return false;
  if (viewer && viewer.id === p.id) return true;
  if (game.phase === 'playing' || game.over) return true;
  if (game.phase !== 'select_general') return true;
  if (isSelectLordSeat(game, p)) return true;
  return false;
}

function syncTeamChoices(game) {
  if (!game.teamPools) return;
  for (const p of game.players) {
    if (p.generalId) continue;
    game.generalChoices[p.id] = game.teamPools[p.team].slice();
  }
}

function banGeneral(game, playerId, generalId) {
  if (game.phase !== 'ban_general') {
    return { ok: false, error: '当前不是 Ban 将阶段' };
  }
  const ban = game.banState;
  if (!ban || ban.order[ban.index] !== playerId) {
    return { ok: false, error: '未轮到你 Ban 将' };
  }
  const p = getPlayer(game, playerId);
  const enemy = enemyTeam(p.team);
  const pool = game.teamPools[enemy];
  const idx = pool.indexOf(generalId);
  if (idx < 0) return { ok: false, error: '只能 Ban 对方阵营武将' };

  pool.splice(idx, 1);
  ban.banned.push({ by: playerId, generalId, team: enemy });
  const g = getGeneral(generalId);
  pushLog(game, `${p.name} Ban 掉【${g ? g.name : generalId}】`);
  ban.index += 1;
  syncTeamChoices(game);

  if (ban.index >= ban.order.length) {
    game.phase = 'select_general';
    game.selectGeneralPhase = 'all';
    pushLog(game, 'Ban 将结束，请从己方剩余武将中选择');
  } else {
    const next = getPlayer(game, ban.order[ban.index]);
    pushLog(game, `请 ${next.name} Ban 对方阵营 1 名武将`);
  }
  return { ok: true };
}

function selectGeneral(game, playerId, generalId) {
  const p = getPlayer(game, playerId);
  if (!p || p.generalId) return { ok: false, error: '无法选择武将' };
  if (game.phase !== 'select_general') {
    return { ok: false, error: '当前不能选将' };
  }

  // 身份 / 先主：主公阶段仅主公可选
  if (
    (game.mode === 'identity' || game.mode === 'xianzhu') &&
    game.selectGeneralPhase === 'lord' &&
    !isSelectLordSeat(game, p)
  ) {
    return { ok: false, error: '请等待主公选将' };
  }

  const choices = game.generalChoices[playerId] || [];
  if (!choices.includes(generalId)) return { ok: false, error: '不在可选列表' };
  if (game.selectedGenerals.has(generalId)) {
    return { ok: false, error: '该武将已被选择' };
  }
  const g = getGeneral(generalId);
  if (!g) return { ok: false, error: '未知武将' };

  p.generalId = g.id;
  p.generalName = g.name;
  p.country = g.country;
  p.gender = g.gender || 'male';
  p.portrait = g.portrait || `hero_${g.id}.png`;
  p.skills = (g.skills || []).map((s) => ({
    id: s.id,
    name: s.name,
    desc: s.desc,
    lord: Boolean(s.lord),
  }));
  p.skillStates = {};
  const isLordSeat =
    (game.mode === 'identity' || game.mode === '1v2') && p.identity === 'zhu';
  const isXianzhu =
    game.mode === 'xianzhu' && p.identity === 'xianzhu';
  const isHouzhu = game.mode === 'xianzhu' && p.identity === 'houzhu';
  p.isLordSkillEnabled = Boolean(isLordSeat || isXianzhu || isHouzhu);
  // 先主选将体力上限 +1；后主传位不加
  const lordBonus = isLordSeat || isXianzhu ? 1 : 0;
  p.maxHp = g.maxHp + lordBonus;
  p.hp = p.maxHp;
  game.selectedGenerals.add(generalId);

  if (game.mode === 'h2h' && game.teamPools) {
    game.teamPools[p.team] = game.teamPools[p.team].filter(
      (id) => id !== generalId
    );
    syncTeamChoices(game);
  }
  delete game.generalChoices[playerId];

  const revealNow = isSelectLordSeat(game, p);
  if (revealNow) {
    pushLog(
      game,
      `${p.name} 选择了 ${g.name}` +
        (lordBonus
          ? isXianzhu
            ? '（先主体力+1）'
            : '（主公体力+1）'
          : '')
    );
  } else {
    pushLog(game, `${p.name} 已选定武将`);
  }

  if (
    (game.mode === 'identity' || game.mode === 'xianzhu') &&
    game.selectGeneralPhase === 'lord' &&
    isSelectLordSeat(game, p)
  ) {
    openOthersGeneralSelect(game);
    return { ok: true };
  }

  tryFinishGeneralSelect(game);
  return { ok: true };
}

function shaLimit(game, player) {
  if (!player) return 1;
  if (hasZhuge(player)) return 99;
  // 锁定技：咆哮等 → 无限
  if (player.skills && player.skills.some((s) => s && s.id === 'paoxiao')) {
    return 99;
  }

  let limit = 1;
  if (skillBus && typeof skillBus.query === 'function') {
    try {
      const qs = skillBus.query(game, player, 'shaLimit');
      for (const r of qs) {
        if (typeof r.value !== 'number') continue;
        if (r.value >= 99) return 99;
        // 技能给出的绝对次数（取较高者），跋扈再在此基础上 +1
        if (r.value > limit) limit = r.value;
      }
    } catch (_) {
      /* ignore */
    }
  }

  // 1v2 跋扈：出杀次数 +1（可与诸葛连弩/咆哮/其它加次叠加，不是「最多 2 张」）
  if (
    game &&
    game.mode === '1v2' &&
    (player.identity === 'zhu' || player.team === 'lord')
  ) {
    limit += 1;
  }

  return limit;
}

function startTurn(game) {
  const p = currentPlayer(game);
  if (!p) return;
  // 翻面：翻回正面并跳过本回合
  if (p.turnedOver) {
    p.turnedOver = false;
    pushLog(game, `${p.name} 翻回正面，跳过回合`);
    advanceTurn(game);
    return;
  }
  p.shaUsed = 0;
  p.wineUsed = 0;
  p.wineBuff = false;
  p.skipPlay = false;
  p.skipDraw = false;
  p.feiyangUsed = false;
  game.turnCount = (game.turnCount || 0) + 1;
  game.turnDamageTotal = 0;
  game._tuxiSkipDraw = 0;
  game._shaPend = null;
  p.skillStates = p.skillStates || {};
  delete p.skillStates.luoyiBuff;
  delete p.skillStates.paoxiaoNoDistance;
  delete p.skillStates.usedShaInPlay;
  delete p.skillStates.skipDiscard;
  delete p.skillStates._skipNormalDraw;
  delete p.skillStates.fangquanHandLimit;
  delete p.skillStates.liegongRange;
  delete p.skillStates.gongqiRange;
  delete p.skillStates.shuangxiongColor;
  delete p.skillStates.danlaoBan;
  // 清临时技能标记
  for (const k of Object.keys(p.skillStates)) {
    if (k.startsWith('temp:')) delete p.skillStates[k];
  }
  for (const id of [
    'zhiheng',
    'fanjian',
    'jieyin',
    'lijian',
    'qingnang',
    'rende',
    'quhu',
    'dimeng',
    'tiaoxin',
    'ganlu',
    'jujian',
    'xuanhuo',
    'anxu',
    'gongqi',
    'qice',
    'haoshi',
    'zishou',
  ]) {
    delete p.skillStates[id];
  }
  game.turnPhase = 'prepare';
  pushLog(game, `【${p.name}】回合开始`);

  if (game.mode === '1v2' && p.identity === 'zhu') {
    drawCards(game, p, 1);
    pushLog(game, `${p.name}【跋扈】准备阶段额外摸 1 张`);
  }

  // 伪帝：始终拥有主公技
  if (p.skills && p.skills.some((s) => s.id === 'weidi')) {
    p.isLordSkillEnabled = true;
  }

  game._skillResume = 'after_prepare';
  const r = skillBus.emit(game, 'phasePrepare', { player: p });
  if (r.pending) return;
  beginJudgePhase(game);
}

function beginJudgePhase(game) {
  game.turnPhase = 'judge';
  const p = currentPlayer(game);
  if (!p || !p.alive) {
    endTurn(game);
    return;
  }
  if (
    game.mode === '1v2' &&
    p.identity === 'zhu' &&
    p.judges.length > 0 &&
    !p.feiyangUsed
  ) {
    setPending(game, {
      type: 'feiyang',
      step: 'discard',
      playerId: p.id,
      judgeIds: p.judges.slice(),
      message:
        '【飞扬】可先弃 2 张手牌或装备牌，再弃置判定区 1 张牌（也可跳过）',
    });
    return;
  }
  runJudgePhase(game);
}

function runJudgePhase(game) {
  const p = currentPlayer(game);
  if (!p || !p.alive) {
    endTurn(game);
    return;
  }
  if (p.judges.length === 0) {
    afterJudgePhase(game);
    return;
  }
  const cardId = p.judges[p.judges.length - 1];
  const card = cardById(game, cardId);
  startDelayedJudgeWithWuxie(game, p, card);
}

function drawJudgeCard(game) {
  reshuffleIfNeeded(game);
  if (!game.drawPile.length) return null;
  const id = game.drawPile.shift();
  return id;
}

/** 判定阶段：先对延时锦囊询问无懈，再翻判定牌 */
function startDelayedJudgeWithWuxie(game, player, card) {
  if (!card || !player) {
    runJudgePhase(game);
    return;
  }
  if (!trickFlow || typeof trickFlow.beginWuxieWindow !== 'function') {
    beginDelayedJudgeReveal(game, player.id, card.id);
    return;
  }
  pushLog(game, `${player.name} 开始判定【${card.name}】`);
  trickFlow.beginWuxieWindow(game, {
    sourceId: player.id,
    cardId: card.id,
    cardName: card.name,
    targetIds: [player.id],
    includeSource: true,
    effect: {
      type: 'delayed_judge',
      playerId: player.id,
      cardId: card.id,
    },
  });
}

function cancelDelayedJudge(game, effect) {
  const player = getPlayer(game, effect && effect.playerId);
  const cardId = effect && effect.cardId;
  const card = cardId ? cardById(game, cardId) : null;
  if (player && card && player.judges.includes(card.id)) {
    discardCard(game, player, card.id, 'judge');
    pushLog(game, `【${card.name}】因无懈被取消，移出判定区`);
  } else if (card) {
    pushLog(game, `【${card.name}】因无懈被取消`);
  }
  runJudgePhase(game);
}

function computeDelayedJudgeOutcome(player, card, jc) {
  if (!player || !card || !jc) {
    return { effective: false, message: '判定结束', kind: 'none' };
  }
  if (card.subtype === 'lebu') {
    if (jc.suit !== 'heart') {
      return {
        effective: true,
        message: `${player.name} 【乐不思蜀】生效：跳过出牌阶段`,
        kind: 'lebu_skip',
      };
    }
    return {
      effective: false,
      message: `${player.name} 【乐不思蜀】判定为红桃，失效`,
      kind: 'lebu_fail',
    };
  }
  if (card.subtype === 'bingliang') {
    if (jc.suit !== 'club') {
      return {
        effective: true,
        message: `${player.name} 【兵粮寸断】生效：跳过摸牌阶段`,
        kind: 'bingliang_skip',
      };
    }
    return {
      effective: false,
      message: `${player.name} 【兵粮寸断】判定为梅花，失效`,
      kind: 'bingliang_fail',
    };
  }
  if (card.subtype === 'shandian') {
    if (jc.suit === 'spade' && jc.number >= 2 && jc.number <= 9) {
      return {
        effective: true,
        message: `${player.name} 被【闪电】击中！受到 3 点雷电伤害`,
        kind: 'shandian_hit',
      };
    }
    return {
      effective: false,
      message: `【闪电】判定未击中，将传给下家`,
      kind: 'shandian_pass',
    };
  }
  return { effective: false, message: '判定结束', kind: 'none' };
}

/**
 * 无懈过后：翻判定牌 →（鬼才等）→ 全员可见判定弹框
 */
function beginDelayedJudgeReveal(game, playerId, cardId) {
  const player = getPlayer(game, playerId);
  const card = cardById(game, cardId);
  if (!player || !player.alive || !card || !player.judges.includes(cardId)) {
    runJudgePhase(game);
    return;
  }
  const jid = drawJudgeCard(game);
  if (!jid) {
    discardCard(game, player, card.id, 'judge');
    runJudgePhase(game);
    return;
  }
  const jc = cardById(game, jid);
  game.discardPile.push(jid);
  game._currentJudgeCardId = jid;
  game._delayedJudgeCtx = { playerId, cardId };

  // 落英等：梅花进弃牌堆
  if (skillBus && jc && jc.suit === 'club') {
    for (const p of alivePlayers(game)) {
      if (p.id === player.id) continue;
      if (!p.skills || !p.skills.some((s) => s.id === 'luoying')) continue;
      skillBus.emit(game, 'afterClubToDiscard', {
        player: p,
        cardIds: [jid],
        fromPlayerId: player.id,
        reason: 'judge',
      });
      if (game.pending) {
        game.stack = game.stack || [];
        game.stack.push({
          resume: 'open_judge_reveal',
          _delayedJudgeCtx: { playerId, cardId },
        });
        return;
      }
    }
  }

  // 鬼才等：判定牌生效前
  if (skillBus) {
    game._skillResume = 'after_delayed_judge_skills';
    for (const p of alivePlayers(game)) {
      const r = skillBus.emit(game, 'beforeJudge', {
        player: p,
        judgeOwnerId: playerId,
        judgeCardId: game._currentJudgeCardId,
        delayedCardId: cardId,
      });
      if (r.pending) return;
    }
    game._skillResume = null;
  }
  openJudgeRevealPending(game);
}

function openJudgeRevealPending(game) {
  const ctx = game._delayedJudgeCtx;
  if (!ctx) {
    runJudgePhase(game);
    return;
  }
  const player = getPlayer(game, ctx.playerId);
  const card = cardById(game, ctx.cardId);
  const jid = game._currentJudgeCardId;
  const jc = jid ? cardById(game, jid) : null;
  if (!player || !card || !jc || !player.judges.includes(card.id)) {
    game._delayedJudgeCtx = null;
    game._currentJudgeCardId = null;
    runJudgePhase(game);
    return;
  }
  const outcome = computeDelayedJudgeOutcome(player, card, jc);
  pushLog(
    game,
    `${player.name} 判定【${card.name}】→ ${SUIT_LABEL[jc.suit]}${jc.number}`
  );
  setPending(game, {
    type: 'judge_reveal',
    playerId: player.id,
    askId: player.id,
    targetId: player.id,
    cardId: card.id,
    resultCardId: jid,
    cardName: card.name,
    message: `${player.name} 判定【${card.name}】`,
    outcomeEffective: outcome.effective,
    outcomeMessage: outcome.message,
    outcomeKind: outcome.kind,
    canPass: false,
  });
}

function applyDelayedJudgeOutcome(game, player, card, jc) {
  if (!player || !card) return;
  const outcome = computeDelayedJudgeOutcome(player, card, jc);

  if (card.subtype === 'lebu') {
    if (outcome.kind === 'lebu_skip') player.skipPlay = true;
    pushLog(game, outcome.message);
    discardCard(game, player, card.id, 'judge');
    return;
  }
  if (card.subtype === 'bingliang') {
    if (outcome.kind === 'bingliang_skip') player.skipDraw = true;
    pushLog(game, outcome.message);
    discardCard(game, player, card.id, 'judge');
    return;
  }
  if (card.subtype === 'shandian') {
    if (outcome.kind === 'shandian_hit') {
      pushLog(game, outcome.message);
      discardCard(game, player, card.id, 'judge');
      dealDamage(game, null, player.id, 3, {
        nature: 'thunder',
        reason: 'shandian',
      });
      return;
    }
    pushLog(game, outcome.message);
    discardCard(game, player, card.id, 'judge');
    const nextSeat = prevAliveSeat(game, player.seat);
    const next = game.players.find((x) => x.seat === nextSeat);
    if (
      next &&
      !next.judges.some((id) => cardById(game, id).subtype === 'shandian')
    ) {
      next.judges.push(card.id);
      game.discardPile = game.discardPile.filter((id) => id !== card.id);
      pushLog(game, `闪电传给 ${next.name}`);
    } else {
      player.judges.push(card.id);
      game.discardPile = game.discardPile.filter((id) => id !== card.id);
      pushLog(game, `闪电无法传递，仍在 ${player.name} 判定区`);
    }
    return;
  }
  discardCard(game, player, card.id, 'judge');
}

function openSkillJudgeRevealPending(game) {
  const ctx = game._skillJudgeCtx;
  if (!ctx) return;
  const meta = game._skillJudgeRevealMeta || {};
  const player = getPlayer(game, ctx.playerId);
  const jid = game._currentJudgeCardId || ctx.resultCardId;
  const jc = jid ? cardById(game, jid) : null;
  if (!player || !jc) {
    game._skillJudgeCtx = null;
    game._skillJudgeRevealMeta = null;
    if (typeof resumeAfterSkill === 'function') resumeAfterSkill(game);
    return;
  }
  ctx.resultCardId = jid;
  const outcome = skillJudgeFlow.computeSkillJudgeOutcome(
    ctx.skillId,
    player,
    jc,
    ctx.extra,
    { SUIT_COLOR, SUIT_LABEL }
  );
  const skillName = meta.skillName || ctx.skillId;
  pushLog(
    game,
    `${player.name} 【${skillName}】判定 → ${SUIT_LABEL[jc.suit]}${jc.number}`
  );
  setPending(game, {
    type: 'judge_reveal',
    judgeKind: 'skill',
    skillId: ctx.skillId,
    skillName,
    playerId: player.id,
    askId: player.id,
    targetId: player.id,
    cardId: null,
    cardName: skillName,
    resultCardId: jid,
    message: meta.message || `${player.name} 【${skillName}】判定`,
    outcomeEffective: outcome.effective,
    outcomeMessage: outcome.message,
    outcomeKind: outcome.kind,
    canPass: false,
  });
}

/**
 * 技能判定：翻牌展示 → 确认后结算（屯田/刚烈/铁骑/洛神/双雄/悲歌等）
 */
function beginSkillJudgeReveal(game, opts = {}) {
  const { playerId, skillId, skillName, message, extra } = opts;
  const player = getPlayer(game, playerId);
  if (!player || !player.alive || !skillId) return { ok: false };

  const jid = drawJudgeCard(game);
  if (!jid) {
    pushLog(
      game,
      `${player.name} 【${skillName || skillId}】判定失败（牌堆无牌）`
    );
    return { ok: false };
  }
  game.discardPile.push(jid);
  game._currentJudgeCardId = jid;
  game._skillJudgeCtx = {
    skillId,
    playerId,
    resultCardId: jid,
    extra: extra || {},
  };
  game._skillJudgeRevealMeta = {
    skillName: skillName || skillId,
    message,
  };

  if (skillBus) {
    game._skillResume = 'after_skill_judge_skills';
    for (const p of alivePlayers(game)) {
      const r = skillBus.emit(game, 'beforeJudge', {
        player: p,
        judgeOwnerId: playerId,
        judgeCardId: game._currentJudgeCardId,
        delayedCardId: null,
        skillId,
      });
      if (r.pending) return { ok: true };
    }
    game._skillResume = null;
  }
  openSkillJudgeRevealPending(game);
  game._skillJudgeRevealMeta = null;
  return { ok: true };
}

function finishSkillJudgeReveal(game, playerId, opts = {}) {
  const pend = game.pending;
  if (!pend || pend.type !== 'judge_reveal' || pend.judgeKind !== 'skill') {
    return { ok: false, error: '当前不是技能判定展示' };
  }
  if (pend.askId !== playerId) return { ok: false, error: '未轮到你' };
  if (!revealElapsedOk(pend, opts.force)) {
    return { ok: false, error: '展示中…' };
  }
  const ctx = game._skillJudgeCtx;
  clearPending(game);
  game._currentJudgeCardId = null;
  game._skillJudgeRevealMeta = null;

  if (ctx) {
    skillJudgeFlow.applySkillJudgeOutcome(game, ctx, {
      getPlayer,
      cardById,
      pushLog,
      setPending,
      drawCards,
      discardCard,
      dealDamage,
      recoverHp,
      SUIT_COLOR,
      SUIT_LABEL,
    });
    game._skillJudgeCtx = null;
  }

  if (game.pending) return { ok: true };
  if (typeof resumeAfterSkill === 'function') resumeAfterSkill(game);
  return { ok: true };
}

function finishJudgeReveal(game, playerId, opts = {}) {
  const pend = game.pending;
  if (!pend || pend.type !== 'judge_reveal') {
    return { ok: false, error: '当前不是判定展示' };
  }
  if (pend.judgeKind === 'bagua') {
    return finishBaguaJudgeReveal(game, playerId, opts);
  }
  if (pend.judgeKind === 'skill') {
    return finishSkillJudgeReveal(game, playerId, opts);
  }
  if (pend.askId !== playerId) return { ok: false, error: '未轮到你' };
  if (!revealElapsedOk(pend, opts.force)) {
    return { ok: false, error: '展示中…' };
  }
  const player = getPlayer(game, pend.playerId);
  const card = cardById(game, pend.cardId);
  const jid = pend.resultCardId || game._currentJudgeCardId;
  const jc = jid ? cardById(game, jid) : null;
  clearPending(game);
  game._currentJudgeCardId = null;
  game._delayedJudgeCtx = null;
  applyDelayedJudgeOutcome(game, player, card, jc);
  if (game.pending) {
    game.stack = game.stack || [];
    game.stack.push({ resume: 'judge_continue' });
    return { ok: true };
  }
  runJudgePhase(game);
  return { ok: true };
}

/** @deprecated 旧即时结算入口，保留给栈恢复兼容 */
function resolveDelayedJudge(game, player, card) {
  beginDelayedJudgeReveal(game, player.id, card.id);
}

function afterJudgePhase(game) {
  game.turnPhase = 'draw';
  const p = currentPlayer(game);
  if (p.skipDraw) {
    pushLog(game, `${p.name} 跳过摸牌阶段`);
    // 断粮等：跳过摸牌后触发
    for (const pl of alivePlayers(game)) {
      if (!pl.alive) continue;
      const r = skillBus.emit(game, 'afterSkipDraw', {
        player: pl,
        skippedId: p.id,
      });
      if (r.pending) return;
    }
    enterPlayPhase(game);
    return;
  }
  game._skillResume = 'after_draw_trigger';
  const r = skillBus.emit(game, 'phaseDraw', { player: p });
  if (r.pending) return;
  finishDrawPhase(game);
}

function enterPlayPhase(game) {
  const p = currentPlayer(game);
  game.turnPhase = 'play';
  if (p && p.alive) {
    game._skillResume = 'after_phase_play_ask';
    const r = skillBus.emit(game, 'phasePlay', { player: p });
    if (r.pending) return;
  }
  if (p && p.skipPlay) {
    pushLog(game, `${p.name} 跳过出牌阶段`);
    enterDiscardPhase(game);
  }
}

function enterDiscardPhase(game) {
  const p = currentPlayer(game);
  game.turnPhase = 'discard';
  game._skillResume = 'enter_discard';
  const r = skillBus.emit(game, 'phaseDiscard', { player: p });
  if (r.pending) return;
  doDiscardOrEnd(game);
}

function endTurn(game) {
  if (game.over) return;
  clearPending(game);
  game.turnPhase = 'end';
  const p = currentPlayer(game);
  if (p) pushLog(game, `【${p.name}】回合结束`);
  if (p && p.alive) {
    game._skillResume = 'after_phase_end';
    const r = skillBus.emit(game, 'phaseEnd', { player: p });
    if (r.pending) return;
  }
  advanceTurn(game);
}

function advanceTurn(game) {
  if (game.over) return;
  clearPending(game);
  if (game._extraTurnQueue && game._extraTurnQueue.length) {
    const nid = game._extraTurnQueue.shift();
    const np = getPlayer(game, nid);
    if (np && np.alive) {
      game.turnSeat = np.seat;
      pushLog(game, `${np.name} 开始额外回合`);
      startTurn(game);
      return;
    }
  }
  game.turnSeat = nextTurnSeat(game, game.turnSeat);
  startTurn(game);
}

function hasZhuge(player) {
  return player.equips.weapon && player.equips.weapon.subtype === 'zhuge';
}

function ignoreArmor(attacker) {
  return Boolean(
    attacker &&
      attacker.equips &&
      attacker.equips.weapon &&
      attacker.equips.weapon.subtype === 'qinggang'
  );
}

function armorBlocksSha(game, attacker, target, shaCard) {
  if (ignoreArmor(attacker)) return false;
  // 毅重：未装备防具时黑色杀无效
  if (
    (!target.equips.armor || !target.equips.armor.id) &&
    target.skills &&
    target.skills.some((s) => s.id === 'yizhong') &&
    !shaCard.nature &&
    SUIT_COLOR[shaCard.suit] === 'black'
  ) {
    return true;
  }
  const armor = target.equips.armor;
  if (!armor) return false;
  const nature = shaCard.nature || null;
  if (armor.subtype === 'renwang') {
    return !nature && SUIT_COLOR[shaCard.suit] === 'black';
  }
  if (armor.subtype === 'tengjia') {
    // 藤甲：普通杀无效
    return !nature;
  }
  return false;
}

function dealDamage(game, sourceId, targetId, amount, meta = {}) {
  const target = getPlayer(game, targetId);
  if (!target || !target.alive) return;
  let dmg = amount;
  const nature = meta.nature || null;
  // 闪电等：有伤害、无来源；正常伤害：sourceId 为伤害来源
  const hasSource = Boolean(sourceId);

  // 绝情：即将造成的伤害改为体力流失
  if (
    hasSource &&
    !meta._fromJueqing &&
    !meta._fromChain
  ) {
    const src0 = getPlayer(game, sourceId);
    if (src0 && src0.skills && src0.skills.some((s) => s.id === 'jueqing')) {
      loseHp(game, targetId, dmg, { reason: 'jueqing' });
      return;
    }
  }

  // 藤甲受火焰伤害 +1
  if (
    nature === 'fire' &&
    target.equips.armor &&
    target.equips.armor.subtype === 'tengjia' &&
    !(hasSource && ignoreArmor(getPlayer(game, sourceId)))
  ) {
    dmg += 1;
  }

  // 白银狮子：受到的伤害结算为 1
  if (
    dmg > 1 &&
    target.equips.armor &&
    target.equips.armor.subtype === 'baiyin' &&
    !(hasSource && ignoreArmor(getPlayer(game, sourceId)))
  ) {
    dmg = 1;
  }

  target.hp -= dmg;
  game.turnDamageTotal = (game.turnDamageTotal || 0) + dmg;
  const src = hasSource ? getPlayer(game, sourceId) : null;
  const natLabel =
    nature === 'fire' ? '火焰' : nature === 'thunder' ? '雷电' : '';
  let fromLabel = '无来源';
  if (meta.reason === 'shandian') fromLabel = '闪电';
  else if (src) fromLabel = src.name;
  let shaLabel = '';
  if (meta.fromSha) {
    shaLabel =
      nature === 'fire' ? '火杀' : nature === 'thunder' ? '雷杀' : '杀';
  }
  pushLog(
    game,
    shaLabel
      ? `${fromLabel} 的【${shaLabel}】对 ${target.name} 造成 ${dmg} 点${natLabel}伤害`
      : `${fromLabel} 对 ${target.name} 造成 ${dmg} 点${natLabel}伤害`
  );

  if (game.mode === 'xianzhu' && src && target.alive) {
    xz.onHuangjinTouch(game, src, target, makeXianzhuApi());
  }

  if (target.hp <= 0) {
    enterDying(game, target, {
      sourceId: hasSource ? sourceId : null,
      kind: 'damage',
      reason: meta.reason || null,
    });
  } else {
    game._skillResume = game._skillResume || 'after_damage';
    skillBus.emit(game, 'afterDamage', {
      player: target,
      sourceId: hasSource ? sourceId : null,
      amount: dmg,
      nature,
      reason: meta.reason || null,
      cardId: meta.cardId || null,
    });
    if (
      meta.fromSha &&
      src &&
      src.alive &&
      target.alive &&
      !game.pending
    ) {
      skillBus.emit(game, 'afterShaDamage', {
        player: src,
        targetId: target.id,
        sourceId: src.id,
        amount: dmg,
        cardId: meta.cardId || null,
      });
      // 悲歌等：通知其他持有者
      if (!game.pending) {
        for (const p of alivePlayers(game)) {
          if (p.id === src.id) continue;
          if (!p.skills || !p.skills.some((s) => s.id === 'beige')) continue;
          skillBus.emit(game, 'afterShaDamage', {
            player: p,
            targetId: target.id,
            sourceId: src.id,
            amount: dmg,
            cardId: meta.cardId || null,
          });
          if (game.pending) break;
        }
      }
    }
  }

  // 属性伤害传导铁索（仍保留原伤害来源性质：闪电传导仍无来源）
  if (
    (nature === 'fire' || nature === 'thunder') &&
    target.chained &&
    !meta._fromChain
  ) {
    target.chained = false;
    pushLog(game, `${target.name} 铁索解除并传导`);
    const srcForChain = sourceId != null ? getPlayer(game, sourceId) : null;
    const anchorSeat = srcForChain ? srcForChain.seat : target.seat;
    const chainTargets = chainDamageOrder(game, target.id, anchorSeat);
    for (const p of chainTargets) {
      p.chained = false;
      dealDamage(game, sourceId, p.id, amount, {
        nature,
        reason: meta.reason || null,
        _fromChain: true,
      });
      if (game.over) break;
    }
  }
}

/** 体力流失：扣体力，但不是伤害，无伤害来源（不触发击杀奖惩） */
function loseHp(game, targetId, amount, meta = {}) {
  const target = getPlayer(game, targetId);
  if (!target || !target.alive) return;
  const n = Math.max(0, amount | 0);
  if (n <= 0) return;
  target.hp -= n;
  pushLog(
    game,
    `${target.name} 失去 ${n} 点体力` +
      (meta.reason ? `（${meta.reason}）` : '')
  );
  if (target.hp <= 0) {
    enterDying(game, target, {
      sourceId: null,
      kind: 'loseHp',
      reason: meta.reason || null,
    });
  } else if (skillBus) {
    skillBus.emit(game, 'afterLoseHp', {
      player: target,
      amount: n,
      reason: meta.reason || null,
    });
  }
}

function getBaguaArmor(target) {
  if (!target) return null;
  let armor = target.equips && target.equips.armor;
  if (!armor || armor.subtype !== 'bagua') {
    try {
      const helpers = require('./hero/_infra_helpers');
      armor = helpers.effectiveArmor(target);
    } catch (_) {
      armor = null;
    }
  }
  if (!armor || armor.subtype !== 'bagua') return null;
  return armor;
}

function canOfferBagua(game, target, attacker) {
  if (!target || !target.alive) return false;
  if (attacker && ignoreArmor(attacker)) return false;
  return Boolean(getBaguaArmor(target));
}

function cloneAoePend(pend) {
  if (!pend) return null;
  return {
    type: pend.type,
    sourceId: pend.sourceId,
    victims: (pend.victims || []).slice(),
    index: pend.index,
    cardName: pend.cardName,
    cardId: pend.cardId,
    message: pend.message,
    _respondedCards: pend._respondedCards
      ? pend._respondedCards.slice()
      : [],
  };
}

function startBaguaOffer(game, ctx) {
  const target = getPlayer(game, ctx.targetId);
  if (!target) return { pending: false };
  game._baguaCtx = ctx;
  setPending(game, {
    type: 'bagua_ask',
    playerId: target.id,
    askId: target.id,
    sourceId: ctx.sourceId,
    message: '是否发动【八卦阵】进行判定？',
    canPass: true,
  });
  return { pending: true };
}

function continueAfterBaguaDecline(game, ctx) {
  if (!ctx) return { ok: true };
  game._baguaCtx = null;
  if (ctx.kind === 'sha') {
    setPending(game, ctx.shaRespondPend);
    return { ok: true };
  }
  if (ctx.kind === 'aoe_shan') {
    const pend = ctx.aoePend;
    const p = getPlayer(game, ctx.targetId);
    if (pend && p) {
      pend.askId = ctx.targetId;
      pend.message = `${pend.cardName}：${p.name} 请响应`;
      game.pending = pend;
      askAoe(game);
    }
    return { ok: true };
  }
  return { ok: true };
}

function beginBaguaJudge(game, ctx) {
  const target = getPlayer(game, ctx.targetId);
  const armor = getBaguaArmor(target);
  if (!target || !armor) {
    return continueAfterBaguaDecline(game, ctx);
  }
  const jid = drawJudgeCard(game);
  if (!jid) {
    return continueAfterBaguaDecline(game, ctx);
  }
  const jc = cardById(game, jid);
  game.discardPile.push(jid);
  game._currentJudgeCardId = jid;
  game._baguaCtx = { ...ctx, resultCardId: jid };

  const ok = SUIT_COLOR[jc.suit] === 'red';
  pushLog(
    game,
    `${target.name} 八卦阵${armor.virtual ? '(虚)' : ''}判定 ${SUIT_LABEL[jc.suit]}${jc.number} → ${
      ok ? '视为出闪' : '失败'
    }`
  );

  setPending(game, {
    type: 'judge_reveal',
    judgeKind: 'bagua',
    playerId: target.id,
    askId: target.id,
    targetId: target.id,
    cardId: armor.virtual ? null : armor.id,
    cardName: '八卦阵',
    resultCardId: jid,
    message: `${target.name} 【八卦阵】判定`,
    outcomeEffective: ok,
    outcomeMessage: ok
      ? '判定为红色，视为打出【闪】'
      : '判定为黑色，仍需打出【闪】或受到伤害',
    outcomeKind: ok ? 'bagua_shan' : 'bagua_fail',
    triggerCardId: armor.virtual ? null : armor.id,
    canPass: false,
  });
  return { ok: true };
}

function onBaguaAskResponse(game, playerId, pass) {
  const pend = game.pending;
  if (!pend || pend.type !== 'bagua_ask' || pend.askId !== playerId) {
    return { ok: false, error: '当前不是八卦阵询问' };
  }
  const ctx = game._baguaCtx;
  clearPending(game);
  if (pass) {
    return continueAfterBaguaDecline(game, ctx);
  }
  return beginBaguaJudge(game, ctx);
}

function resolveShaMissedAfterBagua(game, attacker, target, shaCardId) {
  if (
    attacker &&
    attacker.alive &&
    attacker.equips.weapon &&
    attacker.equips.weapon.subtype === 'qinglong'
  ) {
    attacker.shaUsed = Math.max(0, attacker.shaUsed - 1);
    pushLog(game, `${attacker.name} 青龙偃月刀：可再出一张【杀】`);
  }
  if (attacker && attacker.alive) {
    skillBus.emit(game, 'afterShaMissed', {
      player: attacker,
      targetId: target.id,
      cardId: shaCardId,
    });
  }
}

function finishBaguaJudgeReveal(game, playerId, opts = {}) {
  const pend = game.pending;
  if (!pend || pend.type !== 'judge_reveal' || pend.judgeKind !== 'bagua') {
    return { ok: false, error: '当前不是八卦阵判定' };
  }
  if (pend.askId !== playerId) return { ok: false, error: '未轮到你' };
  if (!revealElapsedOk(pend, opts.force)) {
    return { ok: false, error: '展示中…' };
  }
  const ctx = game._baguaCtx;
  const effective = Boolean(pend.outcomeEffective);
  clearPending(game);
  game._currentJudgeCardId = null;
  game._baguaCtx = null;

  if (!ctx) return { ok: true };

  if (ctx.kind === 'sha') {
    const sp = game._shaPend;
    const target = getPlayer(game, ctx.targetId);
    const attacker = getPlayer(game, ctx.sourceId);
    if (!sp || !target || !attacker) return { ok: true };
    if (effective) {
      moveToDiscard(game, [sp.cardId]);
      attacker.wineBuff = false;
      game._shaPend = null;
      pushLog(game, `${target.name} 八卦阵生效，【杀】被抵消`);
      resolveShaMissedAfterBagua(game, attacker, target, sp.cardId);
      return { ok: true };
    }
    setPending(game, ctx.shaRespondPend);
    return { ok: true };
  }

  if (ctx.kind === 'aoe_shan') {
    const pend = ctx.aoePend;
    const p = getPlayer(game, ctx.targetId);
    if (!pend || !p) return { ok: true };
    if (effective) {
      pushLog(game, `${p.name} 八卦阵生效，视为出【闪】`);
      pend.index += 1;
    } else {
      pend.askId = ctx.targetId;
      pend.message = `${pend.cardName}：${p.name} 请响应`;
    }
    game.pending = pend;
    askAoe(game);
    if (!game.pending) {
      for (const item of pend._respondedCards || []) {
        trickFlow.notifyAfterRespond(
          game,
          getPlayer(game, item.playerId),
          item.card
        );
        if (game.pending) break;
      }
    }
    return { ok: true };
  }

  return { ok: true };
}

function buildShaRespondPending(game, player, target, sp) {
  let needShan = 1;
  for (const q of skillBus.query(game, player, 'shaNeedShanCount')) {
    if (typeof q.value === 'number') needShan = Math.max(needShan, q.value);
  }
  const label = sp.label || '杀';
  return {
    type: 'respond_shan',
    playerId: target.id,
    sourceId: player.id,
    shaCardId: sp.cardId,
    nature: sp.nature,
    extraDamage: sp.extraDamage || 0,
    needShan,
    shanGot: 0,
    message:
      needShan > 1
        ? `${player.name} 的【${label}】（无双），请连续出 ${needShan} 张【闪】`
        : `${player.name} 的【${label}】，请出【闪】或取消`,
  };
}

function enterDying(game, target, deathMeta = {}) {
  // 兼容旧调用 enterDying(game, target, sourceId)
  if (typeof deathMeta === 'string' || deathMeta == null) {
    deathMeta = {
      sourceId: deathMeta || null,
      kind: 'damage',
    };
  }
  pushLog(game, `${target.name} 进入濒死（体力 ${target.hp}）`);

  // 不屈 / 涅槃等濒死技：先尝试自动/询问
  if (skillBus && target.hp <= 0) {
    game._dyingMeta = deathMeta;
    const r = skillBus.emit(game, 'whenDying', {
      player: target,
      sourceId: deathMeta.sourceId || null,
      dyingId: target.id,
    });
    if (r.pending) return;
    if (target.hp > 0) {
      clearPending(game);
      resumeAfterPending(game);
      return;
    }
    // 补益等：其他角色的濒死响应
    for (const p of alivePlayers(game)) {
      if (p.id === target.id) continue;
      if (
        !p.skills ||
        !p.skills.some((s) => s.id === 'buyi')
      ) {
        continue;
      }
      const r2 = skillBus.emit(game, 'otherDying', {
        player: p,
        dyingId: target.id,
        sourceId: deathMeta.sourceId || null,
      });
      if (r2.pending) return;
      if (target.hp > 0) {
        clearPending(game);
        resumeAfterPending(game);
        return;
      }
    }
  }

  const start = currentPlayer(game) || target;
  const order = resolveOrderFromPlayer(game, start.id, { includeSelf: true });
  // 完杀：当前回合拥有者回合内，仅濒死者与完杀拥有者可救
  const cur = currentPlayer(game);
  if (
    cur &&
    cur.alive &&
    cur.skills &&
    cur.skills.some((s) => s.id === 'wansha')
  ) {
    const allowed = new Set([target.id, cur.id]);
    for (let i = order.length - 1; i >= 0; i--) {
      if (!allowed.has(order[i])) order.splice(i, 1);
    }
    if (!order.includes(target.id)) order.unshift(target.id);
    if (!order.includes(cur.id)) order.push(cur.id);
  }
  setPending(game, {
    type: 'dying',
    targetId: target.id,
    sourceId: deathMeta.sourceId || null,
    deathKind: deathMeta.kind || 'damage',
    deathReason: deathMeta.reason || null,
    order,
    index: 0,
    message: `${target.name} 濒死，请求出【桃】`,
  });
  advanceDying(game);
}

function advanceDying(game) {
  const pend = game.pending;
  if (!pend || pend.type !== 'dying') return;
  const target = getPlayer(game, pend.targetId);
  if (!target || target.hp > 0) {
    clearPending(game);
    resumeAfterPending(game);
    return;
  }
  if (pend.index >= pend.order.length) {
    clearPending(game);
    killPlayer(game, target, {
      sourceId: pend.sourceId || null,
      kind: pend.deathKind || 'damage',
      reason: pend.deathReason || null,
    });
    return;
  }
  const askId = pend.order[pend.index];
  pend.askId = askId;
  pend.message = `${target.name} 濒死中，轮到 ${
    getPlayer(game, askId).name
  } 决定是否出【桃】`;
}

function makeXianzhuApi() {
  return {
    pushLog,
    setPending,
    clearPending,
    getPlayer,
    drawCards,
    discardCard,
    allCardsOf,
    findCardZone,
    currentPlayer,
    nextAliveSeat,
    startTurn,
    resumeAfterPending,
    checkWin,
    endGame,
    identityLabel: (id) => IDENTITY[id] || id,
  };
}

function killPlayer(game, dead, deathMeta = {}) {
  if (typeof deathMeta === 'string' || deathMeta == null) {
    deathMeta = { sourceId: deathMeta || null, kind: 'damage' };
  }
  const sourceId = deathMeta.sourceId || null;
  const deathKind = deathMeta.kind || 'damage';

  dead.alive = false;
  dead.hp = 0;
  // 1) 先翻出身份牌
  dead.identityRevealed = true;
  game.lastDeath = {
    playerId: dead.id,
    name: dead.name,
    identity: dead.identity,
  identityLabel: IDENTITY[dead.identity] || dead.identity,
    sourceId,
    kind: deathKind,
  };
  pushLog(
    game,
    `${dead.name} 死亡，身份牌翻开：【${IDENTITY[dead.identity]}】`
  );

  // 击杀连破播报（每人单独计数；无伤害来源不计数）
  const killer = sourceId ? getPlayer(game, sourceId) : null;
  let killCount = 0;
  if (killer && killer.id !== dead.id) {
    killCount = noteKillAnnounce(game, killer);
  }

  // 断肠等死亡技
  if (skillBus && dead.skills) {
    const { createCtx } = require('./hero/skillCtx');
    for (const s of dead.skills) {
      const raw = skillBus.findSkill(dead, s.id);
      if (raw && typeof raw.onDeath === 'function') {
        const ctx = createCtx(
          {
            pushLog,
            getPlayer,
            cardById,
            drawCards,
            discardCard,
            takeFromHand,
            dealDamage,
            loseHp,
            recoverHp,
            drawJudgeCard,
            setPending,
            clearPending,
            alivePlayers,
            inAttackRange,
            SUIT_COLOR,
            SUIT_LABEL,
            currentPlayer,
          },
          game,
          {
            player: dead,
            sourceId,
            deathMeta,
          }
        );
        raw.onDeath(ctx);
      }
    }
  }

  // 2) 弃置区域内所有牌
  for (const id of allCardsOf(dead)) {
    const z = findCardZone(dead, id);
    if (!z) continue;
    if (z.zone === 'hand') discardCard(game, dead, id, 'hand');
    else if (z.zone === 'judge') discardCard(game, dead, id, 'judge');
    else if (z.zone === 'equip') {
      dead.equips[z.slot] = null;
      game.discardPile.push(id);
    }
  }
  dead.hand = [];
  dead.judges = [];

  const xzApi = makeXianzhuApi();

  // 先主模式：后主阵亡连坐
  if (game.mode === 'xianzhu') {
    xz.onHouzhuDeath(game, dead, xzApi);
  }

  // 先主模式：先主阵亡且有忠臣 → 传位（暂缓判胜）
  if (game.mode === 'xianzhu' && xz.tryStartSuccession(game, dead, xzApi)) {
    return;
  }

  // 3) 先判断胜负；未结束再结算击杀奖惩
  checkWin(game);
  if (game.over) {
    // 击杀导致终局且该击杀者累计 ≥3：连破后再播「无双」
    if (killer && killCount >= 3) {
      pushAnnounce(game, killer, '无双');
    }
    return;
  }

  if (game.mode === 'xianzhu') {
    xz.maybeUprising(game, xzApi);
  }

  // 仅「有伤害来源的正常伤害击杀」才有奖惩；体力流失 / 闪电等无来源不触发
  const hasDamageSource =
    deathKind === 'damage' && sourceId && getPlayer(game, sourceId);

  if (game.mode === 'h2h') {
    const mate = game.players.find(
      (p) => p.alive && sameTeam(p, dead) && p.id !== dead.id
    );
    if (mate) {
      drawCards(game, mate, 1);
      pushLog(game, `${mate.name} 因队友阵亡补偿摸 1 张牌`);
    }
  } else if (game.mode === '1v2') {
    if (dead.identity === 'fan') {
      const other = game.players.find(
        (p) => p.alive && p.identity === 'fan' && p.id !== dead.id
      );
      if (other) {
        setPending(game, {
          type: 'rebel_compensate',
          playerId: other.id,
          message: '队友阵亡：选择摸 2 张牌，或回复 1 点体力',
        });
      }
    }
  } else if (hasDamageSource && game.mode === 'xianzhu') {
    const killer = getPlayer(game, sourceId);
    // 击杀反贼（含反贼后主）摸 3
    if (
      killer.alive &&
      (dead.identity === 'fan' ||
        (dead.identity === 'houzhu' && dead.houzhuOrigin === 'fan'))
    ) {
      drawCards(game, killer, 3);
      pushLog(game, `${killer.name} 击杀反贼，摸 3 张牌`);
    }
  } else if (hasDamageSource) {
    // 标准身份场：有伤害来源才结算奖惩
    const killer = getPlayer(game, sourceId);
    if (dead.identity === 'fan' && killer.alive) {
      drawCards(game, killer, 3);
      pushLog(game, `${killer.name} 击杀反贼，摸 3 张牌`);
    }
    if (dead.identity === 'zhong' && killer.identity === 'zhu' && killer.alive) {
      for (const id of [...killer.hand]) discardCard(game, killer, id, 'hand');
      for (const slot of Object.keys(killer.equips)) {
        if (killer.equips[slot]) {
          game.discardPile.push(killer.equips[slot].id);
          killer.equips[slot] = null;
        }
      }
      pushLog(game, `主公误杀忠臣，弃置所有手牌与装备`);
    }
  } else {
    // 身份场无来源死亡：不结算击杀奖惩
    if (deathKind === 'loseHp') {
      pushLog(game, `${dead.name} 因体力流失而死亡（无伤害来源，不结算击杀奖惩）`);
    } else if (deathMeta.reason === 'shandian') {
      pushLog(game, `${dead.name} 被闪电击杀（有伤害但无来源，不结算击杀奖惩）`);
    } else if (!sourceId) {
      pushLog(game, `${dead.name} 死亡无伤害来源，不结算击杀奖惩`);
    }
  }

  if (game.pending && game.pending.type === 'rebel_compensate') {
    return;
  }

  const cur = currentPlayer(game);
  if (!cur || cur.id === dead.id) {
    clearPending(game);
    game.turnSeat = nextTurnSeat(game, dead.seat);
    startTurn(game);
  } else {
    resumeAfterPending(game);
  }
}

function checkWin(game) {
  const alive = alivePlayers(game);

  if (game.mode === '1v2') {
    const zhu = game.players.find((p) => p.identity === 'zhu');
    const fans = alive.filter((p) => p.identity === 'fan');
    if (!zhu || !zhu.alive) {
      endGame(
        game,
        game.players.filter((p) => p.identity === 'fan').map((p) => p.id),
        '反贼击杀主公'
      );
      return;
    }
    if (fans.length === 0) {
      endGame(game, [zhu.id], '主公消灭全部反贼');
    }
    return;
  }

  if (game.mode === 'h2h') {
    const aAlive = alive.filter((p) => p.team === 'A');
    const bAlive = alive.filter((p) => p.team === 'B');
    if (aAlive.length === 0 && bAlive.length > 0) {
      endGame(
        game,
        bAlive.map((p) => p.id),
        `${IDENTITY[bAlive[0].identity]}阵营胜利`
      );
    } else if (bAlive.length === 0 && aAlive.length > 0) {
      endGame(
        game,
        aAlive.map((p) => p.id),
        `${IDENTITY[aAlive[0].identity]}阵营胜利`
      );
    }
    return;
  }

  if (game.mode === 'xianzhu') {
    xz.checkWinXianzhu(game, makeXianzhuApi());
    return;
  }

  const zhu = game.players.find((p) => p.identity === 'zhu');
  const zhuAlive = zhu && zhu.alive;

  if (!zhuAlive) {
    const fans = alive.filter((p) => p.identity === 'fan');
    if (fans.length > 0) {
      endGame(game, fans.map((p) => p.id), '反贼击杀主公');
      return;
    }
    const nei = alive.filter((p) => p.identity === 'nei');
    if (nei.length === 1 && alive.length === 1) {
      endGame(game, [nei[0].id], '内奸胜利');
      return;
    }
    if (nei.length && fans.length === 0) {
      endGame(game, nei.map((p) => p.id), '内奸胜利');
      return;
    }
    endGame(game, [], '主公阵亡');
    return;
  }

  const enemies = alive.filter(
    (p) => p.identity === 'fan' || p.identity === 'nei'
  );
  if (enemies.length === 0) {
    const winners = alive
      .filter((p) => p.identity === 'zhu' || p.identity === 'zhong')
      .map((p) => p.id);
    endGame(game, winners, '主公阵营胜利');
  }
}

function endGame(game, winnerIds, reason) {
  game.over = true;
  game.phase = 'game_over';
  game.winners = winnerIds;
  game.winReason = reason;
  clearPending(game);
  for (const p of game.players) p.identityRevealed = true;
  pushLog(game, `游戏结束：${reason}`);
}

function resumeAfterPending(game) {
  if (game.over) return;
  if (game.pending) return;
  if (game.stack && game.stack.length) {
    const top = game.stack.pop();
    if (top && typeof top === 'object' && top.resume) {
      // data-driven resume tags
      if (top.resume === 'after_sha_resolve') {
        // continue play phase
        return;
      }
      if (top.resume === 'judge_continue') {
        runJudgePhase(game);
        return;
      }
      if (top.resume === 'open_judge_reveal') {
        if (top._delayedJudgeCtx) {
          game._delayedJudgeCtx = top._delayedJudgeCtx;
        }
        openJudgeRevealPending(game);
        return;
      }
      if (top.resume === 'aoe_next') {
        continueAoe(game, top);
        return;
      }
      if (top.resume === 'skill_effect' && top.skill_effect) {
        setPending(game, top.skill_effect);
        return;
      }
      if (top.resume === 'juedou') {
        continueJuedou(game, top);
        return;
      }
    }
  }
  if (game.turnPhase === 'discard') {
    enterDiscardPhase(game);
  }
}

// ——— Card use ———

function useCard(game, playerId, cardId, targets = [], extra = {}) {
  const player = getPlayer(game, playerId);
  if (!player || !player.alive) return { ok: false, error: '角色无效' };
  if (game.phase !== 'playing') return { ok: false, error: '不在对局中' };
  if (game.pending) return { ok: false, error: '请先完成当前响应' };
  if (game.turnPhase !== 'play') return { ok: false, error: '非出牌阶段' };
  if (currentPlayer(game).id !== playerId) {
    return { ok: false, error: '不是你的回合' };
  }
  if (!takeFromPlayableZone(player, cardId)) {
    return { ok: false, error: '手牌或木牛流马上没有此牌' };
  }

  const card = cardById(game, cardId);
  if (!card) return { ok: false, error: '牌不存在' };

  // remove from hand first for equip/use
  const handlers = {
    杀: playSha,
    火杀: playSha,
    雷杀: playSha,
    闪: () => ({ ok: false, error: '【闪】不能主动打出' }),
    桃: playTao,
    酒: playJiu,
    无中生有: playWuzhong,
    过河拆桥: playGuohe,
    顺手牵羊: playShunshou,
    南蛮入侵: playNanman,
    万箭齐发: playWanjian,
    决斗: playJuedou,
    借刀杀人: playJiedao,
    桃园结义: playTaoyuan,
    五谷丰登: playWugu,
    铁索连环: playTiesuo,
    火攻: playHuogong,
    无懈可击: () => ({ ok: false, error: '【无懈可击】只能响应锦囊' }),
    乐不思蜀: playLebu,
    兵粮寸断: playBingliang,
    闪电: playShandian,
  };

  if (card.type === 'equip') {
    return playEquip(game, player, card);
  }

  const fn = handlers[card.name];
  if (!fn) return { ok: false, error: `暂未实现：${card.name}` };
  return fn(game, player, card, targets, extra);
}

function takeFromHand(player, cardId) {
  const i = player.hand.indexOf(cardId);
  if (i < 0) return false;
  player.hand.splice(i, 1);
  return true;
}

function takeFromMuniuPile(player, cardId) {
  const muniuEquip = require('./equip/muniu');
  return muniuEquip.removeFromMuniuPile(player, cardId);
}

function takeFromPlayableZone(player, cardId) {
  if (takeFromHand(player, cardId)) return 'hand';
  if (takeFromMuniuPile(player, cardId)) return 'muniu';
  return null;
}

function playEquip(game, player, card) {
  const muniuEquip = require('./equip/muniu');
  takeFromHand(player, card.id);
  const slot = card.slot;
  if (player.equips[slot]) {
    const old = player.equips[slot];
    if (old.subtype === 'muniu') muniuEquip.clearMuniuPile(player, game);
    game.discardPile.push(old.id);
    pushLog(game, `${player.name} 卸下 ${old.name}`);
    // 白银狮子离开装备区回复 1 体力
    if (old.subtype === 'baiyin' && player.hp < player.maxHp) {
      player.hp += 1;
      pushLog(game, `${player.name} 白银狮子效果：回复 1 点体力`);
    }
    skillBus.emit(game, 'afterLoseEquip', { player, cardId: old.id });
    muniuEquip.syncMuniuSkill(player);
  }
  player.equips[slot] = card;
  if (card.subtype === 'muniu') muniuEquip.syncMuniuSkill(player);
  pushLog(game, `${player.name} 装备【${card.name}】`);
  return { ok: true };
}

function playJiu(game, player, card) {
  if (game.turnPhase === 'play' && currentPlayer(game).id === player.id) {
    if (player.wineBuff || player.wineUsed >= 1) {
      return { ok: false, error: '本回合已使用过【酒】' };
    }
    takeFromHand(player, card.id);
    game.discardPile.push(card.id);
    player.wineBuff = true;
    player.wineUsed = 1;
    pushLog(game, `${player.name} 使用【酒】，下一张【杀】伤害 +1`);
    return { ok: true };
  }
  return { ok: false, error: '现在不能使用【酒】' };
}

function isJileiSkipped(game, playerId, cardId) {
  const p = getPlayer(game, playerId);
  if (!p) return false;
  const st = p.skillStates && p.skillStates.jileiSkip;
  if (st != null && (st === true || st === cardId)) return true;
  const gv = game._jileiSkip && game._jileiSkip[playerId];
  if (gv != null && (gv === true || gv === cardId)) return true;
  return false;
}

function clearJileiSkipForTrick(game, cardId) {
  if (!cardId) return;
  if (game._jileiSkip) {
    for (const pid of Object.keys(game._jileiSkip)) {
      const v = game._jileiSkip[pid];
      if (v === true || v === cardId) delete game._jileiSkip[pid];
    }
  }
  for (const p of game.players || []) {
    if (!p.skillStates || p.skillStates.jileiSkip == null) continue;
    const v = p.skillStates.jileiSkip;
    if (v === true || v === cardId) delete p.skillStates.jileiSkip;
  }
}

function initWhenTrickTargetQueue(game, source, card, targetIds) {
  const targets = (targetIds || []).filter((id) => {
    const p = getPlayer(game, id);
    return p && p.alive;
  });
  game._trickTargetQueue = {
    sourceId: source.id,
    cardId: card.id,
    card,
    cardName: card.name,
    targets,
    index: 0,
  };
}

function advanceWhenTrickTarget(game) {
  const q = game._trickTargetQueue;
  if (!q) return { pending: false };
  while (q.index < q.targets.length) {
    const tid = q.targets[q.index];
    q.index += 1;
    const player = getPlayer(game, tid);
    if (!player || !player.alive) continue;
    const r = skillBus.emit(game, 'whenTrickTarget', {
      player,
      sourceId: q.sourceId,
      source: getPlayer(game, q.sourceId),
      cardId: q.cardId,
      card: q.card,
      cardName: q.cardName,
      targets: q.targets,
      targetIds: q.targets,
    });
    if (r.pending) return { pending: true };
  }
  game._trickTargetQueue = null;
  return { pending: false };
}

function beginTrickTargetPhase(game, source, card, targetIds, trickPend) {
  game._trickPend = trickPend;
  game._skillResume = 'after_trick_targets';
  initWhenTrickTargetQueue(game, source, card, targetIds);
  return advanceWhenTrickTarget(game);
}

function continueTrickAfterTargets(game) {
  const tp = game._trickPend;
  game._trickPend = null;
  game._skillResume = null;
  if (!tp) return { ok: true };

  const cardId = tp.cardId;

  switch (tp.kind) {
    case 'tiesuo': {
      const src = getPlayer(game, tp.playerId);
      for (const tid of tp.targets || []) {
        const t = getPlayer(game, tid);
        if (!t || !t.alive) continue;
        if (isJileiSkipped(game, tid, cardId)) {
          pushLog(game, `${t.name} 不受【铁索连环】影响（鸡肋）`);
          continue;
        }
        t.chained = !t.chained;
        pushLog(
          game,
          `${src ? src.name : '某角色'} 令 ${t.name} ${
            t.chained ? '进入横置' : '解除横置'
          }`
        );
      }
      clearJileiSkipForTrick(game, cardId);
      break;
    }
    case 'taoyuan': {
      const src = getPlayer(game, tp.playerId);
      for (const p of alivePlayers(game)) {
        if (isJileiSkipped(game, p.id, cardId)) {
          pushLog(game, `${p.name} 不受【桃园结义】影响（鸡肋）`);
          continue;
        }
        recoverHp(game, src, p, 1);
      }
      clearJileiSkipForTrick(game, cardId);
      break;
    }
    case 'aoe_sha':
    case 'aoe_shan': {
      setPending(game, {
        type: tp.kind,
        sourceId: tp.sourceId,
        victims: tp.victims,
        index: 0,
        cardName: tp.cardName,
        cardId: tp.cardId,
        message: tp.message,
      });
      askAoe(game);
      break;
    }
    case 'wugu': {
      setPending(game, {
        type: 'wugu',
        order: tp.order,
        index: 0,
        shown: tp.shown,
        cardId: tp.cardId,
        message: '五谷丰登：选择一张牌',
      });
      askWugu(game);
      break;
    }
    default:
      clearJileiSkipForTrick(game, cardId);
      break;
  }
  return { ok: true };
}

function playTiesuo(game, player, card, targets) {
  takeFromHand(player, card.id);
  game.discardPile.push(card.id);
  // 重铸（重置）：弃置后摸 1，不算「使用」，不触发集智等，也不播出牌语音
  if (!targets || targets.length === 0) {
    drawCards(game, player, 1);
    pushLog(game, `${player.name} 重铸【铁索连环】摸 1 张`);
    return { ok: true };
  }
  trickFlow.notifyAfterUseCard(game, player, card);
  const named = [];
  for (const tid of targets.slice(0, 2)) {
    const t = getPlayer(game, tid);
    if (!t || !t.alive) continue;
    named.push(t.name);
  }
  if (named.length) {
    pushLog(
      game,
      `${player.name} 对 ${named.join('、')} 使用【铁索连环】`
    );
  } else {
    pushLog(game, `${player.name} 使用【铁索连环】`);
  }
  const validTargets = [];
  for (const tid of targets.slice(0, 2)) {
    const t = getPlayer(game, tid);
    if (t && t.alive) validTargets.push(t.id);
  }
  const r = beginTrickTargetPhase(game, player, card, validTargets, {
    kind: 'tiesuo',
    playerId: player.id,
    cardId: card.id,
    targets: validTargets,
  });
  if (r.pending) return { ok: true };
  return continueTrickAfterTargets(game);
}

function playHuogong(game, player, card, targets) {
  const tid = targets[0];
  const target = getPlayer(game, tid);
  if (!target || !target.alive || target.id === player.id) {
    return { ok: false, error: '目标无效' };
  }
  if (!target.hand.length) return { ok: false, error: '目标没有手牌' };
  takeFromHand(player, card.id);
  game.discardPile.push(card.id);
  pushLog(game, `${player.name} 对 ${target.name} 使用【火攻】`);
  trickFlow.notifyAfterUseCard(game, player, card);
  setPending(game, {
    type: 'huogong_show',
    playerId: target.id,
    askId: target.id,
    sourceId: player.id,
    targetId: target.id,
    message: '火攻：请选择并展示一张手牌',
  });
  return { ok: true };
}

function recoverHp(game, source, target, amount) {
  if (!target || !target.alive) return 0;
  const wasDying = target.hp <= 0;
  const add = Math.min(Math.max(0, amount | 0), target.maxHp - target.hp);
  if (add <= 0) return 0;
  target.hp += add;
  pushLog(game, `${target.name} 回复 ${add} 点体力`);
  noteRecoverAnnounce(game, target, add);
  if (wasDying && target.hp > 0 && source && source.id !== target.id) {
    noteDyingSaveAnnounce(game, source);
  }
  if (game.mode === 'xianzhu' && source) {
    xz.onHuangjinTouch(game, source, target, makeXianzhuApi());
  }
  if (skillBus) {
    skillBus.emit(game, 'afterRecover', {
      player: target,
      sourceId: source ? source.id : null,
      amount: add,
    });
  }
  return add;
}

function playTao(game, player, card, targets) {
  const tid = targets[0] || player.id;
  const target = getPlayer(game, tid);
  if (!target || !target.alive) return { ok: false, error: '目标无效' };
  if (target.hp >= target.maxHp) return { ok: false, error: '体力已满' };
  takeFromHand(player, card.id);
  game.discardPile.push(card.id);
  recoverHp(game, player, target, 1);
  pushLog(game, `${player.name} 对 ${target.name} 使用【桃】`);
  return { ok: true };
}

function playWuzhong(game, player, card) {
  takeFromHand(player, card.id);
  game.discardPile.push(card.id);
  pushLog(game, `${player.name} 使用【无中生有】摸 2 张`);
  trickFlow.notifyAfterUseCard(game, player, card);
  drawCards(game, player, 2);
  return { ok: true };
}

function playTaoyuan(game, player, card) {
  takeFromHand(player, card.id);
  game.discardPile.push(card.id);
  pushLog(game, `${player.name} 使用【桃园结义】`);
  trickFlow.notifyAfterUseCard(game, player, card);
  const targetIds = alivePlayers(game).map((p) => p.id);
  const r = beginTrickTargetPhase(game, player, card, targetIds, {
    kind: 'taoyuan',
    playerId: player.id,
    cardId: card.id,
  });
  if (r.pending) return { ok: true };
  return continueTrickAfterTargets(game);
}

function playLebu(game, player, card, targets) {
  const tid = targets[0];
  const target = getPlayer(game, tid);
  if (!target || !target.alive || target.id === player.id) {
    return { ok: false, error: '目标无效' };
  }
  const blocked = skillBus.query(game, target, 'canBeTarget', {
    cardName: '乐不思蜀',
    card,
  });
  if (blocked.some((x) => x.value === false)) {
    return { ok: false, error: '目标不能成为【乐不思蜀】的目标' };
  }
  if (target.judges.some((id) => cardById(game, id).subtype === 'lebu')) {
    return { ok: false, error: '判定区已有乐不思蜀' };
  }
  takeFromHand(player, card.id);
  target.judges.push(card.id);
  pushLog(game, `${player.name} 对 ${target.name} 使用【乐不思蜀】`);
  trickFlow.notifyAfterUseCard(game, player, card);
  return { ok: true };
}

function playBingliang(game, player, card, targets) {
  const tid = targets[0];
  const target = getPlayer(game, tid);
  if (!target || !target.alive || target.id === player.id) {
    return { ok: false, error: '目标无效' };
  }
  let maxDist = 1;
  for (const q of skillBus.query(game, player, 'bingliangMaxDistance')) {
    if (typeof q.value === 'number' && q.value > maxDist) maxDist = q.value;
  }
  if (distance(game, player.id, target.id) > maxDist) {
    return { ok: false, error: `兵粮寸断要求距离不超过 ${maxDist}` };
  }
  const blockedBl = skillBus.query(game, target, 'canBeTarget', {
    cardName: '兵粮寸断',
    card,
  });
  if (blockedBl.some((x) => x.value === false)) {
    return { ok: false, error: '目标不能成为【兵粮寸断】的目标' };
  }
  if (target.judges.some((id) => cardById(game, id).subtype === 'bingliang')) {
    return { ok: false, error: '判定区已有兵粮寸断' };
  }
  takeFromHand(player, card.id);
  target.judges.push(card.id);
  pushLog(game, `${player.name} 对 ${target.name} 使用【兵粮寸断】`);
  trickFlow.notifyAfterUseCard(game, player, card);
  return { ok: true };
}

function playShandian(game, player, card) {
  if (player.judges.some((id) => cardById(game, id).subtype === 'shandian')) {
    return { ok: false, error: '判定区已有闪电' };
  }
  takeFromHand(player, card.id);
  player.judges.push(card.id);
  pushLog(game, `${player.name} 使用【闪电】`);
  trickFlow.notifyAfterUseCard(game, player, card);
  return { ok: true };
}

function playSha(game, player, card, targets, extra = {}) {
  const limit = shaLimit(game, player);
  const ignoreCount = Boolean(extra.ignoreShaCount);
  if (!ignoreCount && player.shaUsed >= limit) {
    return { ok: false, error: `本回合【杀】已达上限（${limit}）` };
  }
  const tid = targets[0];
  const target = getPlayer(game, tid);
  if (!target || !target.alive || target.id === player.id) {
    return { ok: false, error: '请选择攻击范围内的目标' };
  }
  const ignoreDist =
    Boolean(extra.ignoreDistance) ||
    (player.skillStates && player.skillStates.paoxiaoNoDistance);
  if (!ignoreDist && !inAttackRange(game, player.id, target.id)) {
    return { ok: false, error: '目标不在攻击范围' };
  }
  const blockTarget = skillBus.query(game, target, 'canBeTarget', {
    cardName: card.name,
    card,
  });
  if (blockTarget.some((x) => x.value === false)) {
    return { ok: false, error: '目标不能成为【杀】的目标' };
  }

  let nature = card.nature || null;
  if (
    !nature &&
    player.equips.weapon &&
    player.equips.weapon.subtype === 'zhuque'
  ) {
    nature = 'fire';
  }
  const shaView = { ...card, nature };

  takeFromHand(player, card.id);
  moveToDiscard(game, [card.id]);
  if (!ignoreCount) player.shaUsed += 1;
  player.skillStates = player.skillStates || {};
  player.skillStates.usedShaInPlay = true;
  const label =
    nature === 'fire' ? '火杀' : nature === 'thunder' ? '雷杀' : '杀';
  pushLog(game, `${player.name} 对 ${target.name} 使用【${label}】`);

  skillBus.emit(game, 'afterUseSha', { player, cardId: card.id, targetId: target.id });
  skillBus.emit(game, 'afterUseHand', { player, cardId: card.id, card });

  game._shaPend = {
    attackerId: player.id,
    targetId: target.id,
    cardId: card.id,
    nature,
    label,
    noShan: false,
  };
  game._skillResume = 'after_sha_skills';
  let r = skillBus.emit(game, 'whenShaTarget', {
    player: target,
    sourceId: player.id,
    cardId: card.id,
  });
  if (r.pending) return { ok: true };
  r = skillBus.emit(game, 'afterShaSpecify', {
    player,
    targetId: game._shaPend.targetId,
    cardId: card.id,
  });
  if (r.pending) return { ok: true };
  return continueShaAfterSkills(game);
}

function continueShaAfterSkills(game) {
  const sp = game._shaPend;
  if (!sp) return { ok: true };
  const player = getPlayer(game, sp.attackerId);
  const target = getPlayer(game, sp.targetId);
  const card = cardById(game, sp.cardId);
  if (!player || !target || !target.alive || !card) {
    game._shaPend = null;
    return { ok: true };
  }
  const shaView = { ...card, nature: sp.nature };

  if (armorBlocksSha(game, player, target, shaView)) {
    const reason =
      target.equips.armor && target.equips.armor.subtype === 'tengjia'
        ? '藤甲抵挡普通【杀】'
        : !target.equips.armor && target.skills && target.skills.some((s) => s.id === 'yizhong')
          ? '毅重抵挡黑色【杀】'
          : '仁王盾抵挡黑色【杀】';
    pushLog(game, `${target.name} 的${reason}`);
    moveToDiscard(game, [card.id]);
    player.wineBuff = false;
    game._shaPend = null;
    return { ok: true };
  }

  if (!ignoreArmor(player) && canOfferBagua(game, target, player) && !sp.noShan) {
    startBaguaOffer(game, {
      kind: 'sha',
      targetId: target.id,
      sourceId: player.id,
      shaRespondPend: buildShaRespondPending(game, player, target, sp),
    });
    return { ok: true };
  }

  let needShan = 1;
  for (const q of skillBus.query(game, player, 'shaNeedShanCount')) {
    if (typeof q.value === 'number') needShan = Math.max(needShan, q.value);
  }

  if (sp.noShan) {
    return resolveShaHit(game, player, target, card, sp.nature, sp.extraDamage || 0);
  }

  setPending(game, {
    type: 'respond_shan',
    playerId: target.id,
    sourceId: player.id,
    shaCardId: card.id,
    nature: sp.nature,
    extraDamage: sp.extraDamage || 0,
    needShan,
    shanGot: 0,
    message:
      needShan > 1
        ? `${player.name} 的【${sp.label}】（无双），请连续出 ${needShan} 张【闪】`
        : `${player.name} 的【${sp.label}】，请出【闪】或取消`,
  });
  return { ok: true };
}

function resolveShaHit(game, player, target, shaCard, nature, extraDamage = 0) {
  moveToDiscard(game, [shaCard.id]);
  clearPending(game);
  game._shaPend = null;
  let dmg = 1 + (extraDamage | 0);
  if (player.wineBuff) {
    dmg += 1;
    player.wineBuff = false;
    pushLog(game, `${player.name} 的【酒】使伤害 +1`);
  }
  if (player.skillStates && player.skillStates.luoyiBuff) {
    dmg += 1;
    pushLog(game, `${player.name} 裸衣：伤害 +1`);
  }
  if (
    player.equips.weapon &&
    player.equips.weapon.subtype === 'guding' &&
    target.hand.length === 0
  ) {
    dmg += 1;
    pushLog(game, '古锭刀：目标无手牌，伤害 +1');
  }
  if (
    player.equips.weapon &&
    player.equips.weapon.subtype === 'hanbing' &&
    allCardsOf(target).length > 0
  ) {
    setPending(game, {
      type: 'hanbing',
      playerId: player.id,
      targetId: target.id,
      nature,
      cardIds: allCardsOf(target),
      message: '寒冰剑：可弃置目标两张牌代替造成伤害，或造成伤害',
    });
    return { ok: true };
  }
  dealDamage(game, player.id, target.id, dmg, {
    nature,
    cardId: shaCard.id,
    fromSha: true,
  });
  if (game.pending) return { ok: true };
  if (
    player.alive &&
    target.alive &&
    player.equips.weapon &&
    player.equips.weapon.subtype === 'qilin'
  ) {
    const mounts = [];
    if (target.equips.horseMinus) mounts.push(target.equips.horseMinus.id);
    if (target.equips.horsePlus) mounts.push(target.equips.horsePlus.id);
    if (mounts.length) {
      setPending(game, {
        type: 'qilin',
        playerId: player.id,
        targetId: target.id,
        mounts,
        message: '麒麟弓：可弃置目标一张坐骑',
      });
    }
  }
  return { ok: true };
}

function maybeQinglong() {
  // placeholder: player can simply play another sha if weapon allows via zhuge or after miss - qinglong allows another sha after shan; we increment allowing by decreasing shaUsed
}

function onShanResponse(game, playerId, cardId, pass) {
  const pend = game.pending;
  if (!pend || pend.type !== 'respond_shan' || pend.playerId !== playerId) {
    return { ok: false, error: '当前无需出闪' };
  }
  const target = getPlayer(game, playerId);
  const attacker = getPlayer(game, pend.sourceId);
  const shaCard = cardById(game, pend.shaCardId);

  if (!pass) {
    if (!cardId || !target.hand.includes(cardId)) {
      return { ok: false, error: '请选择【闪】' };
    }
    const c = cardById(game, cardId);
    if (!c || c.name !== '闪') return { ok: false, error: '必须是【闪】' };
    discardCard(game, target, cardId, 'hand');
    pushLog(game, `${target.name} 打出【闪】`);
    pend._respondedCards = pend._respondedCards || [];
    pend._respondedCards.push({ playerId: target.id, cardId, card: c });
    pend.shanGot = (pend.shanGot || 0) + 1;
    const need = pend.needShan || 1;
    if (pend.shanGot < need) {
      pend.message = `还需再出 ${need - pend.shanGot} 张【闪】`;
      return { ok: true };
    }
    const responded = pend._respondedCards.slice();
    moveToDiscard(game, [pend.shaCardId]);
    clearPending(game);
    game._shaPend = null;
    for (const item of responded) {
      const p = getPlayer(game, item.playerId);
      trickFlow.notifyAfterRespond(game, p, item.card);
      if (game.pending) return { ok: true };
    }
    if (
      attacker.equips.weapon &&
      attacker.equips.weapon.subtype === 'qinglong'
    ) {
      attacker.shaUsed = Math.max(0, attacker.shaUsed - 1);
      pushLog(game, `${attacker.name} 青龙偃月刀：可再出一张【杀】`);
    }
    if (
      attacker.equips.weapon &&
      attacker.equips.weapon.subtype === 'guanshi'
    ) {
      setPending(game, {
        type: 'guanshi',
        playerId: attacker.id,
        targetId: target.id,
        shaCardId: pend.shaCardId,
        message: '贯石斧：可弃 2 张牌强制命中',
      });
      return { ok: true };
    }
    // 杀被闪抵消
    if (attacker && attacker.alive) {
      skillBus.emit(game, 'afterShaMissed', {
        player: attacker,
        targetId: target.id,
        cardId: pend.shaCardId,
      });
    }
    return { ok: true };
  }

  return resolveShaHit(
    game,
    attacker,
    target,
    shaCard || { id: pend.shaCardId, nature: pend.nature },
    pend.nature,
    pend.extraDamage || 0
  );
}

function playGuohe(game, player, card, targets) {
  const tid = targets[0];
  const target = getPlayer(game, tid);
  if (!target || !target.alive || target.id === player.id) {
    return { ok: false, error: '目标无效' };
  }
  const blocked = skillBus.query(game, target, 'canBeTarget', {
    cardName: '过河拆桥',
    card,
  });
  if (blocked.some((x) => x.value === false)) {
    return { ok: false, error: '目标不能成为【过河拆桥】的目标' };
  }
  if (
    skillBus
      .query(game, player, 'trickInvalid', {
        cardName: '过河拆桥',
        card,
        targetId: target.id,
        sourceId: player.id,
      })
      .some((x) => x.value)
  ) {
    return { ok: false, error: '无言：此锦囊对其他角色无效' };
  }
  const cards = allCardsOf(target);
  if (!cards.length) return { ok: false, error: '目标没有牌' };
  takeFromHand(player, card.id);
  game.discardPile.push(card.id);
  pushLog(game, `${player.name} 对 ${target.name} 使用【过河拆桥】`);
  trickFlow.notifyAfterUseCard(game, player, card);
  setPending(game, {
    type: 'choose_discard_target_card',
    playerId: player.id,
    targetId: target.id,
    cardIds: cards,
    message: '选择弃置目标一张牌',
  });
  return { ok: true };
}

function playShunshou(game, player, card, targets) {
  const tid = targets[0];
  const target = getPlayer(game, tid);
  if (!target || !target.alive || target.id === player.id) {
    return { ok: false, error: '目标无效' };
  }
  const blocked = skillBus.query(game, target, 'canBeTarget', {
    cardName: '顺手牵羊',
    card,
  });
  if (blocked.some((x) => x.value === false)) {
    return { ok: false, error: '目标不能成为【顺手牵羊】的目标' };
  }
  if (
    skillBus
      .query(game, player, 'trickInvalid', {
        cardName: '顺手牵羊',
        card,
        targetId: target.id,
        sourceId: player.id,
      })
      .some((x) => x.value)
  ) {
    return { ok: false, error: '无言：此锦囊对其他角色无效' };
  }
  if (distance(game, player.id, target.id) !== 1) {
    return { ok: false, error: '顺手牵羊要求距离为 1' };
  }
  const cards = allCardsOf(target);
  if (!cards.length) return { ok: false, error: '目标没有牌' };
  takeFromHand(player, card.id);
  game.discardPile.push(card.id);
  pushLog(game, `${player.name} 对 ${target.name} 使用【顺手牵羊】`);
  trickFlow.notifyAfterUseCard(game, player, card);
  setPending(game, {
    type: 'choose_gain_target_card',
    playerId: player.id,
    targetId: target.id,
    cardIds: cards,
    message: '选择获得目标一张牌',
  });
  return { ok: true };
}

function playNanman(game, player, card) {
  takeFromHand(player, card.id);
  game.discardPile.push(card.id);
  pushLog(game, `${player.name} 使用【南蛮入侵】`);
  trickFlow.notifyAfterUseCard(game, player, card);
  const victims = resolveOrderFromPlayer(game, player.id, {
    includeSelf: false,
  }).filter((id) => {
    const p = getPlayer(game, id);
    const blocked = skillBus.query(game, p, 'canBeTarget', {
      cardName: '南蛮入侵',
      card,
    });
    if (blocked.some((x) => x.value === false)) {
      pushLog(game, `${p.name} 不受【南蛮入侵】影响`);
      return false;
    }
    return true;
  });
  const r = beginTrickTargetPhase(game, player, card, victims, {
    kind: 'aoe_sha',
    sourceId: player.id,
    cardId: card.id,
    cardName: '南蛮入侵',
    victims,
    message: '南蛮入侵：请打出【杀】',
  });
  if (r.pending) return { ok: true };
  return continueTrickAfterTargets(game);
}

function isWanjianImmune(game, player, card) {
  if (!player || !player.alive) return true;
  if (
    player.equips.armor &&
    player.equips.armor.subtype === 'tengjia'
  ) {
    return true;
  }
  const blocked = skillBus.query(game, player, 'canBeTarget', {
    cardName: '万箭齐发',
    card,
  });
  return blocked.some((x) => x.value === false);
}

function playWanjian(game, player, card) {
  takeFromHand(player, card.id);
  game.discardPile.push(card.id);
  pushLog(game, `${player.name} 使用【万箭齐发】`);
  trickFlow.notifyAfterUseCard(game, player, card);
  const victims = resolveOrderFromPlayer(game, player.id, {
    includeSelf: false,
  }).filter((id) => {
    const p = getPlayer(game, id);
    if (!isWanjianImmune(game, p, card)) return true;
    pushLog(
      game,
      `${p.name} 不受【万箭齐发】影响${
        p.equips.armor && p.equips.armor.subtype === 'tengjia'
          ? '（藤甲）'
          : ''
      }`
    );
    return false;
  });
  const r = beginTrickTargetPhase(game, player, card, victims, {
    kind: 'aoe_shan',
    sourceId: player.id,
    cardId: card.id,
    cardName: '万箭齐发',
    victims,
    message: '万箭齐发：请打出【闪】',
  });
  if (r.pending) return { ok: true };
  return continueTrickAfterTargets(game);
}

function askAoe(game) {
  const pend = game.pending;
  if (!pend || (pend.type !== 'aoe_sha' && pend.type !== 'aoe_shan')) return;
  while (pend.index < pend.victims.length) {
    const id = pend.victims[pend.index];
    const p = getPlayer(game, id);
    if (p && p.alive) {
      if (isJileiSkipped(game, id, pend.cardId)) {
        pushLog(
          game,
          `${p.name} 不受【${pend.cardName}】影响（鸡肋）`
        );
        pend.index += 1;
        continue;
      }
      if (
        pend.type === 'aoe_shan' &&
        isWanjianImmune(
          game,
          p,
          pend.cardId ? cardById(game, pend.cardId) : null
        )
      ) {
        pushLog(
          game,
          `${p.name} 不受【万箭齐发】影响${
            p.equips.armor && p.equips.armor.subtype === 'tengjia'
              ? '（藤甲）'
              : ''
          }`
        );
        pend.index += 1;
        continue;
      }
      if (
        pend.type === 'aoe_shan' &&
        canOfferBagua(game, p, getPlayer(game, pend.sourceId))
      ) {
        startBaguaOffer(game, {
          kind: 'aoe_shan',
          targetId: id,
          sourceId: pend.sourceId,
          aoePend: cloneAoePend(pend),
        });
        return;
      }
      pend.askId = id;
      pend.message = `${pend.cardName}：${p.name} 请响应`;
      return;
    }
    pend.index += 1;
  }
  const settled = { ...pend };
  clearPending(game);
  clearJileiSkipForTrick(game, settled.cardId);
  // 巨象等：AOE 结算后
  for (const pl of alivePlayers(game)) {
    if (!pl.alive) continue;
    const r = skillBus.emit(game, 'afterAoeSettle', {
      player: pl,
      cardName: settled.cardName,
      cardId: settled.cardId || null,
      sourceId: settled.sourceId,
    });
    if (r.pending) return;
  }
}

function continueAoe(game, top) {
  if (!top || !top.aoe) return;
  if (game.over) return;
  if (game.pending) {
    game.stack.push(top);
    return;
  }
  const pend = { ...top.aoe };
  game.pending = pend;
  askAoe(game);
  if (!game.pending) {
    for (const item of pend._respondedCards || []) {
      trickFlow.notifyAfterRespond(
        game,
        getPlayer(game, item.playerId),
        item.card
      );
      if (game.pending) break;
    }
  }
}

function continueJuedou(game, top) {
  if (top && top.juedou) {
    setPending(game, top.juedou);
  }
}

function onAoeResponse(game, playerId, cardId, pass) {
  const pend = game.pending;
  if (!pend || pend.askId !== playerId) return { ok: false, error: '不是你响应' };
  const p = getPlayer(game, playerId);
  if (!pass) {
    if (!cardId || !p.hand.includes(cardId)) {
      return { ok: false, error: '请选择卡牌' };
    }
    const c = cardById(game, cardId);
    if (pend.type === 'aoe_sha' && !isShaName(c.name)) {
      return { ok: false, error: '需打出【杀】' };
    }
    if (pend.type === 'aoe_shan' && c.name !== '闪') {
      return { ok: false, error: '需打出【闪】' };
    }
    discardCard(game, p, cardId, 'hand');
    pushLog(game, `${p.name} 打出【${c.name}】`);
    pend._respondedCards = pend._respondedCards || [];
    pend._respondedCards.push({ playerId: p.id, card: c });
  } else {
    dealDamage(game, pend.sourceId, playerId, 1, {
      cardId: pend.cardId || null,
      reason: pend.cardName || null,
    });
  }
  pend.index += 1;

  // 伤害触发濒死 / 奸雄等技能询问：挂起 AOE，待 resume 后继续
  if (game.pending && game.pending.type !== pend.type) {
    game.stack.push({
      resume: 'aoe_next',
      aoe: cloneAoePend({ ...pend, index: pend.index }),
    });
    return { ok: true };
  }
  if (game.over) return { ok: true };

  game.pending = pend;
  askAoe(game);
  if (!game.pending) {
    for (const item of pend._respondedCards || []) {
      trickFlow.notifyAfterRespond(
        game,
        getPlayer(game, item.playerId),
        item.card
      );
      if (game.pending) break;
    }
  }
  return { ok: true };
}

function playJuedou(game, player, card, targets) {
  const tid = targets[0];
  const target = getPlayer(game, tid);
  if (!target || !target.alive || target.id === player.id) {
    return { ok: false, error: '目标无效' };
  }
  return trickFlow.startJuedou(game, player.id, target.id, { card });
}

function onJuedouResponse(game, playerId, cardId, pass) {
  const pend = game.pending;
  if (!pend || pend.type !== 'juedou' || pend.askId !== playerId) {
    return { ok: false, error: '当前不是决斗响应' };
  }
  const p = getPlayer(game, playerId);
  if (!pass) {
    if (!cardId || !p.hand.includes(cardId)) {
      return { ok: false, error: '请出【杀】' };
    }
    const c = cardById(game, cardId);
    if (!isShaName(c.name)) return { ok: false, error: '需打出【杀】' };
    discardCard(game, p, cardId, 'hand');
    pushLog(game, `${p.name} 打出【杀】`);
    pend._respondedCards = pend._respondedCards || [];
    pend._respondedCards.push({ playerId: p.id, card: c });
    // 延后连营等到本段决斗响应告一段落
    pend.shaGot = (pend.shaGot || 0) + 1;
    const need = pend.needSha || 1;
    if (pend.shaGot < need) {
      pend.message = `决斗：还需再出 ${need - pend.shaGot} 张【杀】`;
      return { ok: true };
    }
    pend.shaGot = 0;
    const next = playerId === pend.a ? pend.b : pend.a;
    const nextP = getPlayer(game, next);
    const needNext = trickFlow.juedouNeedForAsker(game, next, playerId);
    pend.needSha = needNext;
    pend.askId = next;
    pend.message =
      needNext > 1
        ? `决斗（无双）：${nextP.name} 请连续打出 ${needNext} 张【杀】`
        : `决斗：${nextP.name} 请打出【杀】`;
    // flush respond triggers for this round of shas
    const responded = (pend._respondedCards || []).slice();
    pend._respondedCards = [];
    for (const item of responded) {
      trickFlow.notifyAfterRespond(
        game,
        getPlayer(game, item.playerId),
        item.card
      );
      if (game.pending && game.pending.type !== 'juedou') {
        game.stack.push({ resume: 'juedou', juedou: { ...pend } });
        return { ok: true };
      }
    }
    setPending(game, pend);
    return { ok: true };
  }
  const source = playerId === pend.a ? pend.b : pend.a;
  clearPending(game);
  let dmg = 1;
  if (pend.luoyi && source === pend.a) dmg += 1;
  dealDamage(game, source, playerId, dmg, {
    fromTrick: true,
    cardName: '决斗',
  });
  return { ok: true };
}

function playJiedao(game, player, card, targets) {
  const [weaponHolderId, victimId] = targets;
  const holder = getPlayer(game, weaponHolderId);
  const victim = getPlayer(game, victimId);
  if (!holder || !holder.equips.weapon) {
    return { ok: false, error: '目标必须装备武器' };
  }
  if (!victim || !victim.alive || victim.id === holder.id) {
    return { ok: false, error: '请指定杀的目标' };
  }
  if (!inAttackRange(game, holder.id, victim.id)) {
    return { ok: false, error: '武器持有者攻击不到该目标' };
  }
  takeFromHand(player, card.id);
  game.discardPile.push(card.id);
  pushLog(
    game,
    `${player.name} 借刀：令 ${holder.name} 对 ${victim.name} 出杀`
  );
  trickFlow.notifyAfterUseCard(game, player, card);
  setPending(game, {
    type: 'jiedao',
    playerId: holder.id,
    sourceId: player.id,
    victimId,
    message: `借刀杀人：请对 ${victim.name} 出【杀】，否则交出武器`,
  });
  return { ok: true };
}

function onJiedaoResponse(game, playerId, cardId, pass) {
  const pend = game.pending;
  if (!pend || pend.type !== 'jiedao' || pend.playerId !== playerId) {
    return { ok: false, error: '当前不是借刀响应' };
  }
  const holder = getPlayer(game, playerId);
  const user = getPlayer(game, pend.sourceId);
  if (!pass) {
    if (!cardId || !holder.hand.includes(cardId)) {
      return { ok: false, error: '请出【杀】' };
    }
    const c = cardById(game, cardId);
    if (!isShaName(c.name)) return { ok: false, error: '需打出【杀】' };
    // treat as sha from holder to victim
    clearPending(game);
    discardCard(game, holder, cardId, 'hand');
    const target = getPlayer(game, pend.victimId);
    pushLog(game, `${holder.name} 打出【杀】`);
    if (armorBlocksSha(game, holder, target, c)) {
      pushLog(game, '仁王盾抵挡');
      return { ok: true };
    }
    setPending(game, {
      type: 'respond_shan',
      playerId: target.id,
      sourceId: holder.id,
      shaCardId: c.id,
      message: `${holder.name} 的【杀】，请出【闪】`,
    });
    // sha already discarded from hand - for respond we need shaCardId in discard already
    return { ok: true };
  }
  // give weapon
  if (holder.equips.weapon) {
    const w = holder.equips.weapon;
    holder.equips.weapon = null;
    user.hand.push(w.id);
    pushLog(game, `${holder.name} 不出杀，${user.name} 获得【${w.name}】`);
  }
  clearPending(game);
  return { ok: true };
}

function playWugu(game, player, card) {
  takeFromHand(player, card.id);
  game.discardPile.push(card.id);
  const n = alivePlayers(game).length;
  const shown = [];
  for (let i = 0; i < n; i++) {
    reshuffleIfNeeded(game);
    if (!game.drawPile.length) break;
    shown.push(game.drawPile.shift());
  }
  pushLog(game, `${player.name} 使用【五谷丰登】`);
  trickFlow.notifyAfterUseCard(game, player, card);
  const order = resolveOrderFromPlayer(game, player.id, { includeSelf: true });
  const r = beginTrickTargetPhase(game, player, card, order, {
    kind: 'wugu',
    order,
    shown,
    cardId: card.id,
  });
  if (r.pending) return { ok: true };
  return continueTrickAfterTargets(game);
}

function askWugu(game) {
  const pend = game.pending;
  if (!pend || pend.type !== 'wugu') return;
  if (pend.index >= pend.order.length || pend.shown.length === 0) {
    moveToDiscard(game, pend.shown);
    clearJileiSkipForTrick(game, pend.cardId);
    clearPending(game);
    return;
  }
  while (pend.index < pend.order.length) {
    const playerId = pend.order[pend.index];
    const p = getPlayer(game, playerId);
    if (p && p.alive && isJileiSkipped(game, playerId, pend.cardId)) {
      pushLog(game, `${p.name} 不受【五谷丰登】影响（鸡肋）`);
      pend.index += 1;
      continue;
    }
    break;
  }
  if (pend.index >= pend.order.length || pend.shown.length === 0) {
    moveToDiscard(game, pend.shown);
    clearJileiSkipForTrick(game, pend.cardId);
    clearPending(game);
    return;
  }
  // 只剩最后一张，且只剩最后一名可拿牌者：直接入手（含未被无懈打断的情形）
  const remainPlayers = pend.order.length - pend.index;
  if (pend.shown.length === 1 && remainPlayers === 1) {
    const playerId = pend.order[pend.index];
    const cardId = pend.shown[0];
    const p = getPlayer(game, playerId);
    pend.shown = [];
    if (p && p.alive) {
      if (isJileiSkipped(game, playerId, pend.cardId)) {
        pushLog(game, `${p.name} 不受【五谷丰登】影响（鸡肋）`);
        game.discardPile.push(cardId);
      } else {
        p.hand.push(cardId);
        const c = cardById(game, cardId);
        pushLog(
          game,
          `${p.name} 获得五谷最后一张【${c ? c.name : '牌'}】`
        );
      }
    } else {
      game.discardPile.push(cardId);
    }
    clearJileiSkipForTrick(game, pend.cardId);
    clearPending(game);
    return;
  }
  pend.askId = pend.order[pend.index];
  pend.message = `${getPlayer(game, pend.askId).name} 请从五谷中选 1 张`;
}

function onWuguPick(game, playerId, cardId) {
  const pend = game.pending;
  if (!pend || pend.type !== 'wugu' || pend.askId !== playerId) {
    return { ok: false, error: '不是你选牌' };
  }
  const i = pend.shown.indexOf(cardId);
  if (i < 0) return { ok: false, error: '牌不在五谷中' };
  pend.shown.splice(i, 1);
  getPlayer(game, playerId).hand.push(cardId);
  pushLog(game, `${getPlayer(game, playerId).name} 拿走一张牌`);
  pend.index += 1;
  askWugu(game);
  return { ok: true };
}

function onPileReorder(game, playerId, payload) {
  const pend = game.pending;
  if (!pend || pend.type !== 'pile_reorder' || pend.askId !== playerId) {
    return { ok: false, error: '当前不是牌堆重排' };
  }
  const topIds = payload.topIds || [];
  const bottomIds = payload.bottomIds || [];
  const r = trickFlow.applyPileReorder(
    game,
    topIds,
    bottomIds,
    pend.cardIds || []
  );
  if (!r.ok) return r;
  const p = getPlayer(game, playerId);
  pushLog(
    game,
    `${p.name}【${pend.skillName || '观星'}】：${topIds.length} 张置顶，${bottomIds.length} 张置底`
  );
  clearPending(game);
  resumeAfterSkill(game);
  return { ok: true };
}

/**
 * 护驾/激将：主公在需要闪/杀时主动发动，从下家起按座位询问同势力
 */
function tryActivateLordRespond(game, playerId, payload) {
  const skillId = payload.skillId;
  if (skillId !== 'hujia' && skillId !== 'jijiang') return null;
  const player = getPlayer(game, playerId);
  if (!player || !player.isLordSkillEnabled) {
    return { ok: false, error: '主公技不可用' };
  }
  const skill = skillBus.findSkill(player, skillId);
  if (!skill) return { ok: false, error: '无此技能' };

  const pend = game.pending;
  const needShan =
    skillId === 'hujia' &&
    pend &&
    (pend.type === 'respond_shan' || pend.type === 'aoe_shan');
  const needSha =
    skillId === 'jijiang' &&
    ((pend &&
      (pend.type === 'juedou' ||
        pend.type === 'aoe_sha' ||
        pend.type === 'jiedao')) ||
      (!pend &&
        game.turnPhase === 'play' &&
        currentPlayer(game) &&
        currentPlayer(game).id === playerId));

  if (skillId === 'hujia' && !needShan) {
    return { ok: false, error: '护驾仅在需要出【闪】时发动' };
  }
  if (skillId === 'jijiang' && !needSha) {
    return { ok: false, error: '激将仅在需要出【杀】时发动' };
  }

  const country = skillId === 'hujia' ? '魏' : '蜀';
  const helpers = trickFlow.helpersFromNext(game, playerId, country);
  if (!helpers.length) return { ok: false, error: '没有可响应的同势力角色' };

  // 保存原 pending，询问结束后恢复或完成
  game._lordRespond = {
    skillId,
    lordId: playerId,
    purpose: skillId === 'hujia' ? 'shan' : 'sha',
    savedPending: pend ? { ...pend } : null,
    shaTargets: payload.targets || payload.targetIds || [],
  };

  setPending(game, {
    type: 'skill_effect',
    skillId,
    skillName: skill.name,
    playerId,
    askId: helpers[0],
    helpers,
    index: 0,
    purpose: skillId === 'hujia' ? 'shan' : 'sha',
    message:
      skillId === 'hujia'
        ? `护驾：请为 ${player.name} 打出【闪】`
        : `激将：请为 ${player.name} 打出【杀】`,
    canPass: true,
  });
  pushLog(game, `${player.name} 发动【${skill.name}】`);
  return { ok: true };
}

function listLordRespondSkills(game, viewer) {
  if (!viewer || !viewer.isLordSkillEnabled) return [];
  const out = [];
  const pend = game.pending;
  if (
    skillBus.findSkill(viewer, 'hujia') &&
    pend &&
    (pend.type === 'respond_shan' || pend.type === 'aoe_shan') &&
    (pend.playerId === viewer.id || pend.askId === viewer.id)
  ) {
    const helpers = trickFlow.helpersFromNext(game, viewer.id, '魏');
    if (helpers.length) {
      out.push({
        id: 'hujia',
        name: '护驾',
        desc: '令其他魏势力角色打出【闪】',
      });
    }
  }
  if (skillBus.findSkill(viewer, 'jijiang')) {
    const inRespond =
      pend &&
      (pend.type === 'juedou' ||
        pend.type === 'aoe_sha' ||
        pend.type === 'jiedao') &&
      pend.askId === viewer.id;
    const inPlay =
      !pend &&
      game.turnPhase === 'play' &&
      currentPlayer(game) &&
      currentPlayer(game).id === viewer.id;
    if (inRespond || inPlay) {
      const helpers = trickFlow.helpersFromNext(game, viewer.id, '蜀');
      if (helpers.length) {
        out.push({
          id: 'jijiang',
          name: '激将',
          desc: '令其他蜀势力角色打出【杀】',
        });
      }
    }
  }
  return out;
}

function useViewAs(game, playerId, payload) {
  const player = getPlayer(game, playerId);
  if (!player || !player.alive) return { ok: false, error: '角色无效' };
  const skillId = payload.skillId;
  const cardId = payload.cardId;
  const to = payload.to || 'sha';
  const skill = skillBus.findSkill(player, skillId);
  if (!skill || skill.type !== 'viewAs') return { ok: false, error: '非转化技' };

  const specs =
    typeof skillBus.viewAsSpecs === 'function'
      ? skillBus.viewAsSpecs(skill)
      : [skill.viewAs, skill.viewAsAlt].filter(Boolean);
  const spec = specs.find((s) => s && s.to === to) || skill.viewAs;
  if (!spec || spec.to !== to) return { ok: false, error: '无法转化为此牌' };

  const card = cardById(game, cardId);
  if (!card) return { ok: false, error: '牌不存在' };
  const fromHand = player.hand.includes(cardId);
  let fromEquip = null;
  let fromMuniu = false;
  if (!fromHand) {
    const pile = player.skillPiles && player.skillPiles.muniu;
    if (Array.isArray(pile) && pile.includes(cardId)) fromMuniu = true;
    for (const slot of Object.keys(player.equips || {})) {
      if (player.equips[slot] && player.equips[slot].id === cardId) fromEquip = slot;
    }
  }
  if (!fromHand && !fromEquip && !fromMuniu) return { ok: false, error: '没有此牌' };
  if (spec.includeEquip === false && fromEquip) {
    return { ok: false, error: '不能用装备转化' };
  }
  if (spec.cardFilter && !spec.cardFilter(card)) {
    return { ok: false, error: '此牌不能转化' };
  }

  const ctx = { player, purpose: game.pending ? 'respond' : 'use', toName: to };
  if (typeof skill.filter === 'function') {
    // filter 需要 skillCtx；简单复用 skillBus 列表校验
    const okList = skillBus.listViewAs(game, player, to, ctx.purpose);
    if (!okList.some((o) => o.skillId === skillId && o.cardId === cardId)) {
      return { ok: false, error: '现在不能发动该转化' };
    }
  }

  // 从原区域移除，构造虚拟牌
  if (fromHand) takeFromHand(player, cardId);
  else if (fromMuniu) takeFromMuniuPile(player, cardId);
  else player.equips[fromEquip] = null;

  const virtualName =
    to === 'shan'
      ? '闪'
      : to === 'tao'
        ? '桃'
        : to === 'guohe'
          ? '过河拆桥'
          : to === 'lebu'
            ? '乐不思蜀'
            : to === 'juedou'
              ? '决斗'
              : to === 'bingliang'
                ? '兵粮寸断'
                : to === 'tiesuo'
                  ? '铁索连环'
                  : to === 'huogong'
                    ? '火攻'
                    : to === 'wuxie'
                      ? '无懈可击'
                      : to === 'sha'
                        ? '杀'
                        : '杀';
  const virtual = {
    id: cardId,
    name: virtualName,
    type:
      to === 'guohe' ||
      to === 'lebu' ||
      to === 'juedou' ||
      to === 'bingliang' ||
      to === 'tiesuo' ||
      to === 'huogong' ||
      to === 'wuxie'
        ? to === 'bingliang' || to === 'lebu'
          ? 'delayed'
          : 'trick'
        : 'basic',
    suit: card.suit,
    number: card.number,
    nature: null,
    subtype:
      to === 'lebu'
        ? 'lebu'
        : to === 'bingliang'
          ? 'bingliang'
          : to === 'juedou'
            ? 'juedou'
            : to === 'tiesuo'
              ? 'tiesuo'
              : undefined,
    _viewAs: skillId,
    virtualLabel: to === 'wuxie' ? '转无懈' : '虚',
    virtualTitle: to === 'wuxie' ? '转化为无懈可击' : null,
  };
  game.cards[cardId] = { ...card, ...virtual };

  // 响应：放回手牌后走标准 respond（牌面已是闪/杀/桃）
  const pend = game.pending;
  if (to === 'shan') {
    if (
      !pend ||
      (pend.type !== 'respond_shan' && pend.type !== 'aoe_shan') ||
      (pend.playerId !== playerId && pend.askId !== playerId)
    ) {
      // 回滚
      if (fromHand) player.hand.push(cardId);
      else if (fromEquip) player.equips[fromEquip] = card;
      game.cards[cardId] = card;
      return { ok: false, error: '请在需要出闪时转化' };
    }
    player.hand.push(cardId);
    pushLog(game, `${player.name} 发动【${skill.name}】将牌当【闪】`);
    if (pend.type === 'respond_shan') {
      return onShanResponse(game, playerId, cardId, false);
    }
    return onAoeResponse(game, playerId, cardId, false);
  }

  if (to === 'tao') {
    if (!pend || pend.type !== 'dying' || pend.askId !== playerId) {
      if (fromHand) player.hand.push(cardId);
      else if (fromEquip) player.equips[fromEquip] = card;
      game.cards[cardId] = card;
      return { ok: false, error: '请在濒死求桃时转化' };
    }
    player.hand.push(cardId);
    pushLog(game, `${player.name} 发动【${skill.name}】将牌当【桃】`);
    return applyAction(game, playerId, {
      type: 'respond',
      payload: { cardId, pass: false },
    });
  }

  if (to === 'sha') {
    if (
      pend &&
      (pend.type === 'juedou' ||
        pend.type === 'aoe_sha' ||
        pend.type === 'jiedao') &&
      (pend.askId === playerId || pend.playerId === playerId)
    ) {
      player.hand.push(cardId);
      pushLog(game, `${player.name} 发动【${skill.name}】将牌当【杀】`);
      if (pend.type === 'juedou') {
        return onJuedouResponse(game, playerId, cardId, false);
      }
      if (pend.type === 'jiedao') {
        // jiedao uses respond path
        return applyAction(game, playerId, {
          type: 'respond',
          payload: { cardId, pass: false },
        });
      }
      return onAoeResponse(game, playerId, cardId, false);
    }
    // 出牌阶段当杀使用
    if (pend) {
      if (fromHand) player.hand.push(cardId);
      else if (fromEquip) player.equips[fromEquip] = card;
      game.cards[cardId] = card;
      return { ok: false, error: '请先完成当前响应' };
    }
    const extra = {};
    if (skillId === 'wusheng' && card.suit === 'heart') extra.ignoreShaCount = true;
    if (skillId === 'wusheng' && card.suit === 'diamond') extra.ignoreDistance = true;
    player.hand.push(cardId);
    const shaR = playSha(
      game,
      player,
      game.cards[cardId],
      payload.targets || [],
      extra
    );
    if (!shaR.ok) {
      // playSha 失败时牌可能仍在手中且已被改成虚拟杀，需还原
      const i = player.hand.indexOf(cardId);
      if (i >= 0) player.hand.splice(i, 1);
      if (fromHand) player.hand.push(cardId);
      else if (fromEquip) player.equips[fromEquip] = card;
      game.cards[cardId] = card;
    }
    return shaR;
  }

  if (to === 'guohe') {
    if (pend) {
      if (fromHand) player.hand.push(cardId);
      else if (fromEquip) player.equips[fromEquip] = card;
      game.cards[cardId] = card;
      return { ok: false, error: '请先完成当前响应' };
    }
    player.hand.push(cardId);
    return playGuohe(game, player, game.cards[cardId], payload.targets || []);
  }
  if (to === 'lebu') {
    if (pend) {
      if (fromHand) player.hand.push(cardId);
      else if (fromEquip) player.equips[fromEquip] = card;
      game.cards[cardId] = card;
      return { ok: false, error: '请先完成当前响应' };
    }
    player.hand.push(cardId);
    return playLebu(game, player, game.cards[cardId], payload.targets || []);
  }
  if (to === 'juedou') {
    if (pend) {
      if (fromHand) player.hand.push(cardId);
      else if (fromEquip) player.equips[fromEquip] = card;
      game.cards[cardId] = card;
      return { ok: false, error: '请先完成当前响应' };
    }
    player.hand.push(cardId);
    return playJuedou(game, player, game.cards[cardId], payload.targets || []);
  }
  if (to === 'bingliang') {
    if (pend) {
      if (fromHand) player.hand.push(cardId);
      else if (fromEquip) player.equips[fromEquip] = card;
      game.cards[cardId] = card;
      return { ok: false, error: '请先完成当前响应' };
    }
    player.hand.push(cardId);
    return playBingliang(
      game,
      player,
      game.cards[cardId],
      payload.targets || []
    );
  }
  if (to === 'tiesuo') {
    if (pend) {
      if (fromHand) player.hand.push(cardId);
      else if (fromEquip) player.equips[fromEquip] = card;
      game.cards[cardId] = card;
      return { ok: false, error: '请先完成当前响应' };
    }
    player.hand.push(cardId);
    pushLog(game, `${player.name} 发动【${skill.name}】将牌当【铁索连环】`);
    return playTiesuo(game, player, game.cards[cardId], payload.targets || []);
  }
  if (to === 'huogong') {
    if (pend) {
      if (fromHand) player.hand.push(cardId);
      else if (fromEquip) player.equips[fromEquip] = card;
      game.cards[cardId] = card;
      return { ok: false, error: '请先完成当前响应' };
    }
    player.hand.push(cardId);
    pushLog(game, `${player.name} 发动【${skill.name}】将牌当【火攻】`);
    return playHuogong(game, player, game.cards[cardId], payload.targets || []);
  }
  if (to === 'wuxie') {
    if (
      !pend ||
      pend.type !== 'wuxie' ||
      pend.phase !== 'collect' ||
      !pend.waiting ||
      !pend.waiting.includes(playerId)
    ) {
      if (fromHand) player.hand.push(cardId);
      else if (fromEquip) player.equips[fromEquip] = card;
      game.cards[cardId] = card;
      return { ok: false, error: '请在需要出无懈时转化' };
    }
    if (fromMuniu) {
      require('./equip/muniu').getMuniuPile(player).push(cardId);
    } else {
      player.hand.push(cardId);
    }
    return trickFlow.onWuxieResponse(game, playerId, cardId, false, {
      asWuxie: true,
      skillId,
      skillName: skill.name,
    });
  }

  if (fromHand) player.hand.push(cardId);
  else if (fromMuniu) require('./equip/muniu').getMuniuPile(player).push(cardId);
  else if (fromEquip) player.equips[fromEquip] = card;
  game.cards[cardId] = card;
  return { ok: false, error: '未支持的转化' };
}

function applyAction(game, playerId, action) {
  if (!game) return { ok: false, error: '对局未开始' };
  if (game.over) return { ok: false, error: '对局已结束' };

  const type = action && action.type;
  const payload = (action && action.payload) || {};

  if (type === 'bid_lord') {
    return bidLord(game, playerId, payload.value);
  }

  if (type === 'ban_general') {
    return banGeneral(game, playerId, payload.generalId);
  }

  if (type === 'select_general') {
    return selectGeneral(game, playerId, payload.generalId);
  }

  if (type === 'end_play') {
    const cur = currentPlayer(game);
    if (!cur || cur.id !== playerId) return { ok: false, error: '不是你的回合' };
    if (game.turnPhase !== 'play') return { ok: false, error: '非出牌阶段' };
    if (game.pending) return { ok: false, error: '请先完成响应' };
    enterDiscardPhase(game);
    return { ok: true };
  }

  if (type === 'play_card') {
    return useCard(game, playerId, payload.cardId, payload.targets || [], payload);
  }

  if (type === 'use_skill') {
    const lordR = tryActivateLordRespond(game, playerId, payload);
    if (lordR) return lordR;
    return skillBus.useActive(game, playerId, payload.skillId, payload);
  }

  if (type === 'view_as') {
    return useViewAs(game, playerId, payload);
  }

  if (type === 'respond') {
    const pend = game.pending;
    if (!pend) return { ok: false, error: '当前无需响应' };
    const pass = Boolean(payload.pass);

    if (pend.type === 'wuxie') {
      return trickFlow.onWuxieResponse(game, playerId, payload.cardId, pass, {
        asWuxie: Boolean(payload.asWuxie),
        skillId: payload.skillId || null,
        skillName: payload.skillName || null,
        force: Boolean(payload.force),
      });
    }
    if (pend.type === 'judge_reveal') {
      return finishJudgeReveal(game, playerId);
    }
    if (pend.type === 'card_reveal') {
      return finishCardReveal(game, playerId);
    }
    if (pend.type === 'bagua_ask') {
      return onBaguaAskResponse(game, playerId, pass);
    }
    if (pend.type === 'succession') {
      return xz.applySuccession(
        game,
        playerId,
        payload.targetId,
        makeXianzhuApi()
      );
    }
    if (pend.type === 'pile_reorder') {
      return onPileReorder(game, playerId, payload);
    }
    if (pend.type === 'skill_ask') {
      return skillBus.resolveSkillAsk(game, playerId, payload);
    }
    if (pend.type === 'skill_effect') {
      return resolveSkillEffect(game, playerId, payload, {
        pushLog,
        getPlayer,
        cardById,
        drawCards,
        discardCard,
        takeFromHand,
        dealDamage,
        loseHp,
        drawJudgeCard,
        setPending,
        clearPending,
        alivePlayers,
        inAttackRange,
        SUIT_COLOR,
        SUIT_LABEL,
        currentPlayer,
        resumeAfterSkill,
        resumeAfterPending,
        useCard,
        useCardByPlayer: useCard,
        startJuedou: (g, a, b, o) => trickFlow.startJuedou(g, a, b, o),
        helpersFromNext: (g, lordId, country) =>
          trickFlow.helpersFromNext(g, lordId, country),
        nextAliveSeat,
        askAoe,
        resolveShaAs(g, attackerId, targetId, card) {
          const attacker = getPlayer(g, attackerId);
          if (!attacker) return { ok: false, error: '攻击者无效' };
          g._shaPend = {
            attackerId,
            targetId,
            cardId: card.id,
            nature: card.nature || null,
            label: '杀',
            noShan: false,
          };
          attacker.shaUsed = (attacker.shaUsed || 0) + 1;
          attacker.skillStates = attacker.skillStates || {};
          attacker.skillStates.usedShaInPlay = true;
          pushLog(
            g,
            `${attacker.name} 对 ${getPlayer(g, targetId).name} 使用【杀】（激将）`
          );
          g._skillResume = 'after_sha_skills';
          return continueShaAfterSkills(g);
        },
      });
    }

    if (pend.type === 'respond_shan') {
      return onShanResponse(game, playerId, payload.cardId, pass);
    }
    if (pend.type === 'aoe_sha' || pend.type === 'aoe_shan') {
      return onAoeResponse(game, playerId, payload.cardId, pass);
    }
    if (pend.type === 'juedou') {
      return onJuedouResponse(game, playerId, payload.cardId, pass);
    }
    if (pend.type === 'jiedao') {
      return onJiedaoResponse(game, playerId, payload.cardId, pass);
    }
    if (pend.type === 'dying') {
      if (pend.askId !== playerId) return { ok: false, error: '未轮到你救' };
      if (pass) {
        pend.index += 1;
        advanceDying(game);
        return { ok: true };
      }
      if (!payload.cardId) return { ok: false, error: '请出【桃】或【酒】' };
      const p = getPlayer(game, playerId);
      if (!p.hand.includes(payload.cardId)) return { ok: false, error: '没有此牌' };
      const c = cardById(game, payload.cardId);
      if (c.name !== '桃' && c.name !== '酒') {
        return { ok: false, error: '需使用【桃】或【酒】' };
      }
      // 完杀：当前回合角色有完杀时，其他非濒死角色不能出桃
      if (c.name === '桃') {
        const turnP = currentPlayer(game);
        if (
          turnP &&
          turnP.alive &&
          turnP.skills &&
          turnP.skills.some((s) => s.id === 'wansha') &&
          playerId !== turnP.id &&
          playerId !== pend.targetId
        ) {
          return { ok: false, error: '完杀：此时不能使用【桃】救援' };
        }
      }
      // 酒不能救自己（无技能时）
      if (c.name === '酒' && playerId === pend.targetId) {
        return { ok: false, error: '【酒】不能救自己' };
      }
      discardCard(game, p, payload.cardId, 'hand');
      const target = getPlayer(game, pend.targetId);
      const wasDying = target && target.hp <= 0;
      let heal = 1;
      if (c.name === '桃') {
        for (const q of skillBus.query(game, target, 'onTaoHealBonus', {
          taoUser: p,
        })) {
          if (typeof q.value === 'number') heal += q.value;
        }
      }
      const beforeHp = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + heal);
      const realHeal = Math.max(0, target.hp - beforeHp);
      if (game.mode === 'xianzhu' && c.name === '桃') {
        xz.onHuangjinTouch(game, p, target, makeXianzhuApi());
      }
      pushLog(
        game,
        `${p.name} 对 ${target.name} 使用【${c.name}】` +
          (heal > 1 ? `（救援额外回复）` : '')
      );
      if (realHeal > 0) {
        noteRecoverAnnounce(game, target, realHeal);
      }
      if (
        wasDying &&
        target.hp > 0 &&
        p.id !== target.id
      ) {
        noteDyingSaveAnnounce(game, p);
      }
      if (target.hp > 0) {
        clearPending(game);
        resumeAfterPending(game);
      } else {
        pend.index += 1;
        advanceDying(game);
      }
      return { ok: true };
    }
    if (pend.type === 'discard') {
      if (pend.playerId !== playerId) return { ok: false, error: '不是你弃牌' };
      const ids = payload.cardIds || (payload.cardId ? [payload.cardId] : []);
      if (ids.length !== pend.count) {
        return { ok: false, error: `需弃置 ${pend.count} 张` };
      }
      const p = getPlayer(game, playerId);
      for (const id of ids) {
        if (!p.hand.includes(id)) return { ok: false, error: '手牌不符' };
      }
      for (const id of ids) discardCard(game, p, id, 'hand');
      pushLog(game, `${p.name} 弃置 ${ids.length} 张牌`);
      clearPending(game);
      endTurn(game);
      return { ok: true };
    }
    if (pend.type === 'choose_discard_target_card') {
      if (pend.playerId !== playerId) return { ok: false, error: '无权操作' };
      const id = payload.cardId;
      if (!pend.cardIds.includes(id)) return { ok: false, error: '无效选择' };
      const target = getPlayer(game, pend.targetId);
      const z = findCardZone(target, id);
      if (!z) return { ok: false, error: '牌已不在' };
      if (z.zone === 'hand') discardCard(game, target, id, 'hand');
      else if (z.zone === 'judge') discardCard(game, target, id, 'judge');
      else {
        const eq = target.equips[z.slot];
        target.equips[z.slot] = null;
        game.discardPile.push(id);
        if (eq && eq.subtype === 'muniu') onEquipRemoved(game, target, id);
      }
      pushLog(game, `弃置了 ${target.name} 的一张牌`);
      clearPending(game);
      resumeAfterPending(game);
      return { ok: true };
    }
    if (pend.type === 'choose_gain_target_card') {
      if (pend.playerId !== playerId) return { ok: false, error: '无权操作' };
      const id = payload.cardId;
      if (!pend.cardIds.includes(id)) return { ok: false, error: '无效选择' };
      const target = getPlayer(game, pend.targetId);
      const me = getPlayer(game, playerId);
      const z = findCardZone(target, id);
      if (!z) return { ok: false, error: '牌已不在' };
      const muniuMod = require('./equip/muniu');

      if (z.zone === 'equip' && z.slot === 'treasure') {
        const eq = target.equips.treasure;
        if (eq && eq.subtype === 'muniu') {
          if (me.equips.treasure) {
            return { ok: false, error: '你的宝物栏已有装备' };
          }
          target.equips.treasure = null;
          me.equips.treasure = eq;
          if (!me.skillPiles) me.skillPiles = {};
          me.skillPiles.muniu = (target.skillPiles && target.skillPiles.muniu
            ? target.skillPiles.muniu.slice()
            : []);
          target.skillPiles.muniu = [];
          muniuMod.syncMuniuSkill(target);
          muniuMod.syncMuniuSkill(me);
          if (skillBus) {
            skillBus.emit(game, 'afterLoseEquip', {
              player: target,
              cardId: eq.id,
            });
          }
          pushLog(game, `${me.name} 获得了 ${target.name} 的【木牛流马】`);
          clearPending(game);
          resumeAfterPending(game);
          return { ok: true };
        }
      }

      if (z.zone === 'hand') {
        target.hand = target.hand.filter((x) => x !== id);
        me.hand.push(id);
      } else if (z.zone === 'judge') {
        target.judges = target.judges.filter((x) => x !== id);
        me.hand.push(id);
      } else if (z.zone === 'muniu') {
        muniuMod.removeFromMuniuPile(target, id);
        me.hand.push(id);
      } else if (z.zone === 'equip') {
        target.equips[z.slot] = null;
        me.hand.push(id);
      }
      pushLog(game, `${me.name} 获得了 ${target.name} 的一张牌`);
      clearPending(game);
      resumeAfterPending(game);
      return { ok: true };
    }
    if (pend.type === 'wugu') {
      return onWuguPick(game, playerId, payload.cardId);
    }
    if (pend.type === 'guanshi') {
      if (pend.playerId !== playerId) return { ok: false, error: '无权' };
      if (pass) {
        clearPending(game);
        return { ok: true };
      }
      const ids = payload.cardIds || [];
      if (ids.length !== 2) return { ok: false, error: '需弃 2 张牌' };
      const p = getPlayer(game, playerId);
      for (const id of ids) {
        if (!p.hand.includes(id) && !Object.values(p.equips).some((e) => e && e.id === id)) {
          return { ok: false, error: '牌不属于你' };
        }
      }
      for (const id of ids) {
        if (p.hand.includes(id)) discardCard(game, p, id, 'hand');
        else {
          for (const slot of Object.keys(p.equips)) {
            if (p.equips[slot] && p.equips[slot].id === id) {
              game.discardPile.push(id);
              p.equips[slot] = null;
            }
          }
        }
      }
      clearPending(game);
      dealDamage(game, playerId, pend.targetId, 1);
      return { ok: true };
    }
    if (pend.type === 'qilin') {
      if (pend.playerId !== playerId) return { ok: false, error: '无权' };
      if (pass) {
        clearPending(game);
        return { ok: true };
      }
      const id = payload.cardId;
      if (!pend.mounts.includes(id)) return { ok: false, error: '请选择坐骑' };
      const target = getPlayer(game, pend.targetId);
      for (const slot of ['horseMinus', 'horsePlus']) {
        if (target.equips[slot] && target.equips[slot].id === id) {
          game.discardPile.push(id);
          target.equips[slot] = null;
        }
      }
      pushLog(game, `麒麟弓弃置坐骑`);
      clearPending(game);
      return { ok: true };
    }
    if (pend.type === 'feiyang') {
      if (pend.playerId !== playerId) return { ok: false, error: '无权' };
      const p = getPlayer(game, playerId);
      if (pass) {
        clearPending(game);
        runJudgePhase(game);
        return { ok: true };
      }
      if (pend.step === 'judge') {
        const judgeId = payload.judgeId || payload.cardId;
        if (!judgeId || !p.judges.includes(judgeId)) {
          return { ok: false, error: '请选择判定区一张牌' };
        }
        discardCard(game, p, judgeId, 'judge');
        p.feiyangUsed = true;
        pushLog(game, `${p.name} 发动【飞扬】弃置判定区一张牌`);
        clearPending(game);
        runJudgePhase(game);
        return { ok: true };
      }
      const pickedIds = payload.cardIds || (payload.cardId ? [payload.cardId] : []);
      if (pickedIds.length !== 2) {
        return { ok: false, error: '需弃 2 张手牌或装备牌' };
      }
      for (const id of pickedIds) {
        const z = findCardZone(p, id);
        if (!z || z.zone === 'judge') {
          return { ok: false, error: '前两张只能弃手牌或装备牌' };
        }
      }
      for (const id of pickedIds) {
        const z = findCardZone(p, id);
        if (!z) return { ok: false, error: '牌已不在原区域' };
        if (z.zone === 'hand') discardCard(game, p, id, 'hand');
        else {
          game.discardPile.push(id);
          p.equips[z.slot] = null;
        }
      }
      setPending(game, {
        type: 'feiyang',
        step: 'judge',
        playerId: p.id,
        judgeIds: p.judges.slice(),
        message: '【飞扬】第二步：请选择判定区 1 张牌弃置',
      });
      return { ok: true };
    }
    if (pend.type === 'rebel_compensate') {
      if (pend.playerId !== playerId) return { ok: false, error: '无权' };
      const p = getPlayer(game, playerId);
      const choice = payload.choice; // 'draw' | 'heal'
      if (choice === 'heal') {
        if (p.hp < p.maxHp) {
          p.hp += 1;
          pushLog(game, `${p.name} 选择回复 1 点体力`);
        } else {
          drawCards(game, p, 2);
          pushLog(game, `${p.name} 体力已满，改为摸 2 张`);
        }
      } else {
        drawCards(game, p, 2);
        pushLog(game, `${p.name} 选择摸 2 张牌`);
      }
      clearPending(game);
      const deadSeat = game.players.find((x) => !x.alive);
      const cur = currentPlayer(game);
      if (!cur) {
        game.turnSeat = nextTurnSeat(game, deadSeat ? deadSeat.seat : 0);
        startTurn(game);
      } else if (!cur.alive) {
        game.turnSeat = nextTurnSeat(game, cur.seat);
        startTurn(game);
      } else {
        resumeAfterPending(game);
      }
      return { ok: true };
    }
    if (pend.type === 'huogong_show') {
      if (pend.playerId !== playerId) return { ok: false, error: '无权' };
      const target = getPlayer(game, playerId);
      const shownId = payload.cardId;
      if (!shownId || !target || !target.hand.includes(shownId)) {
        return { ok: false, error: '请选择一张手牌展示' };
      }
      const shown = cardById(game, shownId);
      if (!shown) return { ok: false, error: '手牌无效' };
      pushLog(
        game,
        `${target.name} 展示 ${SUIT_LABEL[shown.suit]}${shown.number}【${shown.name}】`
      );
      beginCardReveal(game, {
        playerId: target.id,
        askId: pend.sourceId,
        shown: [shownId],
        title: '火攻',
        message: `${target.name} 展示手牌（对所有人明示）`,
        afterReveal: {
          kind: 'huogong',
          sourceId: pend.sourceId,
          targetId: pend.targetId,
          suit: shown.suit,
          shownId,
        },
      });
      return { ok: true };
    }
    if (pend.type === 'huogong') {
      if (pend.playerId !== playerId) return { ok: false, error: '无权' };
      if (pass) {
        clearPending(game);
        return { ok: true };
      }
      const p = getPlayer(game, playerId);
      const id = payload.cardId;
      if (!id || !p.hand.includes(id)) return { ok: false, error: '请弃同花色牌' };
      const c = cardById(game, id);
      if (c.suit !== pend.suit) return { ok: false, error: '花色不符' };
      discardCard(game, p, id, 'hand');
      clearPending(game);
      dealDamage(game, playerId, pend.targetId, 1, { nature: 'fire' });
      return { ok: true };
    }
    if (pend.type === 'hanbing') {
      if (pend.playerId !== playerId) return { ok: false, error: '无权' };
      if (pass) {
        clearPending(game);
        dealDamage(game, playerId, pend.targetId, 1, {
          nature: pend.nature || null,
        });
        return { ok: true };
      }
      // 弃目标两张牌
      const target = getPlayer(game, pend.targetId);
      const ids = payload.cardIds || [];
      if (ids.length !== 2) return { ok: false, error: '需弃目标 2 张牌' };
      for (const id of ids) {
        const z = findCardZone(target, id);
        if (!z) return { ok: false, error: '牌不属于目标' };
        if (z.zone === 'hand') discardCard(game, target, id, 'hand');
        else if (z.zone === 'judge') discardCard(game, target, id, 'judge');
        else {
          target.equips[z.slot] = null;
          game.discardPile.push(id);
        }
      }
      pushLog(game, `${getPlayer(game, playerId).name} 寒冰剑弃置目标两张牌`);
      clearPending(game);
      return { ok: true };
    }
    return { ok: false, error: '未知响应' };
  }

  return { ok: false, error: '无效操作' };
}

function publicCard(c) {
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    suit: c.suit,
    suitLabel: SUIT_LABEL[c.suit],
    color: SUIT_COLOR[c.suit],
    number: c.number,
    subtype: c.subtype,
    nature: c.nature || null,
    slot: c.slot,
    range: c.range,
    mark: c.mark || null,
    virtual: Boolean(c.virtual),
    virtualLabel: c.virtualLabel || null,
    virtualTitle: c.virtualTitle || null,
  };
}

/** 观看者是否可见该角色手牌（自己 / 2v2 存活队友） */
function canViewerSeeHand(game, viewer, owner) {
  if (!viewer || !owner) return false;
  if (viewer.id === owner.id) return true;
  if (game.mode === 'h2h' && sameTeam(viewer, owner) && owner.alive) {
    return true;
  }
  return false;
}

/**
 * 选牌选项：手牌默认暗置；装备/判定明置。
 * pend.revealHand / showHand 为真时，按技能「展示手牌」明置。
 */
function publicCardOption(game, viewer, owner, cardId, pend) {
  const c = cardById(game, cardId);
  if (!c) return null;
  const zoneInfo = owner ? findCardZone(owner, cardId) : null;
  const zone = zoneInfo ? zoneInfo.zone : null;
  const revealHand = Boolean(
    pend && (pend.revealHand || pend.showHand || pend.revealHands)
  );
  if (
    zone === 'hand' &&
    owner &&
    !revealHand &&
    !canViewerSeeHand(game, viewer, owner)
  ) {
    return {
      id: cardId,
      back: true,
      zone: 'hand',
      name: '手牌',
    };
  }
  const pub = publicCard(c);
  if (zone) pub.zone = zone;
  return pub;
}

function pendingOptionOwner(game, pend) {
  if (!pend) return null;
  if (pend.skillId === 'fanjian') {
    return getPlayer(game, pend.playerId);
  }
  if (pend.targetId) return getPlayer(game, pend.targetId);
  if (pend.dyingId) return getPlayer(game, pend.dyingId);
  if (pend.moreId) return getPlayer(game, pend.moreId);
  if (
    pend.sourceId &&
    (pend.skillId === 'fankui' ||
      pend.skillId === 'ganglie' ||
      pend.skillId === 'mengjin' ||
      pend.skillId === 'xuanhuo')
  ) {
    return getPlayer(game, pend.sourceId);
  }
  return null;
}

function publicGameState(game, viewerId) {
  if (!game) return null;
  const viewer = getPlayer(game, viewerId);

  return {
    type: 'sgs',
    mode: game.mode,
    modeLabel: game.modeLabel,
    phase: game.phase,
    over: game.over,
    winners: game.winners.slice(),
    winReason: game.winReason,
    turnSeat: game.turnSeat,
    turnPhase: game.turnPhase,
    turnPlayerId: currentPlayer(game) ? currentPlayer(game).id : null,
    acting: buildActingPublic(game),
    selectGeneralPhase: game.selectGeneralPhase || null,
    drawCount: game.drawPile.length,
    discardCount: game.discardPile.length,
    discardTop:
      game.discardPile.length > 0
        ? publicCard(
            cardById(game, game.discardPile[game.discardPile.length - 1])
          )
        : null,
    lastDeath: game.lastDeath
      ? {
          playerId: game.lastDeath.playerId,
          name: game.lastDeath.name,
          identity: game.lastDeath.identity,
          identityLabel: game.lastDeath.identityLabel,
          kind: game.lastDeath.kind,
        }
      : null,
    log: game.log.slice(-20),
    pending: game.pending
      ? (() => {
          const pend = game.pending;
          let optionIds =
            pend.cardIds || pend.mounts || pend.judgeIds || [];
          if (
            (!optionIds || !optionIds.length) &&
            pend.type === 'skill_effect' &&
            pend.skillId === 'mengjin' &&
            pend.targetId
          ) {
            const t = getPlayer(game, pend.targetId);
            optionIds = t ? allCardsOf(t) : [];
          }
          if (
            (!optionIds || !optionIds.length) &&
            pend.type === 'skill_effect' &&
            pend.skillId === 'tiaoxin' &&
            pend.step === 'discard' &&
            pend.targetId
          ) {
            const t = getPlayer(game, pend.targetId);
            optionIds = t ? allCardsOf(t) : [];
          }
          if (
            (!optionIds || !optionIds.length) &&
            pend.type === 'skill_effect' &&
            pend.sourceId &&
            (pend.skillId === 'fankui' ||
              pend.skillId === 'ganglie' ||
              (pend.skillId === 'xuanhuo' && pend.step === 'take'))
          ) {
            const src = getPlayer(game, pend.sourceId || pend.targetId);
            optionIds = src ? allCardsOf(src) : [];
          }
          if (
            (!optionIds || !optionIds.length) &&
            pend.type === 'skill_effect' &&
            pend.skillId === 'liyu' &&
            pend.targetId
          ) {
            const t = getPlayer(game, pend.targetId);
            optionIds = t ? allCardsOf(t) : [];
          }
          if (
            (!optionIds || !optionIds.length) &&
            pend.type === 'skill_effect' &&
            pend.skillId === 'buyi' &&
            pend.dyingId
          ) {
            const dying = getPlayer(game, pend.dyingId);
            optionIds = dying ? dying.hand.slice() : [];
          }
          if (
            (!optionIds || !optionIds.length) &&
            pend.type === 'skill_effect' &&
            pend.skillId === 'anxu' &&
            pend.moreId
          ) {
            const more = getPlayer(game, pend.moreId);
            optionIds = more ? more.hand.slice() : [];
          }
          if (
            (!optionIds || !optionIds.length) &&
            pend.type === 'skill_effect' &&
            pend.skillId === 'enyuan' &&
            (pend.heartIds || pend.sourceId)
          ) {
            const src = getPlayer(game, pend.sourceId);
            optionIds = (pend.heartIds || (src ? src.hand.slice() : [])).slice();
          }
          if (
            (!optionIds || !optionIds.length) &&
            pend.type === 'skill_effect' &&
            pend.skillId === 'fanjian' &&
            pend.step === 'card'
          ) {
            const src = getPlayer(game, pend.playerId);
            optionIds = src ? src.hand.slice() : [];
          }
          const optionOwner = pendingOptionOwner(game, pend);
          return {
            type: pend.type,
            playerId: pend.playerId,
            askId: pend.askId,
            targetId: pend.targetId,
            sourceId: pend.sourceId || pend.attackerId || null,
            attackerId: pend.attackerId || pend.sourceId || null,
            skillId: pend.skillId || null,
            skillName: pend.skillName || null,
            count: pend.count,
            giveCount: pend.giveCount != null ? pend.giveCount : null,
            message: pend.message,
            cardIds: pend.cardIds,
            heartIds: pend.heartIds || null,
            candidateIds: pend.candidateIds || null,
            fewerId: pend.fewerId || null,
            moreId: pend.moreId || null,
            dyingId: pend.dyingId || null,
            suit: pend.suit || null,
            canPass: pend.canPass !== false,
            minTargets: pend.minTargets != null ? pend.minTargets : null,
            maxTargets: pend.maxTargets != null ? pend.maxTargets : null,
            purpose: pend.purpose || null,
            step: pend.step || null,
            trickId: pend.trickId || null,
            trickName: pend.trickName || null,
            cardName: pend.cardName || null,
            options: pend.options || null,
            candidates: pend.candidates || null,
            mounts: pend.mounts,
            outcomeEffective:
              pend.outcomeEffective != null ? pend.outcomeEffective : null,
            outcomeMessage: pend.outcomeMessage || null,
            outcomeKind: pend.outcomeKind || null,
            judgeKind: pend.judgeKind || null,
            revealMinMs: pend.revealMinMs || REVEAL_MIN_MS,
            title: pend.title || null,
            resultCard:
              pend.type === 'judge_reveal' && pend.resultCardId
                ? publicCard(cardById(game, pend.resultCardId))
                : null,
            triggerCard: (() => {
              if (pend.judgeKind === 'bagua' && !pend.triggerCardId) {
                return {
                  id: 'virtual-bagua',
                  name: '八卦阵',
                  type: 'equip',
                  subtype: 'bagua',
                };
              }
              const tid =
                pend.shaCardId ||
                pend.cardId ||
                pend.triggerCardId ||
                null;
              return tid ? publicCard(cardById(game, tid)) : null;
            })(),
            cardOptions: optionIds
              .map((id) =>
                publicCardOption(game, viewer, optionOwner, id, pend)
              )
              .filter(Boolean),
            shown:
              pend.type === 'judge_reveal' && pend.resultCardId
                ? [publicCard(cardById(game, pend.resultCardId))]
                : (pend.shown || pend.cardIds || []).map((id) =>
                    pend.type === 'pile_reorder' &&
                    viewerId &&
                    pend.askId !== viewerId
                      ? { id, name: '牌', back: true }
                      : publicCard(cardById(game, id))
                  ),
            forMe: (() => {
              if (!viewerId) return false;
              if (pend.type === 'wuxie') {
                if (pend.phase === 'reveal') {
                  return pend.askId === viewerId;
                }
                if (pend.phase === 'collect') {
                  return (
                    Array.isArray(pend.waiting) &&
                    pend.waiting.includes(viewerId)
                  );
                }
              }
              return Boolean(
                pend.askId
                  ? pend.askId === viewerId
                  : pend.playerId === viewerId
              );
            })(),
            wuxiePhase: pend.type === 'wuxie' ? pend.phase || null : null,
            wuxieSubmitted:
              pend.type === 'wuxie' &&
              viewerId &&
              pend.responses &&
              pend.responses[viewerId] != null,
            wuxieWaitingCount:
              pend.type === 'wuxie' && pend.waiting
                ? pend.waiting.length
                : null,
            wuxieResults:
              pend.type === 'wuxie' && pend.phase === 'reveal'
                ? (pend.results || []).map((row) => ({
                    playerId: row.playerId,
                    playerName: row.playerName,
                    pass: row.pass,
                    auto: row.auto,
                    asWuxie: row.asWuxie,
                    skillName: row.skillName || null,
                  }))
                : null,
          };
        })()
      : null,
    generalChoices:
      game.phase === 'select_general' && viewerId
        ? (game.generalChoices[viewerId] || []).map((id) => {
            const g = getGeneral(id);
            return g
              ? {
                  id: g.id,
                  name: g.name,
                  country: g.country,
                  maxHp: g.maxHp,
                  gender: g.gender || null,
                  portrait: g.portrait || `${g.id}.png`,
                  skills: (g.skills || []).map((s) => ({
                    id: s.id,
                    name: s.name,
                    desc: s.desc,
                    lord: Boolean(s.lord),
                  })),
                }
              : null;
          }).filter(Boolean)
        : [],
    banInfo:
      game.phase === 'ban_general' && viewer && game.teamPools
        ? {
            myTurn:
              game.banState &&
              game.banState.order[game.banState.index] === viewerId,
            enemyPool: (game.teamPools[enemyTeam(viewer.team)] || []).map(
              (id) => {
                const g = getGeneral(id);
                return g
                  ? {
                      id: g.id,
                      name: g.name,
                      country: g.country,
                      maxHp: g.maxHp,
                      portrait: g.portrait || `${g.id}.png`,
                    }
                  : null;
              }
            ).filter(Boolean),
            myPool: (game.teamPools[viewer.team] || []).map((id) => {
              const g = getGeneral(id);
              return g
                ? {
                    id: g.id,
                    name: g.name,
                    country: g.country,
                    maxHp: g.maxHp,
                    portrait: g.portrait || `${g.id}.png`,
                  }
                : null;
            }).filter(Boolean),
            askName: game.banState
              ? getPlayer(game, game.banState.order[game.banState.index]).name
              : '',
          }
        : null,
    bidInfo:
      game.phase === 'bid_lord' && game.bidState
        ? {
            myTurn: game.bidState.order[game.bidState.index] === viewerId,
            askName: getPlayer(
              game,
              game.bidState.order[game.bidState.index]
            ).name,
            currentBid: game.bidState.currentBid,
            currentBidderName: game.bidState.currentBidder
              ? getPlayer(game, game.bidState.currentBidder).name
              : null,
            minNext: game.bidState.currentBid + 1,
          }
        : null,
    lordSkills:
      game.mode === '1v2'
        ? [
            { id: 'bahu', name: '跋扈', desc: '准备阶段摸1张；出杀次数+1' },
            { id: 'feiyang', name: '飞扬', desc: '判定阶段可弃2手牌弃1判定牌' },
          ]
        : null,
    players: game.players.map((p) => {
      const isSelf = p.id === viewerId;
      const isMate = viewer && sameTeam(viewer, p);
      let idInfo;
      if (game.mode === 'xianzhu') {
        idInfo = xz.publicIdentityFor(game, p, viewer);
      } else {
        const showId =
          game.mode === 'h2h' ||
          p.identityRevealed ||
          isSelf ||
          game.over ||
          p.identity === 'zhu';
        idInfo = {
          identity: showId ? p.identity : null,
          identityLabel: showId ? IDENTITY[p.identity] : '？',
          identityRevealed: Boolean(p.identityRevealed) || showId,
          isZhu: p.identity === 'zhu',
          houzhuOrigin: null,
        };
      }
      const showHand = isSelf || (game.mode === 'h2h' && isMate && p.alive);
      const showHuangjinMark =
        game.mode === 'xianzhu' &&
        (xz.isHuangjinViewer(viewer) || game.huangjinUprising || game.over) &&
        (p.huangjinMarks || 0) > 0 &&
        p.identity !== 'huangjin';
      const seeGeneral = canViewerSeeGeneral(game, viewer, p);
      const generalHidden = Boolean(p.generalId && !seeGeneral);
      return {
        id: p.id,
        name: p.name,
        tag: p.tag || null,
        left: Boolean(p.left),
        seat: p.seat,
        seatNo: p.seat + 1,
        alive: p.alive,
        team: p.team || null,
        isTeammate: Boolean(isMate && !isSelf),
        identity: idInfo.identity,
        identityLabel: idInfo.identityLabel,
        identityRevealed: idInfo.identityRevealed,
        isZhu: Boolean(idInfo.isZhu),
        houzhuOrigin: idInfo.houzhuOrigin || null,
        huangjinMarks: showHuangjinMark ? p.huangjinMarks : null,
        faction:
          game.mode === 'xianzhu' &&
          (isSelf || game.over || game.huangjinUprising)
            ? xz.factionOf(p)
            : null,
        generalId: seeGeneral ? p.generalId || null : null,
        generalName: seeGeneral ? p.generalName : null,
        generalHidden,
        country: seeGeneral ? p.country : null,
        gender: seeGeneral ? p.gender || null : null,
        portrait: seeGeneral ? p.portrait || null : null,
        skills: seeGeneral
          ? (p.skills || []).filter(
              (s) => !s.lord || p.isLordSkillEnabled || isSelf
            )
          : [],
        hp: seeGeneral || !p.generalId ? p.hp : null,
        maxHp: seeGeneral || !p.generalId ? p.maxHp : null,
        handCount: p.hand.length,
        hand: showHand
          ? p.hand.map((id) => publicCard(cardById(game, id)))
          : null,
        equips: (() => {
          let armor = p.equips.armor;
          try {
            const helpers = require('./hero/_infra_helpers');
            if (!armor) armor = helpers.effectiveArmor(p);
          } catch (_) {
            /* ignore */
          }
          return {
            weapon: publicCard(p.equips.weapon),
            armor: publicCard(armor),
            horseMinus: publicCard(p.equips.horseMinus),
            horsePlus: publicCard(p.equips.horsePlus),
            treasure: publicCard(p.equips.treasure),
          };
        })(),
        chained: Boolean(p.chained),
        turnedOver: Boolean(p.turnedOver),
        skillPiles: (() => {
          const piles = p.skillPiles || {};
          const out = {};
          for (const key of Object.keys(piles)) {
            if (key === 'muniu' && !isSelf) {
              out[key] = [];
              continue;
            }
            out[key] = (piles[key] || []).map((id) =>
              publicCard(cardById(game, id))
            );
          }
          return out;
        })(),
        judges: p.judges.map((id) => publicCard(cardById(game, id))),
        distanceFromMe: viewer ? distance(game, viewerId, p.id) : null,
        inMyAttackRange: viewer
          ? inAttackRange(game, viewerId, p.id)
          : false,
        canAttackMe: viewer
          ? inAttackRange(game, p.id, viewerId)
          : false,
      };
    }),
    me: viewer
      ? {
          id: viewer.id,
          team: viewer.team || null,
          isMyTurn:
            game.phase === 'playing' &&
            currentPlayer(game) &&
            currentPlayer(game).id === viewer.id,
          turnPhase: game.turnPhase,
          canEndPlay:
            game.turnPhase === 'play' &&
            !game.pending &&
            currentPlayer(game) &&
            currentPlayer(game).id === viewer.id,
          attackRange: attackRange(viewer),
          shaUsed: viewer.shaUsed || 0,
          shaLimit: shaLimit(game, viewer),
          ignoreShaDistance: Boolean(
            viewer.skillStates && viewer.skillStates.paoxiaoNoDistance
          ),
          muniuCards: (() => {
            const ids = (viewer.skillPiles && viewer.skillPiles.muniu) || [];
            return ids.map((id) => {
              const c = publicCard(cardById(game, id));
              c.onMuniu = true;
              c.muniuLabel = '木牛';
              return c;
            });
          })(),
          activeSkills:
            skillBus && game.phase === 'playing'
              ? skillBus.listActiveSkills(game, viewer)
              : [],
          skillPanel:
            skillBus && game.phase === 'playing'
              ? skillBus.listSkillPanel(game, viewer)
              : [],
          lordSkills:
            skillBus && game.phase === 'playing'
              ? listLordRespondSkills(game, viewer)
              : [],
          viewAsOptions:
            skillBus && game.phase === 'playing'
              ? (() => {
                  const list = [
                    ...skillBus.listViewAs(game, viewer, 'sha', 'use'),
                    ...skillBus.listViewAs(game, viewer, 'guohe', 'use'),
                    ...skillBus.listViewAs(game, viewer, 'lebu', 'use'),
                    ...skillBus.listViewAs(game, viewer, 'juedou', 'use'),
                    ...skillBus.listViewAs(game, viewer, 'bingliang', 'use'),
                    ...skillBus.listViewAs(game, viewer, 'tiesuo', 'use'),
                    ...skillBus.listViewAs(game, viewer, 'huogong', 'use'),
                    ...skillBus.listViewAs(game, viewer, 'wuxie', 'use'),
                  ];
                  const pend = game.pending;
                  if (pend) {
                    const forMe =
                      pend.playerId === viewer.id || pend.askId === viewer.id;
                    if (forMe) {
                      if (
                        pend.type === 'respond_shan' ||
                        pend.type === 'aoe_shan'
                      ) {
                        list.push(
                          ...skillBus.listViewAs(game, viewer, 'shan', 'respond')
                        );
                      }
                      if (
                        pend.type === 'juedou' ||
                        pend.type === 'aoe_sha' ||
                        pend.type === 'jiedao'
                      ) {
                        list.push(
                          ...skillBus.listViewAs(game, viewer, 'sha', 'respond')
                        );
                      }
                      if (pend.type === 'dying') {
                        list.push(
                          ...skillBus.listViewAs(game, viewer, 'tao', 'respond')
                        );
                      }
                      if (pend.type === 'wuxie') {
                        list.push(
                          ...skillBus.listViewAs(game, viewer, 'wuxie', 'respond')
                        );
                      }
                    }
                  }
                  return list;
                })()
              : [],
        }
      : null,
    generalsPoolSize: GENERALS.length,
    huangjinUprising: Boolean(game.huangjinUprising),
    huangjinNotices:
      game.mode === 'xianzhu' &&
      viewer &&
      (xz.isHuangjinViewer(viewer) || game.huangjinUprising)
        ? (game._huangjinNotices || []).slice(-8)
        : [],
  };
}

// 安装技能总线
{
  const bridge = installSkillBridge({
    pushLog,
    getPlayer,
    cardById,
    drawCards,
    discardCard,
    takeFromHand,
    dealDamage,
    loseHp,
    recoverHp,
    drawJudgeCard,
    setPending,
    clearPending,
    alivePlayers,
    inAttackRange,
    distance,
    SUIT_COLOR,
    SUIT_LABEL,
    currentPlayer,
    beginJudgePhase,
    enterPlayPhase,
    enterDiscardPhase,
    endTurn,
    advanceTurn,
    resumeAfterPending,
    continueShaAfterSkills,
    openJudgeRevealPending,
    openSkillJudgeRevealPending,
    beginSkillJudgeReveal,
    playWanjian,
    askAoe,
    playSha,
    advanceWhenTrickTarget,
    continueTrickAfterTargets,
    startJuedou(game, a, b, opts) {
      return trickFlow.startJuedou(game, a, b, opts);
    },
    helpersFromNext(game, lordId, country) {
      return trickFlow.helpersFromNext(game, lordId, country);
    },
  });
  skillBus = bridge.skillBus;
  resolveSkillEffect = bridge.resolveSkillEffect;
  resumeAfterSkill = bridge.resumeAfterSkill;
  finishDrawPhase = bridge.finishDrawPhase;
  doDiscardOrEnd = bridge.doDiscardOrEnd;
  trickFlow = createTrickFlow({
    skillBus,
    getPlayer,
    cardById,
    discardCard,
    takeFromHand,
    setPending,
    clearPending,
    pushLog,
    nextAliveSeat,
    prevAliveSeat,
    resumeAfterSkill,
    beginDelayedJudgeReveal,
    beginSkillJudgeReveal,
    cancelDelayedJudge,
  });
}

/** 当前需要做出操作的玩家（思考时间计时对象） */
function getActingPlayerIds(game) {
  if (!game || game.over) return [];

  if (game.phase === 'bid_lord' && game.bidState) {
    const id = game.bidState.order[game.bidState.index];
    return id ? [id] : [];
  }

  if (game.phase === 'ban_general' && game.banState) {
    const id = game.banState.order[game.banState.index];
    return id ? [id] : [];
  }

  if (game.phase === 'select_general') {
    if (
      (game.mode === 'identity' || game.mode === 'xianzhu') &&
      game.selectGeneralPhase === 'lord'
    ) {
      const lord = game.players.find((p) => isSelectLordSeat(game, p));
      return lord && !lord.generalId ? [lord.id] : [];
    }
    return game.players.filter((p) => !p.generalId).map((p) => p.id);
  }

  if (game.pending) {
    const pend = game.pending;
    if (pend.type === 'wuxie') {
      if (pend.phase === 'collect' && pend.waiting && pend.waiting.length) {
        return pend.waiting.slice();
      }
      if (pend.phase === 'reveal' && pend.askId) {
        return [pend.askId];
      }
    }
    const id = pend.askId || pend.playerId;
    return id ? [id] : [];
  }

  if (game.phase === 'playing') {
    const cur = currentPlayer(game);
    if (cur && (game.turnPhase === 'play' || game.turnPhase === 'discard')) {
      return [cur.id];
    }
  }

  return [];
}

function actingHintFor(game, playerId) {
  if (game.pending) {
    const pend = game.pending;
    const msg = pend.message || '';
    if (pend.type === 'respond_shan') return '请出【闪】';
    if (pend.type === 'aoe_shan') return '请出【闪】';
    if (pend.type === 'juedou') return '请出【杀】';
    if (pend.type === 'dying') return '请救【桃】';
    if (pend.type === 'discard') return msg || '请弃牌';
    if (pend.type === 'wuxie') {
      if (pend.phase === 'reveal') return '无懈结果';
      if (pend.waiting && pend.waiting.includes(playerId)) {
        return '可出【无懈】';
      }
      if (pend.responses && pend.responses[playerId]) {
        return '已选择，等待…';
      }
      return '等待无懈…';
    }
    if (pend.type === 'judge_reveal') return '判定中';
    if (pend.type === 'card_reveal') return pend.message || '展示中';
    if (pend.type === 'bagua_ask') return '是否发动【八卦阵】';
    if (pend.type === 'skill_effect' || pend.type === 'skill_ask') {
      return pend.skillName
        ? `请响应【${pend.skillName}】`
        : shortActingText(msg) || '请响应技能';
    }
    return shortActingText(msg) || '请操作';
  }
  if (game.phase === 'bid_lord') return '请叫分';
  if (game.phase === 'ban_general') return '请 Ban 将';
  if (game.phase === 'select_general') {
    if (
      (game.mode === 'identity' || game.mode === 'xianzhu') &&
      game.selectGeneralPhase === 'lord'
    ) {
      return '请主公选将';
    }
    return '请选将';
  }
  if (game.turnPhase === 'play') return '请出牌';
  if (game.turnPhase === 'discard') return '请弃牌';
  return '请操作';
}

function shortActingText(msg) {
  const s = String(msg || '').trim();
  if (!s) return '';
  if (s.length <= 14) return s;
  return s.slice(0, 13) + '…';
}

function buildActingPublic(game) {
  return getActingPlayerIds(game).map((id) => ({
    id,
    hint: actingHintFor(game, id),
  }));
}

/** 思考超时：自动完成必选操作或跳过/结束出牌 */
function forceTimeout(game, playerId) {
  if (!game || game.over) return { ok: true };

  if (game.phase === 'bid_lord') {
    return applyAction(game, playerId, {
      type: 'bid_lord',
      payload: { value: 0 },
    });
  }

  if (game.phase === 'ban_general') {
    const p = getPlayer(game, playerId);
    if (!p) return { ok: false, error: '玩家无效' };
    const pool = game.teamPools[enemyTeam(p.team)] || [];
    if (!pool.length) return { ok: false, error: '无可 Ban' };
    return applyAction(game, playerId, {
      type: 'ban_general',
      payload: { generalId: pool[0] },
    });
  }

  if (game.phase === 'select_general') {
    const choices = game.generalChoices[playerId] || [];
    const pick = choices.find((id) => !game.selectedGenerals.has(id));
    if (!pick) return { ok: false, error: '无可选武将' };
    return applyAction(game, playerId, {
      type: 'select_general',
      payload: { generalId: pick },
    });
  }

  if (game.pending) {
    const pend = game.pending;
    const askId = pend.askId || pend.playerId;
    if (askId !== playerId) return { ok: false, error: '未轮到你' };

    if (pend.type === 'discard') {
      const p = getPlayer(game, playerId);
      const ids = (p && p.hand ? p.hand : []).slice(0, pend.count);
      return applyAction(game, playerId, {
        type: 'respond',
        payload: { cardIds: ids },
      });
    }

    if (
      pend.type === 'choose_discard_target_card' ||
      pend.type === 'choose_gain_target_card' ||
      pend.type === 'wugu'
    ) {
      const id =
        pend.type === 'wugu'
          ? (pend.shown || [])[0]
          : (pend.cardIds || [])[0];
      if (id) {
        return applyAction(game, playerId, {
          type: 'respond',
          payload: { cardId: id },
        });
      }
    }

    if (pend.type === 'pile_reorder') {
      const order = (pend.shown || pend.cardIds || []).slice();
      return applyAction(game, playerId, {
        type: 'respond',
        payload: { order },
      });
    }

    if (pend.type === 'card_reveal') {
      return finishCardReveal(game, playerId, { force: true });
    }

    if (pend.type === 'judge_reveal') {
      return finishJudgeReveal(game, playerId, { force: true });
    }

    if (pend.type === 'wuxie') {
      if (pend.phase === 'reveal') {
        return trickFlow.finishWuxieReveal(game, playerId, { force: true });
      }
      if (pend.phase === 'collect' && pend.waiting && pend.waiting.includes(playerId)) {
        return trickFlow.onWuxieResponse(game, playerId, null, true);
      }
    }

    if (pend.type === 'rebel_compensate') {
      return applyAction(game, playerId, {
        type: 'respond',
        payload: { choice: 'draw' },
      });
    }

    if (pend.type === 'succession') {
      const targetId =
        (pend.candidates && pend.candidates[0]) ||
        (pend.targetIds && pend.targetIds[0]) ||
        null;
      if (targetId) {
        return applyAction(game, playerId, {
          type: 'respond',
          payload: { targetId },
        });
      }
    }

    let r = applyAction(game, playerId, {
      type: 'respond',
      payload: { pass: true },
    });
    if (r.ok) return r;

    const opt = (pend.cardIds || [])[0];
    if (opt) {
      r = applyAction(game, playerId, {
        type: 'respond',
        payload: { cardId: opt },
      });
      if (r.ok) return r;
    }

    return r;
  }

  if (game.phase === 'playing' && game.turnPhase === 'play') {
    return applyAction(game, playerId, { type: 'end_play', payload: {} });
  }

  return { ok: true };
}

/** 主动退出：视为阵亡（走完整死亡流程） */
function onPlayerQuit(game, playerId) {
  if (!game || game.over) return;
  const p = getPlayer(game, playerId);
  if (!p || !p.alive) return;

  if (game.pending) {
    const askId = game.pending.askId || game.pending.playerId;
    if (askId === playerId) {
      forceTimeout(game, playerId);
    }
  }

  const dead = getPlayer(game, playerId);
  if (!dead || !dead.alive) return;

  pushLog(game, `${dead.name} 离开了游戏，视为阵亡`);
  killPlayer(game, dead, { kind: 'quit', sourceId: null, reason: 'quit' });
}

module.exports = {
  createGameState,
  applyAction,
  publicGameState,
  dealDamage,
  loseHp,
  getActingPlayerIds,
  forceTimeout,
  onPlayerQuit,
};
