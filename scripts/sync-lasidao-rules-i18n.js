'use strict';

const fs = require('fs');
const path = require('path');
const { ENVIRONMENT_CATALOG } = require('../server/games/lasidao/decks');

const ROOT = path.join(__dirname, '..');

function envCardHtml(def, lang) {
  const id = `env:${def.envType}`;
  const enLabels = {
    prisonersDilemma: 'Prisoner’s Dilemma',
    barrenHarvest: 'Barren Harvest',
    resistBarbarians: 'Resist Barbarians',
    clearSky: 'Clear Skies',
    enterFray: 'Enter the Fray',
    mercenaries: 'Mercenaries',
    oneMountain: 'One Mountain',
    luckyDraw: 'Lucky Draw',
    fishermanProfit: "Fisherman's Gain",
    firstCome: 'First Come',
    welfareMinimum: 'Welfare Minimum',
    recall: 'Recall',
    teleport: 'Teleport',
    keepOverflow: 'Bag It Home',
    weiQiRescueZhao: 'Besiege Wei to Rescue Zhao',
  };
  const label = lang === 'en' ? enLabels[def.envType] || def.label : def.label;
  let dd = def.desc;
  if (lang === 'en') {
    const enMap = {
      prisonersDilemma:
        'Setup: place 2 neutral dice on this slot. Settle: after cancel, fewest dice on this slot (ties / 0 allowed) each discard n resource cards (n = 1st place dice). After personal production (including wish well), before build.',
      barrenHarvest:
        'On event slot. Dispatch: when you become the slot leader, place the marker (first time counts; stacking more as leader does not retrigger). Move marker to any resource or function/building slot—marked slots yield nothing on settle.',
      resistBarbarians:
        'After produce resolve, before discard: players with ≥2 dice left gain +1 VP in rank order from 1st; reaching 15 VP ends the game immediately.',
      clearSky: 'Dispatch: dispatcher gains any 1 resource (once per dispatch, regardless of dice count).',
      enterFray:
        'Setup: 3 neutral dice on this slot. Dispatch: move 1 neutral from here to any number slot (cannot use if no neutrals here).',
      mercenaries:
        'Setup: 2 mercenary dice. After everyone placed dice, before produce resolve: sole 1st place rolls and places (ties skip); gain that slot\'s large share immediately; dispatch events on placement also trigger; then produce resolve.',
      oneMountain: 'Settle: 2nd place gets no small share; 1st place also takes the small share.',
      luckyDraw: 'Setup: face-down top card from merged deck beside slot. Settle: 1st place takes it.',
      fishermanProfit:
        'Dispatch: when you become slot leader (first time counts; stacking more as leader does not retrigger), gain any 2 resources (duplicates OK). Settle: 3rd place gains the sum of 1st and 2nd place resources from this slot.',
      firstCome:
        'Setup reward stash: 1 of each resource rounds 1–4, 2 rounds 5–8, 3 from round 9. Dispatch: when you place 2/4/6 villagers on this slot (by round band), gain one tier (once per player per event).',
      welfareMinimum:
        'On appear: lowest-score player(s) each pick any 2 resources (ties all apply; duplicates OK). Multiple copies resolve separately.',
      recall:
        'Dispatch: recall 1 of your dice from any board slot, including this slot (skip if none).',
      teleport:
        'Dispatch: when you become slot leader (first time counts; stacking more as leader does not retrigger), move 1 die (any player or neutral) from any slot to any slot with tiles; destination does not trigger dispatch events.',
      keepOverflow:
        'After settle cancel: 1st place on this slot skips resource discard for this round and picks any 2 resources.',
      weiQiRescueZhao:
        'Setup: if this event slot is odd, place 1 neutral on each even slot in resource and function/building areas; if even, place 1 on each odd slot. Dispatch: choose another slot with neutrals and move all neutrals here.',
    };
    dd = enMap[def.envType] || dd;
  }
  return `<dt data-las-card="${id}">${label}</dt><dd>${dd}</dd>`;
}

