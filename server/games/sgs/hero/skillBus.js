'use strict';

const { createCtx } = require('./skillCtx');
const { getHero } = require('./index');

let api = null;

function bindApi(engineApi) {
  api = engineApi;
}

function ensureApi() {
  if (!api) throw new Error('skillBus 未 bindApi');
}

function rawSkills(player) {
  if (!player) return [];
  if (
    player.skillsLost ||
    (player.skillStates && player.skillStates._duanchang)
  ) {
    return [];
  }
  const { getHero, getSkillRaw } = require('./index');
  const hero = getHero(player && player.generalId);
  const list = [];
  const seen = new Set();
  if (hero) {
    for (const s of hero.skills || []) {
      const raw = s._raw || s;
      if (raw && raw.id && !seen.has(raw.id)) {
        seen.add(raw.id);
        list.push(raw);
      }
    }
  }
  for (const id of player.extraSkillIds || []) {
    if (seen.has(id)) continue;
    const raw = getSkillRaw(id);
    if (raw) {
      seen.add(id);
      list.push(raw);
    }
  }
  if (player.skillStates) {
    for (const k of Object.keys(player.skillStates)) {
      if (!k.startsWith('temp:')) continue;
      const id = k.slice(5);
      if (seen.has(id)) continue;
      const raw = getSkillRaw(id);
      if (raw) {
        seen.add(id);
        list.push(raw);
      }
    }
  }
  return list;
}

function allowed(player, skill) {
  if (skill.lord || skill.type === 'lord') {
    if (!player.isLordSkillEnabled) return false;
  }
  return true;
}

function findSkill(player, skillId) {
  return rawSkills(player).find((s) => s.id === skillId) || null;
}

function query(game, player, hookName, extra = {}) {
  ensureApi();
  if (!player || !player.alive) return [];
  const ctx = createCtx(api, game, { player, ...extra });
  const results = [];
  for (const skill of rawSkills(player)) {
    if (!allowed(player, skill)) continue;
    const fn = skill[hookName] || (skill.hooks && skill.hooks[hookName]);
    if (typeof fn !== 'function') continue;
    const r = fn(ctx, skill);
    if (r !== undefined && r !== null) results.push({ skillId: skill.id, value: r });
  }
  return results;
}

function runContent(game, skill, ctx) {
  const fn =
    typeof skill.content === 'function'
      ? skill.content
      : typeof skill.onTrigger === 'function'
        ? skill.onTrigger
        : null;
  if (!fn) return null;
  api.pushLog(game, `${ctx.player.name} 发动【${skill.name}】`);
  return fn(ctx, skill);
}

/**
 * @returns {{ pending: boolean }}
 */
function emit(game, trigger, extra = {}) {
  ensureApi();
  const player = extra.player;
  if (!player || !player.alive) return { pending: false };

  const forced = [];
  const optional = [];
  for (const skill of rawSkills(player)) {
    if (!allowed(player, skill)) continue;
    const triggers = skill.triggers || [];
    if (!triggers.includes(trigger)) continue;
    // 纯转化技（武圣/龙胆等）只走按钮/响应转化；
    // 像双雄这种「带转化能力、但也会在时机点触发询问」的技能仍需进入触发链。
    if (
      skill.type === 'viewAs' &&
      typeof skill.content !== 'function' &&
      typeof skill.onTrigger !== 'function'
    ) {
      continue;
    }
    // 主动技若登记了 triggers，仍可在对应时机触发（如酒诗 afterDamage）
    if (skill.type === 'active' && !triggers.length) continue;
    const ctx = createCtx(api, game, { player, trigger, ...extra });
    if (typeof skill.filter === 'function' && !skill.filter(ctx, skill)) continue;
    if (typeof skill.canTrigger === 'function' && !skill.canTrigger(ctx, skill)) {
      continue;
    }
    const item = { skill, ctxBase: { trigger, ...extra, playerId: player.id } };
    if (skill.type === 'locked' || skill.forced) forced.push(item);
    else optional.push(item);
  }

  for (const item of forced) {
    const ctx = createCtx(api, game, {
      player,
      trigger,
      ...extra,
    });
    runContent(game, item.skill, ctx);
    if (game.over || game.pending) return { pending: Boolean(game.pending) };
  }

  if (!optional.length) return { pending: false };

  game._skillQueue = optional.map((item) => ({
    skillId: item.skill.id,
    playerId: player.id,
    trigger,
    extraSnapshot: snapshotExtra(extra),
  }));
  return promptNext(game);
}

