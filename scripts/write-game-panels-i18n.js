'use strict';
const fs = require('fs');

const lasPanel = `<!-- Lasidao panel -->
<div class="panel game-panel lasidao-panel" id="panel-lasidao" hidden>
  <h2 data-i18n="lasidao.title">拉斯岛</h2>
  <p id="las-round" class="game-status"></p>
  <p id="las-status" class="muted"></p>
  <div id="las-settle-banner" class="las-settle-banner" hidden></div>
  <div id="las-fx-layer" class="las-fx-layer" aria-hidden="true"></div>
  <div id="las-card-tip" class="las-card-tip" hidden></div>

  <div class="las-meta row">
    <span id="las-deck-meta"></span>
  </div>

  <div class="las-boards">
    <section class="las-board-section las-board-section-resource">
      <h3 class="game-sub" data-i18n="lasidao.areaResource">资源板块</h3>
      <div id="las-board-resource" class="las-board" data-area="resource"></div>
    </section>
    <section class="las-board-section las-board-section-function">
      <h3 class="game-sub" data-i18n="lasidao.areaFunction">功能板块</h3>
      <div id="las-board-function" class="las-board" data-area="function"></div>
    </section>
    <section class="las-board-section las-board-section-building">
      <h3 class="game-sub" data-i18n="lasidao.areaBuilding">建筑板块</h3>
      <div id="las-board-building" class="las-board" data-area="building"></div>
    </section>
  </div>

  <div id="las-dice-wrap" class="las-dice-wrap" hidden>
    <h3 class="game-sub" data-i18n="lasidao.yourDice">你的骰子</h3>
    <div id="las-dice-stage" class="las-dice-stage">
      <div id="las-dice" class="las-dice"></div>
      <div id="las-dice-groups" class="las-dice-groups" hidden></div>
    </div>
    <p id="las-dice-hint" class="muted las-hint"></p>
    <div id="las-dispatch-preview" class="las-dispatch-preview" hidden></div>
    <div class="row las-actions" id="las-produce-actions">
      <button id="btn-las-confirm" type="button" hidden data-i18n="lasidao.confirmDispatch">确认派遣</button>
      <button id="btn-las-void" type="button" class="secondary" data-i18n="lasidao.voidDispatch">放弃派遣（丢弃1资源）</button>
      <div id="las-void-picker" class="row las-void-picker" hidden>
        <span class="muted" data-i18n="lasidao.voidPickLabel">丢弃资源以跳过：</span>
        <button type="button" data-res="wood" data-i18n="lasidao.res.wood">木</button>
        <button type="button" data-res="stone" data-i18n="lasidao.res.stone">石</button>
        <button type="button" data-res="food" data-i18n="lasidao.res.food">食</button>
        <button type="button" data-res="iron" data-i18n="lasidao.res.iron">铁</button>
        <button type="button" class="secondary" id="btn-las-void-cancel" data-i18n="lasidao.cancel">取消</button>
      </div>
    </div>
  </div>

  <div id="las-init-wrap" class="las-init-wrap" hidden>
    <div id="las-init-dice" class="las-dice las-init-dice" hidden></div>
    <div class="row las-actions">
      <button id="btn-las-init-roll" type="button" data-i18n="lasidao.initRoll">投骰比大小（先手）</button>
    </div>
  </div>

  <div id="las-phase-actions" class="row las-actions" hidden>
    <button id="btn-las-pass" type="button" class="secondary" data-i18n="lasidao.pass">跳过 / 结束行动</button>
  </div>

  <h3 class="game-sub" data-i18n="lasidao.myHand">我的资源与手牌</h3>
  <div id="las-me-res" class="las-res"></div>
  <div id="las-me-funcs" class="las-cards"></div>
  <div id="las-me-builds" class="las-cards"></div>

  <div id="las-func-panel" class="las-func-panel" hidden>
    <h3 class="game-sub" data-i18n="lasidao.useFunc">发动功能</h3>
    <div id="las-func-form"></div>
  </div>

  <div id="las-exchange-wrap" class="las-exchange" hidden>
    <h3 class="game-sub" data-i18n="lasidao.exchange">交易所</h3>
    <div class="row">
      <select id="las-ex-from"></select>
      <span>→</span>
      <select id="las-ex-to"></select>
      <button id="btn-las-exchange" type="button" data-i18n="lasidao.exchangeBtn">兑换（2换1）</button>
    </div>
  </div>

  <h3 class="game-sub" data-i18n="lasidao.players">玩家</h3>
  <ul id="las-players" class="member-list"></ul>

  <h3 class="game-sub" data-i18n="lasidao.log">动态</h3>
  <ul id="las-log" class="game-log"></ul>
</div>
`;
fs.writeFileSync('public/games/lasidao/panel.html', lasPanel, 'utf8');

// Patch sgs panel static strings with data-i18n via replace on existing file
let sgs = fs.readFileSync('public/games/sgs/panel.html', 'utf8');
const sgsReps = [
  ['<h2>三国杀 · <span id="sgs-mode-label">标准身份</span></h2>', '<h2><span data-i18n="sgs.title">三国杀</span> · <span id="sgs-mode-label" data-i18n="sgs.modeIdentity">标准身份</span></h2>'],
  ['<h3>选择武将</h3>', '<h3 data-i18n="sgs.pickGeneral">选择武将</h3>'],
  ['title="抽牌堆"', 'data-i18n-attr="title:sgs.drawPile" title="抽牌堆"'],
  ['title="弃牌堆"', 'data-i18n-attr="title:sgs.discardPile" title="弃牌堆"'],
  ['抽牌堆 <span id="sgs-draw">0</span>', '<span data-i18n="sgs.drawPile">抽牌堆</span> <span id="sgs-draw">0</span>'],
  ['弃牌堆 <span id="sgs-discard">0</span>', '<span data-i18n="sgs.discardPile">弃牌堆</span> <span id="sgs-discard">0</span>'],
  ['>确认出牌</button>', ' data-i18n="sgs.confirmPlay">确认出牌</button>'],
  ['>重置</button>', ' data-i18n="sgs.reset">重置</button>'],
  ['>结束出牌</button>', ' data-i18n="sgs.endPlay">结束出牌</button>'],
];
for (const [a, b] of sgsReps) {
  if (sgs.includes(a)) sgs = sgs.split(a).join(b);
  else console.log('sgs miss', a.slice(0, 40));
}
fs.writeFileSync('public/games/sgs/panel.html', sgs, 'utf8');
console.log('panels written');
