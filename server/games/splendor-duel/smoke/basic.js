'use strict';

/**
 * 璀璨宝石·对决 冒烟测试
 * 1) 官方牌表核对（67 张珠宝卡 + 4 张皇室卡）
 * 2) 开局设置（25 标记、2 珍珠、3 金、金字塔 5/4/3）
 * 3) 买卡必须真实扣费（回归：曾经付款字段传错导致不扣宝石）
 * 4) 随机自动对局若干局：不崩溃、不死局、标记守恒
 */
const assert = require('assert');
const {
  createGameState,
  applyAction,
  publicGameState,
  getActingPlayerIds,
  forceTimeout,
  _cards,
} = require('../engine');

const RESOURCES = ['emerald', 'sapphire', 'ruby', 'diamond', 'onyx'];
const ALL = [...RESOURCES, 'pearl'];
const GOLD = 'gold';

function room(n) {
  const players = [];
  for (let i = 0; i < n; i++) players.push({ id: `p${i}`, name: `玩家${i}`, tag: null });
  return { players };
}

function ok(r, msg) {
  assert.ok(r && r.ok, msg || (r && r.error) || 'action failed');
  return r;
}

function bonusOf(p) {
  const b = {};
  for (const c of p.cards) {
    const d = c.discount === 'associate' ? c.assocColor : c.discount;
    if (d) b[d] = (b[d] || 0) + 1;
  }
  return b;
}

/* ---------------- 1) 牌表核对 ---------------- */
function testCardList() {
  const { TIER1, TIER2, TIER3, ROYALS } = _cards;
  assert.strictEqual(TIER1.length, 30, 'L1 应为 30 张');
  assert.strictEqual(TIER2.length, 24, 'L2 应为 24 张');
  assert.strictEqual(TIER3.length, 13, 'L3 应为 13 张');
  assert.strictEqual(ROYALS.length, 4, '皇室卡应为 4 张');

  const ids = new Set();
  for (const c of [...TIER1, ...TIER2, ...TIER3]) {
    assert.ok(!ids.has(c.id), `卡牌 id 重复：${c.id}`);
    ids.add(c.id);
    assert.ok(c.tier >= 1 && c.tier <= 3, '等级非法');
    for (const col of Object.keys(c.cost)) {
      assert.ok(ALL.includes(col), `费用颜色非法：${col}`);
    }
    if (c.discount) assert.ok(RESOURCES.includes(c.discount) || c.discount === 'associate', `红利非法：${c.discount}`);
    if (c.ability) {
      assert.ok(['extra_turn', 'take_gem', 'steal_gem', 'gain_privilege'].includes(c.ability), `能力非法：${c.ability}`);
    }
  }

  // 官方总声望 / 总皇冠
  const all = [...TIER1, ...TIER2, ...TIER3];
  const crowns = all.reduce((s, c) => s + c.crowns, 0);
  const prestige = all.reduce((s, c) => s + c.prestige, 0) + ROYALS.reduce((s, c) => s + c.prestige, 0);
  assert.strictEqual(crowns, 28, `皇冠总数应为 28，实际 ${crowns}`);
  assert.strictEqual(prestige, 101, `声望总数应为 101，实际 ${prestige}`);
  console.log('  牌表核对通过：30/24/13 + 4，皇冠 28、声望 101');
}

/* ---------------- 2) 开局设置 ---------------- */
function testSetup() {
  const g = createGameState(room(2));
  const board = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (g.board[r][c]) board.push(g.board[r][c]);

  assert.strictEqual(board.length, 25, '开场版图应有 25 个标记');
  assert.strictEqual(g.bag.length, 0, '开场抽袋应为空');
  for (const col of RESOURCES) {
    assert.strictEqual(board.filter((x) => x === col).length, 4, `${col} 应为 4 个`);
  }
  assert.strictEqual(board.filter((x) => x === 'pearl').length, 2, '珍珠应为 2 个');
  assert.strictEqual(board.filter((x) => x === GOLD).length, 3, '黄金应为 3 个');

  assert.strictEqual(g.boardCards.tier1.length, 5, 'L1 应翻 5 张');
  assert.strictEqual(g.boardCards.tier2.length, 4, 'L2 应翻 4 张');
  assert.strictEqual(g.boardCards.tier3.length, 3, 'L3 应翻 3 张');
  assert.strictEqual(g.decks.tier1.length, 25, 'L1 牌库应剩 25 张');
  assert.strictEqual(g.decks.tier2.length, 20, 'L2 牌库应剩 20 张');
  assert.strictEqual(g.decks.tier3.length, 10, 'L3 牌库应剩 10 张');
  assert.strictEqual(g.availablePrivileges, 2, '中央应剩 2 个特权');
  const withPriv = g.turnOrder.filter((id) => g.playerData[id].privileges === 1);
  assert.strictEqual(withPriv.length, 1, '后手应持有 1 个特权');
  console.log('  开局设置通过：25 标记（4×5 + 珍珠2 + 金3），金字塔 5/4/3');
}