function snapshotExtra(extra) {
  // 不可克隆 player；只保留 id 与其它可序列化字段
  const out = { ...extra };
  delete out.player;
  if (extra.player) out.playerId = extra.player.id;
  return out;
}

function promptNext(game) {
  const q = game._skillQueue;
  if (!q || !q.length) {
    game._skillQueue = null;
    return { pending: false };
  }
  const next = q[0];
  const player = api.getPlayer(game, next.playerId);
  const skill = findSkill(player, next.skillId);
  if (!player || !skill) {
    q.shift();
    return promptNext(game);
  }
  api.setPending(game, {
    type: 'skill_ask',
    playerId: player.id,
    askId: player.id,
    skillId: skill.id,
    skillName: skill.name,
    trigger: next.trigger,
    message: `是否发动【${skill.name}】？`,
    canPass: true,
  });
  return { pending: true };
}

function resolveSkillAsk(game, playerId, payload) {
  ensureApi();
  const pend = game.pending;
  if (!pend || pend.type !== 'skill_ask' || pend.askId !== playerId) {
    return { ok: false, error: '当前不是技能询问' };
  }
  const q = game._skillQueue || [];
  const head = q[0];
  const player = api.getPlayer(game, playerId);
  const skill = findSkill(player, pend.skillId);

  api.clearPending(game);
  if (head && head.skillId === pend.skillId) q.shift();

  if (!payload.pass && skill && player) {
    const extra = restoreExtra(game, head && head.extraSnapshot);
    const ctx = createCtx(api, game, {
      player,
      trigger: pend.trigger,
      payload,
      ...extra,
    });
    runContent(game, skill, ctx);
    if (game.pending) return { ok: true };
  }

  const next = promptNext(game);
  if (!next.pending && typeof api.resumeAfterSkill === 'function') {
    api.resumeAfterSkill(game);
  }
  return { ok: true };
}

function restoreExtra(game, snap) {
  if (!snap) return {};
  const extra = { ...snap };
  if (snap.playerId) {
    extra.player = api.getPlayer(game, snap.playerId);
  }
  if (snap.sourceId) {
    extra.source = api.getPlayer(game, snap.sourceId);
  }
  return extra;
}

function listActiveSkills(game, player) {
  ensureApi();
  if (!player || !player.alive) return [];
  // 主动技仅出牌阶段、己方回合可发动，回合外不列入可用
  const cur = api.currentPlayer(game);
  if (
    game.phase !== 'playing' ||
    game.pending ||
    !cur ||
    cur.id !== player.id ||
    game.turnPhase !== 'play'
  ) {
    return [];
  }
  const out = [];
  for (const skill of rawSkills(player)) {
    if (!allowed(player, skill)) continue;
    if (skill.type !== 'active') continue;
    const ctx = createCtx(api, game, { player });
    if (typeof skill.filter === 'function' && !skill.filter(ctx, skill)) continue;
    out.push({
      id: skill.id,
      name: skill.name,
      desc: skill.desc || '',
      lord: Boolean(skill.lord),
    });
  }
  return out;
}

function viewAsSpecs(skill) {
  const specs = [];
  if (skill.viewAs) specs.push(skill.viewAs);
  if (skill.viewAsAlt) specs.push(skill.viewAsAlt);
  return specs;
}

/**
 * 人物栏技能按钮状态：
 * - ready：当前可发动/转化
 * - used：本回合已发动（限次技）
 * - disabled：当前不可发动
 */
