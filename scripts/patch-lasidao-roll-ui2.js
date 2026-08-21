'use strict';
const fs = require('fs');
const f = 'public/games/lasidao/ui.js';
let s = fs.readFileSync(f, 'utf8');

if (!s.includes('selectedWildCount')) {
  s = s.replace(
    'let selectedFace = null;',
    `let selectedFace = null;
  /** 遥控模式已选骰子枚数 */
  let selectedWildCount = 0;
  let selectedWildIdx = new Set();`
  );
}

s = s.replace(
  /function resetDiceSelection\(\) \{\s*selectedFace = null;\s*selectedTarget = null;\s*\}/,
  `function resetDiceSelection() {
    selectedFace = null;
    selectedTarget = null;
    selectedWildCount = 0;
    selectedWildIdx = new Set();
  }`
);

s = s.replace(
  /function isMyTurn\(game, meId\) \{\s*return game\.currentPlayerId && meId && game\.currentPlayerId === meId;\s*\}/,
  `function isMyTurn(game, meId) {
    return game.currentPlayerId && meId && game.currentPlayerId === meId;
  }

  function isRemoteMode(game) {
    return Boolean(game && game.remoteDiceMode);
  }

  function isAwaitingRoll(game) {
    return Boolean(game && game.awaitingProduceRoll);
  }`
);

// updateDispatchPreview
s = s.replace(
  /function updateDispatchPreview\(\) \{[\s\S]*?\n  \}/,
  `function updateDispatchPreview() {
    const box = $('las-dispatch-preview');
    const confirm = $('btn-las-confirm');
    if (!box || !confirm) return;
    const remote = lastGame && isRemoteMode(lastGame);

    if (remote) {
      if (!selectedWildCount) {
        box.hidden = true;
        confirm.hidden = true;
        return;
      }
      if (!selectedTarget) {
        box.hidden = false;
        box.textContent = t('lasidao.diceRemotePick', {
          count: selectedWildCount,
        });
        confirm.hidden = true;
        return;
      }
      let targetTxt = '';
      if (selectedTarget.type === 'area') {
        targetTxt =
          areaLabel(selectedTarget.area) + ' #' + selectedTarget.number;
      } else {
        targetTxt = t('lasidao.targetPersonal', {
          label: selectedTarget.label || '',
        });
      }
      box.hidden = false;
      box.textContent = t('lasidao.previewRemote', {
        count: selectedWildCount,
        target: targetTxt,
      });
      confirm.hidden = false;
      return;
    }

    if (selectedFace == null) {
      box.hidden = true;
      confirm.hidden = true;
      return;
    }

    const count = countByFace(diceAnim.finalDice)[selectedFace] || 0;
    if (!selectedTarget) {
      box.hidden = false;
      box.textContent = t('lasidao.previewNeedTarget', {
        face: selectedFace,
        count,
      });
      confirm.hidden = true;
      return;
    }

    let targetTxt = '';
    if (selectedTarget.type === 'area') {
      targetTxt =
        areaLabel(selectedTarget.area) + ' #' + selectedTarget.number;
    } else {
      targetTxt = t('lasidao.targetPersonal', {
        label: selectedTarget.label || '',
      });
    }
    box.hidden = false;
    box.textContent = t('lasidao.previewReady', {
      face: selectedFace,
      count,
      target: targetTxt,
    });
    confirm.hidden = false;
  }`
);

// updateDiceHint
s = s.replace(
  /function updateDiceHint\(\) \{[\s\S]*?\n  \}/,
  `function updateDiceHint() {
    const hint = $('las-dice-hint');
    if (!hint) return;
    if (lastGame && isRemoteMode(lastGame) && diceAnim.stage === 'ready') {
      if (!selectedWildCount) {
        hint.textContent = t('lasidao.diceRemoteHint');
      } else if (!selectedTarget) {
        hint.textContent = t('lasidao.diceRemotePick', {
          count: selectedWildCount,
        });
      } else {
        hint.textContent = t('lasidao.diceConfirm');
      }
      return;
    }
    if (diceAnim.stage === 'rolling') {
      hint.textContent = t('lasidao.diceRolling');
    } else if (diceAnim.stage === 'grouping') {
      hint.textContent = t('lasidao.diceGrouping');
    } else if (diceAnim.stage === 'ready') {
      if (selectedFace == null) {
        hint.textContent = t('lasidao.dicePickFace');
      } else if (!selectedTarget) {
        hint.textContent = t('lasidao.dicePickTarget', { face: selectedFace });
      } else {
        hint.textContent = t('lasidao.diceConfirm');
      }
    } else {
      hint.textContent = '';
    }
  }`
);

// pickAreaTarget - in remote set face from slot
s = s.replace(
  /function pickAreaTarget\(areaKey, num\) \{\s*selectedTarget = \{ type: 'area', area: areaKey, number: num \};/,
  `function pickAreaTarget(areaKey, num) {
    selectedTarget = { type: 'area', area: areaKey, number: num };
    if (lastGame && isRemoteMode(lastGame)) {
      selectedFace = num;
    }`
);

// canPick / matchFace in renderAreaBoard
s = s.replace(
  `    const canPick =
      game.phase === 'produce' &&
      isMyTurn(game, meId) &&
      diceReady() &&
      selectedFace != null;

    for (let num = 1; num <= 6; num++) {`,
  `    const remote = isRemoteMode(game);
    const canPick =
      game.phase === 'produce' &&
      isMyTurn(game, meId) &&
      diceReady() &&
      (remote ? selectedWildCount > 0 : selectedFace != null);

    for (let num = 1; num <= 6; num++) {`
);

s = s.replace(
  `      const hasTiles = tiles.length > 0;
      const matchFace = selectedFace === num;
      slot.disabled = !canPick || !matchFace || !hasTiles;
      if (canPick && matchFace && hasTiles) slot.classList.add('is-target');`,
  `      const hasTiles = tiles.length > 0;
      const matchFace = remote ? true : selectedFace === num;
      slot.disabled = !canPick || !matchFace || !hasTiles;
      if (canPick && matchFace && hasTiles) slot.classList.add('is-target');`
);

// personal building pick: remote any built with matching slot when wild selected
s = s.replace(
  `      if (me && canPick) {
        for (const b of me.buildings || []) {
          if (!b.built || b.slot !== selectedFace) continue;`,
  `      if (me && canPick) {
        for (const b of me.buildings || []) {
          if (!b.built) continue;
          if (!remote && b.slot !== selectedFace) continue;
          if (remote && (b.slot == null || b.slot === 'none')) continue;`
);

// When picking personal building in remote, set selectedFace = b.slot
s = s.replace(
  `          btn.onclick = () => {
            selectedTarget = {
              type: 'building',
              buildingId: b.id,
              label: b.label,
            };
            renderBoard(lastGame, lastMeId);
            renderGroupedDice();
            updateDispatchPreview();
            updateDiceHint();
          };`,
  `          btn.onclick = () => {
            selectedTarget = {
              type: 'building',
              buildingId: b.id,
              label: b.label,
            };
            if (remote) selectedFace = Number(b.slot);
            renderBoard(lastGame, lastMeId);
            if (remote) renderRemoteDice(lastGame, lastMeId);
            else renderGroupedDice();
            updateDispatchPreview();
            updateDiceHint();
          };`
);

fs.writeFileSync(f, s, 'utf8');
console.log('part1', s.includes('isRemoteMode'), s.includes('selectedWildCount'));
