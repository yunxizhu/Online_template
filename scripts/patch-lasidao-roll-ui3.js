'use strict';
const fs = require('fs');
const f = 'public/games/lasidao/ui.js';
let s = fs.readFileSync(f, 'utf8');

// Replace renderDice function entirely and add helpers before it
const renderDiceOld = s.match(/function renderDice\(game, meId\) \{[\s\S]*?\n  \}\n\n  function playInitRollAnim/);
if (!renderDiceOld) {
  console.log('MISS renderDice');
} else {
  s = s.replace(
    /function renderDice\(game, meId\) \{[\s\S]*?\n  \}\n\n  function playInitRollAnim/,
    `function renderRemoteDice(game, meId) {
    const diceEl = $('las-dice');
    const groupsEl = $('las-dice-groups');
    if (!diceEl || !groupsEl) return;
    groupsEl.hidden = true;
    groupsEl.innerHTML = '';
    diceEl.hidden = false;
    diceEl.innerHTML = '';
    const dice = (game.dice || []).slice();
    const myColor = playerDieColor(game.players || [], meId);
    dice.forEach((val, idx) => {
      const el = makeDieEl(
        val === 0 ? t('lasidao.wildDie') : val,
        'is-wild' + (selectedWildIdx.has(idx) ? ' is-selected' : ''),
        myColor
      );
      el.style.cursor = 'pointer';
      el.onclick = () => {
        if (selectedWildIdx.has(idx)) selectedWildIdx.delete(idx);
        else selectedWildIdx.add(idx);
        selectedWildCount = selectedWildIdx.size;
        selectedTarget = null;
        selectedFace = null;
        renderRemoteDice(lastGame, lastMeId);
        renderBoard(lastGame, lastMeId);
        updateDispatchPreview();
        updateDiceHint();
      };
      diceEl.appendChild(el);
    });
    diceAnim.stage = 'ready';
    diceAnim.finalDice = dice.slice();
  }

  function renderRollWrap(game, meId) {
    const wrap = $('las-roll-wrap');
    const rollBtn = $('btn-las-produce-roll');
    const remoteBtn = $('btn-las-remote-dice');
    if (!wrap) return;
    const show =
      game.phase === 'produce' &&
      isMyTurn(game, meId) &&
      isAwaitingRoll(game);
    wrap.hidden = !show;
    if (rollBtn) rollBtn.hidden = !show;
    if (remoteBtn) {
      const hasCard = Boolean(game.me && game.me.hasRemoteDice);
      remoteBtn.hidden = !(show && hasCard);
    }
  }

  function renderDice(game, meId) {
    const wrap = $('las-dice-wrap');
    if (!wrap) return;

    renderRollWrap(game, meId);

    if (isAwaitingRoll(game) && isMyTurn(game, meId)) {
      if (diceAnim.stage !== 'idle') resetDiceAnim();
      wrap.hidden = true;
      return;
    }

    const show =
      game.phase === 'produce' &&
      isMyTurn(game, meId) &&
      (game.dice || []).length > 0;

    if (!show) {
      if (diceAnim.stage !== 'idle') resetDiceAnim();
      wrap.hidden = true;
      return;
    }

    wrap.hidden = false;
    const dice = (game.dice || []).slice();
    const remote = isRemoteMode(game);
    const key =
      game.round +
      ':' +
      meId +
      ':' +
      (remote ? 'R' : 'N') +
      ':' +
      dice.join(',');

    if (diceAnim.key !== key) {
      diceAnim.key = key;
      resetDiceSelection();
      if (remote) {
        diceAnim.stage = 'ready';
        diceAnim.finalDice = dice.slice();
        renderRemoteDice(game, meId);
        updateDispatchPreview();
        updateDiceHint();
      } else {
        startDiceAnimation(dice, meId);
      }
      return;
    }

    if (remote) {
      renderRemoteDice(game, meId);
      updateDispatchPreview();
      updateDiceHint();
      return;
    }

    if (diceAnim.stage === 'rolling' || diceAnim.stage === 'grouping') {
      updateDiceHint();
      return;
    }

    if (diceAnim.stage === 'ready') {
      renderGroupedDice();
      updateDispatchPreview();
      updateDiceHint();
    }
  }

  function playInitRollAnim`
  );
  console.log('renderDice replaced');
}

// confirmDispatch
s = s.replace(
  /function confirmDispatch\(\) \{[\s\S]*?\n  \}/,
  `function confirmDispatch() {
    if (!netRef || !selectedTarget) return;
    const remote = lastGame && isRemoteMode(lastGame);
    if (remote) {
      if (!selectedWildCount || selectedFace == null) return;
      const payload = {
        face: selectedFace,
        count: selectedWildCount,
      };
      if (selectedTarget.type === 'area') payload.area = selectedTarget.area;
      else payload.buildingId = selectedTarget.buildingId;
      netRef.sendAction('placeDice', payload);
      resetDiceAnim();
      return;
    }
    if (selectedFace == null) return;
    const payload = { face: selectedFace };
    if (selectedTarget.type === 'area') {
      payload.area = selectedTarget.area;
    } else {
      payload.buildingId = selectedTarget.buildingId;
    }
    netRef.sendAction('placeDice', payload);
    resetDiceAnim();
  }`
);

// bindButtons - add roll / remote
s = s.replace(
  /function bindButtons\(net\) \{\s*netRef = net;\s*const initBtn = \$\('btn-las-init-roll'\);/,
  `function bindButtons(net) {
    netRef = net;
    const rollBtn = $('btn-las-produce-roll');
    if (rollBtn) {
      rollBtn.onclick = () => net.sendAction('produceRoll', {});
    }
    const remoteBtn = $('btn-las-remote-dice');
    if (remoteBtn) {
      remoteBtn.onclick = () => {
        const me = lastGame && mePlayer(lastGame, lastMeId);
        const card =
          me &&
          (me.funcCards || []).find((c) => c.funcType === 'remoteDice');
        if (!card) return;
        net.sendAction('useFunc', { cardId: card.id });
      };
    }
    const initBtn = $('btn-las-init-roll');`
);

// status awaiting
s = s.replace(
  `    } else if (game.phase === 'produce') {
      if (
        isMyTurn(game, meId) &&
        !diceReady() &&
        (game.dice || []).length
      ) {
        $('las-status').textContent =
          diceAnim.stage === 'rolling'
            ? t('lasidao.diceRolling')
            : t('lasidao.diceGrouping');
      } else {
        $('las-status').textContent = t('lasidao.statusProduce');
      }
    }`,
  `    } else if (game.phase === 'produce') {
      if (isMyTurn(game, meId) && isAwaitingRoll(game)) {
        $('las-status').textContent = t('lasidao.statusAwaitRoll');
      } else if (
        isMyTurn(game, meId) &&
        isRemoteMode(game)
      ) {
        $('las-status').textContent = t('lasidao.diceRemoteHint');
      } else if (
        isMyTurn(game, meId) &&
        !diceReady() &&
        (game.dice || []).length
      ) {
        $('las-status').textContent =
          diceAnim.stage === 'rolling'
            ? t('lasidao.diceRolling')
            : t('lasidao.diceGrouping');
      } else {
        $('las-status').textContent = t('lasidao.statusProduce');
      }
    }`
);

fs.writeFileSync(f, s, 'utf8');
console.log('part2 done', s.includes('renderRemoteDice'), s.includes('produceRoll'));
