'use strict';

const skillBus = require('./skillBus');
const { createCtx } = require('./skillCtx');

/**
 * 处理 pending.type === 'skill_effect' 的多步技能交互
 */
function resolveSkillEffect(game, playerId, payload, api) {
  const pend = game.pending;
  if (!pend || pend.type !== 'skill_effect') {
    return { ok: false, error: '非技能效果响应' };
  }
  if (pend.askId !== playerId) return { ok: false, error: '未轮到你' };

  const pass = Boolean(payload.pass);
  const player = api.getPlayer(game, pend.playerId);
  const skill = skillBus.findSkill(player, pend.skillId);

  switch (pend.skillId) {
    case 'fankui':
      return resolveFankui(game, pend, playerId, payload, api);
    case 'ganglie':
      return resolveGanglie(game, pend, playerId, payload, api);
    case 'tuxi':
      return resolveTuxi(game, pend, playerId, payload, api, pass);
    case 'luoyi':
      return resolveLuoyi(game, pend, playerId, payload, api, pass);
    case 'yiji':
      return resolveYiji(game, pend, playerId, payload, api, pass);
    case 'luoshen':
      return resolveLuoshen(game, pend, playerId, payload, api, pass);
    case 'fanjian':
      return resolveFanjian(game, pend, playerId, payload, api);
    case 'tieji':
      return resolveTieji(game, pend, playerId, payload, api, pass);
    case 'liuli':
      return resolveLiuli(game, pend, playerId, payload, api, pass);
    case 'liyu':
      return resolveLiyu(game, pend, playerId, payload, api, pass);
    case 'rende':
      return resolveRendeBasic(game, pend, playerId, payload, api);
    case 'hujia':
    case 'jijiang':
      return resolveHelperRespond(game, pend, playerId, payload, api, pass);
    case 'guicai':
      return resolveGuicai(game, pend, playerId, payload, api, pass);
    case 'luanwu':
      return resolveLuanwu(game, pend, playerId, payload, api, pass);
    case 'lieren':
      return resolveLieren(game, pend, playerId, payload, api, pass);
    case 'xiangle':
      return resolveXiangle(game, pend, playerId, payload, api, pass);
    case 'fangquan':
      return resolveFangquan(game, pend, playerId, payload, api, pass);
    case 'haoshi':
      return resolveHaoshi(game, pend, playerId, payload, api, pass);
    case 'tiaoxin':
      return resolveTiaoxin(game, pend, playerId, payload, api, pass);
    case 'zhiji':
      return resolveZhiji(game, pend, playerId, payload, api, pass);
    case 'beige':
      return resolveBeige(game, pend, playerId, payload, api, pass);
    case 'jixi':
      return resolveJixi(game, pend, playerId, payload, api, pass);
    case 'luoying':
      return resolveLuoying(game, pend, playerId, payload, api, pass);
    case 'jiushi':
      return resolveJiushi(game, pend, playerId, payload, api, pass);
    case 'enyuan':
      return resolveEnyuan(game, pend, playerId, payload, api, pass);
    case 'xuanhuo':
      return resolveXuanhuo(game, pend, playerId, payload, api, pass);
    case 'ganlu':
      return resolveGanlu(game, pend, playerId, payload, api, pass);
    case 'jujian':
      return resolveJujian(game, pend, playerId, payload, api, pass);
    case 'buyi':
      return resolveBuyi(game, pend, playerId, payload, api, pass);
    case 'tianxiang':
      return resolveTianxiang(game, pend, playerId, payload, api, pass);
    case 'mengjin':
      return resolveMengjin(game, pend, playerId, payload, api, pass);
    case 'jieming':
      return resolveJieming(game, pend, playerId, payload, api, pass);
    case 'quhu':
      return resolveQuhu(game, pend, playerId, payload, api, pass);
    case 'qice':
      return resolveQice(game, pend, playerId, payload, api, pass);
    case 'anxu':
      return resolveAnxu(game, pend, playerId, payload, api, pass);
    case 'jiefan':
      return resolveJiefan(game, pend, playerId, payload, api, pass);
    case 'danlao':
      return resolveDanlao(game, pend, playerId, payload, api, pass);
    case 'zhiyu':
      return resolveZhiyu(game, pend, playerId, payload, api, pass);
    default:
      api.clearPending(game);
      if (typeof api.resumeAfterSkill === 'function') api.resumeAfterSkill(game);
      return { ok: true };
  }
}