function buildEventHtml(lang) {
  const intro =
    lang === 'zh'
      ? '<p>每轮向资源区 4/5/6 号格各放 1 张；整堆 15 张每轮重洗，可重复出现。派遣触发在派到该格时立刻结算；另有生产判定前触发（全员放置完毕、获资源前）；结算触发在骰子抵消后结算。</p>'
      : '<p>Each round places 1 event on resource slots 4/5/6; the 15-card deck reshuffles every round. Dispatch triggers resolve on placement; pre-resolve triggers fire after all dice are placed and before resource gains; settle triggers resolve after cancel.</p>';
  const items = ENVIRONMENT_CATALOG.map((d) => envCardHtml(d, lang)).join('');
  return `${intro}<dl class="las-rules-dl">${items}</dl>`;
}

const zhFlow =
  '<p><strong>第一轮：</strong>投骰子决定先手。</p>' +
  '<p><strong>准备阶段：</strong>发牌到对应板块上（资源区每轮 <code>6+n</code> 张、合区 <code>2+n</code> 张，<code>n=轮次−1</code>；依次填入 1→6 号格并回绕）。</p>' +
  '<p><strong>生产阶段：</strong>由上一轮第一个完成生产的玩家开始：投骰子，放置同一点数的所有骰子或跳过，然后轮到下一位，循环直到所有玩家都用完骰子。</p>' +
  '<ul><li>跳过放置：可<strong>爆掉 1 枚骰子</strong>并任选获得 1 个资源；或<strong>支付 2 张资源</strong>跳过（不爆骰）。</li><li>骰子用完的玩家自动略过。</li></ul>' +
  '<p><strong>生产结算：</strong>同格同数量的骰子相互抵消下场，再按第一名、第二名分发资源/卡牌；雇佣军等「生产判定前」效果在全员放置完毕、正式结算前处理。</p>' +
  '<p><strong>弃牌与个人产出：</strong>先检查资源超上限并弃置 → 个人产出（已建成资源建筑自动产出 + 许愿井选资源；此步不检查资源上限）→ 囚徒困境等事件弃牌（若有）。</p>' +
  '<p><strong>建造阶段：</strong>由本轮第一个完成生产的玩家开始，可建造、发动功能卡、常驻功能或结束回合；全员完成后进入下一轮准备。</p>' +
  '<p><strong>卡牌弃牌：</strong>建造阶段结束后，若功能手牌或建筑格仍超上限则弃置。建筑格超上限时可弃置一张<strong>未建造</strong>的建筑收下新卡，或直接弃置刚获得的建筑；若均已建造则新获得的建筑直接入弃牌堆。</p>' +
  '<p>任意阶段，有玩家达到 <strong>10</strong> 分即立刻获胜并结束（抵抗南蛮等个别效果可使玩家达到 <strong>15</strong> 分并立刻结束）。</p>';

const enFlow =
  '<p><strong>Round 1:</strong> Roll dice to decide who goes first.</p>' +
  '<p><strong>Setup:</strong> Deal onto board slots (resource area <code>6+n</code>, merged area <code>2+n</code>, <code>n = round − 1</code>; fill slots 1→6 and wrap).</p>' +
  '<p><strong>Production:</strong> Starts with last round\'s first finisher. Roll, place all dice of one face or skip, then next player, until everyone has used all dice.</p>' +
  '<ul><li>Skip: <strong>burn 1 die</strong> and take any 1 resource; or <strong>pay 2 resources</strong> to skip without burning a die.</li><li>Players with no dice left are skipped automatically.</li></ul>' +
  '<p><strong>Production settle:</strong> Equal-count dice cancel and leave; award 1st/2nd shares. Pre-resolve effects (e.g. Mercenaries) happen after all dice are placed, before formal settle.</p>' +
  '<p><strong>Discard &amp; personal production:</strong> discard excess resources if needed → personal production (built resource buildings + wish well; no resource cap check) → event discards such as Prisoner\'s Dilemma if any.</p>' +
  '<p><strong>Build:</strong> First finisher this round starts; build, play function cards, permanent actions, or end turn; then next round setup.</p>' +
  '<p><strong>Card discard:</strong> after build, discard excess function/building cards if over cap.</p>' +
  '<p>At any time, reaching <strong>10</strong> VP wins immediately (some events such as Resist Barbarians can end the game at <strong>15</strong> VP).</p>';