function listSkillPanel(game, player) {
  ensureApi();
  if (!player || !player.alive) return [];

  const activeReady = new Set(
    listActiveSkills(game, player).map((s) => s.id)
  );

  const needShan =
    game.pending &&
    (game.pending.type === 'respond_shan' || game.pending.type === 'aoe_shan') &&
    (game.pending.playerId === player.id || game.pending.askId === player.id);
  const needSha =
    game.pending &&
    (game.pending.type === 'juedou' ||
      game.pending.type === 'aoe_sha' ||
      game.pending.type === 'jiedao') &&
    (game.pending.playerId === player.id || game.pending.askId === player.id);
  const needTao =
    game.pending &&
    game.pending.type === 'dying' &&
    (game.pending.askId === player.id || game.pending.playerId === player.id);
  const needWuxie =
    game.pending &&
    game.pending.type === 'wuxie' &&
    game.pending.askId === player.id;

  const inPlay =
    game.phase === 'playing' &&
    !game.pending &&
    api.currentPlayer(game) &&
    api.currentPlayer(game).id === player.id &&
    game.turnPhase === 'play';

  const out = [];
  for (const skill of rawSkills(player)) {
    if (!allowed(player, skill)) continue;

    const used = Boolean(player.skillStates && player.skillStates[skill.id]);
    let status = 'disabled';
    let canClick = false;
    let viewAsTo = null;
    let usableCardIds = [];

    if (skill.type === 'active') {
      if (used) {
        // 出牌阶段限一次：仅在自己出牌阶段显示「已使用」，回合外不特别点亮
        status = inPlay ? 'used' : 'disabled';
      } else if (inPlay && activeReady.has(skill.id)) {
        status = 'ready';
        canClick = true;
      } else {
        status = 'disabled';
      }
    } else if (skill.type === 'viewAs') {
      const wanted = [];
      if (needShan) wanted.push('shan');
      if (needSha) wanted.push('sha');
      if (needTao) wanted.push('tao');
      if (needWuxie) wanted.push('wuxie');
      if (inPlay) wanted.push('sha', 'guohe', 'lebu', 'juedou', 'bingliang', 'huogong');

      for (const toName of [...new Set(wanted)]) {
        const opts = listViewAs(
          game,
          player,
          toName,
          needShan || needSha || needTao || needWuxie ? 'respond' : 'use'
        );
        const mine = opts.filter((o) => o.skillId === skill.id);
        if (mine.length) {
          status = 'ready';
          canClick = true;
          viewAsTo = toName;
          usableCardIds = mine.map((o) => o.cardId);
          break;
        }
      }
      if (status !== 'ready' && used) status = 'used';
    } else if (skill.type === 'lord' || skill.lord) {
      // 主公技响应另有入口；栏上仅展示
      status = 'disabled';
    } else {
      // 触发技 / 锁定技：仅展示
      status = used ? 'used' : 'disabled';
    }

    out.push({
      id: skill.id,
      name: skill.name,
      desc: skill.desc || '',
      type: skill.type || 'trigger',
      lord: Boolean(skill.lord),
      status,
      canClick,
      viewAsTo,
      usableCardIds,
    });
  }
  return out;
}

function useActive(game, playerId, skillId, payload = {}) {
  ensureApi();
  const player = api.getPlayer(game, playerId);
  if (!player || !player.alive) return { ok: false, error: '角色无效' };
  if (game.pending) return { ok: false, error: '请先完成当前响应' };
  const cur = api.currentPlayer(game);
  if (!cur || cur.id !== playerId) return { ok: false, error: '不是你的回合' };
  if (game.turnPhase !== 'play') return { ok: false, error: '仅出牌阶段可发动' };

  const skill = findSkill(player, skillId);
  if (!skill || skill.type !== 'active') return { ok: false, error: '非主动技能' };
  const ctx = createCtx(api, game, { player, payload });
  if (typeof skill.filter === 'function' && !skill.filter(ctx, skill)) {
    return { ok: false, error: '现在不能发动该技能' };
  }
  runContent(game, skill, ctx);
  return { ok: true };
}

function listViewAs(game, player, toName, purpose) {
  ensureApi();
  const options = [];
  if (!player) return options;
  for (const skill of rawSkills(player)) {
    if (!allowed(player, skill)) continue;
    if (skill.type !== 'viewAs') continue;
    const specs = viewAsSpecs(skill);
    for (const spec of specs) {
      if (!spec || spec.to !== toName) continue;
      const ctx = createCtx(api, game, { player, purpose, toName });
      if (typeof skill.filter === 'function' && !skill.filter(ctx, skill)) {
        continue;
      }
      const cards = [...player.hand.map((id) => ({ id, from: 'hand' }))];
      if (spec.includeEquip) {
        for (const slot of Object.keys(player.equips || {})) {
          const eq = player.equips[slot];
          if (eq) cards.push({ id: eq.id, from: 'equip:' + slot, card: eq });
        }
      }
      for (const item of cards) {
        const card = item.card || api.cardById(game, item.id);
        if (!card) continue;
        if (spec.cardFilter && !spec.cardFilter(card, ctx)) continue;
        options.push({
          skillId: skill.id,
          skillName: skill.name,
          cardId: item.id,
          from: item.from,
          name: card.name,
          to: spec.to,
        });
      }
    }
  }
  return options;
}

module.exports = {
  bindApi,
  query,
  emit,
  promptNext,
  resolveSkillAsk,
  listActiveSkills,
  listSkillPanel,
  useActive,
  listViewAs,
  findSkill,
  viewAsSpecs,
};