/* ---------------- 3) 买卡必须真实扣费 ---------------- */
function testPayment() {
  // 手动塞入足够宝石，买下 L1 场上第一张「无能力、非合伙人」卡
  // 排除两类会干扰计数的情况：
  //   - 合伙人卡：要求先拥有一张带红利的卡，否则规则上不允许购买
  //   - take_gem：购买后立刻从版图拿回 1 个同色宝石，会让「净扣数」少 1
  // 极少数开局 5 张 L1 全带能力/都是合伙人，重开一局即可
  let g = null;
  let idx = -1;
  for (let attempt = 0; attempt < 50 && idx < 0; attempt++) {
    g = createGameState(room(2));
    idx = g.boardCards.tier1.findIndex((c) => c.discount !== 'associate' && !c.ability);
  }
  assert.ok(idx >= 0, 'L1 场上应至少有一张无能力的普通卡');
  const pid = g.currentPlayerId;
  const p = g.playerData[pid];
  const card = g.boardCards.tier1[idx];
  for (const col of ALL) p.tokens[col] = (card.cost[col] || 0) + 2;
  const before = { ...p.tokens };

  ok(applyAction(g, pid, { type: 'buy_card', payload: { tier: 1, idx } }), '买卡应成功');

  let spent = 0;
  for (const col of ALL) spent += before[col] - p.tokens[col];
  const expected = Object.values(card.cost).reduce((s, v) => s + v, 0);
  assert.strictEqual(spent, expected, `应扣 ${expected} 个标记，实际扣 ${spent} 个`);
  assert.ok(p.cards.some((c) => c.id === card.id), '买入的卡应进入已购区');
  console.log('  付款回归通过：买卡真实扣除 ' + spent + ' 个标记');
}

/* ---------------- 3b) 合伙人卡：无红利时禁止，有红利时触发选色 ---------------- */
function testAssociate() {
  const g = createGameState(room(2));
  const pid = g.currentPlayerId;
  const p = g.playerData[pid];
  const aIdx = g.boardCards.tier1.findIndex((c) => c.discount === 'associate');
  if (aIdx < 0) { console.log('  合伙人用例跳过：本局 L1 场上无合伙人卡'); return; }

  // a) 手上没有任何红利卡 —— 规则上不能买
  for (const col of ALL) p.tokens[col] = 9;
  const bad = applyAction(g, pid, { type: 'buy_card', payload: { tier: 1, idx: aIdx } });
  assert.strictEqual(bad.ok, false, '无红利时不应允许购买合伙人卡');

  // b) 直接塞一张带红利的卡（不改回合），再买合伙人卡 —— 应进入选色抉择
  p.cards.push({ id: '__test_bonus', tier: 1, discount: 'emerald', cost: {}, prestige: 0, crowns: 0, ability: null, assocColor: null });
  assert.ok(Object.keys(bonusOf(p)).length > 0, '塞入普通卡后应拥有红利');

  const aIdx2 = g.boardCards.tier1.findIndex((c) => c.discount === 'associate');
  if (aIdx2 < 0) { console.log('  合伙人用例跳过：补牌后无合伙人卡'); return; }
  const assoc = g.boardCards.tier1[aIdx2];
  for (const col of ALL) p.tokens[col] = (assoc.cost[col] || 0) + 9;
  ok(applyAction(g, pid, { type: 'buy_card', payload: { tier: 1, idx: aIdx2 } }), '有红利后购买合伙人卡应成功');
  const pend = (g.pending || []).find((x) => x.type === 'associate_color');
  assert.ok(pend, '购买合伙人卡后应进入选色抉择');
  {
    // 选色范围 = 手里除该合伙人卡之外已有的红利颜色
    const allowed = Object.keys(bonusOf({
      cards: p.cards.filter((c) => c.id !== pend.cardId),
    }));
    assert.ok(allowed.length > 0, '选色列表不应为空');
    const opt = allowed[0];
    ok(applyAction(g, pid, { type: 'resolve', payload: { color: opt } }), '合伙人选色应可结算');
    const bought = p.cards.find((c) => c.id === assoc.id);
    assert.strictEqual(bought.assocColor, opt, '合伙人卡的红利颜色应被记录');
    console.log('  合伙人卡通过：无红利时禁止购买，有红利时触发选色并生效');
  }
}

