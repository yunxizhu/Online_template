'use strict';
const fs = require('fs');
const f = 'public/games/sgs/ui.js';
let s = fs.readFileSync(f, 'utf8');
if (!s.includes("i18n:change")) {
  if (s.includes('return {')) {
    // find last return of module
    const idx = s.lastIndexOf('return {');
    if (idx >= 0) {
      s =
        s.slice(0, idx) +
        `window.addEventListener('i18n:change', () => {
    if (window.I18n && window.I18n.applyDom) {
      window.I18n.applyDom(document.getElementById('panel-sgs'));
    }
  });\n\n  ` +
        s.slice(idx);
      fs.writeFileSync(f, s, 'utf8');
      console.log('sgs i18n listener added');
    }
  }
} else console.log('already');

// room label i18n in ui.js
let ui = fs.readFileSync('public/js/ui.js', 'utf8');
const oldRoom =
  `el.roomGameLabel.textContent =
      (room.gameLabel || room.gameType || '—') +
      (room.gameModeLabel ? '·' + room.gameModeLabel : '') +
      t('room.turnThink', { time: formatTurnTime(room.turnTimeSec) });`;
const newRoom =
  `el.roomGameLabel.textContent =
      gameLabelOf(room.gameType, room.gameLabel || room.gameType || t('common.dash')) +
      (room.gameModeLabel
        ? '·' + modeLabelOf(room.gameMode, room.gameModeLabel)
        : '') +
      t('room.turnThink', { time: formatTurnTime(room.turnTimeSec) });`;
if (ui.includes(oldRoom)) {
  ui = ui.split(oldRoom).join(newRoom);
  console.log('room label ok');
} else {
  console.log('room label miss');
}
fs.writeFileSync('public/js/ui.js', ui, 'utf8');
