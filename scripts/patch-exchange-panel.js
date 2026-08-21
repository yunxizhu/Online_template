'use strict';
const fs = require('fs');
const path = 'public/games/lasidao/panel.html';
let p = fs.readFileSync(path, 'utf8');
const start = p.indexOf('<div id="las-exchange-wrap"');
const endMarker = '<h3 class="game-sub" data-i18n="lasidao.players">';
const end = p.indexOf(endMarker);
if (start < 0 || end < 0) {
  console.log('miss', start, end);
  process.exit(1);
}
const block = `<div id="las-exchange-wrap" class="las-exchange" hidden>
    <h3 class="game-sub" data-i18n="lasidao.exchange">交易所</h3>
    <p id="las-exchange-hint" class="muted las-hint"></p>
    <div class="row">
      <select id="las-ex-from"></select>
      <span>→</span>
      <select id="las-ex-to"></select>
      <button id="btn-las-exchange" type="button" data-i18n="lasidao.exchangeBtn">兑换</button>
    </div>
  </div>

  `;
p = p.slice(0, start) + block + p.slice(end);
fs.writeFileSync(path, p, 'utf8');
console.log('panel ok');
