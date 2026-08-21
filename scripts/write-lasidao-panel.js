'use strict';
const fs = require('fs');
const zh = JSON.parse(fs.readFileSync('public/i18n/zh.json', 'utf8')).lasidao;
const out = `<!-- Lasidao panel -->
<div class="panel game-panel lasidao-panel" id="panel-lasidao" hidden>
  <h2 data-i18n="lasidao.title">${zh.title}</h2>
  <p id="las-round" class="game-status"></p>
  <p id="las-status" class="muted"></p>
  <div id="las-settle-banner" class="las-settle-banner" hidden></div>
  <div id="las-fx-layer" class="las-fx-layer" aria-hidden="true"></div>
  <div id="las-card-tip" class="las-card-tip" hidden></div>

  <div class="las-table">
    <div class="las-table-top">
      <aside class="las-decks" id="las-decks" aria-label="decks">
        <div class="las-deck-pile las-deck-pile-resource" data-deck="resource">
          <div class="las-deck-stack" id="las-deck-stack-resource"></div>
          <div class="las-deck-info">
            <span class="las-deck-name" data-i18n="lasidao.area.resource">${zh.area.resource}</span>
            <span class="las-deck-counts"><span id="las-deck-res">0</span>/<span id="las-discard-res">0</span></span>
          </div>
        </div>
        <div class="las-deck-pile las-deck-pile-function" data-deck="function">
          <div class="las-deck-stack" id="las-deck-stack-function"></div>
          <div class="las-deck-info">
            <span class="las-deck-name" data-i18n="lasidao.area.function">${zh.area.function}</span>
            <span class="las-deck-counts"><span id="las-deck-fn">0</span>/<span id="las-discard-fn">0</span></span>
          </div>
        </div>
        <div class="las-deck-pile las-deck-pile-building" data-deck="building">
          <div class="las-deck-stack" id="las-deck-stack-building"></div>
          <div class="las-deck-info">
            <span class="las-deck-name" data-i18n="lasidao.area.building">${zh.area.building}</span>
            <span class="las-deck-counts"><span id="las-deck-bld">0</span>/<span id="las-discard-bld">0</span></span>
          </div>
        </div>
        <p class="las-deck-hint muted" data-i18n="lasidao.deckHint">抽/弃</p>
      </aside>

      <section class="las-board-section las-board-section-resource">
        <h3 class="game-sub" data-i18n="lasidao.areaResource">${zh.areaResource}</h3>
        <div id="las-board-resource" class="las-board las-board-resource" data-area="resource"></div>
      </section>
    </div>

    <div class="las-table-bottom">
      <section class="las-board-section las-board-section-function">
        <h3 class="game-sub" data-i18n="lasidao.areaFunction">${zh.areaFunction}</h3>
        <div id="las-board-function" class="las-board las-board-function" data-area="function"></div>
      </section>
      <section class="las-board-section las-board-section-building">
        <h3 class="game-sub" data-i18n="lasidao.areaBuilding">${zh.areaBuilding}</h3>
        <div id="las-board-building" class="las-board las-board-building" data-area="building"></div>
      </section>
    </div>
  </div>

  <div id="las-roll-wrap" class="las-roll-wrap" hidden>
    <div class="row las-actions">
      <button id="btn-las-produce-roll" type="button" data-i18n="lasidao.produceRoll">${zh.produceRoll}</button>
      <button id="btn-las-remote-dice" type="button" class="secondary" hidden data-i18n="lasidao.useRemoteDice">${zh.useRemoteDice}</button>
    </div>
    <p id="las-roll-hint" class="muted las-hint" data-i18n="lasidao.rollHint">${zh.rollHint}</p>
  </div>

  <div id="las-dice-wrap" class="las-dice-wrap" hidden>
    <h3 class="game-sub" data-i18n="lasidao.yourDice">${zh.yourDice}</h3>
    <div id="las-dice-stage" class="las-dice-stage">
      <div id="las-dice" class="las-dice"></div>
      <div id="las-dice-groups" class="las-dice-groups" hidden></div>
    </div>
    <p id="las-dice-hint" class="muted las-hint"></p>
    <div id="las-dispatch-preview" class="las-dispatch-preview" hidden></div>
    <div class="row las-actions" id="las-produce-actions">
      <button id="btn-las-confirm" type="button" hidden data-i18n="lasidao.confirmDispatch">${zh.confirmDispatch}</button>
      <button id="btn-las-void" type="button" class="secondary" data-i18n="lasidao.voidDispatch">${zh.voidDispatch}</button>
    </div>
  </div>

  <div id="las-init-wrap" class="las-init-wrap" hidden>
    <div id="las-init-dice" class="las-dice las-init-dice" hidden></div>
    <div class="row las-actions">
      <button id="btn-las-init-roll" type="button" data-i18n="lasidao.initRoll">${zh.initRoll}</button>
    </div>
  </div>

  <div id="las-phase-actions" class="row las-actions" hidden>
    <button id="btn-las-pass" type="button" class="secondary" data-i18n="lasidao.pass">${zh.pass}</button>
  </div>

  <h3 class="game-sub" data-i18n="lasidao.myHand">${zh.myHand}</h3>
  <div id="las-me-res" class="las-res"></div>
  <div id="las-me-funcs" class="las-cards"></div>
  <div id="las-me-builds" class="las-cards"></div>

  <div id="las-func-panel" class="las-func-panel" hidden>
    <h3 class="game-sub" data-i18n="lasidao.useFunc">${zh.useFunc}</h3>
    <div id="las-func-form"></div>
  </div>

  <div id="las-exchange-wrap" class="las-exchange" hidden>
    <h3 class="game-sub" data-i18n="lasidao.exchange">${zh.exchange}</h3>
    <p id="las-exchange-hint" class="muted las-hint"></p>
    <div class="row">
      <select id="las-ex-from"></select>
      <span>\u2192</span>
      <select id="las-ex-to"></select>
      <button id="btn-las-exchange" type="button" data-i18n="lasidao.exchangeBtn">${zh.exchangeBtn}</button>
    </div>
  </div>

  <h3 class="game-sub" data-i18n="lasidao.players">${zh.players}</h3>
  <ul id="las-players" class="member-list"></ul>

  <h3 class="game-sub" data-i18n="lasidao.log">${zh.log}</h3>
  <ul id="las-log" class="game-log"></ul>
</div>
`;
fs.writeFileSync('public/games/lasidao/panel.html', out, 'utf8');
console.log('panel written', Buffer.byteLength(out, 'utf8'));