function resolveFankui(game, pend, playerId, payload, api) {
  const src = api.getPlayer(game, pend.sourceId);
  const me = api.getPlayer(game, pend.playerId);
  const cid = payload.cardId;
  if (!src || !cid) return { ok: false, error: '请选择一张牌' };
  if (src.hand.includes(cid)) {
    api.takeFromHand(src, cid);
    me.hand.push(cid);
  } else {
    const slot = Object.keys(src.equips || {}).find(
      (s) => src.equips[s] && src.equips[s].id === cid
    );
    if (!slot) return { ok: false, error: '牌不属于来源' };
    src.equips[slot] = null;
    me.hand.push(cid);
  }
  api.pushLog(game, me.name + ' 反馈获得一张牌');
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveGanglie(game, pend, playerId, payload, api) {
  const src = api.getPlayer(game, pend.sourceId);
  const cid = payload.cardId;
  if (!src || !cid) return { ok: false, error: '请选择弃置的牌' };
  if (src.hand.includes(cid)) api.discardCard(game, src, cid, 'hand');
  else {
    const slot = Object.keys(src.equips || {}).find(
      (s) => src.equips[s] && src.equips[s].id === cid
    );
    if (!slot) return { ok: false, error: '无效' };
    api.discardCard(game, src, cid, 'equip:' + slot);
  }
  api.pushLog(game, src.name + ' 因刚烈弃置一张牌');
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveTuxi(game, pend, playerId, payload, api, pass) {
  const me = api.getPlayer(game, pend.playerId);
  if (pass) {
    api.clearPending(game);
    // 正常摸牌
    game._tuxiSkip = false;
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const tids = payload.targetIds || (payload.targetId ? [payload.targetId] : []);
  if (tids.length < 1 || tids.length > 2) {
    return { ok: false, error: '请选择 1~2 名角色' };
  }
  for (const tid of tids) {
    const t = api.getPlayer(game, tid);
    if (!t || !t.hand.length) return { ok: false, error: '目标无效' };
  }
  me.skillStates = me.skillStates || {};
  me.skillStates._tuxiCount = tids.length;
  game._tuxiSkipDraw = tids.length;
  for (const tid of tids) {
    const t = api.getPlayer(game, tid);
    const cid = t.hand[Math.floor(Math.random() * t.hand.length)];
    api.takeFromHand(t, cid);
    me.hand.push(cid);
  }
  api.pushLog(game, me.name + ' 突袭获得 ' + tids.length + ' 张手牌');
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveLuoyi(game, pend, playerId, payload, api, pass) {
  const me = api.getPlayer(game, pend.playerId);
  const shown = pend.shown || (me.skillStates && me.skillStates._luoyiShown) || [];
  if (pass) {
    // 放回牌堆顶并正常摸牌
    game.drawPile = shown.concat(game.drawPile);
    if (me.skillStates) delete me.skillStates._luoyiShown;
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const take = [];
  const rest = [];
  for (const id of shown) {
    const c = api.cardById(game, id);
    if (
      c &&
      (c.type === 'basic' || (c.type === 'equip' && c.slot === 'weapon'))
    ) {
      take.push(id);
    } else rest.push(id);
  }
  for (const id of take) me.hand.push(id);
  game.discardPile.push(...rest);
  me.skillStates = me.skillStates || {};
  me.skillStates.luoyiBuff = true;
  me.skillStates._skipNormalDraw = true;
  if (me.skillStates) delete me.skillStates._luoyiShown;
  api.pushLog(game, me.name + ' 裸衣获得 ' + take.length + ' 张牌，本回合杀/决斗伤害+1');
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveYiji(game, pend, playerId, payload, api, pass) {
  const me = api.getPlayer(game, pend.playerId);
  if (pass) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const cid = payload.cardId;
  const tid = payload.targetId;
  if (!cid || !tid || !pend.cardIds.includes(cid)) {
    return { ok: false, error: '请选择要分配的牌与目标' };
  }
  const target = api.getPlayer(game, tid);
  if (!target) return { ok: false, error: '目标无效' };
  if (!me.hand.includes(cid)) return { ok: false, error: '没有此牌' };
  api.takeFromHand(me, cid);
  target.hand.push(cid);
  pend.cardIds = pend.cardIds.filter((id) => id !== cid);
  api.pushLog(game, me.name + ' 遗计将牌交给 ' + target.name);
  if (!pend.cardIds.length) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
  }
  return { ok: true };
}

function resolveLuoshen(game, pend, playerId, payload, api, pass) {
  const me = api.getPlayer(game, pend.playerId);
  api.clearPending(game);
  if (pass) {
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  // 继续判定
  const skill = skillBus.findSkill(me, 'luoshen');
  if (skill && skill.content) {
    const ctx = createCtx(api, game, { player: me, trigger: 'phasePrepare' });
    skill.content(ctx, skill);
  }
  if (!game.pending) api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveFanjian(game, pend, playerId, payload, api) {
  const me = api.getPlayer(game, pend.playerId);
  const target = api.getPlayer(game, pend.targetId);
  if (pend.step === 'suit') {
    const suit = payload.suit;
    if (!suit) return { ok: false, error: '请选择花色' };
    if (!me.hand.length) {
      api.clearPending(game);
      api.resumeAfterSkill(game);
      return { ok: true };
    }
    const cid = me.hand[Math.floor(Math.random() * me.hand.length)];
    const card = api.cardById(game, cid);
    api.takeFromHand(me, cid);
    target.hand.push(cid);
    api.pushLog(
      game,
      target.name +
        ' 反间获得 ' +
        api.SUIT_LABEL[card.suit] +
        card.number +
        '【' +
        card.name +
        '】'
    );
    if (card.suit !== suit) {
      api.dealDamage(game, me.id, target.id, 1);
    }
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  return { ok: false, error: '未知步骤' };
}

function resolveTieji(game, pend, playerId, payload, api, pass) {
  const target = api.getPlayer(game, playerId);
  if (pass) {
    // 不能出闪
    if (game._shaPend) game._shaPend.noShan = true;
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const cid = payload.cardId;
  if (!cid || !target.hand.includes(cid)) return { ok: false, error: '请弃置手牌' };
  const c = api.cardById(game, cid);
  if (c.suit !== pend.suit) return { ok: false, error: '花色不符' };
  api.discardCard(game, target, cid, 'hand');
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveLiuli(game, pend, playerId, payload, api, pass) {
  if (pass) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const me = api.getPlayer(game, pend.playerId);
  const cid = payload.cardId;
  const tid = payload.targetId;
  if (!cid || !tid) return { ok: false, error: '请弃牌并选目标' };
  if (tid === pend.attackerId || tid === me.id) {
    return { ok: false, error: '目标无效' };
  }
  if (!api.inAttackRange(game, me.id, tid)) {
    return { ok: false, error: '不在攻击范围' };
  }
  if (me.hand.includes(cid)) api.discardCard(game, me, cid, 'hand');
  else {
    const slot = Object.keys(me.equips || {}).find(
      (s) => me.equips[s] && me.equips[s].id === cid
    );
    if (!slot) return { ok: false, error: '没有此牌' };
    api.discardCard(game, me, cid, 'equip:' + slot);
  }
  if (game._shaPend) {
    game._shaPend.targetId = tid;
  }
  api.pushLog(
    game,
    me.name +
      ' 流离将【杀】转移给 ' +
      (api.getPlayer(game, tid) ? api.getPlayer(game, tid).name : tid)
  );
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveLiyu(game, pend, playerId, payload, api, pass) {
  if (pass) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const me = api.getPlayer(game, pend.playerId);
  const target = api.getPlayer(game, pend.targetId);
  if (pend.step === 'juedou') {
    const tid = payload.targetId;
    if (!tid || tid === me.id || tid === pend.targetId) {
      return { ok: false, error: '请选择另一名角色' };
    }
    const t2 = api.getPlayer(game, tid);
    if (!t2 || !t2.alive) return { ok: false, error: '目标无效' };
    api.pushLog(game, me.name + ' 利驭视为对 ' + t2.name + ' 使用【决斗】');
    api.clearPending(game);
    if (typeof api.startJuedou === 'function') {
      api.startJuedou(game, me.id, tid, { virtual: true });
    } else {
      return { ok: false, error: '决斗流程未就绪' };
    }
    return { ok: true };
  }
  const cid = payload.cardId;
  if (!cid || !target) return { ok: false, error: '请选牌' };
  let isEquip = false;
  if (target.hand.includes(cid)) {
    api.takeFromHand(target, cid);
    me.hand.push(cid);
  } else {
    const slot = Object.keys(target.equips || {}).find(
      (s) => target.equips[s] && target.equips[s].id === cid
    );
    if (slot) {
      isEquip = true;
      target.equips[slot] = null;
      me.hand.push(cid);
      if (typeof api.emitLoseEquip === 'function') {
        api.emitLoseEquip(game, target, cid);
      }
    } else if (target.judges.includes(cid)) {
      target.judges = target.judges.filter((id) => id !== cid);
      me.hand.push(cid);
    } else return { ok: false, error: '无效' };
  }
  if (!isEquip) {
    api.drawCards(game, target, 1);
    api.clearPending(game);
    api.resumeAfterSkill(game);
  } else {
    pend.step = 'juedou';
    pend.message = '利驭：选择另一名角色，视为对其使用【决斗】（可被无懈）';
    pend.gotEquip = true;
  }
  return { ok: true };
}

function resolveRendeBasic(game, pend, playerId, payload, api) {
  const name = payload.basicName;
  if (!['杀', '闪', '桃', '酒'].includes(name)) {
    return { ok: false, error: '请选择基本牌' };
  }
  api.pushLog(game, api.getPlayer(game, playerId).name + ' 仁德视为使用【' + name + '】');
  // 简化：桃回血，酒加伤害，杀需目标
  const me = api.getPlayer(game, playerId);
  if (name === '桃' && me.hp < me.maxHp) me.hp += 1;
  if (name === '酒') me.wineBuff = true;
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveHelperRespond(game, pend, playerId, payload, api, pass) {
  const helpers = pend.helpers || [];
  const lord = api.getPlayer(game, pend.playerId);
  const purpose = pend.purpose || (pend.skillId === 'hujia' ? 'shan' : 'sha');

  if (pass) {
    pend.index = (pend.index || 0) + 1;
    if (pend.index >= helpers.length) {
      api.clearPending(game);
      if (game._lordRespond && game._lordRespond.savedPending) {
        api.setPending(game, game._lordRespond.savedPending);
      }
      game._lordRespond = null;
      api.pushLog(game, `无人响应【${pend.skillName || pend.skillId}】`);
      return { ok: true };
    }
    const nextId = helpers[pend.index];
    const nextP = api.getPlayer(game, nextId);
    pend.askId = nextId;
    pend.message =
      (nextP ? nextP.name + '：' : '') +
      (purpose === 'shan'
        ? `护驾：请为 ${lord.name} 打出【闪】`
        : `激将：请为 ${lord.name} 打出【杀】`);
    return { ok: true };
  }

  const helper = api.getPlayer(game, playerId);
  const cid = payload.cardId;
  if (!cid || !helper.hand.includes(cid)) {
    return { ok: false, error: purpose === 'shan' ? '请出【闪】' : '请出【杀】' };
  }
  const c = api.cardById(game, cid);
  if (purpose === 'shan' && (!c || c.name !== '闪')) {
    return { ok: false, error: '必须是【闪】' };
  }
  if (
    purpose === 'sha' &&
    (!c || (c.name !== '杀' && c.name !== '火杀' && c.name !== '雷杀'))
  ) {
    return { ok: false, error: '必须是【杀】' };
  }
  api.discardCard(game, helper, cid, 'hand');
  api.pushLog(
    game,
    `${helper.name} 响应【${pend.skillName}】打出【${c.name}】（视为 ${lord.name}）`
  );

  const saved = game._lordRespond && game._lordRespond.savedPending;
  const shaTargets =
    (game._lordRespond && game._lordRespond.shaTargets) || [];
  game._lordRespond = null;
  api.clearPending(game);

  if (purpose === 'shan' && saved) {
    if (saved.type === 'respond_shan') {
      game.discardPile.push(saved.shaCardId);
      api.pushLog(game, `${lord.name}【闪】生效（护驾）`);
      return { ok: true };
    }
    if (saved.type === 'aoe_shan') {
      saved.index = (saved.index || 0) + 1;
      api.setPending(game, saved);
      if (typeof api.askAoe === 'function') api.askAoe(game);
      return { ok: true };
    }
  }

  if (purpose === 'sha') {
    if (saved && saved.type === 'juedou') {
      // 视为主公在决斗中打出了杀
      saved.askId = lord.id;
      saved.shaGot = (saved.shaGot || 0) + 1;
      const need = saved.needSha || 1;
      if (saved.shaGot < need) {
        saved.message = `决斗：${lord.name} 还需再出 ${need - saved.shaGot} 张【杀】`;
        api.setPending(game, saved);
        return { ok: true };
      }
      saved.shaGot = 0;
      const nextId = lord.id === saved.a ? saved.b : saved.a;
      const nextP = api.getPlayer(game, nextId);
      saved.askId = nextId;
      saved.message = `决斗：${nextP.name} 请打出【杀】`;
      api.setPending(game, saved);
      return { ok: true };
    }
    if (saved && saved.type === 'aoe_sha') {
      saved.index = (saved.index || 0) + 1;
      api.setPending(game, saved);
      if (typeof api.askAoe === 'function') api.askAoe(game);
      return { ok: true };
    }
    if (saved && saved.type === 'jiedao') {
      api.clearPending(game);
      api.pushLog(game, `${lord.name} 借刀出杀成功（激将）`);
      return { ok: true };
    }
    if (!saved && shaTargets.length && typeof api.resolveShaAs === 'function') {
      const vid = `virt_sha_${Date.now()}`;
      game.cards[vid] = {
        id: vid,
        name: '杀',
        type: 'basic',
        virtual: true,
        nature: c.nature || null,
      };
      return api.resolveShaAs(game, lord.id, shaTargets[0], game.cards[vid]);
    }
  }

  if (typeof api.resumeAfterSkill === 'function') api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveGuicai(game, pend, playerId, payload, api, pass) {
  if (pass) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const me = api.getPlayer(game, playerId);
  const cid = payload.cardId;
  if (!cid) return { ok: false, error: '请选牌' };
  if (me.hand.includes(cid)) api.discardCard(game, me, cid, 'hand');
  else {
    const slot = Object.keys(me.equips || {}).find(
      (s) => me.equips[s] && me.equips[s].id === cid
    );
    if (!slot) return { ok: false, error: '无效' };
    api.discardCard(game, me, cid, 'equip:' + slot);
  }
  // 替换判定牌
  if (game._currentJudgeCardId) {
    game.discardPile.push(game._currentJudgeCardId);
  }
  game._currentJudgeCardId = cid;
  // 从弃牌堆取出作为判定
  game.discardPile = game.discardPile.filter((id) => id !== cid);
  api.pushLog(game, me.name + ' 鬼才打出牌替换判定');
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function nearestTargets(game, fromId, api) {
  const from = api.getPlayer(game, fromId);
  if (!from) return [];
  const others = api
    .alivePlayers(game)
    .filter((p) => p.id !== fromId);
  if (!others.length) return [];
  let best = 99;
  const distFn =
    typeof api.distance === 'function'
      ? (a, b) => api.distance(game, a, b)
      : () => 1;
  for (const p of others) {
    const d = distFn(fromId, p.id);
    if (d < best) best = d;
  }
  return others.filter((p) => distFn(fromId, p.id) === best);
}

function advanceLuanwu(game, pend, api) {
  while (pend.index < pend.order.length) {
    const id = pend.order[pend.index];
    const p = api.getPlayer(game, id);
    if (p && p.alive) {
      pend.askId = id;
      pend.message =
        p.name + '：乱武 — 对距离最近的角色出【杀】，或失去1点体力';
      api.setPending(game, pend);
      return true;
    }
    pend.index += 1;
  }
  api.clearPending(game);
  if (typeof api.resumeAfterSkill === 'function') api.resumeAfterSkill(game);
  return false;
}

function resolveLuanwu(game, pend, playerId, payload, api, pass) {
  const me = api.getPlayer(game, playerId);
  if (!me || !me.alive) {
    pend.index += 1;
    advanceLuanwu(game, pend, api);
    return { ok: true };
  }
  if (pass || payload.loseHp) {
    api.loseHp(game, playerId, 1, { reason: '乱武' });
    pend.index += 1;
    if (game.pending && game.pending.type === 'dying') {
      game.stack = game.stack || [];
      game.stack.push({ resume: 'skill_effect', skill_effect: { ...pend, index: pend.index } });
      return { ok: true };
    }
    advanceLuanwu(game, pend, api);
    return { ok: true };
  }
  const tid = payload.targetId;
  const cid = payload.cardId;
  const nearest = nearestTargets(game, playerId, api).map((p) => p.id);
  if (!tid || !nearest.includes(tid)) {
    return { ok: false, error: '请选择距离最近的角色' };
  }
  if (!cid || !me.hand.includes(cid)) {
    return { ok: false, error: '请打出【杀】' };
  }
  const c = api.cardById(game, cid);
  if (!c || (c.name !== '杀' && c.name !== '火杀' && c.name !== '雷杀')) {
    return { ok: false, error: '须使用【杀】' };
  }
  pend.index += 1;
  api.clearPending(game);
  if (typeof api.playSha === 'function') {
    const r = api.playSha(game, me, c, [tid], { ignoreShaCount: true });
    if (r && r.ok === false) {
      api.loseHp(game, playerId, 1, { reason: '乱武' });
    }
  } else {
    api.discardCard(game, me, cid, 'hand');
    api.dealDamage(game, playerId, tid, 1, { reason: '乱武' });
  }
  if (game.pending) {
    game.stack = game.stack || [];
    game.stack.push({
      resume: 'skill_effect',
      skill_effect: { ...pend, index: pend.index },
    });
    return { ok: true };
  }
  advanceLuanwu(game, pend, api);
  return { ok: true };
}

function resolveLieren(game, pend, playerId, payload, api, pass) {
  if (pass) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const me = api.getPlayer(game, pend.playerId);
  const target = api.getPlayer(game, pend.targetId);
  if (pend.step === 'gain') {
    const cid = payload.cardId;
    if (!cid || !target) return { ok: false, error: '请选牌' };
    if (target.hand.includes(cid)) {
      api.takeFromHand(target, cid);
      me.hand.push(cid);
    } else {
      const slot = Object.keys(target.equips || {}).find(
        (s) => target.equips[s] && target.equips[s].id === cid
      );
      if (!slot) return { ok: false, error: '无效' };
      target.equips[slot] = null;
      me.hand.push(cid);
    }
    api.pushLog(game, me.name + ' 烈刃获得一张牌');
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const cid = payload.cardId;
  if (!cid || !me.hand.includes(cid)) return { ok: false, error: '请选择拼点牌' };
  if (!target || !target.hand.length) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const theirId = target.hand[Math.floor(Math.random() * target.hand.length)];
  const { resolvePinDian } = require('./_infra_helpers');
  const result = resolvePinDian(game, me, cid, target, theirId, api);
  // 「若你赢」才获得牌；平局/输均无此效果
  if (result.winnerId === me.id) {
    const has =
      target.hand.length +
        Object.values(target.equips || {}).filter(Boolean).length >
      0;
    if (has) {
      pend.step = 'gain';
      pend.message = '烈刃：获得目标一张牌';
      pend.askId = me.id;
      return { ok: true };
    }
  }
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveXiangle(game, pend, playerId, payload, api, pass) {
  const src = api.getPlayer(game, pend.sourceId || pend.askId);
  if (pass) {
    // 杀无效
    if (game._shaPend) {
      game.discardPile.push(game._shaPend.cardId);
      api.pushLog(game, (src ? src.name : '') + ' 未弃基本牌，享乐令【杀】无效');
      game._shaPend = null;
    }
    api.clearPending(game);
    if (typeof api.resumeAfterSkill === 'function') api.resumeAfterSkill(game);
    return { ok: true };
  }
  const cid = payload.cardId;
  if (!cid || !src || !src.hand.includes(cid)) {
    return { ok: false, error: '请弃置一张基本牌' };
  }
  const c = api.cardById(game, cid);
  if (!c || c.type !== 'basic') return { ok: false, error: '须弃置基本牌' };
  api.discardCard(game, src, cid, 'hand');
  api.pushLog(game, src.name + ' 因享乐弃置【' + c.name + '】');
  api.clearPending(game);
  if (typeof api.resumeAfterSkill === 'function') api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveFangquan(game, pend, playerId, payload, api, pass) {
  const me = api.getPlayer(game, pend.playerId);
  if (me && me.skillStates) delete me.skillStates.fangquanPending;
  if (pass) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const tid = payload.targetId;
  const t = api.getPlayer(game, tid);
  if (!t || !t.alive || t.id === pend.playerId) {
    return { ok: false, error: '请选择其他角色' };
  }
  game._extraTurnQueue = game._extraTurnQueue || [];
  game._extraTurnQueue.push(t.id);
  api.pushLog(game, me.name + ' 放权令 ' + t.name + ' 获得一个额外回合');
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveHaoshi(game, pend, playerId, payload, api, pass) {
  if (pass) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const me = api.getPlayer(game, pend.playerId);
  const tid = payload.targetId;
  const ids = payload.cardIds || [];
  const give = pend.giveCount || 0;
  if (!tid || !(pend.candidateIds || []).includes(tid)) {
    return { ok: false, error: '请选择手牌最少的角色' };
  }
  if (ids.length !== give) return { ok: false, error: '请交出 ' + give + ' 张手牌' };
  const target = api.getPlayer(game, tid);
  if (!target) return { ok: false, error: '目标无效' };
  for (const id of ids) {
    if (!me.hand.includes(id)) return { ok: false, error: '没有此牌' };
    api.takeFromHand(me, id);
    target.hand.push(id);
  }
  api.pushLog(game, me.name + ' 好施将 ' + give + ' 张牌交给 ' + target.name);
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveTiaoxin(game, pend, playerId, payload, api, pass) {
  const target = api.getPlayer(game, pend.targetId || pend.askId);
  const me = api.getPlayer(game, pend.playerId);
  if (!pass && payload.cardId) {
    const cid = payload.cardId;
    if (!target.hand.includes(cid)) return { ok: false, error: '请出【杀】' };
    const c = api.cardById(game, cid);
    if (!c || (c.name !== '杀' && c.name !== '火杀' && c.name !== '雷杀')) {
      return { ok: false, error: '须使用【杀】' };
    }
    api.clearPending(game);
    if (typeof api.playSha === 'function') {
      return api.playSha(game, target, c, [me.id], {});
    }
    api.discardCard(game, target, cid, 'hand');
    api.dealDamage(game, target.id, me.id, 1, { reason: '挑衅' });
    if (typeof api.resumeAfterSkill === 'function') api.resumeAfterSkill(game);
    return { ok: true };
  }
  // 弃置其一张牌
  const zones = [];
  for (const id of target.hand) zones.push({ id, from: 'hand' });
  for (const slot of Object.keys(target.equips || {})) {
    if (target.equips[slot]) {
      zones.push({ id: target.equips[slot].id, from: 'equip:' + slot });
    }
  }
  if (!zones.length) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const pick = payload.cardId
    ? zones.find((z) => z.id === payload.cardId)
    : zones[0];
  if (!pick) return { ok: false, error: '请选择要弃置的牌' };
  api.discardCard(game, target, pick.id, pick.from);
  api.pushLog(game, me.name + ' 挑衅弃置 ' + target.name + ' 一张牌');
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveZhiji(game, pend, playerId, payload, api) {
  const me = api.getPlayer(game, pend.playerId);
  const choice = payload.choice || payload.option;
  if (choice === 'draw' || choice === '摸牌') {
    api.drawCards(game, me, 2);
  } else {
    if (typeof api.recoverHp === 'function') {
      api.recoverHp(game, me, me, 1);
    } else if (me.hp < me.maxHp) me.hp += 1;
  }
  me.maxHp = Math.max(1, me.maxHp - 1);
  if (me.hp > me.maxHp) me.hp = me.maxHp;
  const { gainSkill } = require('./_infra_helpers');
  gainSkill(me, {
    id: 'guanxing',
    name: '观星',
    desc: '准备阶段，你可以观看牌堆顶的牌并调整顺序。',
  });
  api.pushLog(game, me.name + ' 志继觉醒，获得【观星】');
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function discardOneFrom(game, player, cardId, api) {
  if (player.hand.includes(cardId)) {
    api.discardCard(game, player, cardId, 'hand');
    return true;
  }
  const slot = Object.keys(player.equips || {}).find(
    (s) => player.equips[s] && player.equips[s].id === cardId
  );
  if (slot) {
    api.discardCard(game, player, cardId, 'equip:' + slot);
    return true;
  }
  return false;
}

function resolveBeige(game, pend, playerId, payload, api, pass) {
  if (pass) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const me = api.getPlayer(game, pend.playerId);
  const cid = payload.cardId;
  if (!cid || !discardOneFrom(game, me, cid, api)) {
    return { ok: false, error: '请弃置一张牌' };
  }
  const victim = api.getPlayer(game, pend.targetId);
  const src = api.getPlayer(game, pend.sourceId);
  const jid = api.drawJudgeCard(game);
  if (!jid || !victim) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const jc = api.cardById(game, jid);
  game.discardPile.push(jid);
  api.pushLog(
    game,
    me.name + ' 悲歌判定 ' + api.SUIT_LABEL[jc.suit] + jc.number
  );
  if (jc.suit === 'diamond') {
    api.drawCards(game, victim, 2);
  } else if (jc.suit === 'heart') {
    if (typeof api.recoverHp === 'function') api.recoverHp(game, me, victim, 1);
    else if (victim.hp < victim.maxHp) victim.hp += 1;
  } else if (jc.suit === 'club') {
    if (src && src.alive) {
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
    }
  } else if (jc.suit === 'spade') {
    if (src && src.alive) {
      src.turnedOver = !src.turnedOver;
      api.pushLog(
        game,
        src.name + ' 因悲歌翻至' + (src.turnedOver ? '背面' : '正面')
      );
    }
  }
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveJixi(game, pend, playerId, payload, api, pass) {
  if (pass) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const me = api.getPlayer(game, pend.playerId);
  const skill = skillBus.findSkill(me, 'jixi');
  if (!skill || !skill.content) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  api.clearPending(game);
  const ctx = createCtx(api, game, {
    player: me,
    payload: {
      cardId: payload.cardId,
      targetId: payload.targetId,
    },
  });
  skill.content(ctx, skill);
  if (!game.pending && typeof api.resumeAfterSkill === 'function') {
    api.resumeAfterSkill(game);
  }
  return { ok: true };
}

function resolveLuoying(game, pend, playerId, payload, api, pass) {
  const me = api.getPlayer(game, pend.playerId);
  if (pass) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  for (const id of pend.cardIds || []) {
    game.discardPile = game.discardPile.filter((x) => x !== id);
    if (!me.hand.includes(id)) me.hand.push(id);
  }
  api.pushLog(game, me.name + ' 落英获得梅花牌');
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveJiushi(game, pend, playerId, payload, api, pass) {
  const me = api.getPlayer(game, pend.playerId);
  if (!pass && me && me.turnedOver) {
    me.turnedOver = false;
    api.pushLog(game, me.name + ' 酒诗翻至正面');
  }
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveEnyuan(game, pend, playerId, payload, api, pass) {
  const src = api.getPlayer(game, pend.sourceId);
  const me = api.getPlayer(game, pend.targetId || pend.playerId);
  if (pass || !payload.cardId) {
    if (src && src.alive) api.loseHp(game, src.id, 1, { reason: '恩怨' });
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const cid = payload.cardId;
  if (!src || !src.hand.includes(cid)) {
    return { ok: false, error: '请选择红桃手牌' };
  }
  const c = api.cardById(game, cid);
  if (!c || c.suit !== 'heart') return { ok: false, error: '须为红桃' };
  api.takeFromHand(src, cid);
  me.hand.push(cid);
  api.pushLog(game, src.name + ' 因恩怨交给 ' + me.name + ' 一张红桃');
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveXuanhuo(game, pend, playerId, payload, api, pass) {
  const me = api.getPlayer(game, pend.playerId);
  if (pass && pend.step === 'give') {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  if (pend.step === 'give') {
    const skill = skillBus.findSkill(me, 'xuanhuo');
    api.clearPending(game);
    if (skill && skill.content) {
      const ctx = createCtx(api, game, {
        player: me,
        payload: {
          cardId: payload.cardId,
          targetId: payload.targetId,
        },
      });
      skill.content(ctx, skill);
    }
    if (!game.pending) api.resumeAfterSkill(game);
    return { ok: true };
  }
  if (pend.step === 'take') {
    const target = api.getPlayer(game, pend.targetId);
    const cid = payload.cardId;
    if (!target || !cid) return { ok: false, error: '请选牌' };
    if (target.hand.includes(cid)) {
      api.takeFromHand(target, cid);
    } else {
      const slot = Object.keys(target.equips || {}).find(
        (s) => target.equips[s] && target.equips[s].id === cid
      );
      if (!slot) return { ok: false, error: '无效' };
      target.equips[slot] = null;
    }
    pend.gotCardId = cid;
    pend.step = 'giveOther';
    pend.message = '眩惑：将获得的牌交给另一名角色（非原目标）';
    return { ok: true };
  }
  if (pend.step === 'giveOther') {
    const tid = payload.targetId;
    if (!tid || tid === pend.targetId) {
      return { ok: false, error: '请选择另一名角色' };
    }
    const other = api.getPlayer(game, tid);
    if (!other || !other.alive) return { ok: false, error: '目标无效' };
    other.hand.push(pend.gotCardId);
    api.pushLog(game, me.name + ' 眩惑将牌交给 ' + other.name);
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  return { ok: false, error: '未知步骤' };
}

function resolveGanlu(game, pend, playerId, payload, api, pass) {
  if (pass) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const me = api.getPlayer(game, pend.playerId);
  const skill = skillBus.findSkill(me, 'ganlu');
  api.clearPending(game);
  if (skill && skill.content) {
    const ctx = createCtx(api, game, {
      player: me,
      payload: {
        targetA: payload.targetA || (payload.targetIds || [])[0],
        targetB: payload.targetB || (payload.targetIds || [])[1],
        targetIds: payload.targetIds,
      },
    });
    skill.content(ctx, skill);
  }
  if (!game.pending) api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveJujian(game, pend, playerId, payload, api, pass) {
  if (pass) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const me = api.getPlayer(game, pend.playerId);
  const skill = skillBus.findSkill(me, 'jujian');
  api.clearPending(game);
  if (skill && skill.content) {
    const ctx = createCtx(api, game, {
      player: me,
      payload: {
        cardIds: payload.cardIds || (payload.cardId ? [payload.cardId] : []),
        targetId: payload.targetId,
      },
    });
    skill.content(ctx, skill);
  }
  if (!game.pending) api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveBuyi(game, pend, playerId, payload, api, pass) {
  if (pass) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const dying = api.getPlayer(game, pend.dyingId);
  const cid = payload.cardId;
  if (!dying || !cid || !dying.hand.includes(cid)) {
    return { ok: false, error: '请选择要展示的手牌' };
  }
  const c = api.cardById(game, cid);
  api.pushLog(
    game,
    dying.name + ' 展示手牌【' + (c ? c.name : cid) + '】'
  );
  if (c && c.type !== 'basic') {
    api.discardCard(game, dying, cid, 'hand');
    if (typeof api.recoverHp === 'function') {
      api.recoverHp(game, api.getPlayer(game, pend.playerId), dying, 1);
    } else if (dying.hp < dying.maxHp) {
      dying.hp += 1;
    }
    api.pushLog(game, dying.name + ' 因补益弃置非基本牌并回复 1 点体力');
  }
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveTianxiang(game, pend, playerId, payload, api, pass) {
  if (pass) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const me = api.getPlayer(game, pend.playerId);
  const cid = payload.cardId;
  const tid = payload.targetId;
  if (!me || !cid || !me.hand.includes(cid)) {
    return { ok: false, error: '请弃置一张红桃手牌' };
  }
  const card = api.cardById(game, cid);
  let suit = card && card.suit;
  try {
    const helpers = require('./_infra_helpers');
    suit = helpers.effectiveSuit(me, card);
  } catch (_) {
    /* ignore */
  }
  if (suit !== 'heart') return { ok: false, error: '须为红桃手牌' };
  const t = api.getPlayer(game, tid);
  if (!t || !t.alive || t.id === me.id) {
    return { ok: false, error: '请选择其他角色' };
  }
  api.discardCard(game, me, cid, 'hand');
  const amt = Math.max(1, pend.amount | 0);
  // 已受伤：先回复自身，再转移伤害
  if (me.hp < me.maxHp) {
    me.hp = Math.min(me.maxHp, me.hp + amt);
  }
  api.dealDamage(pend.sourceId || null, t.id, amt, {
    nature: pend.nature || null,
    reason: '天香',
  });
  const lost = Math.max(0, t.maxHp - t.hp);
  if (lost > 0 && t.alive) api.drawCards(game, t, lost);
  api.pushLog(game, `${me.name} 天香：伤害转移给 ${t.name}`);
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveMengjin(game, pend, playerId, payload, api, pass) {
  if (pass) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const target = api.getPlayer(game, pend.targetId);
  const cid = payload.cardId;
  if (!target || !cid) return { ok: false, error: '请选择目标一张牌' };
  if (target.hand.includes(cid)) {
    api.discardCard(game, target, cid, 'hand');
  } else {
    const slot = Object.keys(target.equips || {}).find(
      (s) => target.equips[s] && target.equips[s].id === cid
    );
    if (!slot) return { ok: false, error: '无效的牌' };
    api.discardCard(game, target, cid, 'equip:' + slot);
  }
  api.pushLog(game, `${api.getPlayer(game, pend.playerId).name} 猛进弃置目标一张牌`);
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveJieming(game, pend, playerId, payload, api, pass) {
  if (pass) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const t = api.getPlayer(game, payload.targetId);
  if (!t || !t.alive) return { ok: false, error: '请选择一名角色' };
  const cap = Math.min(t.maxHp, 5);
  const need = cap - t.hand.length;
  if (need > 0) api.drawCards(game, t, need);
  api.pushLog(
    game,
    `${api.getPlayer(game, pend.playerId).name} 节命：令 ${t.name} 手牌至 ${cap}`
  );
  pend.amount = (pend.amount || 1) - 1;
  if (pend.amount > 0) {
    pend.message = `节命：还可令一名角色补手牌（剩余 ${pend.amount} 次），或取消`;
    return { ok: true };
  }
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveQuhu(game, pend, playerId, payload, api, pass) {
  if (pass) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const me = api.getPlayer(game, pend.playerId);
  const target = api.getPlayer(game, pend.targetId);
  if (!me || !target) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  if (pend.step === 'pindian') {
    const myCard = payload.cardId;
    const theirCard = payload.targetCardId;
    if (!myCard || !theirCard) return { ok: false, error: '请双方各选一张手牌' };
    if (!me.hand.includes(myCard) || !target.hand.includes(theirCard)) {
      return { ok: false, error: '手牌无效' };
    }
    let result;
    try {
      const helpers = require('./_infra_helpers');
      result = helpers.resolvePinDian(game, me, myCard, target, theirCard, api);
    } catch (_) {
      return { ok: false, error: '拼点失败' };
    }
    me.skillStates = me.skillStates || {};
    me.skillStates['quhu:phase'] = true;
    // 「若你赢」
    if (result.winnerId === me.id) {
      pend.step = 'damage';
      pend.message = '驱虎：选择其攻击范围内一名角色造成伤害';
      pend.minTargets = 1;
      pend.maxTargets = 1;
      return { ok: true };
    }
    // 「若你没赢」（含平局）
    api.dealDamage(target.id, me.id, 1, { reason: '驱虎' });
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  if (pend.step === 'damage') {
    const tid = payload.targetId || payload.damageTargetId;
    const dt = api.getPlayer(game, tid);
    if (!dt || !dt.alive || dt.id === target.id) {
      return { ok: false, error: '请选择合法目标' };
    }
    if (!api.inAttackRange(target.id, dt.id)) {
      return { ok: false, error: '不在其攻击范围' };
    }
    api.dealDamage(target.id, dt.id, 1, { reason: '驱虎' });
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

const QICE_TRICK_MAP = {
  wuzhong: { name: '无中生有', minTargets: 0, maxTargets: 0 },
  guohe: { name: '过河拆桥', minTargets: 1, maxTargets: 1 },
  shunshou: { name: '顺手牵羊', minTargets: 1, maxTargets: 1 },
  juedou: { name: '决斗', minTargets: 1, maxTargets: 1 },
  huogong: { name: '火攻', minTargets: 1, maxTargets: 1 },
  tiesuo: { name: '铁索连环', minTargets: 0, maxTargets: 2 },
  nanman: { name: '南蛮入侵', minTargets: 0, maxTargets: 0 },
  wanjian: { name: '万箭齐发', minTargets: 0, maxTargets: 0 },
};

function qiceTrickId(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw.id || raw.option || null;
  const s = String(raw);
  if (QICE_TRICK_MAP[s]) return s;
  for (const [id, info] of Object.entries(QICE_TRICK_MAP)) {
    if (info.name === s) return id;
  }
  return null;
}

function restoreQiceCardFace(card) {
  if (!card || !card._qiceOrig) return;
  const o = card._qiceOrig;
  card.name = o.name;
  card.type = o.type;
  card.subtype = o.subtype;
  card.nature = o.nature;
  card.slot = o.slot;
  card.range = o.range;
  delete card._qiceOrig;
  delete card._viewAs;
  delete card._qiceBundle;
}

function executeQiceUse(game, me, trickId, targets, api) {
  const info = QICE_TRICK_MAP[trickId];
  if (!info) return { ok: false, error: '无效锦囊' };
  const handIds = me.hand.slice();
  if (!handIds.length) return { ok: false, error: '没有手牌' };

  const first = handIds[0];
  for (const id of handIds) {
    if (me.hand.includes(id)) api.takeFromHand(me, id);
    if (id !== first) game.discardPile.push(id);
  }
  me.hand.push(first);

  const card = api.cardById(game, first);
  if (!card) return { ok: false, error: '牌不存在' };
  card._qiceOrig = {
    name: card.name,
    type: card.type,
    subtype: card.subtype,
    nature: card.nature,
    slot: card.slot,
    range: card.range,
  };
  card._qiceBundle = handIds.slice();
  card.name = info.name;
  card.type = 'trick';
  card.subtype =
    trickId === 'tiesuo' ? 'tiesuo' : trickId === 'juedou' ? 'juedou' : undefined;
  card._viewAs = 'qice';

  me.skillStates = me.skillStates || {};
  me.skillStates.qice = true;

  api.clearPending(game);
  api.pushLog(
    game,
    `${me.name} 奇策：将 ${handIds.length} 张手牌当【${info.name}】使用`
  );

  const useFn =
    typeof api.useCard === 'function'
      ? api.useCard
      : typeof api.useCardByPlayer === 'function'
        ? api.useCardByPlayer
        : null;
  if (!useFn) {
    restoreQiceCardFace(card);
    for (const id of handIds) {
      game.discardPile = game.discardPile.filter((x) => x !== id);
      if (!me.hand.includes(id)) me.hand.push(id);
    }
    delete me.skillStates.qice;
    return { ok: false, error: '引擎未接入出牌' };
  }

  const r = useFn(game, me.id, first, targets || []);
  if (!r || !r.ok) {
    // 出牌失败：还原手牌与牌面
    restoreQiceCardFace(card);
    for (const id of handIds) {
      game.discardPile = game.discardPile.filter((x) => x !== id);
      if (!me.hand.includes(id)) me.hand.push(id);
    }
    delete me.skillStates.qice;
    if (!game.pending) {
      api.setPending(game, {
        type: 'skill_effect',
        skillId: 'qice',
        step: 'choose_trick',
        playerId: me.id,
        askId: me.id,
        options: Object.keys(QICE_TRICK_MAP).map((id) => ({
          id,
          name: QICE_TRICK_MAP[id].name,
        })),
        message: '奇策：选择一张非延时锦囊（将全部手牌当该锦囊使用）',
        canPass: true,
      });
    }
    return r || { ok: false, error: '使用失败' };
  }
  return r;
}

function resolveQice(game, pend, playerId, payload, api, pass) {
  if (pass) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const me = api.getPlayer(game, pend.playerId);
  if (!me || me.id !== playerId) return { ok: false, error: '不是你的奇策' };

  const step = pend.step || 'choose_trick';

  if (step === 'choose_trick') {
    const trickId = qiceTrickId(
      payload.option || payload.trick || payload.choice || payload.optionId
    );
    if (!trickId || !QICE_TRICK_MAP[trickId]) {
      return { ok: false, error: '请选择锦囊' };
    }
    const info = QICE_TRICK_MAP[trickId];
    // 无需目标：直接当真锦囊结算
    if (info.maxTargets === 0 && info.minTargets === 0) {
      return executeQiceUse(game, me, trickId, [], api);
    }
    // 铁索：可重铸（0 目标）或选 1～2 名目标
    api.setPending(game, {
      type: 'skill_effect',
      skillId: 'qice',
      step: 'choose_targets',
      trickId,
      trickName: info.name,
      playerId: me.id,
      askId: me.id,
      minTargets: info.minTargets,
      maxTargets: info.maxTargets,
      message:
        trickId === 'tiesuo'
          ? '奇策·铁索连环：点选 1～2 名角色（各自横置状态取反），或点「重置」摸 1 张'
          : `奇策·${info.name}：请选择目标后确认使用`,
      canPass: true,
    });
    return { ok: true };
  }

  if (step === 'choose_targets') {
    const trickId = pend.trickId || qiceTrickId(payload.option);
    const info = QICE_TRICK_MAP[trickId];
    if (!info) return { ok: false, error: '锦囊无效' };
    let targets =
      payload.targets ||
      payload.targetIds ||
      (payload.targetId ? [payload.targetId] : []);
    targets = (targets || []).filter(Boolean);
    if (payload.recast || payload.chongzhu) targets = [];
    if (targets.length < info.minTargets) {
      return { ok: false, error: `请选择至少 ${info.minTargets} 名目标` };
    }
    if (targets.length > info.maxTargets) {
      targets = targets.slice(0, info.maxTargets);
    }
    return executeQiceUse(game, me, trickId, targets, api);
  }

  return { ok: false, error: '奇策步骤无效' };
}

function resolveAnxu(game, pend, playerId, payload, api, pass) {
  if (pass) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const fewer = api.getPlayer(game, pend.fewerId);
  const more = api.getPlayer(game, pend.moreId);
  const me = api.getPlayer(game, pend.playerId);
  const cid = payload.cardId;
  if (!fewer || !more || !cid || !more.hand.includes(cid)) {
    return { ok: false, error: '请选择一张手牌' };
  }
  api.takeFromHand(more, cid);
  fewer.hand.push(cid);
  const c = api.cardById(game, cid);
  api.pushLog(
    game,
    `${fewer.name} 安恤获得并展示【${c ? c.name : cid}】`
  );
  if (c && c.suit !== 'spade' && me) {
    api.drawCards(game, me, 1);
  }
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveJiefan(game, pend, playerId, payload, api, pass) {
  const target = api.getPlayer(game, pend.targetId);
  const asker = api.getPlayer(game, pend.askId);
  if (!target || !asker) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  if (!pass && payload.cardId) {
    const cid = payload.cardId;
    const slot = Object.keys(asker.equips || {}).find(
      (s) => asker.equips[s] && asker.equips[s].id === cid
    );
    if (slot !== 'weapon') return { ok: false, error: '请弃置武器牌' };
    api.discardCard(game, asker, cid, 'equip:weapon');
    api.pushLog(game, `${asker.name} 解烦弃置武器`);
  } else {
    api.drawCards(game, target, 1);
    api.pushLog(game, `${target.name} 因解烦摸 1 张`);
  }
  pend.index = (pend.index || 0) + 1;
  if (pend.index < (pend.choosers || []).length) {
    pend.askId = pend.choosers[pend.index];
    pend.message =
      '解烦：弃置一张武器牌，或令 ' + target.name + ' 摸一张牌';
    return { ok: true };
  }
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveDanlao(game, pend, playerId, payload, api, pass) {
  if (pass) {
    api.clearPending(game);
    api.resumeAfterSkill(game);
    return { ok: true };
  }
  const kind = payload.option || payload.choice || payload.cardType;
  if (!['basic', 'equip', 'trick'].includes(kind)) {
    return { ok: false, error: '请声明牌类' };
  }
  const src = api.getPlayer(game, pend.sourceId);
  if (src) {
    src.skillStates = src.skillStates || {};
    src.skillStates.danlaoBan = kind;
    api.pushLog(
      game,
      `${api.getPlayer(game, pend.playerId).name} 啖酪：本回合 ${src.name} 不能使用/弃置${
        kind === 'basic' ? '基本牌' : kind === 'equip' ? '装备牌' : '锦囊牌'
      }`
    );
  }
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

function resolveZhiyu(game, pend, playerId, payload, api, pass) {
  const src = api.getPlayer(game, pend.sourceId || pend.askId);
  const cid = payload.cardId;
  if (!src || !cid || !src.hand.includes(cid)) {
    return { ok: false, error: '请弃置一张手牌' };
  }
  api.discardCard(game, src, cid, 'hand');
  api.pushLog(game, `${src.name} 因智愚弃置一张手牌`);
  api.clearPending(game);
  api.resumeAfterSkill(game);
  return { ok: true };
}

module.exports = { resolveSkillEffect };
