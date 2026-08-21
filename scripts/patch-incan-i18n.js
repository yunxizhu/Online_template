'use strict';
const fs = require('fs');
const f = 'public/games/incan/ui.js';
let s = fs.readFileSync(f, 'utf8');
if (!s.includes('function t(key')) {
  s = s.replace(
    'window.IncanUi = (function () {\n  function $(id) {',
    `window.IncanUi = (function () {
  function t(key, vars) {
    return window.I18n && typeof window.I18n.t === 'function'
      ? window.I18n.t(key, vars)
      : key;
  }
  function $(id) {`
  );
}
s = s.replace(
  /function choiceLabel\(c\) \{\s*if \(c === 'continue'\) return '继续';\s*if \(c === 'retreat'\) return '返回';\s*return '';\s*\}/,
  `function choiceLabel(c) {
    if (c === 'continue') return t('incan.continue');
    if (c === 'retreat') return t('incan.retreat');
    return '';
  }`
);

// temple line
s = s.replace(
  /\$\('incan-temple'\)\.textContent = [^;]+;/,
  "$('incan-temple').textContent = t('incan.temple', { cur: game.templeIndex || 1, max: game.templeTotal || 5 });"
);

if (!s.includes("i18n:change")) {
  s = s.replace(
    'return { render, hide, bindButtons };',
    `window.addEventListener('i18n:change', () => {
    if (window.I18n && window.I18n.applyDom) {
      window.I18n.applyDom(document.getElementById('panel-incan'));
    }
  });
  return { render, hide, bindButtons };`
  );
}

fs.writeFileSync(f, s, 'utf8');
console.log('incan ok');

// fix rejoin msg keys
const zhPath = 'public/i18n/zh.json';
const enPath = 'public/i18n/en.json';
const zh = JSON.parse(fs.readFileSync(zhPath, 'utf8'));
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
zh.toast.rejoinMsg =
  '检测到你曾在房间「{name}」，当前{status}。是否重新加入？';
en.toast.rejoinMsg =
  'You were in room “{name}” ({status}). Rejoin?';
fs.writeFileSync(zhPath, JSON.stringify(zh, null, 2), 'utf8');
fs.writeFileSync(enPath, JSON.stringify(en, null, 2), 'utf8');
console.log('toast keys ok');
