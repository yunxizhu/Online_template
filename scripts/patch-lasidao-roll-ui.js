'use strict';
const fs = require('fs');

// panel: insert roll wrap before dice wrap
let panel = fs.readFileSync('public/games/lasidao/panel.html', 'utf8');
if (!panel.includes('btn-las-produce-roll')) {
  panel = panel.replace(
    '<div id="las-dice-wrap"',
    `<div id="las-roll-wrap" class="las-roll-wrap" hidden>
    <div class="row las-actions">
      <button id="btn-las-produce-roll" type="button" data-i18n="lasidao.produceRoll">投掷</button>
      <button id="btn-las-remote-dice" type="button" class="secondary" hidden data-i18n="lasidao.useRemoteDice">使用遥控骰子</button>
    </div>
    <p id="las-roll-hint" class="muted las-hint" data-i18n="lasidao.rollHint">轮到你了：请投掷，或使用遥控骰子</p>
  </div>

  <div id="las-dice-wrap"`
  );
  fs.writeFileSync('public/games/lasidao/panel.html', panel, 'utf8');
  console.log('panel ok');
} else console.log('panel already');

// i18n
for (const lang of ['zh', 'en']) {
  const p = `public/i18n/${lang}.json`;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!j.lasidao) j.lasidao = {};
  if (lang === 'zh') {
    Object.assign(j.lasidao, {
      produceRoll: '投掷',
      useRemoteDice: '使用遥控骰子',
      rollHint: '轮到你了：请投掷，或使用遥控骰子',
      statusAwaitRoll: '请点击「投掷」或「使用遥控骰子」',
      diceRemoteHint: '遥控模式：点选任意枚骰子，再点任意数字格派遣（点数=格子）',
      diceRemotePick: '已选 {count} 枚，请点任意有板块的数字格',
      previewRemote: '遥控派遣 {count} 枚 → {target}',
      wildDie: '?',
    });
  } else {
    Object.assign(j.lasidao, {
      produceRoll: 'Roll',
      useRemoteDice: 'Use remote dice',
      rollHint: 'Your turn: roll, or use remote dice',
      statusAwaitRoll: 'Click Roll or Use remote dice',
      diceRemoteHint: 'Remote mode: select any dice, then any number slot (face = slot)',
      diceRemotePick: '{count} selected — click any slot with tiles',
      previewRemote: 'Remote dispatch {count} → {target}',
      wildDie: '?',
    });
  }
  fs.writeFileSync(p, JSON.stringify(j, null, 2), 'utf8');
}
console.log('i18n ok');