const zhPermanent =
  '<p>建造阶段，每回合不限次数。开局每人 <strong>3 村民、2 间房子</strong>（每房容纳 2 村民），无初始资源。</p>' +
  '<dl class="las-rules-dl">' +
  '<dt>建造房子</dt><dd>支付 3 木 3 石 1 铁，房子 +1、+1 分。</dd>' +
  '<dt>繁殖村民</dt><dd>消耗 <strong>等于当前村民数</strong> 的小麦，村民 +1（上限 15）。需至少 1 个空位（空位 = 住房容量 − 村民数）。</dd>' +
  '<dt>购买功能卡</dt><dd>支付 3 小麦 2 铁：从功能/建筑合堆顶抽 3 张，选 1 保留；合堆不足 3 张时洗混弃牌堆合并后再抽。超出手牌/建筑上限须先弃置。</dd>' +
  '<dt>扩建</dt><dd>消耗 <strong>各 1 木 1 石 1 麦 1 铁</strong>（固定，不随次数增加）。三选一：建筑格 / 功能卡格 / 资源卡位（资源手牌上限 +4）。功能卡「免费扩建」效果相同但无资源消耗。</dd>' +
  '<dt>集市兑换</dt><dd>随时可用：默认银行 4:1；已建集市提升比例（1 座→3:1，2 座→2:1，≥3 座→1:1，最多按 3 座计）。</dd>' +
  '</dl>';

const enPermanent =
  '<p>Build phase, unlimited uses per round. Start with <strong>3 villagers, 2 houses</strong> (2 villagers per house), no resources.</p>' +
  '<dl class="las-rules-dl">' +
  '<dt>Build House</dt><dd>Pay 3W 3S 1I; +1 house and +1 VP.</dd>' +
  '<dt>Breed Villagers</dt><dd>Pay wheat = <strong>current villager count</strong>; +1 villager (max 15). Needs 1 free housing slot.</dd>' +
  '<dt>Buy Function Card</dt><dd>Pay 3 wheat 2 iron: draw 3 from merged deck top, keep 1; reshuffle discard into deck if fewer than 3. Discard if over hand/building cap.</dd>' +
  '<dt>Capacity</dt><dd>Cost <strong>1 each</strong> wood, stone, food &amp; iron (fixed). Pick one: building slot, function hand, or resource slot (+4 cap). Free Expand function card does the same for free.</dd>' +
  '<dt>Market trade</dt><dd>Anytime: default bank 4:1; Markets improve rate (1→3:1, 2→2:1, ≥3→1:1, counts at most 3).</dd>' +
  '</dl>';

const zhResource =
  '<p>资源板块共 4 种：木、石、小麦、铁。木/石/小麦各有丰/贫两档；铁矿仅贫档。</p>' +
  '<dl class="las-rules-dl">' +
  '<dt>丰</dt><dd>大份 3、小份 2。每轮个人产出阶段，已建成对应资源建筑自动产出 2 个该资源。</dd>' +
  '<dt>贫</dt><dd>大份 2、小份 1。每轮个人产出阶段，已建成对应资源建筑自动产出 1 个该资源。</dd>' +
  '<dt>铁矿·贫</dt><dd>大份 2、小份 1。资源建筑造价 1 木 1 石 1 铁，产出 1 铁。</dd>' +
  '</dl>';

const enResource =
  '<p>Resources come in four types: wood, stone, wheat, and iron. Wood/stone/wheat have rich/poor tiers; iron is only poor.</p>' +
  '<dl class="las-rules-dl">' +
  '<dt>Rich</dt><dd>Large share 3, small share 2. Built resource buildings auto-produce 2/round.</dd>' +
  '<dt>Poor</dt><dd>Large share 2, small share 1. Built resource buildings auto-produce 1/round.</dd>' +
  '<dt>Iron · Poor</dt><dd>Cost 1W 1S 1I, produces 1 iron/round.</dd>' +
  '</dl>';