/* ---------------- 4) 随机自动对局 ---------------- */
function countTokens(g) {
  const tally = {};
  for (const col of ALL.concat([GOLD])) tally[col] = 0;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (g.board[r][c]) tally[g.board[r][c]]++;
  for (const id of g.turnOrder) for (const col of ALL.concat([GOLD])) tally[col] += g.playerData[id].tokens[col] || 0;
  for (const col of g.bag) tally[col]++;
  return tally;
}

function findTakeCells(g) {
  // 找一条 1~3 个相邻非金标记
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (g.board[r][c] && g.board[r][c] !== GOLD) {
        if (c + 2 < 5 && g.board[r][c + 1] && g.board[r][c + 1] !== GOLD && g.board[r][c + 2] && g.board[r][c + 2] !== GOLD) {
          return [[r, c], [r, c + 1], [r, c + 2]];
        }
        return [[r, c]];
      }
    }
  }
  return null;
}

/** 红利计数（合伙人卡按其已选颜色计） */
function bonusMap(p) {
  const b = {};
  for (const c of p.cards) {
    const d = c.discount === 'associate' ? c.assocColor : c.discount;
    if (d) b[d] = (b[d] || 0) + 1;
  }
  return b;
}

/**
 * 选一张「最容易凑齐」的目标卡，返回还缺的颜色及数量。
 * 机器人靠它决定取哪种宝石、弃哪些宝石，否则会出现
 * 「手里 2/2/2/2/2 但场上只卖 4 同色卡」的死循环。
 */
function targetCard(g, pid) {
  const p = g.playerData[pid];
  const bonuses = bonusMap(p);
  let best = null;
  let bestKey = null;
  for (const tier of [1, 2, 3]) {
    (g.boardCards['tier' + tier] || []).forEach((card, idx) => {
      if (card.discount === 'associate' && !p.cards.some((c) => c.discount)) return;
      const need = {};
      let gap = 0;
      let kinds = 0;
      for (const col of ALL) {
        const n = Math.max(0, (card.cost[col] || 0) - (bonuses[col] || 0) - (p.tokens[col] || 0));
        if (n > 0) { need[col] = n; gap += n; kinds++; }
      }
      if (gap === 0) return; // 已经买得起，交给 affordable 处理
      const key = [gap, kinds, tier];
      if (!best || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) { best = { tier, idx, card, need }; bestKey = key; }
    });
  }
  return best;
}

/**
 * 决定这一轮要「攒」哪些颜色：
 *   - 优先目标卡还缺的颜色；
 *   - 场上没有需要的颜色时，改为囤积手里已有的最大堆（往单色大卡靠拢）。
 * 返回 want（颜色→还想要几个）与要拿的格子。
 */
function planTake(g, pid) {
  const p = g.playerData[pid];
  const tgt = targetCard(g, pid);
  const want = tgt ? { ...tgt.need } : {};
  const avail = {};
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    const v = g.board[r][c];
    if (v && v !== GOLD) avail[v] = (avail[v] || 0) + 1;
  }
  if (!Object.keys(want).some((col) => avail[col])) {
    const pool = Object.keys(avail).sort((a, b) => (p.tokens[b] || 0) - (p.tokens[a] || 0));
    if (pool.length) want[pool[0]] = (want[pool[0]] || 0) + 1;
  }
  return { want, cells: takeCellsFor(g, want) };
}

/** 优先取目标卡还缺的颜色；同一行能连取就连取，最多 3 个 */
function takeCellsFor(g, need) {
  const cellsOf = (pred) => {
    const out = [];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      const v = g.board[r][c];
      if (v && v !== GOLD && pred(v)) out.push([r, c]);
    }
    return out;
  };
  const wanted = need ? cellsOf((v) => (need[v] || 0) > 0) : [];
  const pool = wanted.length ? wanted : cellsOf(() => true);
  if (!pool.length) return null;

  const has = (r, c) => pool.some(([a, b]) => a === r && b === c);
  const maxTake = need ? Math.max(1, Math.min(3, Object.values(need).reduce((s, v) => s + v, 0))) : 3;
  for (let n = Math.min(3, maxTake); n >= 2; n--) {
    for (const [r, c] of pool) {
      if (c + n - 1 > 4) continue;
      const line = [];
      for (let k = 0; k < n; k++) {
        if (!has(r, c + k)) { line.length = 0; break; }
        line.push([r, c + k]);
      }
      if (line.length === n) return line;
    }
  }
  return [pool[0]];
}

