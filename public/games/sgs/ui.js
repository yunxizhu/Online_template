'use strict';

window.SgsUi = (function () {
  const state = {
    selectedCardId: null,
    selectedTargets: [],
    skillCardPick: [],
    allowMultiSelect: false,
    pendingSkill: null,
    pendingViewAs: null,
    generalPickFly: null,
    /** 本局是否已播过自己的身份牌开场动画 */
    identityRevealDone: null,
    /** 身份牌开场动画进行中（占位隐藏） */
    identityRevealPlaying: false,
    /** @type {Record<string, string>} 本地身份标记（仅自己可见） */
    identityMarks: {},
    identityMarkPop: null,
    handFocusRatio: null,
    game: null,
    net: null,
    prevSnap: null,
    fxBusy: false,
  };

  const AOE_TRICKS = new Set(['南蛮入侵', '万箭齐发']);
  const SELF_TRICKS = new Set(['无中生有', '桃园结义']);
  const DELAYED_TRICKS = new Set(['乐不思蜀', '兵粮寸断', '闪电']);
  const MULTI_SKILL_IDS = new Set(['rende', 'luanji']);
  /** 展示弹框最短停留时间（毫秒） */
  const REVEAL_MIN_MS = 3000;
  /** 发动前需先选座位的主动技 */
  const SEAT_TARGET_ACTIVE_SKILLS = new Set(['tiaoxin', 'xuanhuo']);
  const MUNIU_SKILL_ID = 'muniu';
  const MULTI_SKILL_RULES = {
    luanji: {
      min: 2,
      max: 2,
      sameSuit: true,
      hint: '【乱击】：请选择两张同花色手牌，再点技能发动',
    },
  };

  function $(id) {
    return document.getElementById(id);
  }

  function A() {
    return window.SgsAssets;
  }

  function Fx() {
    return window.SgsFx;
  }

  function cardLabel(c) {
    if (!c) return '';
    const rank = A() ? A().rankLabel(c.number) : c.number;
    return `${c.suitLabel || ''}${rank} ${c.name}`;
  }

  function isShaTargetReachable(game, p, ignoreDist) {
    const me = game && game.me;
    if (!p || !p.alive || !me || p.id === me.id) return false;
    if (ignoreDist) return true;
    if (p.inMyAttackRange === true) return true;
    const dist = Number(p.distanceFromMe);
    const maxRange = Math.max(1, Number(me.attackRange) || 1);
    if (Number.isFinite(dist) && dist > 0) return dist <= maxRange;
    // 兜底：前端距离字段异常时，允许先选目标，再由服务端做最终校验。
    return true;
  }

  function isActiveSkillSeatTargeting() {
    return Boolean(
      state.pendingSkill &&
        SEAT_TARGET_ACTIVE_SKILLS.has(state.pendingSkill.skillId) &&
        state.game &&
        state.game.me &&
        state.game.me.isMyTurn &&
        state.game.turnPhase === 'play' &&
        !state.game.pending &&
        state.game.phase === 'playing'
    );
  }

  function isActiveSkillSeatTargetValid(game, skillId, p) {
    if (!p || !p.alive || !game || !game.me || p.id === game.me.id) return false;
    if (skillId === 'tiaoxin') return Boolean(p.canAttackMe);
    if (skillId === 'xuanhuo') return hasValidXuanhuoSelection(game);
    return p.id !== game.me.id;
  }

  function isXuanhuoSkillPending() {
    return Boolean(
      state.pendingSkill && state.pendingSkill.skillId === 'xuanhuo'
    );
  }

  function xuanhuoSelectableCardIds(game) {
    const me = (game && game.players || []).find(
      (p) => game && game.me && p.id === game.me.id
    );
    return ((me && me.hand) || [])
      .filter((c) => c && c.suit === 'heart')
      .map((c) => c.id);
  }

  function hasValidXuanhuoSelection(game) {
    return xuanhuoSelectableCardIds(game).includes(state.selectedCardId);
  }

  function makeSelectableCard(c, onClick, selected) {
    const faceDown = Boolean(c && (c.back || c.faceDown));
    const el = A().createCardEl(c, {
      selectable: true,
      selected: Boolean(selected),
      size: 'md',
      faceDown,
      title: faceDown
        ? c.zone === 'hand' || c.name === '手牌'
          ? '手牌'
          : '牌'
        : undefined,
    });
    el.addEventListener('click', onClick);
    return el;
  }

  function hideSgsModal() {
    const modal = $('sgs-modal');
    if (modal) modal.hidden = true;
    const panel = $('sgs-modal-panel');
    if (panel) {
      panel.classList.remove('sgs-modal-panel--cards');
      panel.classList.remove('sgs-modal-panel--judge');
      panel.classList.remove('sgs-modal-panel--guanxing');
    }
    const body = $('sgs-modal-body');
    if (body) {
      body.classList.remove('sgs-modal-body--cards');
      delete body.dataset.judgeReveal;
    }
  }

  function hideQiceModal() {
    hideSgsModal();
  }

  function showQiceTrickModal(pend, net) {
    const modal = $('sgs-modal');
    const panel = $('sgs-modal-panel');
    const title = $('sgs-modal-title');
    const hint = $('sgs-modal-hint');
    const body = $('sgs-modal-body');
    const actions = $('sgs-modal-actions');
    if (!modal || !body || !actions) return;
    hideSgsModal();
    modal.hidden = false;
    if (panel) panel.classList.remove('sgs-modal-panel--cards');
    body.classList.remove('sgs-modal-body--cards');
    if (title) title.textContent = '奇策';
    if (hint) {
      hint.textContent =
        pend.message || '选择一张非延时锦囊（全部手牌将视为该锦囊）';
    }
    body.innerHTML = '';
    actions.innerHTML = '';

    const opts = pend.options || [];
    for (const opt of opts) {
      const id = typeof opt === 'string' ? opt : opt.id;
      const name =
        typeof opt === 'string'
          ? opt
          : opt.name || opt.label || opt.id;
      if (!id) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sgs-modal-option';
      b.textContent = name;
      b.addEventListener('click', () => {
        hideSgsModal();
        state.selectedTargets = [];
        net.sendAction('respond', { option: id, trick: id });
      });
      body.appendChild(b);
    }

    if (pend.canPass !== false) {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'secondary';
      cancel.textContent = '取消';
      cancel.addEventListener('click', () => {
        hideSgsModal();
        net.sendAction('respond', { pass: true });
      });
      actions.appendChild(cancel);
    }
  }

  function showFanjianSuitModal(pend, net) {
    const modal = $('sgs-modal');
    const panel = $('sgs-modal-panel');
    const title = $('sgs-modal-title');
    const hint = $('sgs-modal-hint');
    const body = $('sgs-modal-body');
    const actions = $('sgs-modal-actions');
    if (!modal || !body || !actions) return;

    modal.hidden = false;
    if (panel) panel.classList.remove('sgs-modal-panel--cards');
    body.classList.remove('sgs-modal-body--cards');
    if (title) title.textContent = '反间';
    if (hint) {
      hint.textContent = pend.message || '请选择一种花色';
    }
    body.innerHTML = '';
    actions.innerHTML = '';

    const suits = [
      { id: 'spade', label: '♠ 黑桃', red: false },
      { id: 'heart', label: '♥ 红桃', red: true },
      { id: 'club', label: '♣ 梅花', red: false },
      { id: 'diamond', label: '♦ 方片', red: true },
    ];
    for (const s of suits) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className =
        'sgs-modal-option sgs-suit-btn' + (s.red ? ' is-red' : ' is-black');
      b.textContent = s.label;
      b.addEventListener('click', () => {
        hideSgsModal();
        net.sendAction('respond', { suit: s.id });
      });
      body.appendChild(b);
    }
  }

  /** 过拆/顺手/反馈等：从他人手牌或区域选牌 */
  function isOpponentZonePickPending(pend) {
    if (!pend) return false;
    if (
      pend.type === 'choose_discard_target_card' ||
      pend.type === 'choose_gain_target_card' ||
      pend.type === 'qilin' ||
      pend.type === 'hanbing'
    ) {
      return true;
    }
    if (
      pend.type === 'skill_effect' &&
      pend.skillId === 'fanjian' &&
      pend.step === 'card'
    ) {
      return true;
    }
    if (pend.type !== 'skill_effect') return false;
    if (pend.skillId === 'qice') return false;
    if (
      pend.skillId === 'tuxi' ||
      pend.skillId === 'liuli' ||
      pend.skillId === 'yiji' ||
      pend.skillId === 'rende' ||
      pend.skillId === 'hujia' ||
      pend.skillId === 'jijiang'
    ) {
      return false;
    }
    const opts = pend.cardOptions || [];
    if (!opts.length) return false;
    if (!opts.some((c) => c.zone || c.back)) return false;
    return Boolean(
      pend.targetId || pend.sourceId || pend.moreId || pend.dyingId
    );
  }

  function zonePickModalTitle(game, pend) {
    if (pend.type === 'choose_discard_target_card') return '过河拆桥';
    if (pend.type === 'choose_gain_target_card') return '顺手牵羊';
    if (pend.type === 'qilin') return '麒麟弓';
    if (pend.type === 'hanbing') return '寒冰剑';
    if (pend.skillName) return `【${pend.skillName}】`;
    return '选择目标区域的牌';
  }

  function showOpponentZonePickModal(game, pend, net) {
    const modal = $('sgs-modal');
    const panel = $('sgs-modal-panel');
    const title = $('sgs-modal-title');
    const hint = $('sgs-modal-hint');
    const body = $('sgs-modal-body');
    const actions = $('sgs-modal-actions');
    if (!modal || !body || !actions) return;

    const opts = pend.cardOptions || [];
    const target =
      (game.players || []).find((p) => p.id === pend.targetId) ||
      (game.players || []).find((p) => p.id === pend.sourceId);

    modal.hidden = false;
    if (panel) panel.classList.add('sgs-modal-panel--cards');
    body.classList.add('sgs-modal-body--cards');
    if (title) title.textContent = zonePickModalTitle(game, pend);
    if (hint) {
      const who = target ? target.name : '';
      hint.textContent =
        (pend.message || '选择一张牌') + (who ? ` · ${who}` : '');
    }
    body.innerHTML = '';
    actions.innerHTML = '';

    const hands = opts.filter((c) => c.zone === 'hand' || c.back);
    const equips = opts.filter((c) => c.zone === 'equip');
    const judges = opts.filter((c) => c.zone === 'judge');
    const rest = opts.filter(
      (c) =>
        !hands.includes(c) && !equips.includes(c) && !judges.includes(c)
    );

    const multi = pend.type === 'hanbing';
    const maxPick = multi ? 2 : 1;
    let picked = [];

    const appendGroup = (label, list) => {
      if (!list.length) return;
      const group = document.createElement('div');
      group.className = 'sgs-modal-zone';
      if (label) {
        const tag = document.createElement('div');
        tag.className = 'sgs-modal-zone-title';
        tag.textContent = label;
        group.appendChild(tag);
      }
      const row = document.createElement('div');
      row.className = 'sgs-modal-zone-cards';
      for (const c of list) {
        const btn = makeSelectableCard(c, () => {
          if (!multi) {
            hideSgsModal();
            clearSkillAskBar();
            net.sendAction('respond', { cardId: c.id });
            return;
          }
          const i = picked.indexOf(c.id);
          if (i >= 0) {
            picked.splice(i, 1);
            btn.classList.remove('selected');
          } else if (picked.length < maxPick) {
            picked.push(c.id);
            btn.classList.add('selected');
          }
        });
        row.appendChild(btn);
      }
      group.appendChild(row);
      body.appendChild(group);
    };

    appendGroup(hands.length ? '手牌（暗置）' : null, hands);
    appendGroup(equips.length ? '装备区' : null, equips);
    appendGroup(judges.length ? '判定区' : null, judges);
    appendGroup(
      rest.length && (hands.length || equips.length || judges.length)
        ? '其他'
        : null,
      rest
    );

    if (!opts.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = '没有可选的牌';
      body.appendChild(empty);
    }

    if (multi) {
      const conf = document.createElement('button');
      conf.type = 'button';
      conf.textContent = '弃 2 张代替伤害';
      conf.addEventListener('click', () => {
        if (picked.length !== 2) {
          alert('请选择 2 张牌');
          return;
        }
        hideSgsModal();
        net.sendAction('respond', { cardIds: picked.slice() });
      });
      actions.appendChild(conf);
    }

    const showPass =
      pend.type === 'qilin' ||
      pend.type === 'hanbing' ||
      (pend.type === 'skill_effect' && pend.canPass !== false);
    if (showPass) {
      const pass = document.createElement('button');
      pass.type = 'button';
      pass.className = 'secondary';
      pass.textContent =
        pend.type === 'qilin'
          ? '放弃'
          : pend.type === 'hanbing'
            ? '造成伤害'
            : '取消';
      pass.addEventListener('click', () => {
        hideSgsModal();
        net.sendAction('respond', { pass: true });
      });
      actions.appendChild(pass);
    }
  }

  function render(game, net) {
    state.game = game;
    state.net = net;
    // 换人对局时清空本地身份标记
    const meKey = game.me && game.me.id;
    if (state._markOwnerId && meKey && state._markOwnerId !== meKey) {
      state.identityMarks = {};
      state.identityRevealDone = null;
      state.identityRevealPlaying = false;
      hideIdentityMarkPop();
    }
    if (meKey) state._markOwnerId = meKey;
    // 回合结束/进入响应时取消已点亮的转化技
    if (
      state.pendingViewAs &&
      (!game.me ||
        !game.me.isMyTurn ||
        game.turnPhase !== 'play' ||
        game.pending ||
        game.phase !== 'playing')
    ) {
      state.pendingViewAs = null;
    }
    if (
      state.pendingSkill &&
      (!game.me ||
        !game.me.isMyTurn ||
        game.turnPhase !== 'play' ||
        game.pending ||
        game.phase !== 'playing')
    ) {
      state.pendingSkill = null;
      state.selectedTargets = [];
    }
    const panel = $('panel-sgs');
    if (!panel) return;
    panel.hidden = false;

    $('sgs-mode-label').textContent = game.modeLabel || '标准身份';

    if (game.over) {
      const names = (game.winners || [])
        .map((id) => {
          const p = (game.players || []).find((x) => x.id === id);
          return p ? p.name : id;
        })
        .join('、');
      $('sgs-status').textContent = `结束：${game.winReason || ''} 胜者 ${names || '—'}`;
    } else if (game.phase === 'bid_lord') {
      const bid = game.bidInfo;
      $('sgs-status').textContent = bid
        ? `叫地主：当前 ${bid.currentBid || 0} 倍，等待 ${bid.askName}`
        : '叫地主';
    } else if (game.phase === 'ban_general') {
      const ban = game.banInfo;
      $('sgs-status').textContent = ban
        ? `Ban 将阶段：等待 ${ban.askName}`
        : 'Ban 将阶段';
    } else if (game.phase === 'select_general') {
      const me = game.me && (game.players || []).find((p) => p.id === game.me.id);
      const myChoices =
        game.generalChoices && Array.isArray(game.generalChoices)
          ? game.generalChoices.length
          : 0;
      if (game.mode === 'h2h') {
        $('sgs-status').textContent = '请从己方武将池中选择武将';
      } else if (
        (game.mode === 'identity' || game.mode === 'xianzhu') &&
        game.selectGeneralPhase === 'lord'
      ) {
        const lordName = game.mode === 'xianzhu' ? '先主' : '主公';
        $('sgs-status').textContent = myChoices
          ? `请${lordName}选择武将`
          : `等待${lordName}选将`;
      } else if (game.mode === '1v2') {
        $('sgs-status').textContent = myChoices
          ? '请选择武将（选定后对他人显示将背）'
          : '等待其余玩家选将';
      } else {
        $('sgs-status').textContent = myChoices
          ? game.mode === 'xianzhu'
            ? '请选择武将（先主已亮明）'
            : '请选择武将（主公已亮明）'
          : '等待其余玩家选将';
      }
    } else {
      const turn = (game.players || []).find((p) => p.id === game.turnPlayerId);
      $('sgs-status').textContent = `回合：${turn ? turn.name : '—'} · 阶段 ${phaseLabel(game.turnPhase)}`;
      if (game.huangjinUprising) {
        $('sgs-status').textContent += ' · 【黄巾起义】';
      }
    }

    renderBid(game, net);
    renderBan(game, net);
    renderGenerals(game, net);
    renderTable(game);
    renderPiles(game);
    renderDeathReveal(game);
    prepareIncomingHandFx(game);
    renderHand(game, net);
    renderMateHand(game);
    renderLog(game);
    playGeneralPickFly(game);
    playIdentityReveal(game);

    // 仅「出牌后立刻要别人出闪/杀」类响应可等特效；选将/技能询问必须立刻显示，否则会卡死
    const fxRun = queueFx(game);
    const pend = game.pending;
    const deferPending =
      Boolean(fxRun) &&
      pend &&
      pend.forMe &&
      (pend.type === 'respond_shan' ||
        pend.type === 'aoe_shan' ||
        pend.type === 'aoe_sha' ||
        pend.type === 'juedou' ||
        pend.type === 'jiedao' ||
        pend.type === 'wuxie');
    if (deferPending) {
      const pendBox = $('sgs-pending');
      if (pendBox) pendBox.hidden = true;
      clearSkillAskBar();
      fxRun.then(() => {
        if (state.game) renderPending(state.game, state.net);
      });
    } else {
      renderPending(game, net);
    }
  }

  function snapshotGame(game) {
    const me = (game.players || []).find((p) => game.me && p.id === game.me.id);
    return {
      drawCount: game.drawCount || 0,
      discardCount: game.discardCount || 0,
      discardTopId: game.discardTop && game.discardTop.id,
      discardTop: game.discardTop,
      handIds: me && me.hand ? me.hand.map((c) => c.id) : [],
      handCards: me && me.hand ? me.hand.slice() : [],
      turnPlayerId: game.turnPlayerId,
      logLen: (game.log || []).length,
      lastLogs: (game.log || []).slice(-20),
      pendingType: game.pending && game.pending.type,
      hpById: Object.fromEntries(
        (game.players || []).map((p) => [p.id, Number(p.hp) || 0])
      ),
    };
  }

  function logKey(row) {
    if (!row) return '';
    return `${row.at || ''}|${row.text || ''}`;
  }

  function parseGainFromPlayerLog(text, game) {
    const m = String(text || '').match(/^(.+?) 获得了 (.+?) 的一张牌$/);
    if (!m) return null;
    const gainer = findPlayerByName(game, m[1]);
    const target = findPlayerByName(game, m[2]);
    if (!gainer || !target) return null;
    return { gainerId: gainer.id, targetId: target.id };
  }

  /** 顺手牵羊等：先藏入手牌末端的牌，等飞入动画结束再显示 */
  function prepareIncomingHandFx(game) {
    state._incomingHandFx = null;
    const prev = state.prevSnap;
    if (!prev || !game.me) return;
    const me = (game.players || []).find((p) => p.id === game.me.id);
    if (!me || !me.hand) return;
    const nextSnap = snapshotGame(game);
    const gainIds = nextSnap.handIds.filter((id) => !prev.handIds.includes(id));
    if (!gainIds.length) return;
    if (nextSnap.drawCount < prev.drawCount) return;

    const freshLogs = freshPlayLogs(prev, nextSnap);
    let fromPlayerId = null;
    for (const row of freshLogs) {
      const parsed = parseGainFromPlayerLog(row && row.text, game);
      if (
        parsed &&
        parsed.gainerId === game.me.id &&
        parsed.targetId !== game.me.id
      ) {
        fromPlayerId = parsed.targetId;
        break;
      }
    }
    if (!fromPlayerId) return;

    state._incomingHandFx = {
      cardIds: gainIds,
      cards: nextSnap.handCards.filter((c) => gainIds.includes(c.id)),
      fromPlayerId,
    };
  }

  function revealIncomingHandCards() {
    state._incomingHandFx = null;
    const hand = $('sgs-hand');
    if (!hand) return;
    hand.querySelectorAll('.sgs-kapai.is-steal-incoming').forEach((el) => {
      el.classList.remove('is-steal-incoming');
    });
    layoutSelfHand(hand, state.handFocusRatio);
  }

  function freshPlayLogs(prev, next) {
    const prevLogs = prev.lastLogs || [];
    const nextLogs = next.lastLogs || [];
    if (!nextLogs.length) return [];
    if (!prevLogs.length) return nextLogs.slice();
    // 客户端 log 被截断后 logLen 可能不变，用条目指纹取新增尾部
    const prevKeys = new Set(prevLogs.map(logKey));
    const fresh = [];
    for (let i = nextLogs.length - 1; i >= 0; i--) {
      const row = nextLogs[i];
      if (prevKeys.has(logKey(row))) break;
      fresh.unshift(row);
    }
    return fresh;
  }

  function findPlayerByName(game, name) {
    return (game.players || []).find((p) => p.name === name);
  }

  function collectHpHits(prev, next, game, freshLogs) {
    const byId = new Map();
    const put = (playerId, amount) => {
      if (!playerId) return;
      const n = Math.max(0, Math.floor(Number(amount) || 0));
      if (n <= 0) return;
      byId.set(playerId, Math.max(byId.get(playerId) || 0, n));
    };
    const prevHp = (prev && prev.hpById) || {};
    const nextHp = (next && next.hpById) || {};
    for (const p of game.players || []) {
      if (prevHp[p.id] == null || nextHp[p.id] == null) continue;
      if (nextHp[p.id] < prevHp[p.id]) {
        put(p.id, prevHp[p.id] - nextHp[p.id]);
      }
    }
    if (!byId.size) {
      for (const row of freshLogs || []) {
        const t = String((row && row.text) || '');
        let m = t.match(/对 (.+?) 造成 (\d+) 点(?:火焰|雷电)?伤害/);
        if (m) {
          const target = findPlayerByName(game, m[1]);
          if (target) put(target.id, m[2]);
          continue;
        }
        m = t.match(/^(.+?) 失去 (\d+) 点体力/);
        if (m) {
          const target = findPlayerByName(game, m[1]);
          if (target) put(target.id, m[2]);
        }
      }
    }
    return [...byId.entries()].map(([playerId, amount]) => ({
      playerId,
      amount,
    }));
  }

  function parsePlayLog(text, game) {
    if (!text) return null;
    // 例：张三 对 李四 使用【杀】 / 张三 使用【无中生有】
    let m = text.match(/^(.+?) 对 (.+?) 使用【(.+?)】/);
    if (m) {
      const from = findPlayerByName(game, m[1]);
      const targets = m[2]
        .split(/[、,，]/)
        .map((n) => findPlayerByName(game, n.trim()))
        .filter(Boolean);
      return {
        fromId: from && from.id,
        targets: targets.map((p) => p.id),
        cardName: m[3],
        caption: `${m[1]} 对 ${m[2]}`,
      };
    }
    m = text.match(/^(.+?) 使用【(.+?)】/);
    if (m) {
      const from = findPlayerByName(game, m[1]);
      return {
        fromId: from && from.id,
        targets: [],
        cardName: m[2],
        caption: m[1] + ' 使用',
        selfEffect: SELF_TRICKS.has(m[2]),
      };
    }
    m = text.match(/^(.+?) 打出【(.+?)】/);
    if (m) {
      const from = findPlayerByName(game, m[1]);
      return {
        fromId: from && from.id,
        targets: [],
        cardName: m[2],
        caption: m[1] + ' 打出',
      };
    }
    m = text.match(/^(.+?) 装备【(.+?)】/);
    if (m) {
      const from = findPlayerByName(game, m[1]);
      return {
        fromId: from && from.id,
        targets: [],
        cardName: m[2],
        caption: `${m[1]} 装备`,
        equip: true,
      };
    }
    return null;
  }

  /** 从日志解析「谁指定了谁」——出牌、技能、伤害等 */
  function parseTargetEvents(text, game) {
    if (!text) return [];
    const events = [];

    let m = text.match(/^(.+?) 借刀：令 (.+?) 对 (.+?) 出杀/);
    if (m) {
      const from = findPlayerByName(game, m[1]);
      const holder = findPlayerByName(game, m[2]);
      const victim = findPlayerByName(game, m[3]);
      if (from && holder) {
        events.push({ fromId: from.id, targetIds: [holder.id] });
      }
      if (holder && victim) {
        events.push({ fromId: holder.id, targetIds: [victim.id] });
      }
      if (from && victim) {
        events.push({ fromId: from.id, targetIds: [victim.id] });
      }
      return events;
    }

    m = text.match(/^(.+?) 流离将【杀】转移给 (.+)$/);
    if (m) {
      const from = findPlayerByName(game, m[1]);
      const to = findPlayerByName(game, m[2]);
      if (from && to) events.push({ fromId: from.id, targetIds: [to.id] });
      return events;
    }

    m = text.match(/^(.+?) 仁德交给 (.+?) /);
    if (m) {
      const from = findPlayerByName(game, m[1]);
      const to = findPlayerByName(game, m[2]);
      if (from && to) events.push({ fromId: from.id, targetIds: [to.id] });
      return events;
    }

    m = text.match(/^(.+?) 遗计将牌交给 (.+)$/);
    if (m) {
      const from = findPlayerByName(game, m[1]);
      const to = findPlayerByName(game, m[2]);
      if (from && to) events.push({ fromId: from.id, targetIds: [to.id] });
      return events;
    }

    // 利驭视为对 / 其他「视为对」
    m = text.match(/^(.+?) (?:利驭)?视为对 (.+?) 使用【/);
    if (m) {
      const from = findPlayerByName(game, m[1]);
      const targets = m[2]
        .split(/[、,，]/)
        .map((n) => findPlayerByName(game, n.trim()))
        .filter(Boolean);
      if (from && targets.length) {
        events.push({
          fromId: from.id,
          targetIds: targets.map((p) => p.id),
        });
      }
      return events;
    }

    // X 对 Y（、Z）使用/造成/发动…
    m = text.match(/^(.+?) 对 (.+?) (?:使用|造成|发动)/);
    if (m) {
      const from = findPlayerByName(game, m[1]);
      const targets = m[2]
        .split(/[、,，]/)
        .map((n) => findPlayerByName(game, n.trim()))
        .filter(Boolean);
      if (from && targets.length) {
        events.push({
          fromId: from.id,
          targetIds: targets.map((p) => p.id),
        });
      }
      return events;
    }

    return events;
  }

  /** pending 里出现的指定关系（技能点名、杀指定等） */
  function pendingTargetEvents(prev, next, game) {
    if (!game.pending) return [];
    if (next.pendingType === prev.pendingType) return [];

    const pend = game.pending;
    const events = [];

    if (pend.type === 'skill_effect' || pend.type === 'skill_ask') {
      const caster = pend.playerId;
      const ask = pend.askId || pend.targetId;
      if (caster && ask && caster !== ask) {
        events.push({ fromId: caster, targetIds: [ask] });
      }
      if (
        pend.sourceId &&
        pend.targetId &&
        pend.sourceId !== pend.targetId
      ) {
        events.push({
          fromId: pend.sourceId,
          targetIds: [pend.targetId],
        });
      }
      return events;
    }

    const fromId = pend.sourceId || pend.playerId || null;
    const toIds = [];
    if (pend.targetId && pend.targetId !== fromId) toIds.push(pend.targetId);
    if (pend.askId && pend.askId !== fromId) toIds.push(pend.askId);
    if (
      pend.type === 'respond_shan' &&
      pend.sourceId &&
      pend.playerId &&
      pend.sourceId !== pend.playerId
    ) {
      toIds.push(pend.playerId);
    }
    if (fromId && toIds.length) {
      events.push({
        fromId,
        targetIds: [...new Set(toIds)],
      });
    }
    return events;
  }

  function resolvePlayFx(prev, next, game) {
    const logs = freshPlayLogs(prev, next);
    let play = null;
    let playLogText = null;
    let discardOnly = null;
    let recastOnly = null;

    for (let i = logs.length - 1; i >= 0; i--) {
      const text = logs[i] && logs[i].text;
      if (!text) continue;
      // 铁索等重铸：弃牌摸牌，不出牌语音
      const recast = text.match(/^(.+?) 重铸【(.+?)】/);
      if (recast && !recastOnly) {
        const from = findPlayerByName(game, recast[1]);
        recastOnly = {
          fromId: from && from.id,
          cardName: recast[2],
          caption: text,
        };
      }
      const disc = parseDiscardLog(text, game);
      if (disc && !discardOnly) discardOnly = disc;
      const used = parsePlayLog(text, game);
      if (used) {
        play = used;
        playLogText = text;
        break;
      }
    }

    if (recastOnly && !play) {
      return {
        kind: 'discard',
        fromId: recastOnly.fromId || game.turnPlayerId || null,
        count: 1,
        card: next.discardTop || { name: recastOnly.cardName },
        play: null,
        targets: [],
        playLogText: recastOnly.caption,
        discardChanged: true,
        skipVoice: true,
      };
    }

    const discardChanged = Boolean(
      next.discardTopId &&
        next.discardTopId !== prev.discardTopId &&
        next.discardCount >= (prev.discardCount || 0)
    );
    const discardGain = Math.max(
      0,
      (next.discardCount || 0) - (prev.discardCount || 0)
    );

    // 纯弃牌（弃置阶段等）：不走「使用」出牌光线
    if (!play && discardOnly) {
      const fromId =
        (discardOnly && discardOnly.fromId) ||
        game.turnPlayerId ||
        null;
      return {
        kind: 'discard',
        fromId,
        count: (discardOnly && discardOnly.count) || discardGain || 1,
        card: next.discardTop || null,
        play: null,
        targets: [],
        playLogText: discardOnly.caption,
        discardChanged,
      };
    }

    // 出杀等：牌尚未进弃牌堆，但已产生「使用」日志 / 进入出闪 pending
    if (
      !play &&
      next.pendingType === 'respond_shan' &&
      prev.pendingType !== 'respond_shan' &&
      game.pending
    ) {
      const src = (game.players || []).find(
        (p) => p.id === game.pending.sourceId
      );
      const dst = (game.players || []).find(
        (p) => p.id === game.pending.playerId
      );
      const card = game.pending.triggerCard;
      play = {
        fromId: game.pending.sourceId,
        targets: game.pending.playerId ? [game.pending.playerId] : [],
        cardName: (card && card.name) || '杀',
        caption:
          src && dst
            ? `${src.name} 对 ${dst.name}`
            : (card && card.name) || '杀',
      };
    }

    // 弃牌堆顶变化且无使用/弃置日志：仍可能是打出闪/桃等
    if (!play && discardChanged && next.discardTop) {
      play = {
        fromId: game.turnPlayerId,
        targets: [],
        cardName: next.discardTop.name,
        caption: next.discardTop.name,
      };
    }

    if (!play) return null;

    const cardName = play.cardName;
    // 出闪后引擎会把【杀】也推进弃牌堆，堆顶往往是杀而非刚打出的闪；
    // 牌面/语音必须以「使用/打出」日志为准，不能盲信 discardTop。
    let card = null;
    if (
      discardChanged &&
      next.discardTop &&
      (!cardName || next.discardTop.name === cardName)
    ) {
      card = next.discardTop;
    }
    if (
      !card &&
      game.pending &&
      game.pending.triggerCard &&
      (!cardName || game.pending.triggerCard.name === cardName)
    ) {
      card = game.pending.triggerCard;
    }

    // 延时锦囊进判定区：从目标判定区取牌面
    if (!card && DELAYED_TRICKS.has(cardName)) {
      const tids =
        play.targets && play.targets.length
          ? play.targets
          : play.fromId
            ? [play.fromId]
            : [];
      for (const tid of tids) {
        const p = (game.players || []).find((x) => x.id === tid);
        const hit = ((p && p.judges) || []).find(
          (j) => j && j.name === cardName
        );
        if (hit) {
          card = hit;
          break;
        }
      }
    }
    if (!card) card = { name: cardName };

    let targets = play.targets || [];
    if (AOE_TRICKS.has(card.name || cardName) && !targets.length) {
      targets = (game.players || [])
        .filter((p) => p.alive && p.id !== play.fromId)
        .map((p) => p.id);
    }

    // 闪电贴自己判定区
    if (cardName === '闪电' && !targets.length && play.fromId) {
      targets = [play.fromId];
    }

    const delayed = DELAYED_TRICKS.has(card.name || cardName);

    return {
      kind: delayed ? 'delayed' : 'play',
      play,
      card,
      targets,
      playLogText,
      discardChanged,
      skipVoice: Boolean(play.equip),
    };
  }

  function parseDiscardLog(text, game) {
    if (!text) return null;
    // 例：张三 弃置 2 张牌
    let m = text.match(/^(.+?) 弃置 (\d+) 张牌/);
    if (m) {
      const from = findPlayerByName(game, m[1]);
      return {
        fromId: from && from.id,
        count: Number(m[2]) || 1,
        caption: text,
      };
    }
    m = text.match(/^弃置了 (.+?) 的一张牌/);
    if (m) {
      return {
        fromId: game.turnPlayerId,
        count: 1,
        caption: text,
      };
    }
    return null;
  }

  function collectTargetRayEvents(prev, next, game, playResolved) {
    const covered = new Set();
    if (playResolved && playResolved.play && playResolved.targets) {
      for (const tid of playResolved.targets) {
        covered.add(`${playResolved.play.fromId}->${tid}`);
      }
    }

    const raw = [];
    for (const row of freshPlayLogs(prev, next)) {
      raw.push(...parseTargetEvents(row && row.text, game));
    }
    raw.push(...pendingTargetEvents(prev, next, game));

    const merged = [];
    for (const ev of raw) {
      if (!ev || !ev.fromId || !ev.targetIds || !ev.targetIds.length) continue;
      const ids = [];
      for (const tid of ev.targetIds) {
        const key = `${ev.fromId}->${tid}`;
        if (!tid || tid === ev.fromId || covered.has(key)) continue;
        covered.add(key);
        ids.push(tid);
      }
      if (ids.length) merged.push({ fromId: ev.fromId, targetIds: ids });
    }
    return merged;
  }

  function queueFx(game) {
    const fx = Fx();
    // 选将/叫分/Ban 将阶段不播桌面特效，避免清 UI、也避免牌堆未就绪
    if (
      !game ||
      game.phase === 'select_general' ||
      game.phase === 'bid_lord' ||
      game.phase === 'ban_general'
    ) {
      state.prevSnap = snapshotGame(game);
      return null;
    }
    if (!fx) {
      state.prevSnap = snapshotGame(game);
      if (state._incomingHandFx) revealIncomingHandCards();
      return null;
    }
    if (state.fxBusy) {
      state._fxQueuedGame = game;
      return state._fxRunPromise || null;
    }

    const prev = state.prevSnap;
    const next = snapshotGame(game);
    state.prevSnap = next;
    if (!prev) return null;

    const freshLogs = freshPlayLogs(prev, next);
    if (A() && A().playSfxFromLogs) {
      A().playSfxFromLogs(freshLogs);
    }

    const tasks = [];

    // 摸牌：手牌变多且抽牌堆变少
    const handGain = next.handIds.filter((id) => !prev.handIds.includes(id));
    const stealFx = state._incomingHandFx;
    const stealGainIds =
      stealFx && stealFx.cardIds
        ? handGain.filter((id) => stealFx.cardIds.includes(id))
        : [];
    const drawGainIds = handGain.filter((id) => !stealGainIds.includes(id));
    if (
      drawGainIds.length > 0 &&
      next.drawCount < prev.drawCount &&
      game.me &&
      (game.me.isMyTurn || game.turnPhase === 'draw' || !game.pending)
    ) {
      const newCards = next.handCards.filter((c) => drawGainIds.includes(c.id));
      tasks.push(() =>
        fx.animateDraw(drawGainIds.length, newCards[0] || null)
      );
    }
    if (
      stealFx &&
      stealGainIds.length > 0 &&
      game.me &&
      fx.animateGainFromSeat
    ) {
      tasks.push(async () => {
        try {
          await fx.animateGainFromSeat({
            card: (stealFx.cards && stealFx.cards[0]) || null,
            fromPlayerId: stealFx.fromPlayerId,
            duration: 920,
          });
        } finally {
          revealIncomingHandCards();
        }
      });
    }

    const resolved = resolvePlayFx(prev, next, game);
    if (resolved) {
      if (
        !resolved.skipVoice &&
        resolved.kind !== 'discard' &&
        A() &&
        A().playCardVoice
      ) {
        const fromId =
          (resolved.play && resolved.play.fromId) || resolved.fromId;
        const from = (game.players || []).find((p) => p.id === fromId);
        // 优先用「使用/打出」日志里的牌名（出闪时弃牌堆顶可能已被【杀】盖住）
        const cardName =
          (resolved.play && resolved.play.cardName) ||
          (resolved.card && resolved.card.name);
        A().playCardVoice(cardName, (from && from.gender) || 'male');
      }
      if (resolved.kind === 'discard') {
        tasks.push(() =>
          fx.animateDiscardToPile({
            count: resolved.count,
            fromPlayerId: resolved.fromId,
            card: resolved.card,
          })
        );
      } else if (resolved.kind === 'delayed') {
        const { play, card, targets } = resolved;
        tasks.push(() =>
          fx.animatePlayToSeat({
            card,
            fromPlayerId: play.fromId,
            targets,
            caption: play.caption,
          })
        );
      } else {
        const { play, card, targets } = resolved;
        const isEquip = (card && card.type === 'equip') || play.equip;
        tasks.push(() =>
          fx.animatePlayToDiscard({
            card,
            fromPlayerId: play.fromId,
            targets,
            caption: play.caption,
            equipToPlayerId: isEquip ? play.fromId : null,
            selfEffect: play.selfEffect || SELF_TRICKS.has(card.name),
          })
        );
      }
    }

    // 技能/伤害等指定目标：单独划线（出牌动画已覆盖的不再重复）
    const rayEvents = collectTargetRayEvents(prev, next, game, resolved);
    for (const ev of rayEvents) {
      tasks.push(() =>
        fx.animateTargetRays({
          fromPlayerId: ev.fromId,
          targetIds: ev.targetIds,
        })
      );
    }

    for (const row of freshLogs) {
      const text = String(row && row.text || '');
      const m = text.match(/^(.+?) 的(仁王盾抵挡黑色【杀】|毅重抵挡黑色【杀】|藤甲抵挡普通【杀】)$/);
      if (!m) continue;
      const target = (game.players || []).find((p) => p.name === m[1]);
      if (!target) continue;
      tasks.push(() =>
        fx.animateSeatText({
          playerId: target.id,
          text: '无效',
        })
      );
    }

    const hpHits = collectHpHits(prev, next, game, freshLogs);
    if (hpHits.length && fx.animateDamageHit) {
      tasks.push(() =>
        Promise.all(hpHits.map((hit) => fx.animateDamageHit(hit)))
      );
    }

    if (!tasks.length) {
      if (state._incomingHandFx) revealIncomingHandCards();
      return null;
    }

    state.fxBusy = true;
    const run = (async () => {
      for (const t of tasks) {
        try {
          await t();
        } catch (_) {
          /* ignore */
        }
      }
      state.fxBusy = false;
      state._fxRunPromise = null;
      const queued = state._fxQueuedGame;
      state._fxQueuedGame = null;
      if (queued && state.game) {
        const again = queueFx(queued);
        if (again) await again;
      }
    })();
    state._fxRunPromise = run;
    return run;
  }

  function renderDeathReveal(game) {
    let box = $('sgs-death-reveal');
    if (!box) {
      const arena = $('sgs-arena');
      if (!arena) return;
      box = document.createElement('div');
      box.id = 'sgs-death-reveal';
      box.className = 'sgs-death-reveal';
      box.hidden = true;
      arena.appendChild(box);
    }
    const d = game.lastDeath;
    if (!d || !d.identity) {
      box.hidden = true;
      return;
    }
    // 同一死亡只强提示一次
    if (state._shownDeathId === d.playerId + ':' + d.identity) {
      return;
    }
    state._shownDeathId = d.playerId + ':' + d.identity;
    const url = A().identityUrl(d.identity);
    box.hidden = false;
    box.innerHTML =
      `<div class="sgs-death-reveal-inner">` +
      `<p><strong>${escapeHtml(d.name)}</strong> 死亡</p>` +
      (url ? `<img src="${url}" alt="${escapeHtml(d.identityLabel)}" />` : '') +
      `<p>身份：${escapeHtml(d.identityLabel)}</p>` +
      `</div>`;
    clearTimeout(state._deathRevealTimer);
    state._deathRevealTimer = setTimeout(() => {
      box.hidden = true;
    }, 2800);
  }

  function phaseLabel(p) {
    const map = {
      prepare: '准备',
      judge: '判定',
      draw: '摸牌',
      play: '出牌',
      discard: '弃牌',
      end: '结束',
    };
    return map[p] || p || '—';
  }

  function renderBid(game, net) {
    let wrap = $('sgs-bid-select');
    if (!wrap) {
      const parent = $('panel-sgs');
      if (!parent) return;
      wrap = document.createElement('div');
      wrap.id = 'sgs-bid-select';
      wrap.className = 'sgs-general-select';
      wrap.innerHTML =
        '<h3>叫地主</h3><p id="sgs-bid-hint" class="muted"></p><div id="sgs-bid-actions" class="row"></div>';
      const gen = $('sgs-general-select');
      parent.insertBefore(wrap, gen || parent.firstChild);
    }
    const hint = $('sgs-bid-hint');
    const actions = $('sgs-bid-actions');
    if (game.phase !== 'bid_lord') {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    const bid = game.bidInfo || {};
    hint.textContent = `当前 ${bid.currentBid || 0} 倍 · 轮到 ${bid.askName || '—'}`;
    actions.innerHTML = '';
    if (!bid.myTurn) return;
    const minNext = bid.minNext || 1;
    for (const v of [0, 1, 2, 3]) {
      if (v > 0 && v < minNext) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = v === 0 ? '不叫' : `叫 ${v} 倍`;
      b.addEventListener('click', () => {
        net.sendAction('bid_lord', { value: v });
      });
      actions.appendChild(b);
    }
  }

  function makeGeneralButton(g, onClick, pickIndex) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sgs-gen-btn';
    btn.dataset.generalId = g.id;
    if (pickIndex != null) btn.dataset.pickIndex = String(pickIndex);
    const skillText = (g.skills || [])
      .map((s) => s.name + (s.lord ? '(主)' : ''))
      .join(' / ');
    const cardHtml = A().heroCardSlotHtml
      ? A().heroCardSlotHtml({
          size: 'pick',
          title: g.name,
          portrait: g.portrait || g.id,
        })
      : '<div class="sgs-hero-card sgs-hero-card--pick is-empty"></div>';
    btn.innerHTML =
      cardHtml +
      `<span class="sgs-gen-meta"><strong>${escapeHtml(g.name)}</strong>` +
      `<small>${escapeHtml(g.country)} · ${g.maxHp} 血</small>` +
      (skillText
        ? `<small class="sgs-gen-skills">${escapeHtml(skillText)}</small>`
        : '') +
      `</span>`;
    btn.addEventListener('click', (ev) => onClick(ev, btn));
    bindGeneralHoverTip(btn, g);
    return btn;
  }

  function captureGeneralPickFly(g, btn) {
    const fx = Fx();
    const cardEl = btn && btn.querySelector('.sgs-hero-card');
    const box =
      (fx && fx.rectBox && fx.rectBox(cardEl)) ||
      (cardEl &&
        (() => {
          const r = cardEl.getBoundingClientRect();
          return { x: r.left, y: r.top, w: r.width, h: r.height };
        })());
    state.generalPickFly = {
      generalId: g.id,
      portrait: g.portrait || g.id,
      from: box,
      pickIndex: btn && btn.dataset.pickIndex,
      playing: false,
    };
  }

  function playGeneralPickFly(game) {
    const pending = state.generalPickFly;
    if (!pending || pending.playing) return;
    const me = (game.players || []).find((p) => game.me && p.id === game.me.id);
    if (!me || !me.generalId || me.generalId !== pending.generalId) return;

    const dest =
      ($('sgs-self-info') &&
        $('sgs-self-info').querySelector('.sgs-hero-card--self')) ||
      ($('sgs-self-info') && $('sgs-self-info').querySelector('.sgs-hero-card'));
    if (!dest) return;

    pending.playing = true;
    dest.classList.add('is-await-fly');

    const fx = Fx();
    const to =
      (fx && fx.rectBox && fx.rectBox(dest)) ||
      (() => {
        const r = dest.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      })();
    const from = pending.from || to;

    const finish = () => {
      dest.classList.remove('is-await-fly');
      if (
        state.generalPickFly &&
        state.generalPickFly.generalId === pending.generalId
      ) {
        state.generalPickFly = null;
      }
    };

    const run =
      fx && fx.animateHeroFly
        ? fx.animateHeroFly({
            portrait: pending.portrait || me.portrait || me.generalId,
            from,
            to,
            duration: 620,
          })
        : Promise.resolve();

    Promise.resolve(run).then(finish).catch(finish);
    setTimeout(finish, 1200);
  }

  /** 身份局开场：自己的身份牌先在屏幕中央放大，再飞到身份牌位 */
  function playIdentityReveal(game) {
    if (!game) return;
    // 身份局需求：应在「选将前」先播放自己的身份牌放大 → 飞入。
    // - identity/xianzhu：select_general(lord) 时播一次
    // - playing：首回合 turnCount===1 时兜底播一次（例如重连/状态跳过）
    const phaseOk =
      (game.phase === 'select_general' &&
        (game.mode === 'identity' || game.mode === 'xianzhu') &&
        game.selectGeneralPhase === 'lord') ||
      (game.phase === 'playing' && Number(game.turnCount) === 1);
    if (!phaseOk) return;
    if (
      game.mode !== 'identity' &&
      game.mode !== 'xianzhu' &&
      game.mode !== '1v2'
    ) {
      return;
    }
    const me = (game.players || []).find((p) => game.me && p.id === game.me.id);
    if (!me || !me.identity || !A() || !A().identityUrl(me.identity)) return;

    const key = `${me.id}:${me.identity}:${game.mode}:${(game.players || [])
      .map((p) => p.id)
      .join(',')}`;
    if (state.identityRevealDone === key || state.identityRevealPlaying) return;

    const dest =
      ($('sgs-self-meta') &&
        $('sgs-self-meta').querySelector('.sgs-identity-card')) ||
      null;
    if (!dest) return;

    state.identityRevealDone = key;
    state.identityRevealPlaying = true;
    dest.classList.add('is-await-fly');

    const fx = Fx();
    const measureDest = () => {
      const el =
        ($('sgs-self-meta') &&
          $('sgs-self-meta').querySelector('.sgs-identity-card')) ||
        dest;
      return (
        (fx && fx.rectBox && fx.rectBox(el)) ||
        (() => {
          const r = el.getBoundingClientRect();
          return { x: r.left, y: r.top, w: r.width, h: r.height };
        })()
      );
    };

    const finish = () => {
      state.identityRevealPlaying = false;
      const el =
        $('sgs-self-meta') &&
        $('sgs-self-meta').querySelector('.sgs-identity-card');
      if (el) el.classList.remove('is-await-fly');
      dest.classList.remove('is-await-fly');
    };

    // 若同时有武将飞入，稍后再播身份，避免叠在一起
    const delay =
      state.generalPickFly && state.generalPickFly.playing ? 720 : 120;

    setTimeout(() => {
      const to = measureDest();
      const run =
        fx && fx.animateIdentityReveal
          ? fx.animateIdentityReveal({
              identity: me.identity,
              to,
              holdMs: 1100,
              flyMs: 680,
            })
          : Promise.resolve();
      Promise.resolve(run).then(finish).catch(finish);
      setTimeout(finish, 2400);
    }, delay);
  }

  function renderBan(game, net) {
    let wrap = $('sgs-ban-select');
    if (!wrap) {
      const parent =
        ($('sgs-general-select') && $('sgs-general-select').parentNode) ||
        $('panel-sgs');
      if (!parent) return;
      wrap = document.createElement('div');
      wrap.id = 'sgs-ban-select';
      wrap.className = 'sgs-general-select';
      wrap.innerHTML =
        '<h3>Ban 对方武将</h3><p id="sgs-ban-hint" class="muted"></p><div id="sgs-ban-choices" class="sgs-general-choices"></div>';
      parent.insertBefore(wrap, $('sgs-general-select'));
    }
    const box = $('sgs-ban-choices');
    const hint = $('sgs-ban-hint');
    if (game.phase !== 'ban_general') {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    const ban = game.banInfo || {};
    hint.textContent = ban.myTurn
      ? '请选择要禁用的对方武将'
      : `等待 ${ban.askName || '—'} Ban 将`;
    box.innerHTML = '';
    if (!ban.myTurn) return;
    for (const g of ban.enemyPool || []) {
      box.appendChild(
        makeGeneralButton(g, () => {
          net.sendAction('ban_general', { generalId: g.id });
        })
      );
    }
  }

  function renderGenerals(game, net) {
    const wrap = $('sgs-general-select');
    const box = $('sgs-general-choices');
    if (!wrap || !box) return;
    if (
      game.phase !== 'select_general' ||
      !game.generalChoices ||
      !game.generalChoices.length
    ) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    box.innerHTML = '';
    game.generalChoices.forEach((g, index) => {
      box.appendChild(
        makeGeneralButton(
          g,
          (_ev, btn) => {
            captureGeneralPickFly(g, btn);
            net.sendAction('select_general', { generalId: g.id });
          },
          index
        )
      );
    });
  }

  function seatIdentityLabel(game, p) {
    if (game.mode === 'xianzhu') {
      if (p.isZhu && p.identity === 'xianzhu') return '先主';
      if (p.identity === 'houzhu' || (p.isZhu && p.houzhuOrigin)) {
        return p.identityLabel || '后主';
      }
      return p.identityLabel || '？';
    }
    if (p.isZhu) return game.mode === '1v2' ? '主公/地主' : '主公';
    return p.identityLabel || '？';
  }

  /** 当前模式可标记的身份选项（不含已亮明的主公/先主） */
  function identityMarkChoices(game) {
    if (game.mode === 'xianzhu') {
      return [
        { id: 'zhong', name: '忠臣' },
        { id: 'fan', name: '反贼' },
        { id: 'huangjin', name: '黄巾' },
      ];
    }
    if (game.mode === 'identity') {
      return [
        { id: 'zhong', name: '忠臣' },
        { id: 'fan', name: '反贼' },
        { id: 'nei', name: '内奸' },
      ];
    }
    return [];
  }

  function canMarkSeatIdentity(game, p) {
    if (!game || !p || !game.me) return false;
    if (p.id === game.me.id) return false;
    if (game.mode !== 'identity' && game.mode !== 'xianzhu') return false;
    if (game.over) return false;
    if (p.identity) return false;
    if (p.isZhu) return false;
    if (p.identityRevealed) return false;
    return identityMarkChoices(game).length > 0;
  }

  function hideIdentityMarkPop() {
    const pop = $('sgs-id-mark-pop');
    if (pop) pop.hidden = true;
    state.identityMarkPop = null;
  }

  function showIdentityMarkPop(anchorEl, game, playerId) {
    let pop = $('sgs-id-mark-pop');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'sgs-id-mark-pop';
      pop.className = 'sgs-id-mark-pop';
      pop.hidden = true;
      document.body.appendChild(pop);
      document.addEventListener(
        'click',
        (ev) => {
          if (!pop || pop.hidden) return;
          if (pop.contains(ev.target)) return;
          if (ev.target.closest && ev.target.closest('.sgs-seat-identity')) {
            return;
          }
          hideIdentityMarkPop();
        },
        true
      );
    }
    const choices = identityMarkChoices(game);
    const cur = state.identityMarks[playerId] || null;
    pop.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'sgs-id-mark-title';
    title.textContent = '标记身份（仅自己可见）';
    pop.appendChild(title);
    const row = document.createElement('div');
    row.className = 'sgs-id-mark-row';
    for (const opt of choices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className =
        'sgs-id-mark-opt' + (cur === opt.id ? ' is-active' : '');
      const img = document.createElement('img');
      img.src = A().identityUrl(opt.id);
      img.alt = opt.name;
      b.appendChild(img);
      const lab = document.createElement('span');
      lab.textContent = opt.name;
      b.appendChild(lab);
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        state.identityMarks[playerId] = opt.id;
        hideIdentityMarkPop();
        if (state.game && state.net) render(state.game, state.net);
      });
      row.appendChild(b);
    }
    pop.appendChild(row);
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'sgs-id-mark-clear secondary';
    clear.textContent = '恢复暗置';
    clear.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      delete state.identityMarks[playerId];
      hideIdentityMarkPop();
      if (state.game && state.net) render(state.game, state.net);
    });
    pop.appendChild(clear);
    pop.hidden = false;
    state.identityMarkPop = { playerId };

    const r = anchorEl.getBoundingClientRect();
    const pw = 220;
    let left = r.right + 6;
    let top = r.top;
    if (left + pw > window.innerWidth - 8) left = r.left - pw - 6;
    if (left < 8) left = 8;
    if (top + 200 > window.innerHeight) {
      top = Math.max(8, window.innerHeight - 210);
    }
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function mountSeatIdentity(div, game, p, isMe) {
    const markable = canMarkSeatIdentity(game, p);
    const marked = state.identityMarks[p.id] || null;

    let src = null;
    let title = '';
    let cls = 'sgs-seat-identity';
    let clickable = false;

    if (p.identity && A().identityUrl(p.identity)) {
      src = A().identityUrl(p.identity);
      title = p.identityLabel || A().identityLabel(p.identity) || '';
      if (!p.alive || p.identityRevealed) cls += ' revealed';
    } else if (markable && marked && A().identityUrl(marked)) {
      src = A().identityUrl(marked);
      title = `标记：${A().identityLabel(marked)}（仅自己可见）`;
      cls += ' is-marked';
      clickable = true;
    } else if (markable) {
      src = A().identityBackUrl();
      title = '身份暗置，点击标记';
      cls += ' is-hidden is-markable';
      clickable = true;
    } else if (!isMe && (game.mode === 'identity' || game.mode === 'xianzhu')) {
      src = A().identityBackUrl();
      title = '身份暗置';
      cls += ' is-hidden';
    } else {
      return;
    }

    const idImg = document.createElement('img');
    idImg.className = cls;
    idImg.src = src;
    idImg.alt = title;
    idImg.title = title;
    if (clickable) {
      idImg.style.cursor = 'pointer';
      idImg.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (
          state.identityMarkPop &&
          state.identityMarkPop.playerId === p.id &&
          $('sgs-id-mark-pop') &&
          !$('sgs-id-mark-pop').hidden
        ) {
          hideIdentityMarkPop();
          return;
        }
        showIdentityMarkPop(idImg, game, p.id);
      });
    }
    div.appendChild(idImg);
  }

  function isShaCard(card) {
    return Boolean(card && (card.name === '杀' || card.name === '火杀' || card.name === '雷杀'));
  }

  function playerHasRegionCards(p) {
    if (!p) return false;
    if ((p.handCount || 0) > 0) return true;
    if (p.judges && p.judges.length) return true;
    const e = p.equips || {};
    return Boolean(
      e.weapon || e.armor || e.horseMinus || e.horsePlus || e.treasure
    );
  }

  function myMuniuCards(game) {
    return (game.me && game.me.muniuCards) || [];
  }

  function myPlayableCards(game) {
    const me = (game.players || []).find((p) => game.me && p.id === game.me.id);
    return [...(me && me.hand ? me.hand : []), ...myMuniuCards(game)];
  }

  function findSelectedCard(game) {
    if (!state.selectedCardId || !game.me) return null;
    return (
      myPlayableCards(game).find((c) => c.id === state.selectedCardId) || null
    );
  }

  function viewAsVirtualCard(card, to) {
    if (!card || !to) return card;
    const name =
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
                      : to === 'sha'
                        ? '杀'
                        : card.name;
    return { ...card, name, _viewAsTo: to };
  }

  /**
   * 选中手牌后的操作提示 / 合法目标 / 能否确认出牌
   */
  function getCardPlayGuide(game, card) {
    const me = game.me;
    const empty = {
      hint: '需要目标的牌：先点手牌，再点桌上角色',
      needTargets: 0,
      maxTargets: 0,
      canConfirm: false,
      blockReason: '',
      isTargetValid: () => false,
      dimUnreachable: false,
      canRecast: false,
    };
    const pv = state.pendingViewAs;
    if (
      !me ||
      !me.isMyTurn ||
      game.turnPhase !== 'play' ||
      game.pending
    ) {
      return empty;
    }

    // 转化技已点亮：未选可用牌时给引导
    if (pv) {
      const usable = pv.usableCardIds || [];
      if (!card || !usable.includes(card.id)) {
        const needsTarget =
          pv.to === 'sha' ||
          pv.to === 'guohe' ||
          pv.to === 'lebu' ||
          pv.to === 'juedou' ||
          pv.to === 'bingliang' ||
          pv.to === 'tiesuo' ||
          pv.to === 'huogong';
        return {
          ...empty,
          hint: `【${pv.skillName || '技能'}】已准备：请选择可用手牌${
            needsTarget ? '，再选择目标' : ''
          }（再点技能可取消）`,
          needTargets: needsTarget ? 1 : 0,
          maxTargets: needsTarget ? 1 : 0,
          // 先选可用牌：角色目标全部置灰，避免误点
          dimUnreachable: needsTarget,
          isTargetValid: () => false,
        };
      }
      card = viewAsVirtualCard(card, pv.to);
    } else if (!card) {
      return empty;
    }

    const meId = me.id;
    const othersAlive = (game.players || []).filter(
      (p) => p.alive && p.id !== meId
    );
    const selected = state.selectedTargets || [];

    const guide = {
      hint: '',
      needTargets: 0,
      maxTargets: 0,
      canConfirm: false,
      blockReason: '',
      isTargetValid: () => false,
      dimUnreachable: false,
      canRecast: false,
    };

    const name = card.name;

    if (isShaCard(card)) {
      const limit = Number(me.shaLimit);
      const used = Number(me.shaUsed) || 0;
      const ignoreCount =
        Boolean(pv && pv.skillId === 'wusheng' && card.suit === 'heart') ||
        Boolean(pv && pv.skillId === 'wusheng' && card.suitLabel === '♥');
      const ignoreDist =
        Boolean(me.ignoreShaDistance) ||
        Boolean(pv && pv.skillId === 'wusheng' && card.suit === 'diamond') ||
        Boolean(pv && pv.skillId === 'wusheng' && card.suitLabel === '♦');
      const noCount =
        !ignoreCount && Number.isFinite(limit) && limit < 99 && used >= limit;
      guide.needTargets = 1;
      guide.maxTargets = 1;
      guide.dimUnreachable = true;
      guide.isTargetValid = (p) => {
        if (!p || !p.alive || p.id === meId) return false;
        return isShaTargetReachable(game, p, ignoreDist);
      };
      if (noCount) {
        guide.hint = `无出杀次数（本回合 ${used}/${limit}）`;
        guide.blockReason = guide.hint;
        guide.canConfirm = false;
        guide.isTargetValid = () => false;
        return guide;
      }
      const remain =
        Number.isFinite(limit) && limit < 99
          ? `（本回合杀 ${used}/${limit}）`
          : '';
      guide.hint =
        selected.length >= 1
          ? `${pv ? `【${pv.skillName}】视为【杀】，` : ''}已选目标，点击「确认出牌」${remain}`
          : `${pv ? `【${pv.skillName}】：已选牌，` : ''}请选择攻击目标${remain}`;
      guide.canConfirm =
        selected.length === 1 &&
        guide.isTargetValid(
          (game.players || []).find((p) => p.id === selected[0])
        );
      if (selected.length && !guide.canConfirm) {
        guide.hint = '所选目标攻击不到，请改选可攻击角色';
      }
      return guide;
    }

    if (name === '闪') {
      guide.hint = '【闪】不能主动打出，只能在被杀时使用';
      guide.blockReason = '不能主动打出';
      return guide;
    }

    if (name === '桃') {
      guide.needTargets = 0;
      guide.maxTargets = 1;
      guide.dimUnreachable = true;
      guide.isTargetValid = (p) =>
        Boolean(p && p.alive && p.hp < p.maxHp);
      const meP = (game.players || []).find((p) => p.id === meId);
      const canSelf = meP && meP.hp < meP.maxHp;
      if (!canSelf && !othersAlive.some(guide.isTargetValid)) {
        guide.hint = '没有体力未满的角色，无法使用【桃】';
        guide.blockReason = '无人可回血';
        return guide;
      }
      guide.hint = selected.length
        ? '已选回复目标，点击「打出选中牌」'
        : canSelf
          ? '可直接出牌对自己使用，或选择一名体力未满的角色（满血已置灰）'
          : '请选择一名体力未满的角色';
      guide.canConfirm =
        selected.length === 0
          ? Boolean(canSelf)
          : guide.isTargetValid(
              (game.players || []).find((p) => p.id === selected[0])
            );
      return guide;
    }

    if (name === '酒') {
      guide.hint = '点击「打出选中牌」：下一张【杀】伤害 +1';
      guide.canConfirm = true;
      return guide;
    }

    if (
      name === '无中生有' ||
      name === '桃园结义' ||
      name === '五谷丰登' ||
      name === '南蛮入侵' ||
      name === '万箭齐发' ||
      name === '闪电'
    ) {
      guide.hint = `点击「打出选中牌」使用【${name}】`;
      guide.canConfirm = true;
      return guide;
    }

    if (name === '过河拆桥') {
      guide.needTargets = 1;
      guide.maxTargets = 1;
      guide.dimUnreachable = true;
      guide.isTargetValid = (p) =>
        Boolean(p && p.alive && p.id !== meId && playerHasRegionCards(p));
      guide.hint = selected.length
        ? '已选目标，出牌后选择弃置其一张牌'
        : '请选择一名区域内有牌的角色';
      guide.canConfirm =
        selected.length === 1 &&
        guide.isTargetValid(
          (game.players || []).find((p) => p.id === selected[0])
        );
      if (!othersAlive.some(guide.isTargetValid)) {
        guide.hint = '没有可拆目标';
        guide.blockReason = '无目标';
        guide.canConfirm = false;
      }
      return guide;
    }

    if (name === '顺手牵羊') {
      guide.needTargets = 1;
      guide.maxTargets = 1;
      guide.dimUnreachable = true;
      guide.isTargetValid = (p) =>
        Boolean(
          p &&
            p.alive &&
            p.id !== meId &&
            playerHasRegionCards(p) &&
            (p.distanceFromMe == null || p.distanceFromMe <= 1)
        );
      guide.hint = selected.length
        ? '已选目标，出牌后选择获得其一张牌'
        : '请选择距离为 1 且区域内有牌的角色（其余已置灰）';
      guide.canConfirm =
        selected.length === 1 &&
        guide.isTargetValid(
          (game.players || []).find((p) => p.id === selected[0])
        );
      if (!othersAlive.some(guide.isTargetValid)) {
        guide.hint = '没有可顺手的目标';
        guide.blockReason = '无目标';
        guide.canConfirm = false;
      }
      return guide;
    }

    if (name === '决斗') {
      guide.needTargets = 1;
      guide.maxTargets = 1;
      guide.dimUnreachable = true;
      guide.isTargetValid = (p) => Boolean(p && p.alive && p.id !== meId);
      guide.hint = selected.length
        ? '已选决斗对象，点击「打出选中牌」'
        : '请选择一名角色进行决斗';
      guide.canConfirm = selected.length === 1;
      return guide;
    }

    if (name === '借刀杀人') {
      guide.needTargets = 2;
      guide.maxTargets = 2;
      guide.dimUnreachable = true;
      guide.isTargetValid = (p) => {
        if (!p || !p.alive || p.id === meId) return false;
        if (selected.includes(p.id)) return true;
        if (selected.length === 0) return Boolean(p.equips && p.equips.weapon);
        if (selected.length === 1) return p.id !== selected[0];
        return false;
      };
      if (selected.length === 0) {
        guide.hint = '请先选择拥有武器的角色（借出刀）';
      } else if (selected.length === 1) {
        guide.hint = '请再选择被杀的目标';
      } else {
        guide.hint = '目标已选齐，点击「打出选中牌」';
      }
      guide.canConfirm = selected.length === 2;
      return guide;
    }

    if (name === '乐不思蜀' || name === '兵粮寸断') {
      guide.needTargets = 1;
      guide.maxTargets = 1;
      guide.dimUnreachable = true;
      const sub = name === '乐不思蜀' ? 'lebu' : 'bingliang';
      guide.isTargetValid = (p) => {
        if (!p || !p.alive || p.id === meId) return false;
        if (name === '兵粮寸断' && p.distanceFromMe != null && p.distanceFromMe > 1) {
          return false;
        }
        const has = (p.judges || []).some(
          (j) => j.subtype === sub || j.name === name
        );
        return !has;
      };
      guide.hint = selected.length
        ? '已选目标，点击「打出选中牌」'
        : name === '兵粮寸断'
          ? '请选择距离为 1 且判定区无此牌的角色'
          : '请选择判定区没有【乐不思蜀】的角色';
      guide.canConfirm =
        selected.length === 1 &&
        guide.isTargetValid(
          (game.players || []).find((p) => p.id === selected[0])
        );
      return guide;
    }

    if (name === '铁索连环') {
      guide.needTargets = 0;
      guide.maxTargets = 2;
      guide.dimUnreachable = true;
      guide.isTargetValid = (p) => Boolean(p && p.alive);
      guide.hint = selected.length
        ? `已选 ${selected.length} 人：对每人横置状态取反（已连↔未连）；或点「重置」摸 1`
        : '点选 1～2 名角色，对各自横置状态取反；或不选目标点「重置」摸 1';
      guide.canConfirm = true;
      guide.canRecast = true;
      return guide;
    }

    if (name === '火攻') {
      guide.needTargets = 1;
      guide.maxTargets = 1;
      guide.dimUnreachable = true;
      guide.isTargetValid = (p) =>
        Boolean(p && p.alive && p.id !== meId && (p.handCount || 0) > 0);
      guide.hint = selected.length
        ? '已选目标，点击「打出选中牌」'
        : '请选择一名有手牌的角色';
      guide.canConfirm =
        selected.length === 1 &&
        guide.isTargetValid(
          (game.players || []).find((p) => p.id === selected[0])
        );
      return guide;
    }

    if (card.type === 'equip') {
      guide.hint = `点击「打出选中牌」装备【${name}】`;
      guide.canConfirm = true;
      return guide;
    }

    guide.hint = `已选【${name}】，选择目标（如需）后点击出牌`;
    guide.canConfirm = true;
    return guide;
  }

  function isMuniuSkillPending() {
    return Boolean(
      state.pendingSkill && state.pendingSkill.skillId === MUNIU_SKILL_ID
    );
  }

  function isPendingSeatTargeting(pend) {
    if (!pend || !pend.forMe) return false;
    if (pend.type === 'succession') return true;
    if (pend.maxTargets != null && Number(pend.maxTargets) > 0) return true;
    if (pend.type !== 'skill_effect') return false;
    if (pend.skillId === MUNIU_SKILL_ID && pend.step === 'transfer') return true;
    if (pend.skillId === 'fanjian') return pend.step === 'target';
    const seatSkills = new Set([
      'tuxi',
      'liuli',
      'qice',
      'liyu',
      'jujian',
      'yiji',
      'tianxiang',
      'fangquan',
      'jieming',
      'ganlu',
      'haoshi',
      'xuanhuo',
      'quhu',
      'dimeng',
      'anxu',
      'lijian',
      'luanwu',
    ]);
    if (seatSkills.has(pend.skillId)) return true;
    return /选择.*角色|点击座位|交给/.test(pend.message || '');
  }

  /** 技能选座期间：目标是否可选 */
  function isPendingSeatTargetValid(game, pend, p) {
    if (!pend || !p || !p.alive) return false;
    const meId = game.me && game.me.id;
    if (pend.skillId === 'tuxi') {
      return p.id !== meId && Number(p.handCount) > 0;
    }
    if (pend.skillId === 'liuli') {
      const atk = pend.attackerId || pend.sourceId;
      return p.id !== meId && p.id !== atk && Boolean(p.inMyAttackRange);
    }
    if (pend.skillId === 'haoshi') {
      return (pend.candidateIds || []).includes(p.id);
    }
    if (pend.skillId === MUNIU_SKILL_ID && pend.step === 'transfer') {
      return (pend.candidateIds || []).includes(p.id);
    }
    if (pend.skillId === 'yiji' || pend.allowSelf) {
      return true;
    }
    if (pend.skillId === 'jieming' || pend.skillId === 'ganlu') {
      return true;
    }
    if (pend.skillId === 'qice' && pend.trickId === 'tiesuo') {
      return true;
    }
    if (pend.skillId === 'quhu' && pend.step === 'damage') {
      return p.id !== meId && p.id !== pend.targetId;
    }
    if (pend.type === 'succession') {
      return p.id !== meId;
    }
    return p.id !== meId;
  }

  /** 出牌或 pending 选座时，是否可点自己角色卡作为目标 */
  function canPickSelfSeatTarget(game, pend, me, guide) {
    if (!me || !me.alive) return false;
    if (isPendingSeatTargeting(pend)) {
      return isPendingSeatTargetValid(game, pend, me);
    }
    if (pend) return false;
    if (!game.me || !game.me.isMyTurn || game.turnPhase !== 'play') return false;
    if (!guide) return false;
    if (guide.maxTargets <= 0 && guide.needTargets <= 0) return false;
    return Boolean(guide.isTargetValid && guide.isTargetValid(me));
  }

  function toggleSelfSeatTarget(game, pend, guide) {
    const me = (game.players || []).find((p) => game.me && p.id === game.me.id);
    if (!me || !canPickSelfSeatTarget(game, pend, me, guide)) return;
    let max = 1;
    if (isPendingSeatTargeting(pend)) {
      max = Math.max(1, Number(pend.maxTargets) || 1);
    } else if (guide && guide.maxTargets > 0) {
      max = guide.maxTargets;
    }
    const iSel = state.selectedTargets.indexOf(me.id);
    if (iSel >= 0) {
      state.selectedTargets.splice(iSel, 1);
    } else if (max === 1) {
      state.selectedTargets = [me.id];
    } else if (state.selectedTargets.length >= max) {
      state.selectedTargets = state.selectedTargets.slice(1).concat(me.id);
    } else {
      state.selectedTargets.push(me.id);
    }
    refreshLocalSelection(game, state.net);
  }

  function pruneInvalidTargets(game, guide) {
    if (!guide) return;
    if (isActiveSkillSeatTargeting()) {
      const skId = state.pendingSkill.skillId;
      state.selectedTargets = (state.selectedTargets || []).filter((id) => {
        const p = (game.players || []).find((x) => x.id === id);
        return isActiveSkillSeatTargetValid(game, skId, p);
      });
      if (state.selectedTargets.length > 1) {
        state.selectedTargets = state.selectedTargets.slice(0, 1);
      }
      return;
    }
    // 突袭等技能选座位期间，不能按出牌 guide（此时 isTargetValid 恒为 false）清掉已选
    if (isPendingSeatTargeting(game.pending)) {
      const pend = game.pending;
      state.selectedTargets = (state.selectedTargets || []).filter((id) => {
        const p = (game.players || []).find((x) => x.id === id);
        return isPendingSeatTargetValid(game, pend, p);
      });
      const max =
        pend.maxTargets != null ? Number(pend.maxTargets) : 1;
      if (max > 0 && state.selectedTargets.length > max) {
        state.selectedTargets = state.selectedTargets.slice(0, max);
      }
      return;
    }
    state.selectedTargets = (state.selectedTargets || []).filter((id) => {
      const p = (game.players || []).find((x) => x.id === id);
      return guide.isTargetValid(p);
    });
    if (guide.maxTargets > 0 && state.selectedTargets.length > guide.maxTargets) {
      state.selectedTargets = state.selectedTargets.slice(0, guide.maxTargets);
    }
  }

  function getActingHint(game, playerId) {
    const list = game.acting || [];
    const row = list.find((a) => a.id === playerId);
    return row ? row.hint || '请操作' : null;
  }

  function hpHeartsHtml(hp, maxHp) {
    const cur = Math.max(0, Math.floor(Number(hp) || 0));
    const max = Math.max(cur, Math.floor(Number(maxHp) || 0));
    let html = `<span class="sgs-hp-hearts" title="体力 ${cur}/${max}" aria-label="体力 ${cur}/${max}">`;
    for (let i = 0; i < max; i++) {
      html +=
        i < cur
          ? '<span class="sgs-hp-heart is-full">♥</span>'
          : '<span class="sgs-hp-heart is-empty">♥</span>';
    }
    return html + '</span>';
  }

  function judgeMarkMeta(j) {
    if (!j) return null;
    const name = j.name || '';
    const sub = j.subtype || '';
    if (sub === 'lebu' || name === '乐不思蜀') {
      return { cls: 'le', text: '乐', title: '乐不思蜀' };
    }
    if (sub === 'bingliang' || name === '兵粮寸断') {
      return { cls: 'bing', text: '兵', title: '兵粮寸断' };
    }
    if (sub === 'shandian' || name === '闪电') {
      return { cls: 'shan', text: '闪', title: '闪电' };
    }
    return null;
  }

  function judgeMarksHtml(judges) {
    const marks = (judges || []).map(judgeMarkMeta).filter(Boolean);
    if (!marks.length) return '';
    return (
      `<div class="sgs-judge-marks">` +
      marks
        .map(
          (m) =>
            `<span class="sgs-judge-mark is-${m.cls}" title="${escapeHtml(m.title)}">${m.text}</span>`
        )
        .join('') +
      `</div>`
    );
  }

  function appendTianStack(parent, tianCards) {
    if (!parent || !tianCards || !tianCards.length || !A() || !A().createCardEl) {
      return;
    }
    const n = tianCards.length;
    const wrap = document.createElement('div');
    wrap.className = 'sgs-tian-stack';
    wrap.title = `田 ×${n}`;
    const cardsEl = document.createElement('div');
    cardsEl.className = 'sgs-tian-cards';
    const show = tianCards.slice(-Math.min(3, n));
    show.forEach((c, i) => {
      const el = A().createCardEl(c, { size: 'sm', className: 'is-tian-card' });
      el.style.zIndex = String(i + 1);
      if (i > 0) el.style.marginLeft = '-22px';
      cardsEl.appendChild(el);
    });
    wrap.appendChild(cardsEl);
    const badge = document.createElement('span');
    badge.className = 'sgs-tian-count';
    badge.textContent = String(n);
    wrap.appendChild(badge);
    parent.appendChild(wrap);
  }

  function skillPilesHtml(piles) {
    if (!piles) return '';
    const bits = [];
    if (piles.buqu && piles.buqu.length) {
      bits.push(
        `<span class="sgs-pile-mark is-buqu" title="不屈×${piles.buqu.length}">不屈${piles.buqu.length}</span>`
      );
    }
    if (piles.muniu && piles.muniu.length) {
      /* 木牛上的牌仅拥有者可见，在本人手牌区展示 */
    }
    if (!bits.length) return '';
    return `<div class="sgs-skill-piles">${bits.join('')}</div>`;
  }

  function heroCardWithChainHtml(heroHtml, chained) {
    if (!chained || !heroHtml) return heroHtml;
    const chain =
      '<div class="sgs-chain-wrap" aria-hidden="true" title="铁索连环：横置">' +
      '<span></span><span></span><span></span></div>';
    return String(heroHtml)
      .replace(/class="(sgs-hero-card[^"]*)"/, 'class="$1 is-chained"')
      .replace(/<\/div>\s*$/, chain + '</div>');
  }

  /** 清除误挂在本人整块操作区上的铁索层（只保留武将卡内） */
  function scrubPanelChainOverlays(root) {
    if (!root) return;
    const nodes = root.querySelectorAll('.sgs-chain-wrap');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (!el.closest || !el.closest('.sgs-hero-card')) {
        el.remove();
      }
    }
    if (root.classList) root.classList.remove('is-chained');
  }

  function fillSeatCard(div, game, p, isMe, guide) {
    const modeSkills =
      game.mode === '1v2' && p.isZhu && p.alive ? ['跋扈', '飞扬'] : [];
    const skillNames = [
      ...(p.skills || []).map((s) => s.name),
      ...modeSkills,
    ].join('/');
    const seatNo = `${p.seatNo || p.seat + 1}号`;
    const seatMetaBits = [];
    if (p.isTeammate) seatMetaBits.push('队友');
    else if (isMe) seatMetaBits.push('你');
    if (p.team) seatMetaBits.push(`队${p.team}`);
    // 自己座位仍显示号位；对方号位改到距离左侧
    if (isMe) seatMetaBits.unshift(seatNo);
    const actingHint = p.alive ? getActingHint(game, p.id) : null;

    div.className =
      'sgs-seat' +
      (p.alive ? '' : ' dead') +
      (p.id === game.turnPlayerId ? ' turn' : '') +
      (actingHint ? ' acting' : '') +
      (p.isTeammate ? ' mate' : '') +
      (isMe ? ' me-seat' : '') +
      (p.turnedOver ? ' is-turned' : '') +
      (p.left ? ' is-left' : '') +
      (state.selectedTargets.includes(p.id) ? ' targeted' : '');

    if (
      !isMe &&
      p.alive &&
      !p.left &&
      guide &&
      (guide.dimUnreachable ||
        guide.needTargets > 0 ||
        guide.maxTargets > 0) &&
      typeof guide.isTargetValid === 'function'
    ) {
      if (guide.isTargetValid(p)) div.className += ' target-ok';
      else div.className += ' target-dim';
    }

    // 突袭等：按技能规则高亮可选座位
    if (!isMe && p.alive && !p.left && isPendingSeatTargeting(game.pending)) {
      if (isPendingSeatTargetValid(game, game.pending, p)) {
        div.className += ' target-ok';
      } else {
        div.className += ' target-dim';
      }
    }
    if (!isMe && p.alive && !p.left && isActiveSkillSeatTargeting()) {
      if (isActiveSkillSeatTargetValid(game, state.pendingSkill.skillId, p)) {
        div.className += ' target-ok';
      } else {
        div.className += ' target-dim';
      }
    }

    const equipWrap = document.createElement('div');
    equipWrap.className = 'sgs-seat-equips';
    const e = p.equips || {};
    if (A() && A().createCardEl) {
      for (const slot of [
        'weapon',
        'armor',
        'horseMinus',
        'horsePlus',
        'treasure',
      ]) {
        if (!e[slot]) continue;
        equipWrap.appendChild(A().createCardEl(e[slot], { size: 'sm' }));
      }
    }

    const heroCardHtml = heroCardWithChainHtml(
      A() && A().heroCardSlotHtml
        ? A().heroCardSlotHtml(
            p.generalHidden
              ? {
                  size: 'seat',
                  title: '已选定（暗置）',
                  faceDown: true,
                }
              : p.generalId || p.portrait
                ? {
                    size: 'seat',
                    title: p.generalName || '角色卡',
                    portrait: p.portrait || p.generalId,
                  }
                : {
                    size: 'seat',
                    title: '选将中',
                    empty: true,
                  }
          )
        : '<div class="sgs-hero-card sgs-hero-card--seat is-empty"></div>',
      p.chained
    );

    const generalLabel = p.generalName
      ? escapeHtml(p.generalName)
      : p.generalHidden
        ? '已选定'
        : '选将中';

    div.innerHTML =
      (actingHint
        ? `<div class="sgs-acting-tip">${escapeHtml(actingHint)}</div>`
        : '') +
      `<div class="sgs-seat-main">` +
      heroCardHtml +
      `<div class="sgs-seat-body">` +
      `<div class="sgs-seat-general">${generalLabel}</div>` +
      (seatMetaBits.length
        ? `<div class="muted">${escapeHtml(seatMetaBits.join(' · '))}</div>`
        : '') +
      (skillNames
        ? `<div class="sgs-seat-skills muted">${escapeHtml(skillNames)}</div>`
        : '') +
      `<div class="sgs-seat-hp-row">${hpHeartsHtml(p.hp, p.maxHp)}</div>` +
      (p.huangjinMarks
        ? `<div class="sgs-huangjin-mark">黄巾标记 ${p.huangjinMarks}/3</div>`
        : '') +
      `</div></div>` +
      judgeMarksHtml(p.judges) +
      skillPilesHtml(p.skillPiles);

    // 身份牌：右上角（真身份 / 本地标记 / 暗置卡背）
    mountSeatIdentity(div, game, p, isMe);

    // 手牌：按张数叠放卡背（张数多时加大重叠，避免超出座位宽度）
    const handN = Math.max(0, Number(p.handCount) || 0);
    if (handN > 0 && A() && A().createCardEl) {
      const handWrap = document.createElement('div');
      handWrap.className = 'sgs-seat-handbacks';
      handWrap.title = `手牌 ${handN}`;
      const show = Math.min(handN, 10);
      const overlapPx =
        show <= 3 ? 10 : show <= 5 ? 18 : show <= 7 ? 24 : show <= 9 ? 28 : 30;
      for (let i = 0; i < show; i++) {
        const back = A().createCardEl(null, { faceDown: true, size: 'sm' });
        back.style.zIndex = String(i + 1);
        if (i > 0) back.style.marginLeft = `-${overlapPx}px`;
        handWrap.appendChild(back);
      }
      if (handN > show) {
        const more = document.createElement('span');
        more.className = 'sgs-seat-hand-more';
        more.textContent = `+${handN - show}`;
        handWrap.appendChild(more);
      }
      div.appendChild(handWrap);
    }

    if (equipWrap.childNodes.length) {
      const marks = div.querySelector('.sgs-judge-marks');
      const hands = div.querySelector('.sgs-seat-handbacks');
      if (marks) div.insertBefore(equipWrap, marks);
      else if (hands) div.insertBefore(equipWrap, hands);
      else div.appendChild(equipWrap);
    }

    const heroEl = div.querySelector('.sgs-hero-card:not(.is-back)');
    if (heroEl) bindPlayerGeneralHoverTip(heroEl, p);
    const seatMain = div.querySelector('.sgs-seat-main');
    if (seatMain && p.skillPiles && p.skillPiles.tian && p.skillPiles.tian.length) {
      appendTianStack(seatMain, p.skillPiles.tian);
    }
  }

  function isMobileSgsSurface() {
    try {
      if (document.documentElement.dataset.mobilePlay === '1') return true;
      if (document.body.classList.contains('is-mobile-chat')) return true;
    } catch (_) {}
    return false;
  }

  /** 对手人数越多，座位版面等比缩小，避免互相压住 */
  function seatScaleForOpponents(n) {
    const count = Number(n) || 0;
    let scale = 1;
    if (count <= 2) scale = 1;
    else if (count === 3) scale = 0.9;
    else if (count === 4) scale = 0.78;
    else if (count === 5) scale = 0.7;
    else if (count === 6) scale = 0.64;
    else scale = 0.58; // 7+（如 8 人局）
    if (isMobileSgsSurface()) return Math.min(scale, 0.78);
    return scale;
  }

  /** 以本人为底，其余座位沿远端弧线排布 */
  function opponentLayout(index, total) {
    if (total <= 0) return { left: '50%', top: '18%' };
    const t = total === 1 ? 0.5 : index / (total - 1);
    const mobile = isMobileSgsSurface();
    // 人多时略拉开弧线半径，配合缩小后的版面减少碰撞
    const rx = mobile
      ? total >= 6
        ? 36
        : total >= 4
          ? 34
          : 32
      : total >= 6
        ? 43
        : total >= 4
          ? 40
          : 38;
    const ry = mobile
      ? total >= 6
        ? 24
        : total >= 4
          ? 22
          : 20
      : total >= 6
        ? 31
        : total >= 4
          ? 29
          : 28;
    const angle = Math.PI - t * Math.PI; // 左 π → 右 0
    const x = 50 + Math.cos(angle) * rx;
    const y = (mobile ? 40 : 46) - Math.sin(angle) * ry;
    return { left: `${x}%`, top: `${y}%` };
  }

  function renderTable(game) {
    const box = $('sgs-opponents');
    const selfInfo = $('sgs-self-info');
    const selfEquips = $('sgs-self-equips');
    const selfBar = $('sgs-self');
    if (!box) return;
    box.innerHTML = '';

    const players = game.players || [];
    const meId = game.me && game.me.id;
    let meIdx = players.findIndex((p) => p.id === meId);
    if (meIdx < 0) meIdx = 0;
    const rotated = players.slice(meIdx).concat(players.slice(0, meIdx));
    const me = rotated[0];
    const others = rotated.slice(1);

    const seatScale = seatScaleForOpponents(others.length);
    box.style.setProperty('--sgs-seat-scale', String(seatScale));
    box.dataset.opponents = String(others.length);

    const selectedCard = findSelectedCard(game);
    const guide = getCardPlayGuide(game, selectedCard);
    pruneInvalidTargets(game, guide);

    others.forEach((p, i) => {
      const anchor = document.createElement('div');
      const pos = opponentLayout(i, others.length);
      anchor.className = 'sgs-seat-anchor';
      anchor.style.left = pos.left;
      anchor.style.top = pos.top;
      anchor.dataset.playerId = p.id;

      const div = document.createElement('div');
      div.dataset.playerId = p.id;
      fillSeatCard(div, game, p, false, guide);

      const onSeatClick = () => {
        const g = state.game || game;
        const pend = g.pending;
        if (isActiveSkillSeatTargeting()) {
          const skId = state.pendingSkill.skillId;
          if (!isActiveSkillSeatTargetValid(g, skId, p)) return;
          const iSel = state.selectedTargets.indexOf(p.id);
          if (iSel >= 0) state.selectedTargets.splice(iSel, 1);
          else state.selectedTargets = [p.id];
          refreshLocalSelection(g, state.net);
          return;
        }
        if (isPendingSeatTargeting(pend)) {
          if (!isPendingSeatTargetValid(g, pend, p)) return;
          const max = Math.max(1, Number(pend.maxTargets) || 1);
          const iSel = state.selectedTargets.indexOf(p.id);
          if (iSel >= 0) {
            state.selectedTargets.splice(iSel, 1);
          } else if (max === 1) {
            state.selectedTargets = [p.id];
          } else if (state.selectedTargets.length >= max) {
            state.selectedTargets = state.selectedTargets.slice(1).concat(p.id);
          } else {
            state.selectedTargets.push(p.id);
          }
          refreshLocalSelection(g, state.net);
          return;
        }

        if (!g.me || !g.me.isMyTurn || g.turnPhase !== 'play') return;
        if (!p.alive || p.left || p.id === g.me.id) return;
        const selectedCard = findSelectedCard(g);
        if (!selectedCard) return;
        const guide = getCardPlayGuide(g, selectedCard);
        if (guide.maxTargets <= 0 && guide.needTargets <= 0) return;
        if (
          guide.dimUnreachable ||
          guide.needTargets > 0 ||
          guide.maxTargets > 0
        ) {
          if (!guide.isTargetValid(p)) return;
        }
        const iSel = state.selectedTargets.indexOf(p.id);
        if (iSel >= 0) {
          state.selectedTargets.splice(iSel, 1);
        } else if (guide.maxTargets === 1) {
          state.selectedTargets = [p.id];
        } else if (
          guide.maxTargets > 0 &&
          state.selectedTargets.length >= guide.maxTargets
        ) {
          state.selectedTargets = state.selectedTargets
            .slice(1)
            .concat(p.id);
        } else {
          state.selectedTargets.push(p.id);
        }
        refreshLocalSelection(g, state.net);
      };
      div.addEventListener('click', onSeatClick);
      anchor.appendChild(div);

      // 版面下方：昵称在号位左边，再跟距离
      const dist = document.createElement('div');
      dist.className = 'sgs-seat-dist';
      const nick = document.createElement('span');
      nick.className = 'sgs-seat-nick';
      const Nick = window.PlayerNick;
      if (Nick && Nick.formatHtml) {
        nick.innerHTML = Nick.formatHtml(p.name, p.tag);
        nick.title = Nick.fullLabel(p.name, p.tag);
      } else {
        nick.textContent = p.name || '玩家';
        nick.title = p.name || '玩家';
      }
      dist.appendChild(nick);
      if (p.left) {
        const leftTag = document.createElement('span');
        leftTag.className = 'sgs-left-tag';
        leftTag.textContent = '已离开';
        dist.appendChild(leftTag);
      }
      const no = p.seatNo != null ? p.seatNo : Number(p.seat) + 1;
      const noEl = document.createElement('span');
      noEl.className = 'sgs-seat-no';
      noEl.textContent = `${no}号`;
      dist.appendChild(noEl);
      if (p.alive && p.distanceFromMe != null && p.distanceFromMe > 0) {
        const val = document.createElement('span');
        val.className = 'sgs-seat-dist-val';
        val.textContent = `距${p.distanceFromMe}`;
        dist.appendChild(val);
      }
      anchor.appendChild(dist);

      box.appendChild(anchor);
    });

    if (selfBar) {
      selfBar.dataset.playerId = meId || '';
      const myActingHint = meId ? getActingHint(game, meId) : null;
      selfBar.classList.toggle(
        'is-turn',
        Boolean(game.me && game.me.isMyTurn && me && me.alive)
      );
      selfBar.classList.toggle('is-acting', Boolean(myActingHint));
      scrubPanelChainOverlays(selfBar);

      let nickEl = selfBar.querySelector('.sgs-self-nick');
      if (me) {
        if (!nickEl) {
          nickEl = document.createElement('div');
          nickEl.className = 'sgs-self-nick';
          selfBar.insertBefore(nickEl, selfBar.firstChild);
        }
        const seatNo =
          me.seatNo != null ? me.seatNo : Number(me.seat) + 1;
        const Nick = window.PlayerNick;
        const nameHtml =
          Nick && Nick.formatHtml
            ? Nick.formatHtml(me.name || '玩家', me.tag)
            : escapeHtml(me.name || '玩家');
        nickEl.innerHTML =
          `<span class="sgs-seat-nick">${nameHtml}</span>` +
          `<span class="sgs-seat-no">${seatNo}号</span>`;
        nickEl.title =
          Nick && Nick.fullLabel
            ? Nick.fullLabel(me.name, me.tag)
            : me.name || '玩家';
        nickEl.hidden = false;
      } else if (nickEl) {
        nickEl.hidden = true;
        nickEl.textContent = '';
      }

      let tip = selfBar.querySelector('.sgs-self-acting-tip');
      if (myActingHint) {
        if (!tip) {
          tip = document.createElement('div');
          tip.className = 'sgs-self-acting-tip';
          const after = selfBar.querySelector('.sgs-self-nick');
          if (after && after.nextSibling) {
            selfBar.insertBefore(tip, after.nextSibling);
          } else {
            selfBar.insertBefore(tip, selfBar.firstChild);
          }
        }
        tip.textContent = myActingHint;
        tip.hidden = false;
      } else if (tip) {
        tip.hidden = true;
        tip.textContent = '';
      }

      let selfJudgeEl = selfBar.querySelector('.sgs-self-judge-float');
      if (me && me.judges && me.judges.length) {
        if (!selfJudgeEl) {
          selfJudgeEl = document.createElement('div');
          selfJudgeEl.className = 'sgs-self-judge-float';
          selfBar.appendChild(selfJudgeEl);
        }
        selfJudgeEl.innerHTML =
          `<div class="sgs-self-judge-title">判定区</div>` + judgeMarksHtml(me.judges);
        selfJudgeEl.hidden = false;
      } else if (selfJudgeEl) {
        selfJudgeEl.hidden = true;
        selfJudgeEl.innerHTML = '';
      }
    }

    if (selfInfo && me) {
      const awaitFly =
        state.generalPickFly &&
        state.generalPickFly.generalId === me.generalId &&
        !state.generalPickFly.done;
      const myCard = heroCardWithChainHtml(
        A().heroCardSlotHtml
          ? A().heroCardSlotHtml({
              size: 'self',
              title: me.generalName || '角色卡',
              portrait: me.portrait || me.generalId,
            })
          : '<div class="sgs-hero-card sgs-hero-card--self is-empty"></div>',
        me.chained
      );
      selfInfo.innerHTML = myCard.replace(
        /sgs-hero-card sgs-hero-card--self/,
        'sgs-hero-card sgs-hero-card--self' +
          (awaitFly ? ' is-await-fly' : '')
      );
      scrubPanelChainOverlays(selfInfo);
      const selfCard =
        selfInfo.querySelector('.sgs-hero-card--self') ||
        selfInfo.querySelector('.sgs-hero-card');
      if (selfCard) {
        bindPlayerGeneralHoverTip(selfCard, me);
        const oldTian = selfInfo.querySelector('.sgs-tian-stack');
        if (oldTian) oldTian.remove();
        if (me.skillPiles && me.skillPiles.tian && me.skillPiles.tian.length) {
          appendTianStack(selfInfo, me.skillPiles.tian);
        }
        const pend = game.pending;
        const selfGuide = getCardPlayGuide(game, findSelectedCard(game));
        const canPickSelf = canPickSelfSeatTarget(game, pend, me, selfGuide);
        selfInfo.classList.toggle('is-seat-target-ok', Boolean(canPickSelf));
        selfInfo.classList.toggle(
          'is-seat-targeted',
          Boolean((state.selectedTargets || []).includes(me.id))
        );
        selfCard.onclick = () => {
          const g = state.game || game;
          toggleSelfSeatTarget(
            g,
            g.pending,
            getCardPlayGuide(g, findSelectedCard(g))
          );
        };
      }
    }

    const selfMeta = $('sgs-self-meta');
    if (selfMeta && me) {
      const myActingHint = meId ? getActingHint(game, meId) : null;
      selfMeta.innerHTML =
        `<span class="sgs-self-text">` +
        (me.generalName ? `${escapeHtml(me.generalName)} · ` : '') +
        `${escapeHtml(seatIdentityLabel(game, me))}` +
        ` · ${hpHeartsHtml(me.hp, me.maxHp)}` +
        (me.turnedOver ? ' · <em>翻面</em>' : '') +
        (me.chained ? ' · <em>横置</em>' : '') +
        skillPilesHtml(me.skillPiles) +
        (myActingHint
          ? ` · <em class="sgs-acting-em">${escapeHtml(myActingHint)}</em>`
          : game.me && game.me.isMyTurn
            ? ' · <em>你的回合</em>'
            : '') +
        `</span>`;
      if (me.identity && A().identityUrl(me.identity)) {
        const idImg = document.createElement('img');
        idImg.className =
          'sgs-identity-card' +
          (state.identityRevealPlaying ? ' is-await-fly' : '');
        idImg.src = A().identityUrl(me.identity);
        idImg.alt = me.identityLabel || '';
        idImg.style.display = 'inline-block';
        idImg.style.verticalAlign = 'middle';
        selfMeta.appendChild(idImg);
      }
    } else if (selfMeta && !me) {
      selfMeta.innerHTML = '';
    }
    if (selfEquips && me) {
      selfEquips.innerHTML = '';
      const e = me.equips || {};
      let any = false;
      for (const slot of ['weapon', 'armor', 'horseMinus', 'horsePlus', 'treasure']) {
        if (!e[slot]) continue;
        any = true;
        const eqEl = A().createCardEl(e[slot], { size: 'sm' });
        eqEl.dataset.cardId = e[slot].id;
        eqEl.addEventListener('click', () => {
          const g = state.game;
          const n = state.net;
          if (!g || !n) return;
          toggleHandPickCard(e[slot].id, g, n);
        });
        selfEquips.appendChild(eqEl);
      }
      if (!any) {
        selfEquips.innerHTML = '<span class="muted">无装备</span>';
      }
    }
  }

  function renderPiles(game) {
    const drawN = $('sgs-draw');
    const discN = $('sgs-discard');
    if (drawN) drawN.textContent = String(game.drawCount || 0);
    if (discN) discN.textContent = String(game.discardCount || 0);

    const drawVis = $('sgs-draw-visual');
    const discVis = $('sgs-discard-visual');
    const assets = A();
    if (drawVis) {
      drawVis.innerHTML = '';
      if (game.drawCount > 0 && assets && assets.createBackStack) {
        drawVis.appendChild(assets.createBackStack(game.drawCount, 'md'));
      } else if (game.drawCount > 0) {
        drawVis.innerHTML = `<span class="muted">${game.drawCount}</span>`;
      } else {
        drawVis.innerHTML = '<span class="muted">空</span>';
      }
    }
    if (discVis) {
      discVis.innerHTML = '';
      if (game.discardTop && assets && assets.createCardEl) {
        discVis.appendChild(assets.createCardEl(game.discardTop, { size: 'md' }));
      } else if (game.discardCount > 0 && assets && assets.createCardEl) {
        discVis.appendChild(
          assets.createCardEl(null, { faceDown: true, size: 'md' })
        );
      } else if (game.discardCount > 0) {
        discVis.innerHTML = `<span class="muted">${game.discardCount}</span>`;
      } else {
        discVis.innerHTML = '<span class="muted">空</span>';
      }
    }
  }

  function renderMateHand(game) {
    let wrap = $('sgs-mate-hand-wrap');
    if (!wrap) {
      const handWrap = $('sgs-hand-wrap');
      if (!handWrap) return;
      wrap = document.createElement('div');
      wrap.id = 'sgs-mate-hand-wrap';
      wrap.innerHTML =
        '<h3 class="game-sub">队友手牌</h3><div id="sgs-mate-hand" class="sgs-hand"></div>';
      handWrap.parentNode.insertBefore(wrap, handWrap);
    }
    const box = $('sgs-mate-hand');
    const mate = (game.players || []).find((p) => p.isTeammate && p.alive);
    if (game.mode !== 'h2h' || !mate || !mate.hand) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    box.innerHTML = '';
    for (const c of mate.hand) {
      box.appendChild(A().createCardEl(c, { size: 'sm' }));
    }
    if (!mate.hand.length) {
      box.innerHTML = '<span class="muted">（空）</span>';
    }
  }

  function toggleTarget(id) {
    const i = state.selectedTargets.indexOf(id);
    if (i >= 0) state.selectedTargets.splice(i, 1);
    else state.selectedTargets = [id];
  }

  /** 手牌重叠排布：默认层层压住；仅鼠标下的那张上浮 */
  function layoutSelfHand(hand, focusRatio) {
    if (!hand) return;
    const cards = Array.from(hand.children).filter((el) =>
      el.classList.contains('sgs-kapai')
    );
    const n = cards.length;
    if (!n) {
      hand.style.height = '';
      return;
    }
    const cardW = cards[0].offsetWidth || 108;
    const cardH = cards[0].offsetHeight || 150;
    hand.style.height = `${cardH + 48}px`;
    const avail = Math.max(cardW, hand.clientWidth || 0);
    // 牌越多默认步长越小，层层重叠
    const comfortStep =
      n <= 4
        ? cardW + 6
        : n <= 7
          ? cardW * 0.55
          : n <= 10
            ? cardW * 0.4
            : cardW * 0.3;
    const span = Math.max(0, avail - cardW);
    const xs = new Array(n).fill(0);

    if (n === 1) {
      xs[0] = Math.max(0, (avail - cardW) / 2);
    } else if (comfortStep * (n - 1) <= span) {
      const total = cardW + comfortStep * (n - 1);
      const start = Math.max(0, (avail - total) / 2);
      for (let i = 0; i < n; i++) xs[i] = start + i * comfortStep;
    } else {
      // 挤不下时均匀重叠，聚焦时不再拉开间距（避免邻牌“双上浮”盖住中间）
      for (let i = 0; i < n; i++) {
        xs[i] = n === 1 ? 0 : (span * i) / (n - 1);
      }
    }

    // 先写好 left，再按实际牌面命中聚焦（从右往左：上层优先）
    cards.forEach((el, i) => {
      el.style.left = `${xs[i]}px`;
    });

    let focusIdx = -1;
    if (focusRatio != null && !Number.isNaN(focusRatio) && n > 0) {
      const handRect = hand.getBoundingClientRect();
      const mouseX =
        handRect.left +
        Math.max(0, Math.min(1, focusRatio)) * handRect.width;
      for (let i = n - 1; i >= 0; i--) {
        const left = handRect.left + xs[i];
        if (mouseX >= left && mouseX <= left + cardW) {
          focusIdx = i;
          break;
        }
      }
      // 落在空隙时，取最近牌心
      if (focusIdx < 0) {
        let best = 0;
        let bestDist = Infinity;
        for (let i = 0; i < n; i++) {
          const cx = handRect.left + xs[i] + cardW / 2;
          const d = Math.abs(mouseX - cx);
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        }
        focusIdx = best;
      }
    }

    cards.forEach((el, i) => {
      // 默认：右边压左边；选中略抬层级便于上浮露出；聚焦牌最顶
      let z = 100 + i;
      if (focusIdx === i) z = 1000;
      else if (el.classList.contains('selected')) z = 280 + i;
      el.style.zIndex = String(z);
      el.classList.toggle('is-focus', focusIdx === i);
    });
  }

  function bindHandStackInteractions(hand) {
    if (!hand || hand.dataset.stackBound === '1') return;
    hand.dataset.stackBound = '1';
    const syncFocusFromEvent = (ev) => {
      const rect = hand.getBoundingClientRect();
      if (rect.width <= 1) return;
      state.handFocusRatio = Math.max(
        0,
        Math.min(1, (ev.clientX - rect.left) / rect.width)
      );
      layoutSelfHand(hand, state.handFocusRatio);
    };
    hand.addEventListener('mousemove', syncFocusFromEvent);
    // 点击前先按命中抬高对应牌，避免重叠时点到上层遮挡牌
    hand.addEventListener('pointerdown', syncFocusFromEvent, true);
    hand.addEventListener('mouseleave', () => {
      state.handFocusRatio = null;
      layoutSelfHand(hand, null);
    });
    if (!state._handResizeBound) {
      state._handResizeBound = true;
      window.addEventListener('resize', () => {
        const el = $('sgs-hand');
        if (el) layoutSelfHand(el, state.handFocusRatio);
      });
    }
  }

  /** 手牌列表签名：牌未变时避免整手重建（防图片闪烁） */
  function handListKey(mePlayer, multi, game) {
    const ids = (mePlayer && mePlayer.hand ? mePlayer.hand : [])
      .map((c) => c.id)
      .join(',');
    const muniuIds = (game && game.me && game.me.muniuCards
      ? game.me.muniuCards
      : []
    )
      .map((c) => c.id)
      .join(',');
    const viewAs = state.pendingViewAs
      ? (state.pendingViewAs.usableCardIds || []).join(',')
      : '';
    const armedSkill = state.pendingSkill ? state.pendingSkill.skillId : '';
    const pend = state.game && state.game.pending;
    const mode = getOwnHandPickMode(pend);
    return `${ids}|m${muniuIds}|n${multi ? 1 : 0}|v${viewAs}|s${armedSkill}|p${mode ? mode.id : ''}`;
  }

  function suitMark(suit) {
    return (
      {
        spade: '♠',
        heart: '♥',
        club: '♣',
        diamond: '♦',
      }[suit] || ''
    );
  }

  /**
   * 需要从「自己手牌区」选牌再点上方确认的交互。
   * 不包含过河拆桥等选别人区域的弹窗。
   */
  function ownHandPickIgnoresCardOptions(pend) {
    if (!pend) return false;
    if (
      pend.type === 'guanshi' ||
      pend.type === 'feiyang' ||
      pend.type === 'huogong_show'
    ) {
      return true;
    }
    if (pend.type === 'skill_effect') {
      return (
        pend.skillId === 'zhiyu' ||
        pend.skillId === 'yiji' ||
        // 恩怨（enyuan）：server 侧会把可交给的红桃牌作为 cardOptions 下发，
        // 但交互仍希望走「下方手牌区点选」模式（上方仅确认/取消）。
        pend.skillId === 'enyuan'
      );
    }
    return false;
  }

  function buildOwnHandPickMode(pend) {
    if (!pend || !pend.forMe) return null;

    if (pend.type === 'wuxie') {
      if (pend.wuxiePhase === 'reveal' || pend.wuxieSubmitted) return null;
    }

    if (
      pend.type === 'respond_shan' ||
      pend.type === 'aoe_shan' ||
      pend.type === 'aoe_sha' ||
      pend.type === 'juedou' ||
      pend.type === 'jiedao' ||
      pend.type === 'dying' ||
      pend.type === 'wuxie'
    ) {
      const names = handRespondNeedNames(pend);
      return {
        id: pend.type,
        min: 1,
        max: 1,
        names,
        confirmLabel: '确认出牌',
        passLabel:
          pend.type === 'dying'
            ? '不出桃/酒'
            : pend.type === 'wuxie'
              ? '不出无懈'
              : '放弃',
        canPass: true,
        action: 'respond',
        allowViewAs: true,
      };
    }

    if (pend.type === 'discard') {
      const n = Math.max(1, Number(pend.count) || 1);
      return {
        id: 'discard',
        min: n,
        max: n,
        confirmLabel: `确认弃 ${n} 张`,
        passLabel: null,
        canPass: false,
        action: 'discard',
      };
    }

    if (pend.type === 'guanshi') {
      return {
        id: 'guanshi',
        min: 2,
        max: 2,
        includeEquips: true,
        confirmLabel: '弃 2 张强制命中',
        passLabel: '放弃强命',
        canPass: true,
        action: 'respond',
      };
    }

    if (pend.type === 'feiyang' && pend.step === 'discard') {
      return {
        id: 'feiyang',
        min: 2,
        max: 2,
        includeEquips: true,
        confirmLabel: '弃 2 张进入下一步',
        passLabel: '不发动',
        canPass: true,
        action: 'respond',
      };
    }

    if (pend.type === 'huogong_show') {
      return {
        id: 'huogong_show',
        min: 1,
        max: 1,
        confirmLabel: '确认展示',
        canPass: false,
        action: 'respond',
      };
    }

    if (pend.type === 'huogong') {
      return {
        id: 'huogong',
        min: 1,
        max: 1,
        suit: pend.suit || null,
        confirmLabel: '确认弃牌',
        passLabel: '取消火攻',
        canPass: true,
        action: 'respond',
      };
    }

    if (pend.type !== 'skill_effect') return null;
    if (pend.skillId === 'tiaoxin' && pend.step === 'discard') return null;

    if (pend.skillId === 'zhiyu') {
      return {
        id: 'zhiyu',
        min: 1,
        max: 1,
        confirmLabel: '确认弃置',
        canPass: false,
        action: 'respond',
      };
    }

    if (pend.skillId === 'hujia' || pend.skillId === 'jijiang') {
      const names =
        pend.purpose === 'shan' || pend.skillId === 'hujia'
          ? ['闪']
          : ['杀', '火杀', '雷杀'];
      return {
        id: pend.skillId,
        min: 1,
        max: 1,
        names,
        confirmLabel: '确认打出',
        passLabel: '不响应',
        canPass: true,
        action: 'respond',
        allowViewAs: true,
      };
    }

    const skillMap = {
      guicai: { passLabel: '取消' },
      beige: { passLabel: '取消' },
      lieren: { passLabel: '取消' },
      tiaoxin: {
        names: ['杀', '火杀', '雷杀'],
        passLabel: '取消',
        allowViewAs: true,
      },
      tieji: { suit: pend.suit || null, passLabel: '取消' },
      xiangle: { basicOnly: true, passLabel: '取消' },
      enyuan: { suit: 'heart', passLabel: '取消' },
    };
    const extra = skillMap[pend.skillId];
    if (!extra) return null;
    return {
      id: pend.skillId,
      min: 1,
      max: 1,
      confirmLabel: '确认',
      canPass: true,
      action: 'respond',
      ...extra,
    };
  }

  function getOwnHandPickMode(pend) {
    const mode = buildOwnHandPickMode(pend);
    if (!mode) return null;
    if (
      pend.cardOptions &&
      pend.cardOptions.length &&
      !ownHandPickIgnoresCardOptions(pend)
    ) {
      return null;
    }
    return mode;
  }

  function isHandCardRespondPending(pend) {
    return Boolean(getOwnHandPickMode(pend));
  }

  function handRespondNeedNames(pend) {
    if (!pend) return null;
    if (pend.type === 'respond_shan' || pend.type === 'aoe_shan') return ['闪'];
    if (
      pend.type === 'aoe_sha' ||
      pend.type === 'juedou' ||
      pend.type === 'jiedao'
    ) {
      return ['杀', '火杀', '雷杀'];
    }
    if (pend.type === 'dying') return ['桃', '酒'];
    if (pend.type === 'wuxie') return ['无懈可击'];
    return null;
  }

  function cardMatchesPickMode(card, mode) {
    if (!card || !mode) return false;
    if (mode.names && mode.names.length && !mode.names.includes(card.name)) {
      return false;
    }
    if (mode.suit) {
      if (card.suit !== mode.suit && card.suitLabel !== suitMark(mode.suit)) {
        return false;
      }
    }
    if (mode.basicOnly && card.type !== 'basic') return false;
    return true;
  }

  function listPickableOwnCardIds(game, mode) {
    if (!mode || !game || !game.me) return [];
    const me = (game.players || []).find((p) => p.id === game.me.id);
    if (!me) return [];
    const allowed =
      mode.allowedIds && mode.allowedIds.length
        ? new Set(mode.allowedIds)
        : null;
    const out = [];
    for (const c of me.hand || []) {
      if (allowed && !allowed.has(c.id)) continue;
      if (
        cardMatchesPickMode(c, mode) ||
        (!mode.names && !mode.suit && !mode.basicOnly)
      ) {
        out.push(c.id);
      }
    }
    for (const c of myMuniuCards(game)) {
      if (allowed && !allowed.has(c.id)) continue;
      if (
        cardMatchesPickMode(c, mode) ||
        (!mode.names && !mode.suit && !mode.basicOnly)
      ) {
        out.push(c.id);
      }
    }
    if (mode.includeEquips && me.equips) {
      for (const slot of Object.keys(me.equips)) {
        const eq = me.equips[slot];
        if (!eq) continue;
        if (allowed && !allowed.has(eq.id)) continue;
        out.push(eq.id);
      }
    }
    return out;
  }

  function toggleHandPickCard(cardId, game, net) {
    const pend = game && game.pending;
    const pickMode = getOwnHandPickMode(pend);
    if (!pickMode) return false;
    const ids = listPickableOwnCardIds(game, pickMode);
    if (!ids.includes(cardId)) return false;
    if (pickMode.max > 1) {
      if (!state.skillCardPick) state.skillCardPick = [];
      const idx = state.skillCardPick.indexOf(cardId);
      if (idx >= 0) state.skillCardPick.splice(idx, 1);
      else if (state.skillCardPick.length < pickMode.max) {
        state.skillCardPick.push(cardId);
      }
      state.selectedCardId =
        state.skillCardPick[state.skillCardPick.length - 1] || null;
    } else {
      state.selectedCardId =
        state.selectedCardId === cardId ? null : cardId;
      state.skillCardPick = [];
    }
    state.allowMultiSelect = pickMode.max > 1;
    refreshLocalSelection(game, net);
    return true;
  }

  function listHandRespondOptions(game, pend) {
    const mode = getOwnHandPickMode(pend);
    if (!mode || !game || !game.me) return [];
    const me = (game.players || []).find((p) => p.id === game.me.id);
    const hand = (me && me.hand) || [];
    const needNames = mode.names || null;
    const viewAsForPend =
      mode.allowViewAs && needNames
        ? (game.me.viewAsOptions || []).filter((v) => {
            if (needNames.includes('闪')) return v.to === 'shan';
            if (needNames.some((n) => n === '杀' || n === '火杀' || n === '雷杀'))
              return v.to === 'sha';
            if (needNames.includes('桃')) return v.to === 'tao';
            if (needNames.includes('无懈可击')) return v.to === 'wuxie';
            return false;
          })
        : [];
    const pickIds = new Set(listPickableOwnCardIds(game, mode));
    const out = [];
    for (const c of hand) {
      if (!pickIds.has(c.id)) continue;
      const va = viewAsForPend.find((v) => v.cardId === c.id) || null;
      if (cardMatchesPickMode(c, mode) || va) {
        out.push({ cardId: c.id, viewAs: va });
      }
    }
    for (const c of myMuniuCards(game)) {
      if (!pickIds.has(c.id)) continue;
      const va = viewAsForPend.find((v) => v.cardId === c.id) || null;
      if (cardMatchesPickMode(c, mode) || va) {
        out.push({ cardId: c.id, viewAs: va });
      }
    }
    if (mode.includeEquips && me && me.equips) {
      for (const slot of Object.keys(me.equips)) {
        const eq = me.equips[slot];
        if (!eq || !pickIds.has(eq.id)) continue;
        out.push({ cardId: eq.id, from: 'equip:' + slot });
      }
    }
    return out;
  }

  function ensureHandRespondSelection(game) {
    const pend = game && game.pending;
    const mode = getOwnHandPickMode(pend);
    if (!mode) {
      if (!state.pendingSkill) state.allowMultiSelect = false;
      return null;
    }
    const opts = listHandRespondOptions(game, pend);
    const ids = opts.map((o) => o.cardId);
    const multi = mode.max > 1;
    state.allowMultiSelect = multi;
    if (!ids.length) {
      state.selectedCardId = null;
      state.skillCardPick = [];
      return { mode, opts, ids };
    }
    if (multi) {
      if (!Array.isArray(state.skillCardPick)) state.skillCardPick = [];
      state.skillCardPick = state.skillCardPick.filter((id) => ids.includes(id));
      if (state.skillCardPick.length > mode.max) {
        state.skillCardPick = state.skillCardPick.slice(0, mode.max);
      }
      state.selectedCardId =
        state.skillCardPick[state.skillCardPick.length - 1] || null;
    } else if (state.selectedCardId && !ids.includes(state.selectedCardId)) {
      state.selectedCardId = null;
    }
    return { mode, opts, ids };
  }

  function listSeatSkillHandIds(game) {
    const pend = game && game.pending;
    if (!pend || !pend.forMe || pend.type !== 'skill_effect') return null;
    if (
      pend.skillId !== 'liuli' &&
      pend.skillId !== 'tianxiang' &&
      pend.skillId !== 'jujian' &&
      pend.skillId !== 'haoshi' &&
      pend.skillId !== 'yiji'
    ) {
      return null;
    }
    const me = (game.players || []).find((p) => game.me && p.id === game.me.id);
    const hand = (me && me.hand) || [];
    if (pend.skillId === 'tianxiang') {
      return hand
        .filter((c) => c.suit === 'heart' || c.suitLabel === '♥')
        .map((c) => c.id);
    }
    if (pend.skillId === 'yiji') {
      const allow = new Set(pend.cardIds || []);
      return hand.filter((c) => allow.has(c.id)).map((c) => c.id);
    }
    return hand.map((c) => c.id);
  }

  function syncSelfEquipPickAppearance(game) {
    const wrap = $('sgs-self-equips');
    if (!wrap) return;
    const pend = game && game.pending;
    const mode = getOwnHandPickMode(pend);
    if (!mode || !mode.includeEquips) {
      wrap.querySelectorAll('.sgs-kapai[data-card-id]').forEach((btn) => {
        btn.classList.remove('selected', 'is-respond-ok', 'is-respond-dim');
        btn.style.outline = '';
      });
      return;
    }
    const ids = new Set(listPickableOwnCardIds(game, mode));
    const multi = mode.max > 1;
    wrap.querySelectorAll('.sgs-kapai[data-card-id]').forEach((btn) => {
      const id = btn.dataset.cardId;
      const ok = ids.has(id);
      const selected = multi
        ? (state.skillCardPick || []).includes(id)
        : state.selectedCardId === id;
      btn.classList.toggle('selected', selected);
      btn.classList.toggle('is-respond-ok', ok);
      btn.classList.toggle('is-respond-dim', !ok);
      btn.style.outline =
        ok && !selected ? '2px solid rgba(94, 207, 152, 0.7)' : '';
    });
  }

  function syncHandSelectionAppearance(game) {
    const hand = $('sgs-hand');
    if (hand) syncPlayableStackSelection(game, hand);
    const muniuStack = document.querySelector(
      '#sgs-hand-muniu .sgs-hand-muniu-stack'
    );
    if (muniuStack) syncPlayableStackSelection(game, muniuStack);
    syncSelfEquipPickAppearance(game);
  }

  function syncOpponentSeatTargetClasses(game) {
    const box = $('sgs-opponents');
    if (!box) return;
    const selectedCard = findSelectedCard(game);
    const guide = getCardPlayGuide(game, selectedCard);
    pruneInvalidTargets(game, guide);
    const pend = game.pending;
    const seatTargeting = isPendingSeatTargeting(pend);
    box.querySelectorAll('.sgs-seat[data-player-id]').forEach((div) => {
      const pid = div.dataset.playerId;
      const p = (game.players || []).find((x) => x.id === pid);
      if (!p) return;
      div.classList.remove('target-ok', 'target-dim', 'targeted');
      if ((state.selectedTargets || []).includes(p.id)) {
        div.classList.add('targeted');
      }
      if (!p.alive) return;
      if (seatTargeting) {
        div.classList.add(
          isPendingSeatTargetValid(game, pend, p) ? 'target-ok' : 'target-dim'
        );
        return;
      }
      if (isActiveSkillSeatTargeting()) {
        div.classList.add(
          isActiveSkillSeatTargetValid(game, state.pendingSkill.skillId, p)
            ? 'target-ok'
            : 'target-dim'
        );
        return;
      }
      if (
        guide &&
        typeof guide.isTargetValid === 'function' &&
        (guide.dimUnreachable ||
          guide.needTargets > 0 ||
          guide.maxTargets > 0)
      ) {
        div.classList.add(
          guide.isTargetValid(p) ? 'target-ok' : 'target-dim'
        );
      }
    });
  }

  function syncSelfSeatTargetClasses(game) {
    const selfInfo = $('sgs-self-info');
    if (!selfInfo || !game || !game.me) return;
    const me = (game.players || []).find((p) => p.id === game.me.id);
    if (!me) return;
    const pend = game.pending;
    const guide = getCardPlayGuide(game, findSelectedCard(game));
    const canPickSelf = canPickSelfSeatTarget(game, pend, me, guide);
    selfInfo.classList.toggle('is-seat-target-ok', Boolean(canPickSelf));
    selfInfo.classList.toggle(
      'is-seat-targeted',
      Boolean((state.selectedTargets || []).includes(me.id))
    );
  }

  /** 仅本地选牌/选目标变化：不整页重建，避免手牌与桌面闪烁 */
  function refreshLocalSelection(game, net) {
    syncHandSelectionAppearance(game);
    syncSelfEquipPickAppearance(game);
    updateHandPlayChrome(game, net, { rebuildSkills: false });
    syncOpponentSeatTargetClasses(game);
    syncSelfSeatTargetClasses(game);
    const hand = $('sgs-hand');
    if (hand) layoutSelfHand(hand, state.handFocusRatio);
    const muniuStack = document.querySelector(
      '#sgs-hand-muniu .sgs-hand-muniu-stack'
    );
    if (muniuStack) layoutSelfHand(muniuStack, state.handFocusRatio);

    const pend = game && game.pending;
    if (pend && pend.forMe && isSeatTargetSkillEffect(pend)) {
      showSeatTargetAskBar(game, pend, net);
    }
  }

  function updateHandPlayChrome(game, net, opts) {
    opts = opts || {};
    const hint = $('sgs-hand-hint');
    const btnPlay = $('btn-sgs-play');
    const btnRecast = $('btn-sgs-recast');
    const btnEnd = $('btn-sgs-end-play');
    const pend = game.pending;
    const handRespond =
      isHandCardRespondPending(pend) && Boolean(game.me && pend.forMe);

    if (handRespond) {
      const info = ensureHandRespondSelection(game);
      const mode = (info && info.mode) || getOwnHandPickMode(pend);
      const ids = (info && info.ids) || [];
      const multi = Boolean(mode && mode.max > 1);
      const picked = multi
        ? (state.skillCardPick || []).filter((id) => ids.includes(id))
        : state.selectedCardId && ids.includes(state.selectedCardId)
          ? [state.selectedCardId]
          : [];
      const canConfirm = Boolean(
        mode &&
          picked.length >= (mode.min || 1) &&
          picked.length <= (mode.max || 1)
      );
      if (hint) {
        hint.textContent = pend.message || '请在手牌区选择';
      }
      const hintEl = $('sgs-target-hint');
      if (hintEl) {
        hintEl.textContent =
          (pend.message || '请在下方手牌区选择') +
          (multi ? `（已选 ${picked.length}/${mode.max}）` : '') +
          (mode.includeEquips ? '；装备牌可点左侧装备区' : '');
        hintEl.classList.add('is-warn');
      }
      if (btnPlay) {
        btnPlay.hidden = false;
        btnPlay.textContent = (mode && mode.confirmLabel) || '确认';
        btnPlay.disabled = !canConfirm;
        btnPlay.classList.toggle('is-disabled', !canConfirm);
        btnPlay.title = canConfirm
          ? '确认打出/弃置选中的手牌'
          : ids.length
            ? '请在下方手牌区点选'
            : '没有可出的牌' + (mode && mode.canPass ? '，请点放弃' : '');
      }
      if (btnRecast) {
        btnRecast.hidden = true;
        btnRecast.disabled = true;
      }
      if (btnEnd) {
        const canPass = Boolean(mode && mode.canPass);
        btnEnd.hidden = !canPass;
        btnEnd.textContent = (mode && mode.passLabel) || '放弃';
        btnEnd.title = '放弃本次响应';
        btnEnd.disabled = !canPass;
        btnEnd.classList.toggle('is-disabled', !canPass);
      }
      syncHandSelectionAppearance(game);
      if (opts.rebuildSkills !== false) {
        renderActiveSkills(game, net, false);
      }
      return;
    }

    if (isActiveSkillSeatTargeting()) {
      const sk = state.pendingSkill;
      const n = (state.selectedTargets || []).length;
      const isXuanhuo = sk && sk.skillId === 'xuanhuo';
      const hasCard = hasValidXuanhuoSelection(game);
      const hintEl = $('sgs-target-hint');
      if (hintEl) {
        hintEl.textContent = isXuanhuo
          ? `【${sk.skillName || sk.skillId}】：请先选择一张红桃手牌，再选择一名其他角色（已选目标 ${n}/1，再点技能取消）`
          : `【${sk.skillName || sk.skillId}】：请选择攻击范围内含有你的一名角色（已选 ${n}/1，再点技能取消）`;
        hintEl.classList.add('is-warn');
      }
      if (btnPlay) {
        btnPlay.hidden = false;
        btnPlay.textContent = '确认发动';
        const disabled = isXuanhuo ? !hasCard || n < 1 : n < 1;
        btnPlay.disabled = disabled;
        btnPlay.classList.toggle('is-disabled', disabled);
        btnPlay.title = isXuanhuo
          ? !hasCard
            ? '请先选择一张红桃手牌'
            : n < 1
              ? '请再选择一名其他角色'
              : '确认发动技能'
          : n < 1
            ? '请先点击一名可选角色'
            : '确认发动技能';
      }
      if (btnRecast) {
        btnRecast.hidden = true;
        btnRecast.disabled = true;
      }
      if (btnEnd) {
        btnEnd.hidden = false;
        btnEnd.textContent = '取消';
        btnEnd.title = '取消发动技能';
        btnEnd.disabled = false;
        btnEnd.classList.remove('is-disabled');
      }
      // 预启动技能时同步置灰非法手牌/目标
      syncHandSelectionAppearance(game);
      syncOpponentSeatTargetClasses(game);
      if (opts.rebuildSkills !== false) {
        renderActiveSkills(game, net, true);
      }
      return;
    }

    if (isMuniuSkillPending()) {
      const sk = state.pendingSkill;
      const meHand =
        ((game.players || []).find((p) => game.me && p.id === game.me.id) || {})
          .hand || [];
      const hasCard = Boolean(
        state.selectedCardId &&
          meHand.some((c) => c.id === state.selectedCardId)
      );
      const hintEl = $('sgs-target-hint');
      if (hintEl) {
        hintEl.textContent =
          `【${sk.skillName || '木牛流马'}】：请选择一张手牌置于木牛流马上（再点技能取消）`;
        hintEl.classList.add('is-warn');
      }
      if (btnPlay) {
        btnPlay.hidden = false;
        btnPlay.textContent = '确认发动';
        btnPlay.disabled = !hasCard;
        btnPlay.classList.toggle('is-disabled', !hasCard);
        btnPlay.title = hasCard ? '确认发动' : '请先选择一张手牌';
      }
      if (btnRecast) {
        btnRecast.hidden = true;
        btnRecast.disabled = true;
      }
      if (btnEnd) {
        btnEnd.hidden = false;
        btnEnd.textContent = '取消';
        btnEnd.title = '取消发动技能';
        btnEnd.disabled = false;
        btnEnd.classList.remove('is-disabled');
      }
      if (opts.rebuildSkills !== false) {
        renderActiveSkills(game, net, true);
      }
      return;
    }

    if (btnPlay) btnPlay.textContent = '确认出牌';
    if (btnEnd) btnEnd.textContent = '结束出牌';

    const canPlayPhase =
      game.me &&
      game.me.isMyTurn &&
      game.turnPhase === 'play' &&
      !game.pending;
    const canEndPlay = Boolean(
      game.me &&
      (game.me.canEndPlay != null
        ? game.me.canEndPlay
        : canPlayPhase)
    );

    if (hint) {
      hint.textContent =
        game.me && game.me.isMyTurn
          ? state.allowMultiSelect
            ? `（多选中 · 攻击范围 ${game.me.attackRange}）`
            : `（攻击范围 ${game.me.attackRange}）`
          : '';
    }
    if (btnPlay) btnPlay.hidden = !canPlayPhase;
    if (btnEnd) {
      btnEnd.hidden = !canEndPlay;
      btnEnd.disabled = !canEndPlay;
      btnEnd.classList.toggle('is-disabled', !canEndPlay);
      if (canEndPlay) {
        btnEnd.title = '结束出牌阶段';
      }
    }

    const selectedCard = findSelectedCard(game);
    const guide = getCardPlayGuide(game, selectedCard);
    const hintEl = $('sgs-target-hint');
    if (hintEl) {
      if (!canPlayPhase) {
        hintEl.textContent = '';
        hintEl.classList.remove('is-warn');
      } else if (selectedCard) {
        hintEl.textContent = guide.hint || '';
        hintEl.classList.toggle('is-warn', Boolean(guide.blockReason));
      } else {
        hintEl.textContent = '先点选手牌，再按提示选择目标或出牌';
        hintEl.classList.remove('is-warn');
      }
    }

    const canConfirm = Boolean(
      canPlayPhase && selectedCard && guide.canConfirm
    );
    if (btnPlay) {
      btnPlay.disabled = !canConfirm;
      btnPlay.classList.toggle('is-disabled', !canConfirm);
      if (guide.blockReason) {
        btnPlay.title = guide.blockReason;
      } else if (!selectedCard) {
        btnPlay.title = '请先选择手牌';
      } else if (!guide.canConfirm) {
        btnPlay.title = guide.hint || '请按提示完成选择';
      } else if (
        selectedCard.name === '铁索连环' &&
        !(state.selectedTargets || []).length
      ) {
        btnPlay.title = '请先选择目标，或使用「重置」';
        btnPlay.disabled = true;
        btnPlay.classList.add('is-disabled');
      } else {
        btnPlay.title = '确认出牌';
      }
    }
    if (btnRecast) {
      const showRecast = Boolean(
        canPlayPhase && selectedCard && guide.canRecast
      );
      btnRecast.hidden = !showRecast;
      btnRecast.disabled = !showRecast;
      btnRecast.title =
        '弃置【铁索连环】，从牌堆摸 1 张（不触发使用效果与语音）';
    }

    if (opts.rebuildSkills !== false) {
      renderActiveSkills(game, net, canPlayPhase);
    }
  }

  function ensureMuniuHandEl() {
    let root = $('sgs-hand-muniu');
    if (root) return root;
    const wrap = $('sgs-hand-wrap');
    const hand = $('sgs-hand');
    if (!wrap || !hand) return null;
    root = document.createElement('div');
    root.id = 'sgs-hand-muniu';
    root.className = 'sgs-hand-muniu';
    root.hidden = true;
    root.innerHTML =
      '<div class="sgs-hand-muniu-label">木牛</div>' +
      '<div class="sgs-hand-muniu-stack sgs-hand sgs-hand-stack"></div>';
    hand.insertAdjacentElement('afterend', root);
    return root;
  }

  function handleSelfPlayableCardClick(c, game, net, opts) {
    opts = opts || {};
    if (opts.fromMuniu && isMuniuSkillPending()) return;
    if (isXuanhuoSkillPending()) {
      const allowed = xuanhuoSelectableCardIds(game);
      if (!allowed.includes(c.id)) return;
    }

    const g = state.game || game;
    const n = state.net || net;
    const pend = g.pending;
    const pickMode = getOwnHandPickMode(pend);
    if (pickMode) {
      if (toggleHandPickCard(c.id, g, n)) return;
    }
    if (
      state.pendingViewAs &&
      (state.pendingViewAs.usableCardIds || []).includes(c.id)
    ) {
      state.selectedCardId =
        state.selectedCardId === c.id ? null : c.id;
      state.selectedTargets = [];
      state.skillCardPick = [];
      state.allowMultiSelect = false;
      refreshLocalSelection(g, n);
      return;
    }
    if (state.pendingViewAs) {
      return;
    }
    const multi = Boolean(state.allowMultiSelect);
    if (multi) {
      if (!state.skillCardPick) state.skillCardPick = [];
      const activeRule =
        (state.pendingSkill && MULTI_SKILL_RULES[state.pendingSkill.skillId]) ||
        null;
      const idx = state.skillCardPick.indexOf(c.id);
      if (idx >= 0) state.skillCardPick.splice(idx, 1);
      else if (
        !activeRule ||
        !activeRule.max ||
        state.skillCardPick.length < activeRule.max
      ) {
        state.skillCardPick.push(c.id);
      }
      state.selectedCardId =
        state.skillCardPick[state.skillCardPick.length - 1] || null;
    } else {
      state.skillCardPick = [];
      const nextId = state.selectedCardId === c.id ? null : c.id;
      if (
        nextId !== state.selectedCardId &&
        !isPendingSeatTargeting(g.pending)
      ) {
        state.selectedTargets = [];
      }
      state.selectedCardId = nextId;
    }
    refreshLocalSelection(g, n);
  }

  function buildSelfPlayableCardBtn(c, game, net, multi, opts) {
    const selected = multi
      ? (state.skillCardPick || []).includes(c.id)
      : state.selectedCardId === c.id;
    const card = Object.assign({}, c, {
      onMuniu: Boolean(opts && opts.fromMuniu),
      muniuLabel: opts && opts.fromMuniu ? '木牛' : c.muniuLabel,
    });
    const btn = A().createCardEl(card, {
      selectable: true,
      selected: false,
      size: 'md',
      title: '',
    });
    if (selected) btn.dataset.pendingSelected = '1';
    if (
      state._incomingHandFx &&
      state._incomingHandFx.cardIds.includes(c.id)
    ) {
      btn.classList.add('is-steal-incoming');
    }
    btn.addEventListener('click', () => {
      handleSelfPlayableCardClick(c, game, net, opts);
    });
    if (
      state.pendingViewAs &&
      (state.pendingViewAs.usableCardIds || []).includes(c.id)
    ) {
      btn.style.outline = '2px solid #5ecf98';
    }
    if (A().bindCardHoverPreview) A().bindCardHoverPreview(btn, card);
    return btn;
  }

  function syncPlayableStackSelection(game, stack) {
    if (!stack) return;
    const multi = Boolean(state.allowMultiSelect);
    const xuanhuoArmed = isXuanhuoSkillPending();
    const xuanhuoSet = xuanhuoArmed
      ? new Set(xuanhuoSelectableCardIds(game))
      : null;
    const viewAsIds = state.pendingViewAs
      ? state.pendingViewAs.usableCardIds || []
      : [];
    const respond = ensureHandRespondSelection(game);
    let respondIds = respond ? new Set(respond.ids) : null;
    if (!respondIds) {
      const seatIds = listSeatSkillHandIds(game);
      if (seatIds && seatIds.length) respondIds = new Set(seatIds);
    }
    const viewAsArmed = Boolean(state.pendingViewAs) && !respondIds;
    const viewAsSet = viewAsArmed ? new Set(viewAsIds) : null;
    stack.querySelectorAll('.sgs-kapai[data-card-id]').forEach((btn) => {
      const id = btn.dataset.cardId;
      const selected = multi
        ? (state.skillCardPick || []).includes(id)
        : state.selectedCardId === id;
      btn.classList.toggle('selected', selected);
      if (respondIds) {
        const ok = respondIds.has(id);
        btn.classList.toggle('is-respond-ok', ok);
        btn.classList.toggle('is-respond-dim', !ok);
        btn.classList.remove('is-viewas-ok', 'is-viewas-dim');
        if (ok && !selected) {
          btn.style.outline = '2px solid rgba(94, 207, 152, 0.7)';
        } else if (!selected) {
          btn.style.outline = '';
        } else {
          btn.style.outline = '';
        }
      } else if (viewAsSet) {
        const ok = viewAsSet.has(id);
        btn.classList.toggle('is-viewas-ok', ok);
        btn.classList.toggle('is-viewas-dim', !ok);
        btn.classList.remove('is-respond-ok', 'is-respond-dim');
        if (ok && !selected) {
          btn.style.outline = '2px solid rgba(232, 184, 106, 0.85)';
        } else if (!selected) {
          btn.style.outline = '';
        } else {
          btn.style.outline = '';
        }
      } else if (xuanhuoSet) {
        const ok = xuanhuoSet.has(id);
        btn.classList.remove('is-viewas-ok', 'is-viewas-dim');
        btn.classList.toggle('is-respond-ok', ok);
        btn.classList.toggle('is-respond-dim', !ok);
        if (ok && !selected) {
          btn.style.outline = '2px solid rgba(94, 207, 152, 0.7)';
        } else if (!selected) {
          btn.style.outline = '';
        } else {
          btn.style.outline = '';
        }
      } else {
        btn.classList.remove(
          'is-respond-ok',
          'is-respond-dim',
          'is-viewas-ok',
          'is-viewas-dim'
        );
        if (!selected) {
          btn.style.outline = '';
        } else {
          btn.style.outline = '';
        }
      }
    });
  }

  function renderMuniuHand(game, net, multi, needRebuild) {
    const root = ensureMuniuHandEl();
    if (!root) return;
    const stack = root.querySelector('.sgs-hand-muniu-stack');
    if (!stack) return;
    const cards = myMuniuCards(game);
    if (!cards.length) {
      root.hidden = true;
      stack.innerHTML = '';
      stack.dataset.handKey = '';
      stack.style.height = '';
      return;
    }
    root.hidden = false;
    const key =
      cards.map((c) => c.id).join(',') +
      `|n${multi ? 1 : 0}|p${(game.pending && getOwnHandPickMode(game.pending)?.id) || ''}`;
    const rebuild = needRebuild || stack.dataset.handKey !== key;
    if (!rebuild) {
      syncPlayableStackSelection(game, stack);
      layoutSelfHand(stack, state.handFocusRatio);
      return;
    }
    if (A() && A().hideCardPreview) A().hideCardPreview();
    stack.innerHTML = '';
    stack.dataset.handKey = key;
    cards.forEach((c) => {
      stack.appendChild(
        buildSelfPlayableCardBtn(c, game, net, multi, { fromMuniu: true })
      );
    });
    bindHandStackInteractions(stack);
    requestAnimationFrame(() => {
      layoutSelfHand(stack, state.handFocusRatio);
      requestAnimationFrame(() => {
        stack.querySelectorAll('.sgs-kapai[data-pending-selected="1"]').forEach(
          (el) => {
            el.classList.add('selected');
            delete el.dataset.pendingSelected;
          }
        );
        syncPlayableStackSelection(game, stack);
        layoutSelfHand(stack, state.handFocusRatio);
      });
    });
  }

  function renderHand(game, net) {
    const hand = $('sgs-hand');
    const btnPlay = $('btn-sgs-play');
    const btnRecast = $('btn-sgs-recast');
    const btnEnd = $('btn-sgs-end-play');
    const mePlayer = (game.players || []).find(
      (p) => game.me && p.id === game.me.id
    );
    if (!hand) return;

    if (!mePlayer) {
      if (A() && A().hideCardPreview) A().hideCardPreview();
      hand.innerHTML = '';
      hand.dataset.handKey = '';
      const muniuRoot = $('sgs-hand-muniu');
      if (muniuRoot) {
        muniuRoot.hidden = true;
        const mStack = muniuRoot.querySelector('.sgs-hand-muniu-stack');
        if (mStack) {
          mStack.innerHTML = '';
          mStack.dataset.handKey = '';
        }
      }
      const hint = $('sgs-hand-hint');
      if (hint) hint.textContent = '';
      if (btnPlay) btnPlay.hidden = true;
      if (btnRecast) btnRecast.hidden = true;
      if (btnEnd) btnEnd.hidden = true;
      layoutSelfHand(hand, null);
      return;
    }

    const muniuCards = myMuniuCards(game);
    if (
      (!mePlayer.hand || !mePlayer.hand.length) &&
      !muniuCards.length
    ) {
      if (A() && A().hideCardPreview) A().hideCardPreview();
      hand.innerHTML = '';
      hand.dataset.handKey = '';
      const muniuRoot = $('sgs-hand-muniu');
      if (muniuRoot) {
        muniuRoot.hidden = true;
        const mStack = muniuRoot.querySelector('.sgs-hand-muniu-stack');
        if (mStack) {
          mStack.innerHTML = '';
          mStack.dataset.handKey = '';
        }
      }
      const hint = $('sgs-hand-hint');
      if (hint) hint.textContent = '';
      if (btnPlay) btnPlay.hidden = true;
      if (btnRecast) btnRecast.hidden = true;
      if (btnEnd) btnEnd.hidden = true;
      layoutSelfHand(hand, null);
      return;
    }

    ensureHandRespondSelection(game);
    const multi = Boolean(state.allowMultiSelect);
    const key = handListKey(mePlayer, multi, game);
    const needRebuild = hand.dataset.handKey !== key;

    if (needRebuild) {
      if (A() && A().hideCardPreview) A().hideCardPreview();
      hand.innerHTML = '';
      hand.dataset.handKey = key;
      (mePlayer.hand || []).forEach((c) => {
        hand.appendChild(buildSelfPlayableCardBtn(c, game, net, multi));
      });
      bindHandStackInteractions(hand);
      requestAnimationFrame(() => {
        layoutSelfHand(hand, state.handFocusRatio);
        // 第二帧再挂 selected，确保从 translateY(0) 过渡到上浮
        requestAnimationFrame(() => {
          hand.querySelectorAll('.sgs-kapai[data-pending-selected="1"]').forEach(
            (el) => {
              el.classList.add('selected');
              delete el.dataset.pendingSelected;
            }
          );
          syncHandSelectionAppearance(game);
          layoutSelfHand(hand, state.handFocusRatio);
        });
      });
    } else {
      syncHandSelectionAppearance(game);
      layoutSelfHand(hand, state.handFocusRatio);
    }

    renderMuniuHand(game, net, multi, needRebuild);

    updateHandPlayChrome(game, net, { rebuildSkills: true });
  }

  function renderActiveSkills(game, net, canPlay) {
    // 主公技并入武将卡右侧技能栏，不再挂在出牌按钮旁
    const legacy = $('sgs-skill-actions');
    if (legacy) {
      legacy.innerHTML = '';
      legacy.hidden = true;
    }
    renderSkillBar(game, net, canPlay);
  }

  function viewAsLabel(to) {
    if (to === 'sha') return '杀';
    if (to === 'shan') return '闪';
    if (to === 'tao') return '桃';
    if (to === 'guohe') return '过河拆桥';
    if (to === 'lebu') return '乐不思蜀';
    return to || '';
  }

  let skillTipTimer = null;
  let skillTipKey = null;

  function hideSkillTip() {
    if (skillTipTimer) {
      clearTimeout(skillTipTimer);
      skillTipTimer = null;
    }
    skillTipKey = null;
    const tip = $('sgs-skill-tip');
    if (tip) {
      tip.hidden = true;
      tip.classList.remove('is-visible');
    }
  }

  function ensureSkillTip() {
    let tip = $('sgs-skill-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'sgs-skill-tip';
      tip.className = 'sgs-skill-tip';
      tip.hidden = true;
      tip.setAttribute('aria-hidden', 'true');
      document.body.appendChild(tip);
    }
    return tip;
  }

  function placeSkillTip(tip, anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    const tw = tip.offsetWidth || 240;
    const th = tip.offsetHeight || 80;
    const gap = 10;
    let left = rect.left + rect.width / 2 - tw / 2;
    let top = rect.top - th - gap;
    const pad = 8;
    left = Math.max(pad, Math.min(left, window.innerWidth - tw - pad));
    if (top < pad) {
      top = Math.min(rect.bottom + gap, window.innerHeight - th - pad);
    }
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }

  function showSkillTip(anchorEl, skill) {
    if (!anchorEl || !skill || !document.body.contains(anchorEl)) return;
    const tip = ensureSkillTip();
    tip.classList.remove('is-general');
    const statusText =
      skill.status === 'ready'
        ? '可发动'
        : skill.status === 'used'
          ? '本回合已发动'
          : skill.type === 'viewAs'
            ? '转化技'
            : skill.type === 'active'
              ? '当前不可发动'
              : '被动 / 触发';
    tip.innerHTML =
      `<div class="sgs-skill-tip-name">【${escapeHtml(skill.name || '')}】</div>` +
      `<div class="sgs-skill-tip-status">${escapeHtml(statusText)}</div>` +
      `<div class="sgs-skill-tip-desc">${escapeHtml(
        skill.desc || '暂无描述'
      )}</div>`;
    tip.hidden = false;
    placeSkillTip(tip, anchorEl);
    requestAnimationFrame(() => {
      if (!tip.hidden) {
        placeSkillTip(tip, anchorEl);
        tip.classList.add('is-visible');
      }
    });
  }

  function showGeneralSkillTip(anchorEl, general) {
    if (!anchorEl || !general || !document.body.contains(anchorEl)) return;
    const tip = ensureSkillTip();
    tip.classList.add('is-general');
    const skills = general.skills || [];
    const skillsHtml = skills.length
      ? skills
          .map((s) => {
            const tag = s.lord ? '主公技' : '';
            return (
              `<div class="sgs-skill-tip-block">` +
              `<div class="sgs-skill-tip-name">【${escapeHtml(s.name || '')}】` +
              (tag
                ? `<span class="sgs-skill-tip-tag">${escapeHtml(tag)}</span>`
                : '') +
              `</div>` +
              `<div class="sgs-skill-tip-desc">${escapeHtml(
                s.desc || '暂无描述'
              )}</div>` +
              `</div>`
            );
          })
          .join('')
      : `<div class="sgs-skill-tip-desc">暂无技能</div>`;
    tip.innerHTML =
      `<div class="sgs-skill-tip-hero">${escapeHtml(general.name || '')}` +
      `<small>${escapeHtml(general.country || '')} · ${
        general.maxHp != null ? general.maxHp : '?'
      } 血</small></div>` +
      skillsHtml;
    tip.hidden = false;
    placeSkillTip(tip, anchorEl);
    requestAnimationFrame(() => {
      if (!tip.hidden) {
        placeSkillTip(tip, anchorEl);
        tip.classList.add('is-visible');
      }
    });
  }

  function playerGeneralForTip(player) {
    if (!player || player.generalHidden || !player.generalId) return null;
    return {
      id: player.generalId,
      name: player.generalName || player.generalId,
      country: player.country || '',
      maxHp: player.maxHp,
      skills: Array.isArray(player.skills) ? player.skills : [],
    };
  }

  function bindPlayerGeneralHoverTip(el, player) {
    const general = playerGeneralForTip(player);
    if (el && general) bindGeneralHoverTip(el, general);
  }

  function guardInactiveSkillBtn(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.setAttribute('aria-disabled', 'true');
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
  }

  function bindSkillHoverTip(el, skill) {
    if (!el || !skill) return;
    const key = skill.id || skill.name;
    el.addEventListener('pointerenter', () => {
      if (skillTipTimer) clearTimeout(skillTipTimer);
      skillTipTimer = setTimeout(() => {
        skillTipTimer = null;
        skillTipKey = key;
        showSkillTip(el, skill);
      }, 400);
    });
    el.addEventListener('pointerleave', () => {
      if (skillTipTimer) {
        clearTimeout(skillTipTimer);
        skillTipTimer = null;
      }
      if (skillTipKey === key) hideSkillTip();
    });
    el.addEventListener('pointerdown', () => {
      hideSkillTip();
    });
  }

  function bindGeneralHoverTip(el, general) {
    if (!el || !general) return;
    const key = `gen:${general.id || general.name}`;
    el.addEventListener('pointerenter', () => {
      if (skillTipTimer) clearTimeout(skillTipTimer);
      skillTipTimer = setTimeout(() => {
        skillTipTimer = null;
        skillTipKey = key;
        showGeneralSkillTip(el, general);
      }, 350);
    });
    el.addEventListener('pointerleave', () => {
      if (skillTipTimer) {
        clearTimeout(skillTipTimer);
        skillTipTimer = null;
      }
      if (skillTipKey === key) hideSkillTip();
    });
    el.addEventListener('pointerdown', () => {
      hideSkillTip();
    });
  }

  function renderSkillBar(game, net, canPlay) {
    const bar = $('sgs-skill-bar');
    if (!bar) return;
    hideSkillTip();
    bar.innerHTML = '';
    if (!game.me || game.phase !== 'playing') {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;

    const panel = game.me.skillPanel || [];
    const hint = $('sgs-target-hint');

    const appendLordSkills = () => {
      for (const sk of game.me.lordSkills || []) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sgs-skill-btn is-ready';
        b.textContent = sk.name;
        b.removeAttribute('title');
        bindSkillHoverTip(b, sk);
        b.addEventListener('click', () => {
          net.sendAction('use_skill', {
            skillId: sk.id,
            targets: state.selectedTargets.slice(),
            targetIds: state.selectedTargets.slice(),
          });
        });
        bar.appendChild(b);
      }
    };

    if (!panel.length) {
      // 回退：用座位技能名展示为不可点
      const me = (game.players || []).find((p) => p.id === game.me.id);
      for (const sk of (me && me.skills) || []) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sgs-skill-btn is-disabled';
        b.textContent = sk.name;
        b.removeAttribute('title');
        bindSkillHoverTip(b, sk);
        guardInactiveSkillBtn(b);
        bar.appendChild(b);
      }
      appendLordSkills();
      return;
    }

    for (const sk of panel) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className =
        'sgs-skill-btn' +
        (sk.status === 'ready'
          ? ' is-ready'
          : sk.status === 'used'
            ? ' is-used'
            : ' is-disabled');
      b.textContent = sk.name;
      b.removeAttribute('title');
      bindSkillHoverTip(b, sk);
      const canInteract =
        sk.canClick ||
        (state.pendingViewAs && state.pendingViewAs.skillId === sk.id);
      if (canInteract) {
        b.disabled = false;
        b.setAttribute('aria-disabled', 'false');
        b.addEventListener('click', () => {
          if (sk.type === 'viewAs') {
            const to = sk.viewAsTo;
            const usable = sk.usableCardIds || [];
            // 再点同一技能：取消发动
            if (
              state.pendingViewAs &&
              state.pendingViewAs.skillId === sk.id
            ) {
              state.pendingViewAs = null;
              state.pendingSkill = null;
              state.selectedCardId = null;
              state.selectedTargets = [];
              if (hint) {
                hint.textContent = '';
                hint.classList.remove('is-warn');
              }
              render(game, net);
              return;
            }
            state.pendingViewAs = {
              skillId: sk.id,
              skillName: sk.name,
              to,
              usableCardIds: usable.slice(),
            };
            state.pendingSkill = null;
            state.allowMultiSelect = false;
            state.skillCardPick = [];
            state.selectedTargets = [];
            if (
              state.selectedCardId &&
              !usable.includes(state.selectedCardId)
            ) {
              state.selectedCardId = null;
            }
            if (hint) {
              hint.textContent = `【${sk.name}】已准备：请选择可用手牌${
                to === 'sha' ? '与攻击目标' : ''
              }，再点「确认出牌」（再点技能取消）`;
              hint.classList.add('is-warn');
            }
            render(game, net);
            return;
          }

          if (SEAT_TARGET_ACTIVE_SKILLS.has(sk.id)) {
            if (state.pendingSkill && state.pendingSkill.skillId === sk.id) {
              state.pendingSkill = null;
              state.selectedCardId = null;
              state.selectedTargets = [];
              if (hint) {
                hint.textContent = '';
                hint.classList.remove('is-warn');
              }
              render(game, net);
              return;
            }
            state.pendingSkill = { skillId: sk.id, skillName: sk.name };
            state.pendingViewAs = null;
            state.allowMultiSelect = false;
            state.skillCardPick = [];
            state.selectedCardId = null;
            state.selectedTargets = [];
            if (hint) {
              hint.textContent = sk.id === 'xuanhuo'
                ? `【${sk.name}】：请选择一张红桃手牌，再选择一名其他角色，最后点「确认发动」（再点技能取消）`
                : `【${sk.name}】：请选择攻击范围内含有你的一名角色，再点「确认发动」（再点技能取消）`;
              hint.classList.add('is-warn');
            }
            render(game, net);
            return;
          }

          if (sk.id === MUNIU_SKILL_ID) {
            if (state.pendingSkill && state.pendingSkill.skillId === sk.id) {
              state.pendingSkill = null;
              state.selectedCardId = null;
              if (hint) {
                hint.textContent = '';
                hint.classList.remove('is-warn');
              }
              render(game, net);
              return;
            }
            state.pendingSkill = { skillId: sk.id, skillName: sk.name };
            state.pendingViewAs = null;
            state.allowMultiSelect = false;
            state.skillCardPick = [];
            state.selectedCardId = null;
            state.selectedTargets = [];
            if (hint) {
              hint.textContent =
                `【${sk.name}】：请选择一张手牌置于木牛流马上，再点「确认发动」（再点技能取消）`;
              hint.classList.add('is-warn');
            }
            render(game, net);
            return;
          }

          // 主动技
          const needsMulti =
            MULTI_SKILL_IDS.has(sk.id) ||
            /仁德|交给|制衡/.test(String(sk.name || '') + String(sk.desc || ''));
          if (
            needsMulti &&
            state.pendingSkill &&
            state.pendingSkill.skillId === sk.id &&
            !(state.skillCardPick && state.skillCardPick.length)
          ) {
            state.pendingSkill = null;
            state.selectedCardId = null;
            state.selectedTargets = [];
            state.skillCardPick = [];
            state.allowMultiSelect = false;
            if (hint) {
              hint.textContent = '';
              hint.classList.remove('is-warn');
            }
            render(game, net);
            return;
          }
          if (needsMulti && !(state.skillCardPick && state.skillCardPick.length)) {
            state.allowMultiSelect = true;
            state.pendingSkill = { skillId: sk.id, skillName: sk.name };
            state.skillCardPick = state.selectedCardId
              ? [state.selectedCardId]
              : [];
            const rule = MULTI_SKILL_RULES[sk.id] || null;
            if (hint) {
              hint.textContent =
                (rule && rule.hint) ||
                `【${sk.name}】：请点选手牌（可多选）与目标后，再点技能发动`;
              hint.classList.add('is-warn');
            }
            render(game, net);
            return;
          }
          const ids =
            state.skillCardPick && state.skillCardPick.length
              ? state.skillCardPick.slice()
              : state.selectedCardId != null
                ? [state.selectedCardId]
                : [];
          const rule = MULTI_SKILL_RULES[sk.id] || null;
          if (rule) {
            if (ids.length < (rule.min || 0)) {
              if (hint) {
                hint.textContent = rule.hint || `【${sk.name}】：请选择足够的手牌`;
                hint.classList.add('is-warn');
              }
              return;
            }
            if (rule.max && ids.length > rule.max) {
              if (hint) {
                hint.textContent = `【${sk.name}】：最多只能选择 ${rule.max} 张牌`;
                hint.classList.add('is-warn');
              }
              return;
            }
            if (rule.sameSuit) {
              const meState = (game.players || []).find(
                (p) => game.me && p.id === game.me.id
              );
              const picked = ids
                .map((id) => (meState && meState.hand || []).find((c) => c.id === id))
                .filter(Boolean);
              const suits = [...new Set(picked.map((c) => c.suit))];
              if (picked.length !== ids.length || suits.length > 1) {
                if (hint) {
                  hint.textContent = `【${sk.name}】：请选择两张同花色手牌`;
                  hint.classList.add('is-warn');
                }
                return;
              }
            }
          }
          net.sendAction('use_skill', {
            skillId: sk.id,
            cardIds: ids,
            cardId: ids[0] || null,
            targetId: state.selectedTargets[0] || null,
            targetIds: state.selectedTargets.slice(),
            targetA: state.selectedTargets[0] || null,
            targetB: state.selectedTargets[1] || null,
          });
          state.selectedCardId = null;
          state.selectedTargets = [];
          state.skillCardPick = [];
          state.allowMultiSelect = false;
          state.pendingSkill = null;
          state.pendingViewAs = null;
        });
      } else {
        guardInactiveSkillBtn(b);
      }
      if (state.pendingViewAs && state.pendingViewAs.skillId === sk.id) {
        b.classList.add('is-armed');
        b.classList.remove('is-disabled');
      }
      if (state.pendingSkill && state.pendingSkill.skillId === sk.id) {
        b.classList.add('is-armed');
        b.classList.remove('is-disabled');
      }
      bar.appendChild(b);
    }

    appendLordSkills();
  }

  function resetGuanxingSlots(pend) {
    const ids = (pend.cardIds || []).slice();
    const n = ids.length;
    state._guanxingKey = ids.join(',');
    state.guanxingTop = ids.slice();
    while (state.guanxingTop.length < n) state.guanxingTop.push(null);
    state.guanxingBottom = new Array(n).fill(null);
    state.guanxingSelected = null;
  }

  function guanxingZoneSlots(zone) {
    return zone === 'bottom' ? state.guanxingBottom : state.guanxingTop;
  }

  function moveGuanxingCard(fromZone, fromIdx, toZone, toIdx) {
    const fromList = guanxingZoneSlots(fromZone);
    const toList = guanxingZoneSlots(toZone);
    const fromId = fromList[fromIdx];
    if (!fromId) return;
    const toId = toList[toIdx];
    fromList[fromIdx] = toId || null;
    toList[toIdx] = fromId;
    state.guanxingSelected = null;
  }

  function showGuanxingModal(pend, net) {
    const modal = $('sgs-modal');
    const panel = $('sgs-modal-panel');
    const title = $('sgs-modal-title');
    const hint = $('sgs-modal-hint');
    const body = $('sgs-modal-body');
    const actions = $('sgs-modal-actions');
    if (!modal || !body || !actions) return;

    const idsKey = (pend.cardIds || []).join(',');
    if (state._guanxingKey !== idsKey) resetGuanxingSlots(pend);

    const n = (pend.cardIds || []).length;
    const byId = {};
    for (const c of pend.shown || []) byId[c.id] = c;

    modal.hidden = false;
    if (panel) {
      panel.classList.add('sgs-modal-panel--cards');
      panel.classList.add('sgs-modal-panel--guanxing');
    }
    body.classList.add('sgs-modal-body--cards');
    if (title) {
      title.textContent = pend.skillName ? `【${pend.skillName}】` : '观星';
    }
    if (hint) {
      hint.textContent =
        pend.message ||
        '将上方牌拖至下方空位表示置于牌堆底；留在上方即置于牌堆顶';
    }

    const paint = () => {
      body.innerHTML = '';
      actions.innerHTML = '';

      const root = document.createElement('div');
      root.className = 'sgs-guanxing';

      const buildZone = (zone, label) => {
        const wrap = document.createElement('div');
        wrap.className = 'sgs-guanxing-zone';
        const tag = document.createElement('div');
        tag.className = 'sgs-guanxing-zone-title';
        tag.textContent = label;
        wrap.appendChild(tag);

        const row = document.createElement('div');
        row.className = 'sgs-guanxing-slots';
        const slots = guanxingZoneSlots(zone);
        for (let i = 0; i < n; i++) {
          const slot = document.createElement('div');
          slot.className = 'sgs-guanxing-slot';
          slot.dataset.zone = zone;
          slot.dataset.idx = String(i);
          const cardId = slots[i];
          const selected =
            state.guanxingSelected &&
            state.guanxingSelected.zone === zone &&
            state.guanxingSelected.idx === i;
          if (selected) slot.classList.add('is-selected');

          slot.addEventListener('dragover', (e) => {
            e.preventDefault();
            slot.classList.add('is-drag-over');
          });
          slot.addEventListener('dragleave', () => {
            slot.classList.remove('is-drag-over');
          });
          slot.addEventListener('drop', (e) => {
            e.preventDefault();
            slot.classList.remove('is-drag-over');
            const drag = state.guanxingDrag;
            if (!drag) return;
            moveGuanxingCard(drag.zone, drag.idx, zone, i);
            paint();
          });
          slot.addEventListener('click', () => {
            const sel = state.guanxingSelected;
            if (!sel) {
              if (cardId) state.guanxingSelected = { zone, idx: i };
              paint();
              return;
            }
            if (sel.zone === zone && sel.idx === i) {
              state.guanxingSelected = null;
              paint();
              return;
            }
            moveGuanxingCard(sel.zone, sel.idx, zone, i);
            paint();
          });

          if (cardId && byId[cardId]) {
            const cardEl = makeSelectableCard(byId[cardId], () => {}, selected);
            cardEl.draggable = true;
            cardEl.addEventListener('dragstart', (e) => {
              state.guanxingDrag = { zone, idx: i };
              e.dataTransfer.effectAllowed = 'move';
            });
            cardEl.addEventListener('dragend', () => {
              state.guanxingDrag = null;
            });
            cardEl.addEventListener('click', (e) => {
              e.stopPropagation();
              slot.click();
            });
            slot.appendChild(cardEl);
          } else {
            const empty = document.createElement('div');
            empty.className = 'sgs-guanxing-slot-empty';
            empty.textContent = zone === 'top' ? '顶' : '底';
            slot.appendChild(empty);
          }
          row.appendChild(slot);
        }
        wrap.appendChild(row);
        return wrap;
      };

      root.appendChild(
        buildZone('top', `牌堆顶（${n} 张，从左到右先摸到）`)
      );
      root.appendChild(
        buildZone('bottom', `牌堆底（${n} 个空位，拖入即置底）`)
      );
      body.appendChild(root);

      const tip = document.createElement('p');
      tip.className = 'muted sgs-guanxing-tip';
      tip.textContent =
        '拖拽或点选卡牌后点目标位：上方留牌=牌堆顶，移到下方=牌堆底；同区可换位调整顺序';
      body.appendChild(tip);

      const conf = document.createElement('button');
      conf.type = 'button';
      conf.textContent = '确认放置';
      conf.addEventListener('click', () => {
        const topIds = (state.guanxingTop || []).filter(Boolean);
        const bottomIds = (state.guanxingBottom || []).filter(Boolean);
        const used = topIds.length + bottomIds.length;
        if (used !== n) {
          alert('请分配全部观星牌');
          return;
        }
        net.sendAction('respond', {
          topIds: topIds.slice(),
          bottomIds: bottomIds.slice(),
        });
        state._guanxingKey = null;
        state.guanxingTop = null;
        state.guanxingBottom = null;
        state.guanxingSelected = null;
        hideSgsModal();
      });
      actions.appendChild(conf);
    };

    paint();
  }

  function clearSkillAskBar() {
    const bar = $('sgs-ask-bar');
    const msg = $('sgs-ask-msg');
    const cards = $('sgs-ask-cards');
    const actions = $('sgs-ask-actions');
    if (bar) bar.hidden = true;
    if (msg) msg.textContent = '';
    if (cards) cards.innerHTML = '';
    if (actions) actions.innerHTML = '';
  }

  function openPromptBar(message) {
    const bar = $('sgs-ask-bar');
    const msg = $('sgs-ask-msg');
    const cards = $('sgs-ask-cards');
    const actions = $('sgs-ask-actions');
    if (!bar) {
      return { msg: null, cards: null, actions: null };
    }
    bar.hidden = false;
    if (msg) msg.textContent = message || '';
    if (cards) cards.innerHTML = '';
    if (actions) actions.innerHTML = '';
    return { msg, cards, actions };
  }

  function showBaguaAskBar(pend, net) {
    const { actions } = openPromptBar(
      pend.message || '是否发动【八卦阵】进行判定？'
    );
    if (!actions) return;
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.textContent = '发动【八卦阵】';
    yes.addEventListener('click', () => {
      net.sendAction('respond', { pass: false });
    });
    actions.appendChild(yes);
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'secondary';
    no.textContent = '不发动';
    no.addEventListener('click', () => {
      net.sendAction('respond', { pass: true });
    });
    actions.appendChild(no);
  }

  function showSkillAskBar(pend, net) {
    const { actions } = openPromptBar(
      pend.message || `是否发动【${pend.skillName || '技能'}】？`
    );
    if (!actions) return;
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.textContent = `发动【${pend.skillName || '技能'}】`;
    yes.addEventListener('click', () => {
      net.sendAction('respond', { pass: false });
    });
    actions.appendChild(yes);
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'secondary';
    no.textContent = '不发动';
    no.addEventListener('click', () => {
      net.sendAction('respond', { pass: true });
    });
    actions.appendChild(no);
  }

  /** 选座位确认（突袭/放权/节命/甘露等） */
  function showSeatTargetAskBar(game, pend, net) {
    const n = (state.selectedTargets || []).length;
    const max = pend.maxTargets != null ? Number(pend.maxTargets) : 1;
    const min = pend.minTargets != null ? Number(pend.minTargets) : 1;
    const { actions } = openPromptBar(
      (pend.message || '请选择目标') +
        `（已选 ${n}/${max}，点击座位选择` +
        (pend.skillId === 'liuli' ||
        pend.skillId === 'tianxiang' ||
        pend.skillId === 'jujian' ||
        pend.skillId === 'haoshi' ||
        pend.skillId === 'yiji'
          ? '；手牌请在下方选择'
          : '') +
        '）'
    );
    if (!actions) return;

    // 流离/天香/好施/举荐：手牌在下方选择，这里只确认目标和张数
    const needOwnCards =
      pend.skillId === 'liuli' ||
      pend.skillId === 'tianxiang' ||
      pend.skillId === 'jujian' ||
      pend.skillId === 'haoshi' ||
      pend.skillId === 'yiji';
    if (needOwnCards) {
      const multi = pend.skillId === 'haoshi' || pend.skillId === 'jujian';
      state.allowMultiSelect = multi;
      if (multi && !state.skillCardPick) state.skillCardPick = [];
      if (pend.skillId === 'tianxiang') {
        const me = (game.players || []).find(
          (p) => game.me && p.id === game.me.id
        );
        const hand = (me && me.hand) || [];
        const hearts = hand.filter(
          (c) => c.suit === 'heart' || c.suitLabel === '♥'
        );
        const ids = new Set(hearts.map((c) => c.id));
        if (state.selectedCardId && !ids.has(state.selectedCardId)) {
          state.selectedCardId = null;
        }
      }
      syncHandSelectionAppearance(game);
    }

    const conf = document.createElement('button');
    conf.type = 'button';
    conf.textContent = '确认';
    const cardOk =
      !needOwnCards ||
      (pend.skillId === 'haoshi'
        ? (state.skillCardPick || []).length === Number(pend.giveCount)
        : pend.skillId === 'jujian'
          ? (state.skillCardPick || []).length >= 1
          : pend.skillId === 'yiji'
            ? Boolean(state.selectedCardId) &&
              (pend.cardIds || []).includes(state.selectedCardId)
            : Boolean(state.selectedCardId));
    conf.disabled = n < min || (max > 0 && n > max) || !cardOk;
    conf.addEventListener('click', () => {
      if ((state.selectedTargets || []).length < min) {
        alert(`请至少选择 ${min} 名角色`);
        return;
      }
      net.sendAction('respond', {
        targetIds: state.selectedTargets.slice(),
        targetId: state.selectedTargets[0] || null,
        targetA: state.selectedTargets[0] || null,
        targetB: state.selectedTargets[1] || null,
        cardId: state.selectedCardId,
        cardIds: (state.skillCardPick || []).slice(),
      });
      state.selectedTargets = [];
      state.skillCardPick = [];
      state.selectedCardId = null;
    });
    actions.appendChild(conf);

    if (pend.canPass !== false) {
      const pass = document.createElement('button');
      pass.type = 'button';
      pass.className = 'secondary';
      pass.textContent = '取消';
      pass.addEventListener('click', () => {
        state.selectedTargets = [];
        state.skillCardPick = [];
        state.selectedCardId = null;
        net.sendAction('respond', { pass: true });
      });
      actions.appendChild(pass);
    }
  }

  function isSeatTargetSkillEffect(pend) {
    if (!pend || pend.type !== 'skill_effect') return false;
    if (pend.skillId === MUNIU_SKILL_ID && pend.step === 'transfer') return true;
    if (pend.skillId === 'yiji') return true;
    if (
      pend.skillId === 'tuxi' ||
      pend.skillId === 'liuli' ||
      pend.skillId === 'fangquan' ||
      pend.skillId === 'jieming' ||
      pend.skillId === 'ganlu' ||
      pend.skillId === 'haoshi' ||
      pend.skillId === 'tianxiang' ||
      pend.skillId === 'jujian' ||
      (pend.skillId === 'quhu' && pend.step === 'damage') ||
      (pend.skillId === 'liyu' && pend.step === 'juedou') ||
      (pend.skillId === 'fanjian' && pend.step === 'target')
    ) {
      return true;
    }
    if (
      pend.maxTargets != null &&
      Number(pend.maxTargets) > 0 &&
      !(pend.cardOptions && pend.cardOptions.length) &&
      !(pend.shown && pend.shown.length) &&
      pend.skillId !== 'qice' &&
      pend.skillId !== 'yiji' &&
      pend.skillId !== 'rende' &&
      pend.skillId !== 'fanjian' &&
      pend.skillId !== 'hujia' &&
      pend.skillId !== 'jijiang'
    ) {
      return true;
    }
    return false;
  }

  function showWuguModal(pend, net) {
    const modal = $('sgs-modal');
    const panel = $('sgs-modal-panel');
    const title = $('sgs-modal-title');
    const hint = $('sgs-modal-hint');
    const body = $('sgs-modal-body');
    const actions = $('sgs-modal-actions');
    if (!modal || !body || !actions) return;

    modal.hidden = false;
    if (panel) panel.classList.add('sgs-modal-panel--cards');
    body.classList.add('sgs-modal-body--cards');
    if (title) title.textContent = '五谷丰登';
    if (hint) {
      hint.textContent = pend.message || '选择一张牌获得';
    }
    body.innerHTML = '';
    actions.innerHTML = '';

    const shown = pend.shown || [];
    const row = document.createElement('div');
    row.className = 'sgs-modal-zone-cards';
    for (const c of shown) {
      const btn = makeSelectableCard(c, () => {
        hideSgsModal();
        net.sendAction('respond', { cardId: c.id });
      });
      row.appendChild(btn);
    }
    body.appendChild(row);

    if (!shown.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = '没有可选的牌';
      body.appendChild(empty);
    }
  }

  function showHuogongRevealModal(pend) {
    showCardRevealModal(pend, state.net, { title: '火攻', hint: '已展示手牌：对所有人明示' });
  }

  function cardRevealKey(pend) {
    if (!pend) return '';
    const ids = (pend.shown || []).map((c) => (c && c.id) || c).join(',');
    return `${pend.type}:${pend.skillId || ''}:${ids}:${pend.message || ''}`;
  }

  function clearCardRevealTimers() {
    (state._cardRevealTimers || []).forEach((t) => clearTimeout(t));
    state._cardRevealTimers = [];
    if (state._cardRevealAutoAck) {
      clearTimeout(state._cardRevealAutoAck);
      state._cardRevealAutoAck = null;
    }
    state._cardRevealKey = null;
    state._cardRevealSent = false;
  }

  function revealAckDelayMs(pend, extraMs = 0) {
    const minMs = (pend && pend.revealMinMs) || REVEAL_MIN_MS;
    return Math.max(minMs, extraMs);
  }

  function sendCardRevealAck(net) {
    if (state._cardRevealSent || !net) return;
    state._cardRevealSent = true;
    hideSgsModal();
    clearCardRevealTimers();
    net.sendAction('respond', {});
  }

  /** 统一展示弹框：全员可见，至少停留 REVEAL_MIN_MS */
  function showCardRevealModal(pend, net, opts = {}) {
    const modal = $('sgs-modal');
    const panel = $('sgs-modal-panel');
    const title = $('sgs-modal-title');
    const hint = $('sgs-modal-hint');
    const body = $('sgs-modal-body');
    const actions = $('sgs-modal-actions');
    if (!modal || !body || !actions) return;

    const key = cardRevealKey(pend);
    const resumeSame =
      state._cardRevealKey === key && body.dataset.cardReveal === key;

    modal.hidden = false;
    if (panel) panel.classList.add('sgs-modal-panel--cards');
    body.classList.add('sgs-modal-body--cards');
    if (title) {
      title.textContent =
        opts.title || pend.title || pend.skillName || '展示';
    }
    if (hint) {
      hint.textContent = opts.hint || pend.message || '对所有人明示';
    }

    if (resumeSame) {
      return;
    }

    state._cardRevealKey = key;
    state._cardRevealSent = false;
    body.dataset.cardReveal = key;
    body.innerHTML = '';
    actions.innerHTML = '';

    const row = document.createElement('div');
    row.className = 'sgs-modal-zone-cards';
    for (const c of pend.shown || []) {
      row.appendChild(makeSelectableCard(c, () => {}, false));
    }
    if (!row.childElementCount) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = '无牌可展示';
      body.appendChild(empty);
    } else {
      body.appendChild(row);
    }

    const ackDelay = revealAckDelayMs(pend);

    if (pend.forMe) {
      const conf = document.createElement('button');
      conf.type = 'button';
      conf.disabled = true;
      conf.textContent = '确认';
      conf.addEventListener('click', () => sendCardRevealAck(net));
      actions.appendChild(conf);
      const tEnable = setTimeout(() => {
        conf.disabled = false;
      }, ackDelay);
      state._cardRevealTimers = [tEnable];
      state._cardRevealAutoAck = setTimeout(() => {
        state._cardRevealAutoAck = null;
        if (
          state.game &&
          state.game.pending &&
          state.game.pending.type === 'card_reveal' &&
          cardRevealKey(state.game.pending) === key &&
          pend.forMe
        ) {
          sendCardRevealAck(net);
        }
      }, ackDelay);
    } else {
      const tip = document.createElement('p');
      tip.className = 'muted';
      tip.textContent = '展示中…';
      actions.appendChild(tip);
    }
  }

  /** 延时锦囊判定展示：左判定牌 → 缓一下 → 翻判定结果 → 显示生效/失效 */
  function showJudgeRevealModal(game, pend, net) {
    const modal = $('sgs-modal');
    const panel = $('sgs-modal-panel');
    const title = $('sgs-modal-title');
    const hint = $('sgs-modal-hint');
    const body = $('sgs-modal-body');
    const actions = $('sgs-modal-actions');
    if (!modal || !body || !actions) return;

    const animKey = `${pend.cardId || ''}:${pend.resultCardId || ''}:${pend.outcomeKind || ''}`;
    const resumeSame =
      state._judgeRevealKey === animKey && body.dataset.judgeReveal === animKey;

    modal.hidden = false;
    if (panel) {
      panel.classList.add('sgs-modal-panel--cards');
      panel.classList.add('sgs-modal-panel--judge');
    }
    body.classList.add('sgs-modal-body--cards');
    if (title) {
      title.textContent =
        pend.judgeKind === 'skill' && (pend.skillName || pend.cardName)
          ? `判定【${pend.skillName || pend.cardName}】`
          : pend.cardName
            ? `判定【${pend.cardName}】`
            : '判定';
    }
    if (hint) {
      hint.textContent = pend.message || '判定中…';
    }

    if (resumeSame) {
      const shown = body.querySelector('.sgs-judge-outcome:not(.is-pending)');
      if (shown) {
        actions.innerHTML = '';
        appendJudgeRevealActions(actions, pend, net);
      }
      return;
    }

    state._judgeRevealKey = animKey;
    state._judgeRevealSent = false;
    body.dataset.judgeReveal = animKey;
    body.innerHTML = '';
    actions.innerHTML = '';

    const stage = document.createElement('div');
    stage.className = 'sgs-judge-reveal';
    const leftCol = document.createElement('div');
    leftCol.className = 'sgs-judge-reveal-col';
    const leftLabel = document.createElement('div');
    leftLabel.className = 'sgs-judge-reveal-label';
    leftLabel.textContent =
      pend.judgeKind === 'skill'
        ? pend.skillName || pend.cardName || '技能'
        : pend.judgeKind === 'bagua'
          ? '八卦阵'
          : '判定牌';
    leftCol.appendChild(leftLabel);
    const delayed = pend.triggerCard || null;
    if (delayed) {
      leftCol.appendChild(makeSelectableCard(delayed, () => {}, false));
    } else if (pend.judgeKind === 'skill') {
      const skillTag = document.createElement('div');
      skillTag.className = 'sgs-judge-skill-tag';
      skillTag.textContent = pend.skillName || pend.cardName || '技能判定';
      leftCol.appendChild(skillTag);
    } else {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = pend.cardName || '—';
      leftCol.appendChild(empty);
    }

    const rightCol = document.createElement('div');
    rightCol.className = 'sgs-judge-reveal-col';
    const rightLabel = document.createElement('div');
    rightLabel.className = 'sgs-judge-reveal-label';
    rightLabel.textContent = '判定结果';
    rightCol.appendChild(rightLabel);

    const resultSlot = document.createElement('div');
    resultSlot.className = 'sgs-judge-reveal-result';
    const back = document.createElement('div');
    back.className = 'sgs-judge-card-back is-waiting';
    back.textContent = '牌堆';
    resultSlot.appendChild(back);
    rightCol.appendChild(resultSlot);

    stage.appendChild(leftCol);
    stage.appendChild(rightCol);
    body.appendChild(stage);

    const outcomeEl = document.createElement('div');
    outcomeEl.className = 'sgs-judge-outcome is-pending';
    outcomeEl.textContent = '翻开判定牌…';
    body.appendChild(outcomeEl);

    const resultCard = pend.resultCard || (pend.shown && pend.shown[0]) || null;
    const revealDelay = 900;
    const outcomeDelay = 700;
    const ackDelay = revealAckDelayMs(pend, revealDelay + outcomeDelay);

    const timers = state._judgeRevealTimers || [];
    timers.forEach((t) => clearTimeout(t));
    state._judgeRevealTimers = [];

    const t1 = setTimeout(() => {
      resultSlot.innerHTML = '';
      if (resultCard) {
        const face = makeSelectableCard(resultCard, () => {}, false);
        face.classList.add('sgs-judge-flip-in');
        resultSlot.appendChild(face);
      } else {
        const miss = document.createElement('div');
        miss.className = 'muted';
        miss.textContent = '无牌';
        resultSlot.appendChild(miss);
      }
      if (hint) {
        const suit =
          resultCard &&
          (resultCard.suitLabel ||
            (resultCard.suit && String(resultCard.suit)) ||
            '');
        const num = resultCard && resultCard.number != null ? resultCard.number : '';
        hint.textContent =
          (pend.message || '判定') +
          (suit || num ? ` → ${suit}${num}` : '');
      }
    }, revealDelay);
    state._judgeRevealTimers.push(t1);

    const t2 = setTimeout(() => {
      outcomeEl.classList.remove('is-pending');
      outcomeEl.classList.toggle('is-effective', Boolean(pend.outcomeEffective));
      outcomeEl.classList.toggle('is-fail', pend.outcomeEffective === false);
      outcomeEl.textContent =
        pend.outcomeMessage ||
        (pend.outcomeEffective ? '判定生效' : '判定失效');
      appendJudgeRevealActions(actions, pend, net, ackDelay);
    }, ackDelay);
    state._judgeRevealTimers.push(t2);
  }

  function appendJudgeRevealActions(actions, pend, net, ackDelay) {
    if (!actions) return;
    actions.innerHTML = '';
    const delay = ackDelay != null ? ackDelay : revealAckDelayMs(pend, 1600);
    if (pend.forMe) {
      const conf = document.createElement('button');
      conf.type = 'button';
      conf.disabled = true;
      conf.textContent = '确认';
      conf.addEventListener('click', () => {
        if (state._judgeRevealSent) return;
        state._judgeRevealSent = true;
        hideSgsModal();
        clearJudgeRevealTimers();
        net.sendAction('respond', {});
      });
      actions.appendChild(conf);
      const tEnable = setTimeout(() => {
        conf.disabled = false;
      }, delay);
      state._judgeRevealTimers = (state._judgeRevealTimers || []).concat(tEnable);
      if (!state._judgeRevealAutoAck) {
        state._judgeRevealAutoAck = setTimeout(() => {
          state._judgeRevealAutoAck = null;
          if (state._judgeRevealSent) return;
          if (
            state.game &&
            state.game.pending &&
            state.game.pending.type === 'judge_reveal' &&
            state.game.pending.forMe
          ) {
            state._judgeRevealSent = true;
            hideSgsModal();
            clearJudgeRevealTimers();
            net.sendAction('respond', {});
          }
        }, delay);
      }
    } else {
      const tip = document.createElement('p');
      tip.className = 'muted';
      tip.textContent = '等待判定展示结束…';
      actions.appendChild(tip);
    }
  }

  function clearJudgeRevealTimers() {
    (state._judgeRevealTimers || []).forEach((t) => clearTimeout(t));
    state._judgeRevealTimers = [];
    if (state._judgeRevealAutoAck) {
      clearTimeout(state._judgeRevealAutoAck);
      state._judgeRevealAutoAck = null;
    }
    state._judgeRevealKey = null;
  }

  function showWuxieWaitingBar(pend) {
    const box = $('sgs-pending');
    if (box) {
      box.hidden = false;
      box.innerHTML =
        `<div class="sgs-pending-inner">` +
        `<p class="muted">${escapeHtml(pend.message || '无懈询问中…')}</p>` +
        `<p><strong>已选择，等待其他玩家…</strong></p>` +
        (pend.wuxieWaitingCount != null
          ? `<p class="muted">尚有 ${pend.wuxieWaitingCount} 人未决定</p>`
          : '') +
        `</div>`;
    }
    hideSgsModal();
    clearSkillAskBar();
  }

  function showWuxieRevealModal(pend, net) {
    const modal = $('sgs-modal');
    const panel = $('sgs-modal-panel');
    const title = $('sgs-modal-title');
    const hint = $('sgs-modal-hint');
    const body = $('sgs-modal-body');
    const actions = $('sgs-modal-actions');
    if (!modal || !body || !actions) return;

    modal.hidden = false;
    if (panel) panel.classList.add('sgs-modal-panel--cards');
    body.classList.add('sgs-modal-body--cards');
    if (title) title.textContent = pend.countering ? '无懈响应结果' : '无懈询问结果';
    if (hint) hint.textContent = pend.message || '全员决定完毕';

    body.innerHTML = '';
    actions.innerHTML = '';

    const list = document.createElement('ul');
    list.className = 'sgs-wuxie-result-list';
    for (const row of pend.wuxieResults || []) {
      const li = document.createElement('li');
      let text = row.playerName || '—';
      if (row.pass) {
        text += row.auto ? '：无法无懈' : '：不出无懈';
      } else if (row.asWuxie && row.skillName) {
        text += `：发动【${row.skillName}】当无懈`;
      } else {
        text += '：打出【无懈可击】';
      }
      li.textContent = text;
      list.appendChild(li);
    }
    body.appendChild(list);

    const delay = revealAckDelayMs(pend, 1600);
    if (pend.forMe) {
      const conf = document.createElement('button');
      conf.type = 'button';
      conf.disabled = true;
      conf.textContent = '确认';
      conf.addEventListener('click', () => {
        hideSgsModal();
        net.sendAction('respond', {});
      });
      actions.appendChild(conf);
      setTimeout(() => {
        conf.disabled = false;
      }, delay);
      if (!state._wuxieRevealAutoAck) {
        state._wuxieRevealAutoAck = setTimeout(() => {
          state._wuxieRevealAutoAck = null;
          if (
            state.game &&
            state.game.pending &&
            state.game.pending.type === 'wuxie' &&
            state.game.pending.wuxiePhase === 'reveal' &&
            state.game.pending.forMe
          ) {
            hideSgsModal();
            net.sendAction('respond', {});
          }
        }, delay);
      }
    } else {
      const tip = document.createElement('p');
      tip.className = 'muted';
      tip.textContent = '等待结果展示结束…';
      actions.appendChild(tip);
    }
  }

  function renderPending(game, net) {
    const box = $('sgs-pending');
    if (box) box.hidden = true;
    const pend = game.pending;
    if (!pend) {
      hideSgsModal();
      clearSkillAskBar();
      clearJudgeRevealTimers();
      clearCardRevealTimers();
      state._guanxingKey = null;
      state.guanxingTop = null;
      state.guanxingBottom = null;
      state.guanxingSelected = null;
      if (state.game && state.net) {
        updateHandPlayChrome(state.game, state.net, { rebuildSkills: false });
      }
      return;
    }
    if (pend.type === 'card_reveal') {
      clearSkillAskBar();
      showCardRevealModal(pend, net);
      return;
    }
    if (pend.type === 'wuxie' && pend.wuxiePhase === 'reveal') {
      clearSkillAskBar();
      showWuxieRevealModal(pend, net);
      return;
    }
    if (pend.type === 'wuxie' && pend.wuxieSubmitted) {
      showWuxieWaitingBar(pend);
      return;
    }
    const keepJudgeRevealModal = pend.type === 'judge_reveal';
    if (keepJudgeRevealModal) {
      clearSkillAskBar();
      showJudgeRevealModal(game, pend, net);
      return;
    }
    hideSgsModal();
    clearCardRevealTimers();
    if (!pend.forMe) {
      clearSkillAskBar();
      clearJudgeRevealTimers();
      if (pend.type === 'wuxie' && pend.wuxiePhase === 'collect') {
        const box = $('sgs-pending');
        if (box) {
          box.hidden = false;
          box.innerHTML =
            `<div class="sgs-pending-inner"><p class="muted">${escapeHtml(
              pend.message || '无懈询问中…'
            )}</p>` +
            (pend.wuxieWaitingCount != null
              ? `<p class="muted">等待 ${pend.wuxieWaitingCount} 人决定…</p>`
              : '') +
            `</div>`;
        }
      }
      return;
    }
    const isQicePick =
      pend.type === 'skill_effect' &&
      pend.skillId === 'qice' &&
      (pend.step === 'choose_trick' || !pend.step);
    if (isQicePick) {
      clearSkillAskBar();
      showQiceTrickModal(pend, net);
      return;
    }
    if (pend.type === 'skill_effect' && pend.skillId === 'fanjian' && pend.step === 'suit') {
      clearSkillAskBar();
      showFanjianSuitModal(pend, net);
      return;
    }
    if (pend.type === 'wugu') {
      clearSkillAskBar();
      showWuguModal(pend, net);
      return;
    }
    if (pend.type === 'pile_reorder' && pend.forMe) {
      clearSkillAskBar();
      showGuanxingModal(pend, net);
      return;
    }
    if (isOpponentZonePickPending(pend)) {
      clearSkillAskBar();
      showOpponentZonePickModal(game, pend, net);
      return;
    }
    if (pend.type === 'bagua_ask') {
      hideSgsModal();
      showBaguaAskBar(pend, net);
      return;
    }
    if (pend.type === 'skill_ask') {
      hideSgsModal();
      showSkillAskBar(pend, net);
      return;
    }
    if (isSeatTargetSkillEffect(pend)) {
      hideSgsModal();
      showSeatTargetAskBar(game, pend, net);
      return;
    }
    // 出闪/杀/桃/弃牌等：不在上方复制手牌，改下方手牌区点选 + 确认
    if (isHandCardRespondPending(pend)) {
      hideSgsModal();
      clearSkillAskBar();
      ensureHandRespondSelection(game);
      updateHandPlayChrome(game, net, { rebuildSkills: true });
      return;
    }
    hideSgsModal();
    const prompt = openPromptBar(pend.message || '请响应');
    const msg = prompt.msg || { textContent: '' };
    const cards = prompt.cards || document.createElement('div');
    const actions = prompt.actions || document.createElement('div');

    const me = (game.players || []).find((p) => game.me && p.id === game.me.id);
    const hand = (me && me.hand) || [];

    const addPass = (label = '取消/不出') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'secondary';
      b.textContent = label;
      b.addEventListener('click', () => {
        net.sendAction('respond', { pass: true });
      });
      actions.appendChild(b);
    };

    if (pend.type === 'succession') {
      msg.textContent = pend.message || '请选择传位对象（点击座位后确认）';
      const conf = document.createElement('button');
      conf.type = 'button';
      conf.textContent = '确认传位给选中角色';
      conf.addEventListener('click', () => {
        if (!state.selectedTargets.length) {
          alert('请先点击一名存活角色');
          return;
        }
        net.sendAction('respond', { targetId: state.selectedTargets[0] });
        state.selectedTargets = [];
      });
      actions.appendChild(conf);
      return;
    }

    if (pend.type === 'wuxie') {
      // 已改到手牌响应模式
      return;
    }

    if (pend.type === 'skill_effect') {
      if (pend.skillId === 'qice' && pend.step === 'choose_targets') {
        msg.textContent =
          (pend.message || '') +
          (state.selectedTargets.length
            ? `（已选 ${state.selectedTargets.length}）`
            : '（点击座位选择目标）');
        if (pend.trickId === 'tiesuo') {
          const recast = document.createElement('button');
          recast.type = 'button';
          recast.textContent = '重置（摸 1）';
          recast.title = '弃置当作铁索连环的牌，摸 1 张（不触发语音）';
          recast.addEventListener('click', () => {
            net.sendAction('respond', { recast: true, targets: [] });
            state.selectedTargets = [];
          });
          actions.appendChild(recast);
        }
        const conf = document.createElement('button');
        conf.type = 'button';
        conf.textContent = '确认使用';
        conf.addEventListener('click', () => {
          const min = Number(pend.minTargets) || 0;
          if (state.selectedTargets.length < min) {
            alert(`请至少选择 ${min} 名目标`);
            return;
          }
          net.sendAction('respond', {
            targets: state.selectedTargets.slice(),
            targetIds: state.selectedTargets.slice(),
            targetId: state.selectedTargets[0] || null,
          });
          state.selectedTargets = [];
        });
        actions.appendChild(conf);
        addPass('取消');
        return;
      }
      if (pend.skillId === 'hujia' || pend.skillId === 'jijiang') {
        return;
      }
      if (pend.skillId === 'rende') {
        for (const name of ['杀', '桃', '酒']) {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = name;
          b.addEventListener('click', () => {
            net.sendAction('respond', { basicName: name });
          });
          actions.appendChild(b);
        }
        return;
      }
      if (pend.skillId === 'fanjian' && pend.step === 'suit') {
        showFanjianSuitModal(pend, net);
        return;
      }
      if (pend.skillId === 'liyu' && pend.step === 'juedou') {
        // 已由 isSeatTargetSkillEffect 接管
        return;
      }
      if (pend.skillId === 'luoyi' || pend.skillId === 'luoying') {
        const conf = document.createElement('button');
        conf.type = 'button';
        conf.textContent = pend.skillId === 'luoyi' ? '确认裸衣' : '获得这些牌';
        conf.addEventListener('click', () => {
          net.sendAction('respond', { pass: false });
        });
        actions.appendChild(conf);
        addPass(pend.skillId === 'luoyi' ? '放弃（放回牌堆）' : '放弃');
        return;
      }
      if (pend.skillId === 'luoshen') {
        for (const c of pend.shown || []) {
          cards.appendChild(makeSelectableCard(c, () => {}));
        }
        const again = document.createElement('button');
        again.type = 'button';
        again.textContent = '继续洛神';
        again.addEventListener('click', () => {
          net.sendAction('respond', { pass: false });
        });
        actions.appendChild(again);
        addPass('停止');
        return;
      }
      if (pend.skillId === 'jiushi') {
        const conf = document.createElement('button');
        conf.type = 'button';
        conf.textContent = '翻回正面';
        conf.addEventListener('click', () => {
          net.sendAction('respond', { pass: false });
        });
        actions.appendChild(conf);
        addPass('取消');
        return;
      }
      if (pend.skillId === 'zhiji') {
        const d = document.createElement('button');
        d.type = 'button';
        d.textContent = '摸 2 张';
        d.addEventListener('click', () => {
          net.sendAction('respond', { choice: 'draw' });
        });
        actions.appendChild(d);
        const h = document.createElement('button');
        h.type = 'button';
        h.textContent = '回 1 血';
        h.addEventListener('click', () => {
          net.sendAction('respond', { choice: 'heal' });
        });
        actions.appendChild(h);
        return;
      }
      if (pend.skillId === 'danlao' && (pend.options || []).length) {
        for (const opt of pend.options) {
          const id = typeof opt === 'string' ? opt : opt.id;
          const name =
            typeof opt === 'string' ? opt : opt.name || opt.label || id;
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = name;
          b.addEventListener('click', () => {
            net.sendAction('respond', { option: id, choice: id });
          });
          actions.appendChild(b);
        }
        addPass('取消');
        return;
      }
      // 鬼才/天香等已由下方手牌区接管
      if (pend.shown && pend.shown.length) {
        for (const c of pend.shown) {
          cards.appendChild(makeSelectableCard(c, () => {}));
        }
      }
      if (pend.cardOptions && pend.cardOptions.length) {
        if (getOwnHandPickMode(pend)) return;
        for (const c of pend.cardOptions) {
          cards.appendChild(
            makeSelectableCard(c, () => {
              net.sendAction('respond', {
                cardId: c.id,
                targetId: state.selectedTargets[0] || null,
                targetIds: state.selectedTargets.slice(),
              });
            })
          );
        }
      }
      // 通用：仅展示 shown 时提供确认（裸衣类兜底）
      if (
        (pend.shown || []).length &&
        !actions.childNodes.length &&
        !['luoyi', 'luoying', 'luoshen'].includes(pend.skillId)
      ) {
        const conf = document.createElement('button');
        conf.type = 'button';
        conf.textContent = '确认';
        conf.addEventListener('click', () => {
          net.sendAction('respond', { pass: false });
        });
        actions.appendChild(conf);
      }
      if (pend.canPass !== false) addPass('取消');
      return;
    }

    if (pend.type === 'feiyang' && pend.step === 'judge') {
      msg.textContent = pend.message;
      let pickedJudge = null;
      for (const c of pend.cardOptions || []) {
        const btn = makeSelectableCard(c, () => {
          pickedJudge = c.id;
          cards.querySelectorAll('.sgs-kapai').forEach((el) => {
            el.classList.remove('selected');
          });
          btn.classList.add('selected');
        });
        cards.appendChild(btn);
      }
      const conf = document.createElement('button');
      conf.type = 'button';
      conf.textContent = '弃置判定牌';
      conf.addEventListener('click', () => {
        net.sendAction('respond', {
          judgeId: pickedJudge,
        });
      });
      actions.appendChild(conf);
      return;
    }

    if (pend.type === 'rebel_compensate') {
      msg.textContent = pend.message;
      const d = document.createElement('button');
      d.type = 'button';
      d.textContent = '摸 2 张';
      d.addEventListener('click', () => {
        net.sendAction('respond', { choice: 'draw' });
      });
      actions.appendChild(d);
      const h = document.createElement('button');
      h.type = 'button';
      h.textContent = '回 1 血';
      h.addEventListener('click', () => {
        net.sendAction('respond', { choice: 'heal' });
      });
      actions.appendChild(h);
      return;
    }
  }

  function renderLog(game) {
    const ul = $('sgs-log');
    if (!ul) return;
    ul.innerHTML = '';
    for (const row of (game.log || []).slice().reverse()) {
      const li = document.createElement('li');
      li.textContent = row.text;
      ul.appendChild(li);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function bindButtons(net) {
    const play = $('btn-sgs-play');
    const recast = $('btn-sgs-recast');
    const end = $('btn-sgs-end-play');
    if (play) {
      play.onclick = () => {
        if (play.disabled) return;
        const game = state.game;
        const pend = game && game.pending;
        if (isActiveSkillSeatTargeting()) {
          const sk = state.pendingSkill;
          if (sk && sk.skillId === 'xuanhuo') {
            if (!hasValidXuanhuoSelection(game)) return;
            if (!(state.selectedTargets || []).length) return;
            net.sendAction('use_skill', {
              skillId: sk.skillId,
              cardId: state.selectedCardId,
              cardIds: [state.selectedCardId],
              targetId: state.selectedTargets[0],
              targetIds: state.selectedTargets.slice(),
            });
            state.pendingSkill = null;
            state.selectedCardId = null;
            state.selectedTargets = [];
            state.skillCardPick = [];
            state.allowMultiSelect = false;
            return;
          }
          if (!(state.selectedTargets || []).length) return;
          net.sendAction('use_skill', {
            skillId: sk.skillId,
            targetId: state.selectedTargets[0],
            targetIds: state.selectedTargets.slice(),
          });
          state.pendingSkill = null;
          state.selectedCardId = null;
          state.selectedTargets = [];
          state.skillCardPick = [];
          state.allowMultiSelect = false;
          return;
        }
        if (isMuniuSkillPending()) {
          if (!state.selectedCardId) return;
          net.sendAction('use_skill', {
            skillId: MUNIU_SKILL_ID,
            cardId: state.selectedCardId,
            cardIds: [state.selectedCardId],
          });
          state.pendingSkill = null;
          state.selectedCardId = null;
          state.selectedTargets = [];
          state.skillCardPick = [];
          state.allowMultiSelect = false;
          return;
        }
        if (isHandCardRespondPending(pend)) {
          const info = ensureHandRespondSelection(game);
          const mode = (info && info.mode) || getOwnHandPickMode(pend);
          const ids = (info && info.ids) || [];
          const multi = Boolean(mode && mode.max > 1);
          const picked = multi
            ? (state.skillCardPick || []).filter((id) => ids.includes(id))
            : state.selectedCardId && ids.includes(state.selectedCardId)
              ? [state.selectedCardId]
              : [];
          if (!mode || picked.length < (mode.min || 1)) return;
          if (mode.action === 'discard') {
            net.sendAction('respond', { cardIds: picked.slice() });
          } else {
            const opt = ((info && info.opts) || []).find(
              (o) => o.cardId === picked[0]
            );
            if (opt && opt.viewAs) {
              net.sendAction('view_as', {
                skillId: opt.viewAs.skillId,
                cardId: opt.cardId,
                to: opt.viewAs.to,
              });
            } else {
              net.sendAction('respond', {
                cardId: picked[0],
                cardIds: picked.slice(),
                pass: false,
              });
            }
          }
          state.selectedCardId = null;
          state.selectedTargets = [];
          state.skillCardPick = [];
          state.allowMultiSelect = false;
          return;
        }
        // 转化技确认：手牌 + 目标 → view_as
        if (state.pendingViewAs) {
          const pv = state.pendingViewAs;
          if (!(pv.usableCardIds || []).includes(state.selectedCardId)) return;
          const card = findSelectedCard(game || {});
          const guide = getCardPlayGuide(game || {}, card);
          if (!guide.canConfirm) return;
          net.sendAction('view_as', {
            skillId: pv.skillId,
            cardId: state.selectedCardId,
            to: pv.to,
            targets: state.selectedTargets.slice(),
          });
          state.pendingViewAs = null;
          state.selectedCardId = null;
          state.selectedTargets = [];
          state.skillCardPick = [];
          state.allowMultiSelect = false;
          return;
        }
        if (!state.selectedCardId) return;
        const card = findSelectedCard(game || {});
        const guide = getCardPlayGuide(game || {}, card);
        if (!guide.canConfirm) return;
        // 铁索：确认出牌必须带目标；无目标请用「重置」
        if (
          card &&
          card.name === '铁索连环' &&
          !(state.selectedTargets || []).length
        ) {
          return;
        }
        net.sendAction('play_card', {
          cardId: state.selectedCardId,
          targets: state.selectedTargets.slice(),
        });
        state.selectedCardId = null;
        state.selectedTargets = [];
        state.skillCardPick = [];
        state.allowMultiSelect = false;
      };
    }
    if (recast) {
      recast.onclick = () => {
        if (recast.disabled || recast.hidden) return;
        if (!state.selectedCardId) return;
        const card = findSelectedCard(state.game);
        if (!card || card.name !== '铁索连环') return;
        net.sendAction('play_card', {
          cardId: state.selectedCardId,
          targets: [],
          recast: true,
        });
        state.selectedCardId = null;
        state.selectedTargets = [];
        state.skillCardPick = [];
        state.allowMultiSelect = false;
      };
    }
    if (end) {
      end.onclick = () => {
        if (end.disabled) return;
        const game = state.game;
        const pend = game && game.pending;
        if (isActiveSkillSeatTargeting()) {
          state.pendingSkill = null;
          state.selectedCardId = null;
          state.selectedTargets = [];
          state.skillCardPick = [];
          state.allowMultiSelect = false;
          const hintEl = $('sgs-target-hint');
          if (hintEl) {
            hintEl.textContent = '';
            hintEl.classList.remove('is-warn');
          }
          render(game, net);
          return;
        }
        if (isMuniuSkillPending()) {
          state.pendingSkill = null;
          state.selectedCardId = null;
          state.selectedTargets = [];
          state.skillCardPick = [];
          state.allowMultiSelect = false;
          const hintEl = $('sgs-target-hint');
          if (hintEl) {
            hintEl.textContent = '';
            hintEl.classList.remove('is-warn');
          }
          render(game, net);
          return;
        }
        if (isHandCardRespondPending(pend)) {
          net.sendAction('respond', { pass: true });
          state.selectedCardId = null;
          state.selectedTargets = [];
          state.skillCardPick = [];
          state.allowMultiSelect = false;
          return;
        }
        const canEndPlay =
          game &&
          game.me &&
          (game.me.canEndPlay != null
            ? game.me.canEndPlay
            : game.me.isMyTurn &&
              game.turnPhase === 'play' &&
              !game.pending);
        if (!canEndPlay) return;
        net.sendAction('end_play', {});
        state.selectedCardId = null;
        state.selectedTargets = [];
      };
    }
  }

  function hide() {
    const panel = $('panel-sgs');
    if (panel) panel.hidden = true;
  }

  window.addEventListener('i18n:change', () => {
    if (window.I18n && window.I18n.applyDom) {
      window.I18n.applyDom(document.getElementById('panel-sgs'));
    }
  });

  return { render, bindButtons, hide };
})();