const zhFunc =
  '<dl class="las-rules-dl">' +
  '<dt data-las-card="func:harvest">丰收（5）</dt><dd>建造阶段：任选获得 2 个资源（各 1）。</dd>' +
  '<dt data-las-card="func:remoteDice">遥控骰子（2）</dt><dd>生产阶段、轮到你时、投掷前：本回合可指定任意点数派遣。</dd>' +
  '<dt data-las-card="func:exile">驱逐（5）</dt><dd>生产阶段、轮到你时：驱逐目标玩家在某数字格的 1 名村民。</dd>' +
  '<dt data-las-card="func:enhance">强化（2）</dt><dd>建造阶段：强化 1 枚未强化过的骰子（最多 3 枚；达上限则无法发动）。强化骰结算时计为 2（普通骰计 1）。</dd>' +
  '<dt data-las-card="func:recruit">征召（5）</dt><dd>建造阶段：下一轮生产阶段临时村民 +2，可参与投骰与派遣；该生产阶段结束后消失。</dd>' +
  '<dt data-las-card="func:redraw">重抽（3）</dt><dd>建造阶段：从功能/建筑合堆顶抽 3 张，选 1 保留，其余弃入弃牌堆；合堆不足时洗混弃牌堆合并后再抽。保留后超出手牌上限须先弃置。</dd>' +
  '<dt data-las-card="func:banditRaid">强盗来袭（5）</dt><dd>生产阶段、轮到你时：在任意板块任意数字格放置 2 枚中立骰；参与抵消并占用名次，不领取收益。</dd>' +
  '<dt data-las-card="func:freeExpand">免费扩建（3）</dt><dd>建造阶段：立即扩建一格（建筑格 / 功能卡格 / 资源卡位），不消耗资源。</dd>' +
  '<dt data-las-card="func:welfareHouse">福利房（3）</dt><dd>建造阶段：获得 1 间免费房子（可繁殖村民，但不加分）。</dd>' +
  '<dt data-las-card="func:caravan">商队来临（2）</dt><dd>建造阶段：本回合结束前可按 2:1 兑换资源（已建集市则 1:1）。</dd>' +
  '<dt data-las-card="func:robbery">抢劫（5）</dt><dd>建造阶段：选择两名玩家（可为同一人），各从其手牌中随机夺取 1 张（资源 / 功能卡 / 未建建筑）。</dd>' +
  '</dl>';

const enFunc =
  '<dl class="las-rules-dl">' +
  '<dt data-las-card="func:harvest">Harvest (5)</dt><dd>Build: gain any 2 resources (1 each).</dd>' +
  '<dt data-las-card="func:remoteDice">Remote Dice (2)</dt><dd>Your produce turn, before rolling: choose any faces.</dd>' +
  '<dt data-las-card="func:exile">Exile (5)</dt><dd>Your produce turn: remove 1 villager of a target on a number slot.</dd>' +
  '<dt data-las-card="func:enhance">Enhance (2)</dt><dd>Build: enhance 1 unenhanced die (max 3). Counts as 2 in settle.</dd>' +
  '<dt data-las-card="func:recruit">Recruit (5)</dt><dd>Build: next produce +2 temp villagers; gone after that produce.</dd>' +
  '<dt data-las-card="func:redraw">Redraw (3)</dt><dd>Build: draw 3 from merged deck top, keep 1; reshuffle discard if needed. Discard if over hand cap after keeping.</dd>' +
  '<dt data-las-card="func:banditRaid">Bandit Raid (5)</dt><dd>Your produce turn: place 2 neutrals on any number slot.</dd>' +
  '<dt data-las-card="func:freeExpand">Free Expand (3)</dt><dd>Build: expand one slot immediately (building / function / resource), no cost.</dd>' +
  '<dt data-las-card="func:welfareHouse">Welfare House (3)</dt><dd>Build: gain 1 free house (breeding only, no VP).</dd>' +
  '<dt data-las-card="func:caravan">Caravan (2)</dt><dd>Build: until your turn ends, trade 2:1 (1:1 if you built a Market).</dd>' +
  '<dt data-las-card="func:robbery">Robbery (5)</dt><dd>Build: pick two players (can be the same); randomly steal 1 hand card from each.</dd>' +
  '</dl>';

