  function renderActRail(game, meId) {
    const wrap = $('las-act-wrap');
    const hand = $('las-act-hand');
    const hint = $('las-act-hint');
    if (!wrap) return;

    hideCardTip();
    const show = shouldShowActRail(game, meId);
    wrap.hidden = !show;
    if (!show) {
      if (hand) hand.innerHTML = '';
      if (hint) hint.textContent = '';
      if (game.phase !== 'settle_act') discardResPick = emptyDiscardResPick();
      return;
    }
    if (game.phase !== 'settle_act') discardResPick = emptyDiscardResPick();

    const me = mePlayer(game, meId);
    if (hand) hand.innerHTML = '';
    if (!me) {
      if (hint) hint.textContent = '';
      return;
    }

    if (hint) {
      if (game.phase === 'build') {
        if (isMyTurn(game, meId) && (me.pendingDiscardFunc || me.pendingDiscardBuild)) {
          hint.textContent = me.pendingDiscardFunc
            ? t('lasidao.discardFuncTip')
            : t('lasidao.discardBuildTip', { n: me.maxBuildings || game.maxBuildings || 3 });
        } else {
          hint.textContent = isMyTurn(game, meId)
            ? t('lasidao.actRailHintBuild')
            : t('lasidao.actRailHintBuildWait');
        }
      } else if (game.phase === 'produce') {
        hint.textContent = t('lasidao.actRailHintProduce');
      } else if (game.phase === 'settle_act') {
        hint.textContent = settleDiscardHintForMe(me);
      } else {
        hint.textContent = '';
      }
    }

    if (game.phase === 'build' && (me.buildPassed || (game.me && game.me.buildPassed))) {
      if (hand) {
        const done = document.createElement('div');
        done.className = 'las-act-passed muted';
        done.textContent = t('lasidao.buildPassedNote');
        hand.appendChild(done);
      }
    }

    if (game.phase === 'build') {
      syncBuildConfirmBar(game, me);
      return;
    }

    if (game.phase === 'settle_act') {
      if (hand) appendResourceDiscardRow(hand, game, me);
      if (me.pendingDiscardBuild && !me.pendingDiscardRes) {
        if (hand) appendBuildDiscardChoiceUi(hand, game, meId, me);
      }
      if (me.pendingDiscardFunc && !me.pendingDiscardRes) {
        if (hand) {
          const tip = document.createElement('div');
          tip.className = 'muted las-pboard-tip';
          tip.textContent = t('lasidao.discardFuncTip');
          hand.appendChild(tip);
          const funcLab = document.createElement('div');
          funcLab.className = 'las-pboard-label';
          funcLab.textContent = t('lasidao.funcHand');
          hand.appendChild(funcLab);
          const funcs = document.createElement('div');
          funcs.className = 'las-cards las-act-cards las-func-hand';
          fillFuncHandRow(funcs, {
            cards: me.funcCards,
            isMe: true,
            interactive: true,
            game,
            player: me,
            meId,
            maxSlots: me.maxFuncHand || MAX_FUNC_HAND_UI,
          });
          hand.appendChild(funcs);
        }
      }
      return;
    }
  }