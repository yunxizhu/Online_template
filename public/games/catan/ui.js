'use strict';

/**
 * 卡坦岛前端 UI
 */
window.CatanUi = (function () {
  const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'];
  const RES_LABEL = {
    brick: '砖',
    lumber: '木',
    wool: '羊',
    grain: '麦',
    ore: '矿',
  };
  const DEV_LABEL = {
    knight: '骑士',
    victory: '胜利点',
    roadBuilding: '道路建设',
    yearOfPlenty: '丰收之年',
    monopoly: '垄断',
  };
  const PHASE_LABEL = {
    setupSettlement: '放置初始定居点',
    setupRoad: '放置初始道路',
    roll: '掷骰',
    discard: '弃牌',
    robber: '移动强盗',
    main: '行动阶段',
    tradeResponse: '交易响应',
    gameOver: '结束',
  };

  let netRef = null;
  let lastGame = null;
  let meId = null;
  let buildMode = null;
  let pendingRobberHex = null;
  let discardPick = emptyRes();
  let tradeGive = emptyRes();
  let tradeWant = emptyRes();
  let bound = false;

  function $(id) {
    return document.getElementById(id);
  }

  function emptyRes() {
    return { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
  }

  function tKey(key, fallback, vars) {
    if (typeof t === 'function') {
      try {
        const s = t(key, vars);
        if (s && s !== key) return s;
      } catch (_) {}
    }
    return fallback;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hideOthers() {
    const gomoku = $('panel-gomoku');
    if (gomoku) gomoku.hidden = true;
    if (window.IncanUi) window.IncanUi.hide();
    if (window.SgsUi) window.SgsUi.hide();
    if (window.LasidaoUi) window.LasidaoUi.hide();
  }

  function hide() {
    const panel = $('panel-catan');
    if (panel) panel.hidden = true;
    const modal = $('catan-steal-modal');
    if (modal) modal.hidden = true;
  }

  function send(type, payload) {
    if (!netRef || typeof netRef.sendAction !== 'function') return;
    netRef.sendAction(type, payload || {});
  }

  function playerColors(game) {
    const map = {};
    const colors = (window.CatanBoardView && window.CatanBoardView.COLORS) || [
      '#e53935',
      '#1e88e5',
      '#43a047',
      '#fdd835',
    ];
    for (const p of game.players || []) {
      map[p.id] = colors[p.colorIndex % colors.length];
    }
    return map;
  }

  function autoBuildMode(game) {
    if (!game || game.over) return null;
    if (game.phase === 'setupSettlement') return 'settlement';
    if (game.phase === 'setupRoad') return 'road';
    if (game.phase === 'robber') return 'robber';
    if (
      game.roadBuildingLeft > 0 &&
      game.roadBuildingPlayerId === meId
    ) {
      return 'road';
    }
    return buildMode;
  }

  function fillResSelect(sel, selected) {
    if (!sel) return;
    const cur = selected || sel.value;
    sel.innerHTML = '';
    for (const r of RESOURCES) {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = RES_LABEL[r];
      sel.appendChild(opt);
    }
    if (cur && RESOURCES.includes(cur)) sel.value = cur;
  }

  function renderResChips(el, resources, editable, onChange) {
    if (!el) return;
    el.innerHTML = '';
    for (const r of RESOURCES) {
      const chip = document.createElement('div');
      chip.className = `catan-res-chip res-${r}`;
      const n = (resources && resources[r]) || 0;
      if (editable) {
        const minus = document.createElement('button');
        minus.type = 'button';
        minus.textContent = '−';
        minus.addEventListener('click', () => {
          if (resources[r] > 0) {
            resources[r] -= 1;
            onChange && onChange();
          }
        });
        const label = document.createElement('span');
        label.textContent = `${RES_LABEL[r]} ${n}`;
        const plus = document.createElement('button');
        plus.type = 'button';
        plus.textContent = '+';
        plus.addEventListener('click', () => {
          resources[r] += 1;
          onChange && onChange();
        });
        chip.appendChild(minus);
        chip.appendChild(label);
        chip.appendChild(plus);
      } else {
        chip.textContent = `${RES_LABEL[r]} ${n}`;
      }
      el.appendChild(chip);
    }
  }

  function countRes(res) {
    return RESOURCES.reduce((s, k) => s + (res[k] || 0), 0);
  }

  function onBoardPick(pick) {
    if (!pick || !lastGame) return;
    if (pick.kind === 'settlement') {
      send('placeSettlement', { vertexId: pick.vertexId });
    } else if (pick.kind === 'city') {
      send('buildCity', { vertexId: pick.vertexId });
    } else if (pick.kind === 'road') {
      send('buildRoad', { edgeId: pick.edgeId });
    } else if (pick.kind === 'robber') {
      pendingRobberHex = pick.hexId;
      const victims = [];
      for (const [vid, b] of Object.entries(lastGame.buildings || {})) {
        const v = lastGame.board.vertices[vid];
        if (!v || !v.hexIds.includes(pick.hexId)) continue;
        if (b.playerId === meId) continue;
        if (!victims.includes(b.playerId)) victims.push(b.playerId);
      }
      if (victims.length <= 1) {
        send('moveRobber', {
          hexId: pick.hexId,
          stealFromId: victims[0] || null,
        });
        pendingRobberHex = null;
      } else {
        showStealModal(victims);
      }
    }
  }

  function showStealModal(victimIds) {
    const modal = $('catan-steal-modal');
    const list = $('catan-steal-list');
    if (!modal || !list) return;
    list.innerHTML = '';
    for (const id of victimIds) {
      const p = (lastGame.players || []).find((x) => x.id === id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = (p && p.name) || id;
      btn.addEventListener('click', () => {
        send('moveRobber', {
          hexId: pendingRobberHex,
          stealFromId: id,
        });
        pendingRobberHex = null;
        modal.hidden = true;
      });
      list.appendChild(btn);
    }
    modal.hidden = false;
  }

  function renderDevHand(game, me) {
    const el = $('catan-dev-hand');
    if (!el) return;
    el.innerHTML = '';
    if (!me || !me.devCards) return;
    const canPlay =
      game.phase === 'main' &&
      game.currentPlayerId === meId &&
      !game.trade &&
      !game.playedDevThisTurn;

    function addCard(card, playable) {
      const chip = document.createElement('div');
      chip.className = 'catan-res-chip';
      chip.textContent = DEV_LABEL[card] || card;
      if (playable && card !== 'victory') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = tKey('catan.play', '打出');
        btn.addEventListener('click', () => playDev(card));
        chip.appendChild(btn);
      }
      el.appendChild(chip);
    }

    for (const c of me.devCards || []) addCard(c, canPlay);
    for (const c of me.newDevCards || []) {
      const chip = document.createElement('div');
      chip.className = 'catan-res-chip';
      chip.textContent = `${DEV_LABEL[c] || c}(新)`;
      el.appendChild(chip);
    }
  }

  function playDev(card) {
    if (card === 'knight') send('playKnight', {});
    else if (card === 'roadBuilding') send('playRoadBuilding', {});
    else if (card === 'yearOfPlenty') {
      const a = prompt(
        tKey('catan.yopPrompt', '丰收：输入两种资源，如 lumber,grain'),
        'lumber,grain'
      );
      if (!a) return;
      const parts = a.split(/[,，\s]+/).map((s) => s.trim());
      const gain = emptyRes();
      for (const p of parts) {
        const key =
          { 砖: 'brick', 木: 'lumber', 羊: 'wool', 麦: 'grain', 矿: 'ore' }[p] ||
          p;
        if (RESOURCES.includes(key)) gain[key] += 1;
      }
      if (countRes(gain) !== 2) {
        alert(tKey('catan.yopNeed2', '须选择恰好 2 份资源'));
        return;
      }
      send('playYearOfPlenty', { resources: gain });
    } else if (card === 'monopoly') {
      const a = prompt(
        tKey('catan.monoPrompt', '垄断哪种资源？brick/lumber/wool/grain/ore'),
        'ore'
      );
      if (!a) return;
      const key =
        { 砖: 'brick', 木: 'lumber', 羊: 'wool', 麦: 'grain', 矿: 'ore' }[
          a.trim()
        ] || a.trim();
      if (!RESOURCES.includes(key)) return;
      send('playMonopoly', { resource: key });
    }
  }

  function renderDiscard(game, me) {
    const sec = $('catan-discard-section');
    if (!sec) return;
    const need = (game.pendingDiscards && game.pendingDiscards[meId]) || 0;
    if (game.phase === 'discard' && need > 0) {
      sec.hidden = false;
      $('catan-discard-need').textContent = tKey(
        'catan.discardNeed',
        `须弃掉 ${need} 张（已选 ${countRes(discardPick)}）`,
        { n: need, picked: countRes(discardPick) }
      );
      const refreshDiscard = () => {
        if (me && me.resources) {
          for (const r of RESOURCES) {
            if (discardPick[r] > me.resources[r]) discardPick[r] = me.resources[r];
          }
        }
        const needEl = $('catan-discard-need');
        if (needEl) {
          needEl.textContent = tKey(
            'catan.discardNeed',
            `须弃掉 ${need} 张（已选 ${countRes(discardPick)}）`,
            { n: need, picked: countRes(discardPick) }
          );
        }
        renderResChips($('catan-discard-pick'), discardPick, true, refreshDiscard);
      };
      refreshDiscard();
    } else {
      sec.hidden = true;
      discardPick = emptyRes();
    }
  }

  function renderTrade(game, me) {
    const pending = $('catan-trade-pending');
    const cancelBtn = $('btn-catan-cancel-trade');
    const offerBtn = $('btn-catan-offer');
    const toSel = $('catan-trade-to');

    if (toSel) {
      const cur = toSel.value;
      toSel.innerHTML = '';
      const any = document.createElement('option');
      any.value = '';
      any.textContent = tKey('catan.broadcast', '所有人');
      toSel.appendChild(any);
      for (const p of game.players || []) {
        if (p.id === meId) continue;
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        toSel.appendChild(opt);
      }
      if ([...toSel.options].some((o) => o.value === cur)) toSel.value = cur;
    }

    renderResChips($('catan-trade-give'), tradeGive, true, () =>
      renderResChips($('catan-trade-give'), tradeGive, true)
    );
    renderResChips($('catan-trade-want'), tradeWant, true, () =>
      renderResChips($('catan-trade-want'), tradeWant, true)
    );

    const isMyTurnMain =
      game.phase === 'main' && game.currentPlayerId === meId && !game.trade;
    if (offerBtn) offerBtn.hidden = !isMyTurnMain;
    if (cancelBtn) {
      cancelBtn.hidden = !(game.trade && game.trade.fromId === meId);
    }

    if (pending) {
      if (game.trade) {
        pending.hidden = false;
        const from = (game.players || []).find((p) => p.id === game.trade.fromId);
        const giveStr = RESOURCES.filter((r) => game.trade.give[r])
          .map((r) => `${RES_LABEL[r]}×${game.trade.give[r]}`)
          .join(' ');
        const wantStr = RESOURCES.filter((r) => game.trade.want[r])
          .map((r) => `${RES_LABEL[r]}×${game.trade.want[r]}`)
          .join(' ');
        pending.innerHTML = `<div>${escapeHtml((from && from.name) || '')} 出价 ${escapeHtml(giveStr)} → 换 ${escapeHtml(wantStr)}</div>`;
        if (
          game.phase === 'tradeResponse' &&
          game.trade.responders &&
          game.trade.responders.includes(meId)
        ) {
          const row = document.createElement('div');
          row.className = 'catan-btn-row';
          const ok = document.createElement('button');
          ok.type = 'button';
          ok.textContent = tKey('catan.accept', '接受');
          ok.addEventListener('click', () =>
            send('respondTrade', { accept: true })
          );
          const no = document.createElement('button');
          no.type = 'button';
          no.className = 'secondary';
          no.textContent = tKey('catan.reject', '拒绝');
          no.addEventListener('click', () =>
            send('respondTrade', { accept: false })
          );
          row.appendChild(ok);
          row.appendChild(no);
          pending.appendChild(row);
        }
      } else {
        pending.hidden = true;
        pending.innerHTML = '';
      }
    }

    // bank
    fillResSelect($('catan-bank-give'));
    fillResSelect($('catan-bank-want'));
    const bankBtn = $('btn-catan-bank');
    if (bankBtn) bankBtn.hidden = !isMyTurnMain;
    const rateEl = $('catan-bank-rate');
    if (rateEl && game.you && game.you.bankRates) {
      const give = $('catan-bank-give') && $('catan-bank-give').value;
      const rate = give ? game.you.bankRates[give] : 4;
      rateEl.textContent = tKey('catan.bankRate', `当前汇率 ${rate}:1`, {
        rate,
      });
    }
  }

  function render(game, net, opts) {
    const panel = $('panel-catan');
    if (!panel) return;
    if (net) netRef = net;
    hideOthers();
    panel.hidden = false;

    if (!game || game.type !== 'catan') return;
    lastGame = game;
    meId = opts && opts.meId;
    const playerNameById =
      (opts && opts.playerNameById) ||
      ((id) => {
        const p = (game.players || []).find((x) => x.id === id);
        return (p && p.name) || id;
      });

    const me = (game.players || []).find((p) => p.id === meId) || null;
    const mode = autoBuildMode(game);

    // status
    const status = $('catan-status');
    if (status) {
      if (game.over) {
        const w = game.winnerId ? playerNameById(game.winnerId) : '—';
        status.textContent = tKey('catan.gameOver', `游戏结束，胜者：${w}`, {
          name: w,
        });
      } else {
        const cur = playerNameById(game.currentPlayerId);
        status.textContent = `${PHASE_LABEL[game.phase] || game.phase} · ${tKey('catan.turnOf', `当前：${cur}`, { name: cur })} · 牌堆 ${game.devDeckLeft || 0}`;
      }
    }

    const rollEl = $('catan-roll');
    if (rollEl) {
      if (game.lastRoll) {
        rollEl.hidden = false;
        rollEl.textContent = `🎲 ${game.lastRoll.d1} + ${game.lastRoll.d2} = ${game.lastRoll.total}`;
      } else {
        rollEl.hidden = true;
      }
    }

    // board
    if (window.CatanBoardView) {
      window.CatanBoardView.render($('catan-board'), game, {
        buildMode: mode,
        playerColors: playerColors(game),
        onPick: onBoardPick,
      });
    }

    // resources
    if (me && me.resources) {
      renderResChips($('catan-resources'), me.resources, false);
    } else {
      const el = $('catan-resources');
      if (el) el.innerHTML = `<span class="muted">${tKey('catan.spectating', '观战中')}</span>`;
    }
    renderDevHand(game, me);

    // actions
    const you = game.you || {};
    const btnRoll = $('btn-catan-roll');
    const btnBuy = $('btn-catan-buy-dev');
    const btnEnd = $('btn-catan-end');
    if (btnRoll) btnRoll.hidden = !you.canRoll;
    if (btnBuy) btnBuy.hidden = !you.canBuyDev;
    if (btnEnd) btnEnd.hidden = !you.canEndTurn;

    const btnRobber = $('btn-catan-mode-robber');
    if (btnRobber) btnRobber.hidden = game.phase !== 'robber';

    for (const id of [
      'btn-catan-mode-settle',
      'btn-catan-mode-city',
      'btn-catan-mode-road',
      'btn-catan-mode-robber',
    ]) {
      const b = $(id);
      if (!b) continue;
      const m = b.getAttribute('data-mode');
      b.classList.toggle('active', mode === m);
      const inMain =
        game.phase === 'main' && game.currentPlayerId === meId && !game.trade;
      if (m === 'robber') {
        b.disabled = game.phase !== 'robber' || game.currentPlayerId !== meId;
      } else if (game.phase === 'setupSettlement') {
        b.disabled = m !== 'settlement';
      } else if (game.phase === 'setupRoad') {
        b.disabled = m !== 'road';
      } else {
        b.disabled = !inMain && !(m === 'road' && game.roadBuildingPlayerId === meId);
      }
    }

    const hint = $('catan-hint');
    if (hint) {
      if (game.phase === 'setupSettlement' && game.currentPlayerId === meId) {
        hint.textContent = tKey('catan.hintSettle', '点击高亮顶点放置定居点');
      } else if (game.phase === 'setupRoad' && game.currentPlayerId === meId) {
        hint.textContent = tKey('catan.hintRoad', '点击高亮边放置道路');
      } else if (game.phase === 'robber' && game.currentPlayerId === meId) {
        hint.textContent = tKey('catan.hintRobber', '点击地形移动强盗');
      } else if (mode === 'settlement') {
        hint.textContent = tKey('catan.hintSettle', '点击高亮顶点放置定居点');
      } else if (mode === 'city') {
        hint.textContent = tKey('catan.hintCity', '点击自己的定居点升级为城市');
      } else if (mode === 'road') {
        hint.textContent = tKey('catan.hintRoad', '点击高亮边放置道路');
      } else {
        hint.textContent = '';
      }
    }

    renderDiscard(game, me);
    renderTrade(game, me);

    // players
    const ul = $('catan-players');
    if (ul) {
      ul.innerHTML = '';
      const colors = playerColors(game);
      for (const p of game.players || []) {
        const li = document.createElement('li');
        const badges = [];
        if (p.hasLongestRoad) badges.push('最长路');
        if (p.hasLargestArmy) badges.push('最大军');
        li.innerHTML = `<div class="catan-player-row">
          <span class="catan-color-dot" style="background:${colors[p.id]}"></span>
          <strong>${escapeHtml(p.name)}</strong>
          <span class="muted">VP ${p.totalVp}${p.id === meId && p.victoryCards ? `（含暗${p.victoryCards}）` : ''}</span>
          <span class="muted">资源 ${p.resourceCount}</span>
          <span class="muted">发展 ${p.devCount}</span>
          <span class="muted">骑士 ${p.knightsPlayed}</span>
          ${badges.map((b) => `<span class="catan-badge">${b}</span>`).join('')}
          ${game.currentPlayerId === p.id ? '<span class="catan-badge">行动中</span>' : ''}
        </div>`;
        ul.appendChild(li);
      }
    }

    // log
    const log = $('catan-log');
    if (log) {
      log.innerHTML = '';
      for (const entry of (game.log || []).slice().reverse()) {
        const li = document.createElement('li');
        li.textContent = entry.text;
        log.appendChild(li);
      }
    }
  }

  function bindButtons(net) {
    netRef = net;
    if (bound) return;
    bound = true;

    fillResSelect($('catan-bank-give'));
    fillResSelect($('catan-bank-want'));

    $('btn-catan-roll')?.addEventListener('click', () => send('roll', {}));
    $('btn-catan-buy-dev')?.addEventListener('click', () => send('buyDev', {}));
    $('btn-catan-end')?.addEventListener('click', () => send('endTurn', {}));
    $('btn-catan-discard')?.addEventListener('click', () => {
      send('discard', { resources: { ...discardPick } });
      discardPick = emptyRes();
    });
    $('btn-catan-bank')?.addEventListener('click', () => {
      send('bankTrade', {
        give: $('catan-bank-give').value,
        want: $('catan-bank-want').value,
      });
    });
    $('catan-bank-give')?.addEventListener('change', () => {
      if (lastGame) render(lastGame, netRef, { meId });
    });
    $('btn-catan-offer')?.addEventListener('click', () => {
      const to = $('catan-trade-to').value;
      send('offerTrade', {
        give: { ...tradeGive },
        want: { ...tradeWant },
        toPlayerId: to || null,
      });
    });
    $('btn-catan-cancel-trade')?.addEventListener('click', () =>
      send('cancelTrade', {})
    );

    for (const id of [
      'btn-catan-mode-settle',
      'btn-catan-mode-city',
      'btn-catan-mode-road',
      'btn-catan-mode-robber',
    ]) {
      $(id)?.addEventListener('click', () => {
        buildMode = $(id).getAttribute('data-mode');
        if (lastGame) render(lastGame, netRef, { meId });
      });
    }
  }

  return { bindButtons, render, hide };
})();