function affordable(g, pid) {
  const p = g.playerData[pid];
  const cands = [];
  for (const tier of [1, 2, 3]) {
    const key = 'tier' + tier;
    (g.boardCards[key] || []).forEach((card, i) => {
      if (card.discount === 'associate' && !p.cards.some((c) => c.discount)) return;
      cands.push({ type: 'board', tier, idx: i, card });
    });
  }
  (p.reserved || []).forEach((card, i) => {
    if (card.discount === 'associate' && !p.cards.some((c) => c.discount)) return; // 无红利时合伙人卡不能买
    cands.push({ type: 'reserve', reserveIdx: i, card });
  });
  // 简单判定：红利抵扣后，宝石+金是否够
  const bonuses = {};
  for (const c of p.cards) {
    const d = c.discount === 'associate' ? c.assocColor : c.discount;
    if (d) bonuses[d] = (bonuses[d] || 0) + 1;
  }
  const okList = cands.filter(({ card }) => {
    let gold = 0;
    for (const col of ALL) {
      const need = (card.cost[col] || 0) - (bonuses[col] || 0);
      if (need > 0) gold += need - Math.min(need, p.tokens[col] || 0);
    }
    return gold <= (p.tokens[GOLD] || 0);
  });
  okList.sort((a, b) => (b.card.prestige || 0) - (a.card.prestige || 0));
  return okList[0] || null;
}