const zhBuild =
  '<dl class="las-rules-dl">' +
  '<dt data-las-cards="build:wood:rich build:stone:rich build:food:rich">资源建筑·富（木/石/小麦各 2）</dt><dd>木：2 石 3 小麦 2 铁，每轮自动产出 2 木。石：2 木 3 小麦 2 铁，产出 2 石。小麦：3 木 3 石 1 铁，产出 2 小麦。</dd>' +
  '<dt data-las-cards="build:wood:poor build:stone:poor build:food:poor build:iron:poor">资源建筑·贫</dt><dd>木/石/小麦（各 3）：贫档造价见卡面，产出 1。铁（3）：1 木 1 石 1 铁，产出 1 铁。建成后每轮个人产出阶段自动产出，无需工人。</dd>' +
  '<dt data-las-card="build:score2">宫殿（+2）（4）</dt><dd>造价 3 木 3 石 3 小麦 2 铁。建成即 +2 分，无需工人。被弃置的宫殿不再计分。</dd>' +
  '<dt data-las-card="build:score1">学堂（+1）（3）</dt><dd>造价 1 木 1 石 1 小麦 1 铁。建成即 +1 分，无需工人。被弃置的学堂不再计分。</dd>' +
  '<dt data-las-card="build:exchange">集市（5）</dt><dd>造价 1 木 1 石 1 小麦。建成后提升兑换比例（默认银行 4:1，1 座→3:1，2 座→2:1，≥3 座→1:1）。相同建筑可叠放同一建筑格；兑换比例最多按 3 座计算。</dd>' +
  '<dt data-las-card="build:wishWell">许愿井（3）</dt><dd>造价 1 木 1 石 1 小麦 1 铁。每建成一座：个人产出阶段可选任意 1 种资源 +1（多座可叠或分配）。无需工人。</dd>' +
  '</dl>';

const enBuild =
  '<dl class="las-rules-dl">' +
  '<dt data-las-cards="build:wood:rich build:stone:rich build:food:rich">Resource building · Rich (×2 each)</dt><dd>Wood: 2S 3 wheat 2I → 2 wood/round. Stone: 2W 3 wheat 2I → 2 stone. Wheat: 3W 3S 1I → 2 wheat.</dd>' +
  '<dt data-las-cards="build:wood:poor build:stone:poor build:food:poor build:iron:poor">Resource building · Poor</dt><dd>Wood/Stone/Wheat×3: poor costs on card, produce 1. Iron×3: 1W 1S 1I → 1 iron. Auto-produce in personal production step.</dd>' +
  '<dt data-las-card="build:score2">Palace (+2) (4)</dt><dd>Cost 3W 3S 3 wheat 2I. +2 when built.</dd>' +
  '<dt data-las-card="build:score1">School (+1) (3)</dt><dd>Cost 1W 1S 1 wheat 1I. +1 when built.</dd>' +
  '<dt data-las-card="build:exchange">Market (5)</dt><dd>Cost 1W 1S 1 wheat. Trade rate: default 4:1, 1→3:1, 2→2:1, ≥3→1:1. Same-type buildings may stack; rate counts at most 3.</dd>' +
  '<dt data-las-card="build:wishWell">Wish Well (3)</dt><dd>Cost 1W 1S 1 wheat 1I. Personal production: +1 any resource per well.</dd>' +
  '</dl>';

function apply(lang, flow, permanent, func, build, resource) {
  const p = path.join(ROOT, 'public/i18n', `${lang}.json`);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.lasidao.rules.flowHtml = flow;
  j.lasidao.rules.permanentHtml = permanent;
  j.lasidao.rules.funcHtml = func;
  j.lasidao.rules.buildHtml = build;
  j.lasidao.rules.resourceHtml = resource;
  j.lasidao.rules.eventHtml = buildEventHtml(lang);
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  console.log('updated', lang);
}

apply('zh', zhFlow, zhPermanent, zhFunc, zhBuild, zhResource);
apply('en', enFlow, enPermanent, enFunc, enBuild, enResource);
