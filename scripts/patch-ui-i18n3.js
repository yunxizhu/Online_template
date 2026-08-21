'use strict';
const fs = require('fs');
const f = 'public/js/ui.js';
let s = fs.readFileSync(f, 'utf8');

s = s.replace(
  /if \(mqttN\) bits\.push\(`广播 \$\{mqttN\}`\);\s*el\.peersLabel\.textContent =\s*`在线：发现 \$\{n\} 个实例` \+ \(bits\.length \? `（\$\{bits\.join\(' · '\)\}）` : ''\);/,
  `if (mqttN) bits.push(t('lobby.broadcastN', { n: mqttN }));
    el.peersLabel.textContent = bits.length
      ? t('lobby.peersFoundWith', { n, bits: bits.join(' · ') })
      : t('lobby.peersFound', { n });`
);

s = s.replace(
  /if \(el\.gameTitle\) \{\s*el\.gameTitle\.textContent =\s*\(state\.room && state\.room\.gameLabel\) \|\| '五子棋';\s*\}/,
  `if (el.gameTitle) {
      el.gameTitle.textContent = gameLabelOf(
        'gomoku',
        (state.room && state.room.gameLabel) || t('gomoku.title')
      );
    }`
);

s = s.replace(
  /el\.gameSides\.textContent =\s*`黑：\$\{blackId \? playerNameById\(blackId\) : '—'\}　白：\$\{\s*whiteId \? playerNameById\(whiteId\) : '—'\s*\}` \+ \(my === 1 \? '　你是黑棋' : my === 2 \? '　你是白棋' : ''\);/,
  `el.gameSides.textContent =
        t('gomoku.sides', {
          black: blackId ? playerNameById(blackId) : t('common.dash'),
          white: whiteId ? playerNameById(whiteId) : t('common.dash'),
        }) +
        (my === 1
          ? '　' + t('gomoku.youBlack')
          : my === 2
            ? '　' + t('gomoku.youWhite')
            : '');`
);

// menu handlers + i18n change + click outside
const menuHook = `  if (el.btnQuitGame) {
    el.btnQuitGame.addEventListener('click', () => {
      closeGameMenu();
      if (typeof net.quitGame === 'function') net.quitGame();
    });
  }
  document.addEventListener('click', (ev) => {
    if (!el.gameMenu || el.gameMenu.hidden) return;
    if (el.gameMenu.contains(ev.target)) return;
    closeGameMenu();
  });`;

const menuNew = `  if (el.btnQuitGame) {
    el.btnQuitGame.addEventListener('click', () => {
      closeGameMenu();
      if (typeof net.quitGame === 'function') net.quitGame();
    });
  }
  if (el.btnMenuLang) {
    el.btnMenuLang.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleLangSub();
    });
  }
  if (el.menuLangSub) {
    el.menuLangSub.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest && ev.target.closest('[data-lang]');
      if (!btn) return;
      ev.stopPropagation();
      const id = btn.getAttribute('data-lang');
      I18n.setLang(id);
      syncLangMenuActive();
      closeGameMenu();
    });
  }
  document.addEventListener('click', (ev) => {
    if (!el.gameMenu) return;
    if (el.gameMenu.contains(ev.target)) return;
    closeGameMenu();
  });

  function refreshAfterLangChange() {
    if (I18n && I18n.applyDom) I18n.applyDom(document);
    syncLangMenuActive();
    syncQuitMenuItem();
    showView(currentViewName);
    updateCreateForm();
    fillGameOptions(state.games);
    if (state.lobbyRooms) renderLobbyRooms(state.lobbyRooms);
    if (state.room) renderRoom();
    if (state.game) renderGame();
    syncChatTabs();
    renderChatLog();
    updateMeLabel();
    markLobbyRefreshed();
    // turn time option labels
    if (el.roomTurnTime) {
      for (const opt of el.roomTurnTime.options) {
        const v = Number(opt.value);
        if (v === 0) opt.textContent = t('create.turnUnlimited');
        else opt.textContent = t('create.turnSec', { n: v });
      }
    }
  }
  if (I18n && typeof I18n.onChange === 'function') {
    I18n.onChange(() => refreshAfterLangChange());
  }
  syncLangMenuActive();
  syncQuitMenuItem();`;

if (s.includes(menuHook)) {
  s = s.replace(menuHook, menuNew);
  console.log('menu hooked');
} else {
  console.log('MISS menu hook');
}

fs.writeFileSync(f, s, 'utf8');
console.log('ok', s.includes("t('lobby.peersFound'"), s.includes("t('gomoku.sides'"));