function autoPlay(idx) {
  const g = createGameState(room(2));
  let steps = 0;
  while (!g.over && steps++ < 4000) {
    const ids = getActingPlayerIds(g);
    assert.ok(ids.length === 1, '应有且仅有一个行动者');
    const pid = ids[0];

    if (g.pending.length > 0) {
      const pend = g.pending[0];
      const payload = {};
      if (pend.type === 'royal') {
        const roy = g.royalties.find((r) => !r.claimedBy);
        payload.royalId = roy ? roy.id : 'royal-04';
      } else if (pend.type === 'associate_color') {
        const p = g.playerData[pid];
        const counts = {};
        for (const c of p.cards) {
          const d = c.discount === 'associate' ? c.assocColor : c.discount;
          if (d && c.id !== pend.cardId) counts[d] = (counts[d] || 0) + 1;
        }
        payload.color = Object.keys(counts)[0];
      } else if (pend.type === 'steal_gem') {
        payload.color = pend.options[0];
      }
      const r = applyAction(g, pid, { type: 'resolve', payload });
      assert.ok(r.ok, `第${idx}局抉择失败：${r.error} (${pend.type})`);
      continue;
    }

    if (g.phase === 'discard') {
      // 绝不弃「正在攒」的颜色，否则手牌被摊平成 2/2/2/2/2，永远凑不出单色大卡
      const p = g.playerData[pid];
      const needAll = g.discardNeed;
      const want = planTake(g, pid).want;
      const tokens = {};
      let left = needAll;
      const take = (col, n) => { if (n > 0) { tokens[col] = (tokens[col] || 0) + n; left -= n; } };
      // 1) 先弃不在攒的颜色（数量多的优先）
      const junk = ALL.concat([GOLD]).filter((col) => !(want[col] > 0)).sort((a, b) => (p.tokens[b] || 0) - (p.tokens[a] || 0));
      for (const col of junk) { if (left <= 0) break; take(col, Math.min(p.tokens[col] || 0, left)); }
      // 2) 还不够：弃在攒的颜色里超出需求的部分
      const keep = ALL.concat([GOLD]).filter((col) => want[col] > 0).sort((a, b) => ((p.tokens[b] || 0) - want[b]) - ((p.tokens[a] || 0) - want[a]));
      for (const col of keep) { if (left <= 0) break; take(col, Math.min(Math.max(0, (p.tokens[col] || 0) - want[col]), left)); }
      // 3) 兜底：按数量最多的弃
      if (left > 0) {
        const rest = ALL.concat([GOLD]).slice().sort((a, b) => (p.tokens[b] || 0) - (p.tokens[a] || 0));
        for (const col of rest) { if (left <= 0) break; take(col, Math.min((p.tokens[col] || 0) - (tokens[col] || 0), left)); }
      }
      ok(applyAction(g, pid, { type: 'discard_tokens', payload: { tokens } }), '弃标记应成功');
      continue;
    }

    // 可选行动：偶尔用特权 / 补充版图
    if (!g.optReplenishDone && g.bag.length > 0 && Math.random() < 0.08) {
      ok(applyAction(g, pid, { type: 'replenish', payload: {} }));
      continue;
    }
    const p = g.playerData[pid];
    if (!g.optPrivilegeDone && p.privileges > 0 && Math.random() < 0.25) {
      const cells = [];
      for (let r = 0; r < 5 && cells.length < 1; r++) {
        for (let c = 0; c < 5 && cells.length < 1; c++) {
          if (g.board[r][c] && g.board[r][c] !== GOLD) cells.push([r, c]);
        }
      }
      if (cells.length) {
        const r = applyAction(g, pid, { type: 'use_privilege', payload: { count: 1, tokens: cells } });
        assert.ok(r.ok, `特权失败：${r.error}`);
        continue;
      }
    }

    // 差 1~2 个宝石且手里没金：优先预留拿金（金可抵任意宝石），避免「取了又弃」原地打转
    const tgt = targetCard(g, pid);
    const gap = tgt ? Object.values(tgt.need).reduce((s, v) => s + v, 0) : 99;
    if (gap >= 1 && gap <= 2 && (p.tokens[GOLD] || 0) === 0 && p.reserved.length < 3) {
      let reserved = false;
      for (const tier of [1, 2, 3]) {
        const arr = g.boardCards['tier' + tier] || [];
        if (!arr.length) continue;
        const r = applyAction(g, pid, { type: 'reserve_card', payload: { tier, idx: 0 } });
        if (r.ok) { reserved = true; break; }
      }
      if (reserved) continue;
    }

    // 强制行动
    const buy = Math.random() < 0.75 ? affordable(g, pid) : null;
    if (buy) {
      const payload = buy.type === 'board' ? { tier: buy.tier, idx: buy.idx } : { fromReserve: true, reserveIdx: buy.reserveIdx };
      const r = applyAction(g, pid, { type: 'buy_card', payload });
      assert.ok(r.ok, `第${idx}局买卡失败：${r.error}`);
      continue;
    }
    const cells = planTake(g, pid).cells;
    if (cells) {
      ok(applyAction(g, pid, { type: 'take_tokens', payload: { cells } }), '拿标记应成功');
      continue;
    }
    if (g.bag.length > 0) {
      ok(applyAction(g, pid, { type: 'replenish', payload: {} }), '补充版图应成功');
      continue;
    }
    // 预留：拿 1 金 + 预留一张卡
    if (p.reserved.length < 3 && Math.random() < 0.6) {
      for (const tier of [3, 2, 1]) {
        const arr = g.boardCards['tier' + tier] || [];
        if (arr.length) {
          const r = applyAction(g, pid, { type: 'reserve_card', payload: { tier, idx: 0 } });
          if (r.ok) break;
          if (g.decks['tier' + tier].length) {
            const r2 = applyAction(g, pid, { type: 'reserve_card', payload: { tier, fromDeck: true } });
            if (r2.ok) break;
          }
        }
      }
      continue;
    }
    const r = applyAction(g, pid, { type: 'pass', payload: {} });
    assert.ok(r.ok, `跳过失败：${r.error}`);
  }

  const tally = countTokens(g);
  for (const col of RESOURCES) assert.strictEqual(tally[col], 4, `${col} 标记总数应守恒为 4，实际 ${tally[col]}`);
  assert.strictEqual(tally.pearl, 2, `珍珠应守恒为 2，实际 ${tally.pearl}`);
  assert.strictEqual(tally[GOLD], 3, `黄金应守恒为 3，实际 ${tally[GOLD]}`);
  return { steps, over: g.over, winner: g.winnerId, cond: g.winCondition, state: g };
}

function testAutoPlay() {
  let finished = 0;
  const total = 40;
  for (let i = 0; i < total; i++) {
    const res = autoPlay(i);
    if (res.over) finished++;
  }
  assert.ok(finished === total, `40 局应全部分出胜负，实际 ${finished} 局`);
  console.log(`  随机对局通过：${total} 局全部正常结束，无异常、无死局（标记守恒已校验）`);
}

/* ---------------- 运行 ---------------- */
testCardList();
testSetup();
testPayment();
testAssociate();
testAutoPlay();
console.log('璀璨宝石·对决 冒烟测试全部通过');
