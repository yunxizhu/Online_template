
  function renderMePanel(game, meId) {
    const me = mePlayer(game, meId);
    const nameEl = $('las-me-info-name');
    const capsEl = $('las-me-info-caps');
    const statsEl = $('las-me-info-stats');
    const resEl = $('las-me-info-res');
    if (!me) {
      if (nameEl) nameEl.innerHTML = '';
      if (capsEl) capsEl.textContent = '';
      if (statsEl) statsEl.textContent = '';
      if (resEl) resEl.innerHTML = '';
      return;
    }

    const labels = getResLabels(game);
    const maxB = me.maxBuildings || (game.maxBuildings || 3) + (Number(me.expandSlots) || 0);
    const maxFunc = me.maxFuncHand || MAX_FUNC_HAND_UI;
    const maxRes = me.maxResourceHand != null ? me.maxResourceHand : (game.me && game.me.maxResourceHand != null ? game.me.maxResourceHand : 12);
    const totalRes = Object.values(me.resources || {}).reduce((a, b) => a + b, 0);
    const funcN = me.funcCount != null ? me.funcCount : (me.funcCards || []).length;
    const buildN = occupiedBuildSlotKeys(me).size;

    if (nameEl) {
      const color = playerDieColor(game.players, me.id);
      const swatch = document.createElement('span');
      swatch.className = 'las-die-swatch color-' + color;
      const Nick = window.PlayerNick;
      const nameHtml = (Nick && Nick.formatHtml ? Nick.formatHtml(me.name, me.tag) : escapeHtml(me.name));
      nameEl.innerHTML = '';
      nameEl.appendChild(swatch);
      const nameSpan = document.createElement('span');
      nameSpan.innerHTML = nameHtml + ' <span class="you">(' + t('lasidao.youMark') + ')</span>';
      nameEl.appendChild(nameSpan);
    }
    if (capsEl) {
      capsEl.textContent = t('lasidao.playerCaps', { res: totalRes, resMax: maxRes, func: funcN, funcMax: maxFunc, build: buildN, buildMax: maxB });
    }
    if (statsEl) {
      const freeH = me.freeHouses != null ? me.freeHouses : Math.max(0, (me.houses != null ? me.houses : 3) - (me.villagers || 0));
      statsEl.textContent = t('lasidao.playerStatsCompact', { score: me.score, villagers: me.villagers, houses: me.houses != null ? me.houses : 3, freeH });
    }
    if (resEl) {
      resEl.innerHTML = '';
      for (const r of RESOURCES) {
        const v = me.resources[r] || 0;
        if (!v) continue;
        const badge = document.createElement('span');
        badge.className = 'las-res ' + r;
        badge.textContent = (labels[r] || r) + ' ' + v;
        resEl.appendChild(badge);
      }
    }

    // cell-10 building slots
    const slotsHost = $('las-me-build-slots');
    if (slotsHost) {
      slotsHost.innerHTML = '';
      const bySlot = groupPlacedBuildingsBySlot(me);
      const slotOrder = noneSlotKeysFor(me).filter((k) => bySlot.has(String(k)));
      for (const [k] of bySlot) {
        if (!slotOrder.includes(k)) slotOrder.push(k);
      }
      for (const slotKey of slotOrder) {
        const group = bySlot.get(slotKey) || [];
        const cell = document.createElement('div');
        cell.className = 'las-pboard-slot las-pboard-slot-none is-filled' + (group.length > 1 ? ' is-stack' : '');
        cell.dataset.slot = slotKey;
        const body = document.createElement('div');
        body.className = 'las-pboard-slot-body';
        const ordered = group.slice().sort((a, b) => (a.built ? 1 : 0) - (b.built ? 1 : 0));
        if (ordered.length > 1) cell.style.setProperty('--stack-n', String(ordered.length));
        ordered.forEach((b, i) => {
          const card = makeBoardBuildingCard(game, meId, me, b, true);
          if (ordered.length > 1) card.style.setProperty('--stack-i', String(i));
          body.appendChild(card);
        });
        if (ordered.length > 1) {
          const badge = document.createElement('span');
          badge.className = 'las-pboard-stack-badge';
          badge.textContent = '×' + ordered.length;
          cell.appendChild(badge);
        }
        cell.appendChild(body);
        if (isHomogeneousStackSlot(me, slotKey)) {
          cell.classList.add('is-stackable');
          const slotStackKey = buildingStackKey(group[0]);
          cell.onclick = (ev) => {
            if (ev.target && ev.target.closest && ev.target.closest('.las-pboard-card')) return;
            const unplacedMatch = (me.buildings || []).find((b) => !b.built && b.slot == null && buildingStackKey(b) === slotStackKey);
            if (!unplacedMatch || !netRef) return;
            netRef.sendAction('placeBuildingSlot', { buildingId: unplacedMatch.id, slot: slotKey });
          };
        }
        slotsHost.appendChild(cell);
      }
      const emptyCount = Math.max(0, maxB - bySlot.size);
      for (let i = 0; i < emptyCount; i++) {
        const cell = document.createElement('div');
        cell.className = 'las-pboard-slot las-pboard-slot-none is-empty';
        cell.setAttribute('aria-hidden', 'true');
        const body = document.createElement('div');
        body.className = 'las-pboard-slot-body';
        cell.classList.add('is-drop');
        cell.removeAttribute('aria-hidden');
        cell.onclick = () => {
          const unplaced = (me.buildings || []).find((b) => !b.built && b.slot == null);
          if (!unplaced || !netRef) return;
          const slot = pickPlaceSlotForBuilding(me, unplaced);
          if (slot == null) return;
          netRef.sendAction('placeBuildingSlot', { buildingId: unplaced.id, slot });
        };
        cell.appendChild(body);
        slotsHost.appendChild(cell);
      }
    }
  }
