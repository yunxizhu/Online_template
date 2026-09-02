'use strict';

/**
 * ?????????? ? ?? ? ??/??/????
 */
window.LasidaoFx = (function () {
  function $(id) {
    return document.getElementById(id);
  }

  function t(key, vars) {
    return window.I18n && typeof window.I18n.t === 'function'
      ? window.I18n.t(key, vars)
      : key;
  }

  function areaLabel(area) {
    const k = 'lasidao.area.' + area;
    const v = t(k);
    return v === k ? area : v;
  }

  function resLabel(key) {
    const k = 'lasidao.res.' + key;
    const v = t(k);
    return v === k ? key : v;
  }

  function formatGainResDetail(detail) {
    return (detail || [])
      .map((d) =>
        t('lasidao.fx.gainResUnit', {
          amount: d.amount,
          res: resLabel(d.resource) || d.resource,
        })
      )
      .join('、');
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** 结算演绎相对原速度的倍率（越大越快） */
  const SETTLE_SPEED = 2.5;
  let settleGen = 0;

  function settleAbortError() {
    const err = new Error('settle-aborted');
    err.name = 'SettleAbort';
    return err;
  }

  function isSettleAbort(err) {
    return Boolean(err && err.name === 'SettleAbort');
  }

  function settleMs(ms) {
    return Math.max(1, Math.round(Number(ms) / SETTLE_SPEED));
  }

  function throwIfSettleAborted(gen) {
    if (gen !== settleGen) throw settleAbortError();
  }

  async function settleSleep(ms) {
    const gen = settleGen;
    await sleep(settleMs(ms));
    throwIfSettleAborted(gen);
  }

  function abortSettle() {
    settleGen += 1;
    setBanner('');
    clearLayer();
    document
      .querySelectorAll(
        '.las-settle-focus, .las-settle-winner, .las-settle-barren'
      )
      .forEach((el) => {
        el.classList.remove(
          'las-settle-focus',
          'las-settle-winner',
          'las-settle-barren'
        );
      });
  }

  function ensureLayer() {
    let layer = $('las-fx-layer');
    if (!layer) {
      const panel = $('panel-lasidao');
      if (!panel) return null;
      layer = document.createElement('div');
      layer.id = 'las-fx-layer';
      layer.className = 'las-fx-layer';
      panel.appendChild(layer);
    }
    return layer;
  }

  function clearLayer() {
    const layer = $('las-fx-layer');
    if (layer) layer.innerHTML = '';
  }

  function rectCenter(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function slotEl(area, number) {
    return document.querySelector(
      `.las-slot[data-area="${area}"][data-num="${number}"]`
    );
  }

  function slotOverlayEl(area, number) {
    return document.querySelector(
      `.las-slot[data-area="${area}"][data-num="${number}"] .las-slot-overlay`
    );
  }

  function slotTilesWrapEl(area, number) {
    return document.querySelector(
      `.las-slot[data-area="${area}"][data-num="${number}"] .las-slot-tiles-wrap`
    );
  }

  function slotNumEl(area, number) {
    return (
      slotOverlayEl(area, number) ||
      slotTilesWrapEl(area, number) ||
      slotEl(area, number)
    );
  }

  function personalBuildEl(buildingId) {
    if (!buildingId) return null;
    const id = String(buildingId).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return document.querySelector(`.las-personal-build[data-bid="${id}"]`);
  }

  function personalBuildNumEl(buildingId) {
    const root = personalBuildEl(buildingId);
    return root ? root.querySelector('.las-personal-build-num') : null;
  }

  function playerEl(pid) {
    return document.querySelector(
      `.las-pboard[data-pid="${pid}"], #las-players li[data-pid="${pid}"]`
    );
  }

  function pushGameLog(text) {
    if (
      window.LasidaoUi &&
      typeof window.LasidaoUi.appendGameLogLine === 'function'
    ) {
      window.LasidaoUi.appendGameLogLine(text);
    }
  }

  function setBanner(text) {
    const b = $('las-settle-banner');
    if (!b) return;
    if (!text) {
      b.hidden = true;
      b.textContent = '';
      return;
    }
    b.hidden = false;
    b.textContent = text;
  }

  function nameOf(game, pid) {
    const p = (game.players || []).find((x) => x.id === pid);
    return p ? p.name : pid.slice(0, 4);
  }

  function spawnWorkerChip(layer, slot, pid, count, name, cancelled) {
    const c = rectCenter(slot);
    if (!c || !layer) return null;
    const el = document.createElement('div');
    el.className =
      'las-fx-worker' + (cancelled ? ' is-cancel' : ' is-remain');
    el.textContent = t('lasidao.fx.workerChip', { name, count });
    el.style.left = c.x + (Math.random() * 40 - 20) + 'px';
    el.style.top = c.y + (Math.random() * 30 - 10) + 'px';
    layer.appendChild(el);
    void el.offsetWidth;
    return el;
  }

  function flyToPoint(el, from, to, ms, opts) {
    opts = opts || {};
    const gen = settleGen;
    return new Promise((resolve, reject) => {
      const failIfAborted = () => {
        if (gen !== settleGen) {
          if (el && el.parentNode) el.parentNode.removeChild(el);
          reject(settleAbortError());
          return true;
        }
        return false;
      };
      if (!el) {
        resolve();
        return;
      }
      if (failIfAborted()) return;
      if (!from || !to) {
        if (opts.keep !== true && el.parentNode) el.remove();
        resolve();
        return;
      }
      el.style.left = from.x + 'px';
      el.style.top = from.y + 'px';
      const fade = opts.fade !== false;
      const fadeTo =
        typeof opts.fadeTo === 'number' ? opts.fadeTo : fade ? 0 : 1;
      const ease = opts.ease || 'linear';
      el.style.transition = [
        `left ${ms}ms ${ease}`,
        `top ${ms}ms ${ease}`,
        fade ? `opacity ${ms}ms ease` : null,
        fade ? `transform ${ms}ms ease` : null,
      ]
        .filter(Boolean)
        .join(',');
      void el.offsetWidth;
      requestAnimationFrame(() => {
        if (failIfAborted()) return;
        el.style.left = to.x + 'px';
        el.style.top = to.y + 'px';
        if (fade) {
          el.style.opacity = String(fadeTo);
          el.style.transform = 'translate(-50%, -50%) scale(0.55)';
        }
      });
      setTimeout(() => {
        if (failIfAborted()) return;
        if (opts.keep !== true && el && el.parentNode) {
          el.parentNode.removeChild(el);
        }
        resolve();
      }, ms + 40);
    });
  }

  function flyTo(el, toEl, ms) {
    const from = rectCenter(el);
    const to = rectCenter(toEl) || from;
    const dur =
      ms != null && ms > 0 ? ms : from && to ? flyDurationMs(from, to) : 400;
    return flyToPoint(el, from, to, dur, {
      fade: true,
      ease: 'linear',
    });
  }

  function tileEl(tileId) {
    if (!tileId) return null;
    const id = String(tileId).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return document.querySelector(`.las-tile[data-tile-id="${id}"]`);
  }

  function deckEl(area) {
    return (
      document.getElementById('las-deck-stack-' + area) ||
      document.querySelector(
        `.las-deck-pile[data-deck="${area}"] .las-deck-stack`
      )
    );
  }

  function distPx(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** 飞行动画基准速度 1200px/s，最短 0.1s */
  function flyDurationMs(from, to) {
    const d = distPx(from, to);
    return Math.max(100, Math.round((d / 1200) * 1000));
  }

  /** 板块摆放（发牌）相对原速度的倍率（越大越快） */
  const DEAL_SPEED = 2;

  function dealMs(ms) {
    return Math.max(1, Math.round(Number(ms) / DEAL_SPEED));
  }

  function dealFlyDurationMs(from, to) {
    return dealMs(flyDurationMs(from, to));
  }

  const DEAL_FLIP_MS = 200;
  const DEAL_STAGGER_MS = 300;

  function tileSettleCardKind(tile, areaKey) {
    if (areaKey === 'resource' || tile.kind === 'resource') return 'resource';
    if (tile.kind === 'building' || tile.buildType) return 'building';
    return 'function';
  }

  /** 结算收获：资源卡明置，功能/建筑卡显示卡背 */
  function makeSettleFlyCard(tile, areaKey, opts) {
    const faceUp = Boolean(opts && opts.faceUp);
    const srcEl = (opts && opts.srcEl) || null;
    const cardKind = tileSettleCardKind(tile, areaKey);
    const kind =
      cardKind === 'building' ? 'bld' : cardKind === 'function' ? 'fn' : 'res';
    const backKind =
      cardKind === 'building'
        ? 'building'
        : cardKind === 'function'
          ? 'function'
          : 'resource';
    const Assets = window.LasidaoAssets;
    const wrap = document.createElement('div');
    wrap.className = 'las-fx-deal is-' + kind + ' is-settle-fly';
    const face = document.createElement('div');

    if (faceUp) {
      face.className = 'las-fx-deal-face las-fx-deal-front';
      let hasArt = false;
      if (srcEl) {
        const art = srcEl.querySelector('.las-tile-art, .las-hand-card-art');
        if (art && art.style && art.style.backgroundImage) {
          face.classList.add('has-image');
          face.style.backgroundImage = art.style.backgroundImage;
          face.style.backgroundSize = 'cover';
          face.style.backgroundPosition = 'center';
          hasArt = true;
        }
      }
      if (
        !hasArt &&
        Assets &&
        cardKind === 'resource' &&
        typeof Assets.applyResourceArt === 'function'
      ) {
        hasArt = Boolean(Assets.applyResourceArt(face, tile));
      }
      if (hasArt) face.classList.add('has-image');
      else {
        face.textContent =
          tile.label || resLabel(tile.resource) || areaLabel(areaKey);
      }
    } else {
      face.className = 'las-fx-deal-face las-fx-deal-back';
      let hasBack = false;
      if (Assets && typeof Assets.applyCardBackArt === 'function') {
        hasBack = Boolean(Assets.applyCardBackArt(face, backKind));
      } else if (Assets && Assets.cardBackImageUrl) {
        const backUrl = Assets.cardBackImageUrl(backKind);
        if (backUrl) {
          face.classList.add('has-image');
          face.style.backgroundImage = 'url("' + backUrl + '")';
          hasBack = true;
        }
      }
      if (!hasBack) face.textContent = t('lasidao.faceDown');
    }

    wrap.appendChild(face);
    return wrap;
  }

  async function flySettleCard(layer, tile, areaKey, fromEl, toEl, opts) {
    const gen = settleGen;
    throwIfSettleAborted(gen);
    if (!layer || !tile || !toEl) return;
    const srcEl = tileEl(tile.id) || fromEl;
    const from = rectCenter(srcEl) || rectCenter(fromEl);
    if (!from) return;

    const fly = makeSettleFlyCard(tile, areaKey, {
      faceUp: opts && opts.faceUp,
      srcEl: srcEl && srcEl.classList && srcEl.classList.contains('las-tile')
        ? srcEl
        : null,
    });
    fly.style.left = from.x + 'px';
    fly.style.top = from.y + 'px';
    layer.appendChild(fly);
    if (srcEl && srcEl.classList && srcEl.classList.contains('las-tile')) {
      srcEl.classList.add('is-settle-claimed');
      srcEl.setAttribute('aria-hidden', 'true');
    }
    const flyMs =
      opts && opts.ms != null ? opts.ms : settleMs(1000);
    await flyTo(fly, toEl, flyMs);
    throwIfSettleAborted(gen);
    if (fly.parentNode) fly.remove();
  }

  function makeDealCard(item) {
    const tile = item.tile || item;
    const cardKind =
      item.area === 'special'
        ? tile.kind === 'building' || tile.buildType
          ? 'building'
          : 'function'
        : item.area === 'environment'
          ? 'environment'
          : item.area;
    const kind =
      cardKind === 'function'
        ? 'fn'
        : cardKind === 'building'
          ? 'bld'
          : cardKind === 'environment'
            ? 'env'
            : 'res';
    const backKind =
      cardKind === 'building'
        ? 'building'
        : cardKind === 'function'
          ? 'function'
          : cardKind === 'environment'
            ? 'environment'
            : 'resource';
    const wrap = document.createElement('div');
    wrap.className = 'las-fx-deal is-' + kind;
    const inner = document.createElement('div');
    inner.className = 'las-fx-deal-inner';
    const back = document.createElement('div');
    back.className = 'las-fx-deal-face las-fx-deal-back';
    const front = document.createElement('div');
    front.className = 'las-fx-deal-face las-fx-deal-front';
    const Assets = window.LasidaoAssets;

    let hasBack = false;
    if (Assets && typeof Assets.applyCardBackArt === 'function') {
      hasBack = Boolean(Assets.applyCardBackArt(back, backKind));
    } else if (Assets && Assets.cardBackImageUrl) {
      const backUrl = Assets.cardBackImageUrl(backKind);
      if (backUrl) {
        back.classList.add('has-image');
        back.style.backgroundImage = 'url("' + backUrl + '")';
        hasBack = true;
      }
    }
    if (!hasBack) {
      back.textContent = t('lasidao.faceDown');
    } else {
      back.textContent = '';
    }

    if (item.faceDown) {
      if (Assets && typeof Assets.applyCardBackArt === 'function') {
        Assets.applyCardBackArt(front, backKind);
      }
      if (!front.classList.contains('has-image')) {
        front.textContent = t('lasidao.faceDown');
      } else {
        front.textContent = '';
      }
    } else {
      let hasFront = false;
      if (Assets) {
        if (
          cardKind === 'resource' &&
          typeof Assets.applyResourceArt === 'function'
        ) {
          hasFront = Boolean(Assets.applyResourceArt(front, tile));
        } else if (
          cardKind === 'environment' &&
          typeof Assets.applyEnvironmentArt === 'function'
        ) {
          hasFront = Boolean(Assets.applyEnvironmentArt(front, tile));
        } else if (
          cardKind === 'function' &&
          typeof Assets.applyFunctionArt === 'function'
        ) {
          hasFront = Boolean(Assets.applyFunctionArt(front, tile));
        } else if (
          cardKind === 'building' &&
          typeof Assets.applyBuildingArt === 'function'
        ) {
          hasFront = Boolean(Assets.applyBuildingArt(front, tile));
        }
      }
      if (!hasFront) {
        front.textContent = item.label || areaLabel(item.area);
      } else {
        front.textContent = '';
      }
    }
    inner.appendChild(back);
    inner.appendChild(front);
    wrap.appendChild(inner);
    return wrap;
  }

  async function flipDealCard(card) {
    const flipMs = dealMs(DEAL_FLIP_MS);
    const inner = card.querySelector('.las-fx-deal-inner');
    if (inner) {
      inner.style.transition =
        'transform ' + flipMs + 'ms cubic-bezier(0.4, 0.05, 0.2, 1)';
    }
    void card.offsetWidth;
    card.classList.add('is-flipped');
    await sleep(flipMs);
  }

  function revealDealtTile(item, toEl) {
    if (toEl && toEl.classList && toEl.classList.contains('is-dealing')) {
      toEl.classList.remove('is-dealing');
    } else {
      const real = tileEl(item.id);
      if (real) real.classList.remove('is-dealing');
    }
  }

  /** 先以卡背飞向目标，到位后再翻开（盖牌则不翻） */
  async function dealOneCard(layer, item, from, to, toEl) {
    const fly = makeDealCard(item);
    fly.style.left = from.x + 'px';
    fly.style.top = from.y + 'px';
    layer.appendChild(fly);
    const ms = dealFlyDurationMs(from, to);
    await flyToPoint(fly, from, to, ms, {
      fade: false,
      ease: 'linear',
      keep: true,
    });
    if (!item.faceDown) {
      await flipDealCard(fly);
    }
    revealDealtTile(item, toEl);
    if (fly.parentNode) fly.remove();
  }

  async function playDeal(newcomers) {
    const layer = ensureLayer();
    if (!layer || !newcomers || !newcomers.length) return;
    const list = newcomers.slice().sort((a, b) => {
      if (a.area !== b.area) {
        const order = { resource: 0, environment: 1, special: 2 };
        return (order[a.area] || 0) - (order[b.area] || 0);
      }
      return (a.number || 0) - (b.number || 0);
    });
    setBanner(t('lasidao.fx.dealStart'));
    const inflight = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const fromDeck =
        item.area === 'special'
          ? 'special'
          : item.area === 'environment'
            ? 'environment'
            : item.area;
      const fromEl = deckEl(fromDeck);
      const toEl =
        tileEl(item.id) ||
        (item.area === 'environment'
          ? slotEl('resource', item.number)
          : slotEl(item.area, item.number));
      const from = rectCenter(fromEl);
      const to = rectCenter(toEl);
      if (!from || !to) {
        revealDealtTile(item, toEl);
      } else {
        // ?????? await ????????????????
        inflight.push(dealOneCard(layer, item, from, to, toEl));
      }
      if (i < list.length - 1) {
        await sleep(dealMs(DEAL_STAGGER_MS));
      }
    }
    await Promise.all(inflight);
    setBanner('');
  }

  /** ?????????????????? */
  async function playDispatch(opts) {
    opts = opts || {};
    const layer = ensureLayer();
    if (!layer) return;
    const face = opts.face;
    const count = Math.max(1, Number(opts.count) || 1);
    const color = opts.color || '';
    let toEl = null;
    if (opts.buildingId) {
      toEl =
        personalBuildNumEl(opts.buildingId) ||
        personalBuildEl(opts.buildingId);
    } else if (opts.area != null && opts.number != null) {
      toEl = slotNumEl(opts.area, opts.number) || slotEl(opts.area, opts.number);
    }
    const toClient = rectCenter(toEl);
    if (!toClient) return;

    const layerRect = layer.getBoundingClientRect();
    const toLayer = (p) => ({
      x: p.x - layerRect.left,
      y: p.y - layerRect.top,
    });
    const to = toLayer(toClient);

    const fromList = (opts.fromCenters || []).filter(Boolean);
    const flies = [];
    try {
      const jobs = [];
      for (let i = 0; i < count; i++) {
        const fromClient =
          fromList[i] ||
          fromList[fromList.length - 1] ||
          rectCenter($('las-dice-stage')) ||
          rectCenter($('las-dice'));
        if (!fromClient) continue;
        const jitterClient = {
          x: fromClient.x + (Math.random() * 12 - 6),
          y: fromClient.y + (Math.random() * 12 - 6),
        };
        const jitter = toLayer(jitterClient);
        const fly = document.createElement('div');
        let cls = 'las-die is-mini las-fx-dispatch-die';
        if (color) cls += ' color-' + color;
        fly.className = cls;
        fly.textContent = String(face);
        fly.style.left = jitter.x + 'px';
        fly.style.top = jitter.y + 'px';
        fly.style.opacity = '1';
        layer.appendChild(fly);
        flies.push(fly);
        const dest = {
          x: to.x + (Math.random() * 8 - 4),
          y: to.y + (Math.random() * 8 - 4),
        };
        const ms = flyDurationMs(jitterClient, {
          x: dest.x + layerRect.left,
          y: dest.y + layerRect.top,
        });
        jobs.push(
          flyToPoint(fly, jitter, dest, ms, {
            fade: true,
            fadeTo: 0,
            ease: 'linear',
          })
        );
        if (i < count - 1) await sleep(40);
      }
      await Promise.all(jobs);
    } finally {
      for (const f of flies) {
        if (f && f.parentNode) f.parentNode.removeChild(f);
      }
      layer.querySelectorAll('.las-fx-dispatch-die').forEach((el) => el.remove());
    }
  }

  async function playSlot(game, slot) {
    const gen = settleGen;
    throwIfSettleAborted(gen);
    const layer = ensureLayer();
    const boardSlot = slotEl(slot.area, slot.number);
    if (!layer || !boardSlot) return;

    const areaLab = areaLabel(slot.area);
    setBanner(
      t('lasidao.fx.slotFocus', { area: areaLab, number: slot.number })
    );

    boardSlot.classList.add('las-settle-focus');

    const physical = slot.physical || {};
    const cancelledSet = new Set(
      (slot.cancelled || []).map((c) => c.pid)
    );
    const chips = [];

    for (const [pid, diceCount] of Object.entries(physical)) {
      if (!diceCount) continue;
      const chip = spawnWorkerChip(
        layer,
        boardSlot,
        pid,
        diceCount,
        nameOf(game, pid),
        false
      );
      if (chip) chips.push({ el: chip, pid, cancelled: cancelledSet.has(pid) });
    }
    await settleSleep(600);

    const cancelChips = chips.filter((c) => c.cancelled);
    if (cancelChips.length) {
      setBanner(
        t('lasidao.fx.slotCancel', { area: areaLab, number: slot.number })
      );
      for (const c of cancelChips) {
        c.el.classList.add('is-cancel');
        const mark = document.createElement('div');
        mark.className = 'las-fx-pop';
        mark.textContent = t('lasidao.fx.cancelMark');
        const r = rectCenter(c.el);
        if (r) {
          mark.style.left = r.x + 'px';
          mark.style.top = r.y + 'px';
          layer.appendChild(mark);
          setTimeout(() => mark.remove(), settleMs(900));
        }
      }
      await settleSleep(900);
      for (const c of cancelChips) c.el.classList.add('is-gone');
      await settleSleep(500);
      for (const c of cancelChips) c.el.remove();
    }

    // 歉收标记：抵消后额外展示一次「颗粒无收」
    if (slot.barren || slot.barrenMarker) {
      const barrenKey =
        slot.area === 'special'
          ? 'lasidao.fx.barrenSpecial'
          : 'lasidao.fx.barrenHarvest';
      setBanner(
        t(barrenKey, {
          area: areaLab,
          number: slot.number,
        })
      );
      boardSlot.classList.add('las-settle-barren');
      const barrenPop = document.createElement('div');
      barrenPop.className = 'las-fx-pop is-barren';
      barrenPop.textContent = t('lasidao.fx.barrenMark');
      const center = rectCenter(boardSlot);
      if (center) {
        barrenPop.style.left = center.x + 'px';
        barrenPop.style.top = center.y - 12 + 'px';
        layer.appendChild(barrenPop);
        setTimeout(() => barrenPop.remove(), settleMs(1200));
      }
      await settleSleep(1100);
      boardSlot.classList.remove('las-settle-barren');
    }

    const winner = (slot.ranked && slot.ranked[0]) || null;
    const winDice = winner
      ? Number(winner.dice) ||
        Number((physical || {})[winner.pid]) ||
        0
      : 0;
    const remainChips = chips.filter((c) => !c.cancelled);
    if (winner) {
      setBanner(
        t('lasidao.fx.slotWinner', {
          name: winner.name,
          count: winDice,
        })
      );
      for (const c of remainChips) {
        if (c.pid === winner.pid) {
          c.el.classList.add('is-winner');
          const crown = document.createElement('div');
          crown.className = 'las-fx-pop is-win';
          crown.textContent = t('lasidao.fx.winMark');
          const r = rectCenter(c.el);
          if (r) {
            crown.style.left = r.x + 'px';
            crown.style.top = r.y - 18 + 'px';
            layer.appendChild(crown);
            setTimeout(() => crown.remove(), settleMs(1100));
          }
        } else {
          c.el.classList.add('is-second');
        }
      }
      boardSlot.classList.add('las-settle-winner');
      await settleSleep(900);
    } else if (Object.keys(physical).length) {
      setBanner(
        t('lasidao.fx.slotNobody', { area: areaLab, number: slot.number })
      );
      await settleSleep(700);
    }

    if (slot.area === 'resource' && (slot.gains || []).length) {
      const gains = slot.gains;
      for (const tile of slot.tiles || []) {
        const el = tileEl(tile.id);
        if (el && el.classList.contains('is-facedown') && !tile.faceDown) {
          el.classList.remove('is-facedown');
          const art = el.querySelector('.las-tile-art');
          if (art && window.LasidaoAssets) {
            const Assets = window.LasidaoAssets;
            if (typeof Assets.applyResourceArt === 'function') {
              Assets.applyResourceArt(art, tile);
            }
          }
          const nameEl = el.querySelector('.las-tile-name');
          if (nameEl) nameEl.textContent = tile.label || resLabel(tile.resource) || '';
        }
      }
      for (let gi = 0; gi < gains.length; gi++) {
        const g = gains[gi];
        const target = playerEl(g.pid);
        const shareKey = g.rank === 2 ? 'small' : 'large';
        const resStr = formatGainResDetail(g.detail);
        const gainLine = t('lasidao.fx.gainRes', {
          area: areaLab,
          number: slot.number,
          name: g.name,
          rank: g.rank || 1,
          res: resStr,
        });
        setBanner(gainLine);
        pushGameLog(gainLine);
        const tilesForGain = (slot.tiles || []).filter(
          (tile) => Number(tile[shareKey]) > 0 && tile.resource
        );
        for (let ti = 0; ti < tilesForGain.length; ti++) {
          await flySettleCard(
            layer,
            tilesForGain[ti],
            'resource',
            boardSlot,
            target,
            { faceUp: true }
          );
          if (ti < tilesForGain.length - 1) {
            await settleSleep(280);
          }
        }
        if (gi < gains.length - 1) {
          await settleSleep(500);
        }
      }
    } else if (
      (slot.area === 'special' ||
        slot.area === 'function' ||
        slot.area === 'building') &&
      slot.claimedBy
    ) {
      const claim = slot.claimedBy;
      const target = playerEl(claim.pid);
      const kind = areaLabel(slot.area);
      const claimLine = t('lasidao.fx.claimCards', { name: claim.name, kind });
      setBanner(claimLine);
      pushGameLog(claimLine);
      const tiles = slot.tiles || [];
      for (let ti = 0; ti < tiles.length; ti++) {
        const tile = tiles[ti];
        await flySettleCard(layer, tile, 'special', boardSlot, target, {
          faceUp: false,
        });
        if (ti < tiles.length - 1) {
          await settleSleep(500);
        }
      }
    }

    for (const c of remainChips) {
      if (c.el && c.el.parentNode) c.el.remove();
    }
    boardSlot.classList.remove('las-settle-focus', 'las-settle-winner', 'las-settle-barren');
    await settleSleep(200);
  }

  async function playSettle(game) {
    const report = game && game.lastSettle;
    if (!report) return;
    const gen = settleGen;
    const layer = ensureLayer();
    if (!layer) return;
    clearLayer();

    const slots = (report.slots || []).filter(
      (s) =>
        s &&
        (Object.keys(s.before || {}).length > 0 ||
          s.barren ||
          s.barrenMarker)
    );

    if (!slots.length) {
      setBanner(t('lasidao.fx.noWorkers'));
      await settleSleep(600);
      setBanner('');
      return;
    }

    setBanner(t('lasidao.fx.start'));
    await settleSleep(600);

    for (let si = 0; si < slots.length; si++) {
      throwIfSettleAborted(gen);
      await playSlot(game, slots[si]);
      if (si < slots.length - 1) {
        await settleSleep(500);
      }
    }

    throwIfSettleAborted(gen);
    if ((report.buildings || []).length) {
      setBanner(t('lasidao.fx.buildingProduce'));
      for (const b of report.buildings) {
        throwIfSettleAborted(gen);
        const produceLine = `${b.name} 的${b.label}产出 ${b.amount} ${resLabel(b.resource) || b.resource || ''}`;
        pushGameLog(produceLine);
        const target = playerEl(b.pid);
        const fly = document.createElement('div');
        fly.className = 'las-fx-loot is-res';
        fly.textContent = `${b.label}+${b.amount}`;
        const from = target ? rectCenter(target) : null;
        if (from && target) {
          fly.style.left = from.x + 'px';
          fly.style.top = from.y - 30 + 'px';
          layer.appendChild(fly);
          await settleSleep(400);
          fly.classList.add('is-pop');
          await settleSleep(800);
          fly.remove();
        }
      }
    }

    throwIfSettleAborted(gen);
    if (report.mvp) {
      setBanner(
        t('lasidao.fx.mvp', {
          name: report.mvp.name,
          gained: report.mvp.gained,
        })
      );
      const target = playerEl(report.mvp.id);
      if (target) {
        target.classList.add('las-mvp-flash');
        target.style.animationDuration = settleMs(1000) + 'ms';
        await settleSleep(1400);
        target.classList.remove('las-mvp-flash');
        target.style.animationDuration = '';
      } else {
        await settleSleep(1200);
      }
    }

    setBanner('');
    clearLayer();
  }

  /** 结算后：场上未取走的卡飞回对应弃牌堆 */
  async function playRecycleBoard(game) {
    const gen = settleGen;
    throwIfSettleAborted(gen);
    const layer = ensureLayer();
    if (!layer) return;

    const tileNodes = Array.from(
      document.querySelectorAll(
        '#las-board-resource .las-tile, #las-board-special .las-tile'
      )
    ).filter((el) => el && el.getBoundingClientRect().width > 0);

    setBanner(t('lasidao.fx.recycleBoard'));

    if (!tileNodes.length) {
      await settleSleep(500);
      setBanner('');
      return;
    }

    const layerRect = layer.getBoundingClientRect();
    const toLayerPt = (p) => ({
      x: p.x - layerRect.left,
      y: p.y - layerRect.top,
    });

    const jobs = [];
    for (let i = 0; i < tileNodes.length; i++) {
      throwIfSettleAborted(gen);
      const el = tileNodes[i];
      const discardKind = el.classList.contains('environment')
        ? 'environment'
        : el.classList.contains('resource')
          ? 'resource'
          : 'special';
      const fromClient = rectCenter(el);
      const toEl = deckEl(discardKind);
      const toClient = rectCenter(toEl) || fromClient;
      if (!fromClient) continue;

      el.classList.add('is-recycling');
      el.style.opacity = '0.15';

      const fly = document.createElement('div');
      fly.className =
        'las-fx-deal is-' +
        (discardKind === 'resource'
          ? 'res'
          : discardKind === 'environment'
            ? 'env'
            : el.classList.contains('building')
              ? 'bld'
              : 'fn');
      const face = document.createElement('div');
      face.className = 'las-fx-deal-face las-fx-deal-front has-image';
      const art = el.querySelector('.las-tile-art, .las-hand-card-art');
      if (art && art.style && art.style.backgroundImage) {
        face.style.backgroundImage = art.style.backgroundImage;
        face.style.backgroundSize = 'cover';
        face.style.backgroundPosition = 'center';
      } else {
        face.classList.remove('has-image');
        face.textContent =
          el.getAttribute('aria-label') ||
          (el.querySelector('.las-tile-name') &&
            el.querySelector('.las-tile-name').textContent) ||
          '';
      }
      fly.appendChild(face);
      const from = toLayerPt(fromClient);
      fly.style.left = from.x + 'px';
      fly.style.top = from.y + 'px';
      layer.appendChild(fly);

      const to = toLayerPt(toClient);
      const ms = settleMs(Math.max(280, flyDurationMs(fromClient, toClient)));
      jobs.push(
        (async () => {
          await settleSleep(i * 55);
          await flyToPoint(fly, from, to, ms, {
            fade: true,
            fadeTo: 0.05,
            ease: 'linear',
          });
          if (fly.parentNode) fly.remove();
        })()
      );
    }

    try {
      await Promise.all(jobs);
    } catch (err) {
      if (!isSettleAbort(err)) throw err;
      clearLayer();
      throw err;
    }
    await settleSleep(200);
    setBanner('');
    clearLayer();
  }

  /** 驱逐：将棋子从源格移到目标格 */
  async function playExile(opts) {
    opts = opts || {};
    const layer = ensureLayer();
    if (!layer) return;
    const game = opts.game || {};
    const fromEl =
      opts.area != null && opts.number != null
        ? slotEl(opts.area, opts.number)
        : null;
    const toEl =
      opts.toArea != null && opts.toNumber != null
        ? slotEl(opts.toArea, opts.toNumber)
        : null;
    const targetName = nameOf(game, opts.targetId);
    const actorName = nameOf(game, opts.actorId);
    const fromLab = opts.area ? areaLabel(opts.area) : '';
    const toLab = opts.toArea ? areaLabel(opts.toArea) : '';

    setBanner(
      opts.toArea != null && opts.toNumber != null
        ? t('lasidao.fx.exileMove', {
            actor: actorName,
            target: targetName,
            area: fromLab,
            number: opts.number,
            toArea: toLab,
            toNumber: opts.toNumber,
          })
        : t('lasidao.fx.exile', {
            actor: actorName,
            target: targetName,
            area: fromLab,
            number: opts.number,
          })
    );

    if (fromEl) fromEl.classList.add('las-fx-exile-focus');
    if (toEl) toEl.classList.add('las-fx-exile-focus');
    await sleep(350);

    const chip = spawnWorkerChip(
      layer,
      fromEl,
      opts.targetId,
      1,
      targetName,
      false
    );
    if (chip) {
      chip.classList.add('is-exile-victim');
      const from = rectCenter(chip);
      const to = rectCenter(toEl) || from;
      const mark = document.createElement('div');
      mark.className = 'las-fx-pop is-exile';
      mark.textContent = t('lasidao.fx.exileMark');
      if (from) {
        mark.style.left = from.x + 'px';
        mark.style.top = from.y - 28 + 'px';
        layer.appendChild(mark);
        setTimeout(() => mark.remove(), 900);
      }
      await sleep(200);
      if (from && to && (from.x !== to.x || from.y !== to.y)) {
        chip.style.transition = 'left 0.55s ease, top 0.55s ease, transform 0.55s ease';
        chip.style.left = to.x + 'px';
        chip.style.top = to.y + 'px';
        await sleep(580);
      } else {
        chip.classList.add('is-exile-out');
        await sleep(700);
      }
      if (chip.parentNode) chip.remove();
    }

    if (fromEl) fromEl.classList.remove('las-fx-exile-focus');
    if (toEl) toEl.classList.remove('las-fx-exile-focus');
    await sleep(250);
    setBanner('');
  }

  /** 强盗来袭：中立骰飞入目标格子 */
  async function playBanditRaid(opts) {
    opts = opts || {};
    const layer = ensureLayer();
    if (!layer) return;
    const game = opts.game || {};
    const area = opts.area;
    const number = opts.number;
    const count = Math.max(1, Number(opts.count) || 2);
    const areaLab = areaLabel(area);
    const actorName = nameOf(game, opts.actorId);
    const neutralName =
      (game && game.neutralWorkerName) || t('lasidao.neutralName');

    setBanner(
      t('lasidao.fx.banditRaid', {
        name: actorName,
        area: areaLab,
        number,
        count,
        neutral: neutralName,
      })
    );
    await sleep(400);

    const boardSlot = slotEl(area, number);
    if (boardSlot) boardSlot.classList.add('las-fx-bandit-hit');

    const toEl = slotNumEl(area, number) || boardSlot;
    const toClient = rectCenter(toEl);
    if (!toClient) {
      await sleep(800);
      if (boardSlot) boardSlot.classList.remove('las-fx-bandit-hit');
      setBanner('');
      return;
    }

    const layerRect = layer.getBoundingClientRect();
    const toLayer = (p) => ({
      x: p.x - layerRect.left,
      y: p.y - layerRect.top,
    });
    const to = toLayer(toClient);
    const fromEl = playerEl(opts.actorId) || $('las-act-hand');
    const fromClient =
      rectCenter(fromEl) || rectCenter($('las-dice-stage')) || toClient;

    const flies = [];
    try {
      const jobs = [];
      for (let i = 0; i < count; i++) {
        const jitterClient = {
          x: fromClient.x + (Math.random() * 24 - 12),
          y: fromClient.y + (Math.random() * 16 - 8),
        };
        const jitter = toLayer(jitterClient);
        const fly = document.createElement('div');
        fly.className = 'las-die is-mini las-fx-dispatch-die color-neutral is-bandit';
        fly.textContent = '?';
        fly.style.left = jitter.x + 'px';
        fly.style.top = jitter.y + 'px';
        fly.style.opacity = '1';
        layer.appendChild(fly);
        flies.push(fly);
        const dest = {
          x: to.x + (Math.random() * 10 - 5),
          y: to.y + (Math.random() * 10 - 5),
        };
        const ms = flyDurationMs(jitterClient, {
          x: dest.x + layerRect.left,
          y: dest.y + layerRect.top,
        });
        jobs.push(
          flyToPoint(fly, jitter, dest, ms, {
            fade: true,
            fadeTo: 0.15,
            ease: 'linear',
            keep: true,
          })
        );
        if (i < count - 1) await sleep(80);
      }
      await Promise.all(jobs);

      const pop = document.createElement('div');
      pop.className = 'las-fx-pop is-bandit';
      pop.textContent = t('lasidao.fx.banditMark', { name: neutralName, count });
      pop.style.left = toClient.x + 'px';
      pop.style.top = toClient.y - 24 + 'px';
      layer.appendChild(pop);
      setTimeout(() => pop.remove(), 1100);
      await sleep(700);
    } finally {
      for (const f of flies) {
        if (f && f.parentNode) f.parentNode.removeChild(f);
      }
      if (boardSlot) boardSlot.classList.remove('las-fx-bandit-hit');
    }

    setBanner('');
  }

  async function playVictory(game) {
    const layer = ensureLayer();
    if (!layer) return;
    clearLayer();
    const winners = new Set(game && game.winners ? game.winners : []);
    const winnerEl =
      winners.size === 1
        ? playerEl(Array.from(winners)[0])
        : $('las-victory-dialog');
    const center = rectCenter(winnerEl) || {
      x: window.innerWidth / 2,
      y: window.innerHeight * 0.38,
    };
    const colors = ['#f3e7b8', '#e8c85a', '#7ec8ff', '#8fd694', '#ff9f7a', '#c89bff'];
    const jobs = [];
    for (let i = 0; i < 42; i++) {
      jobs.push(
        (async () => {
          await sleep(Math.random() * 180);
          const bit = document.createElement('div');
          bit.className = 'las-fx-confetti';
          bit.style.left = center.x + (Math.random() - 0.5) * 220 + 'px';
          bit.style.top = center.y + (Math.random() - 0.5) * 80 + 'px';
          bit.style.background = colors[i % colors.length];
          bit.style.setProperty('--dx', (Math.random() - 0.5) * 160 + 'px');
          bit.style.setProperty('--dy', 80 + Math.random() * 140 + 'px');
          bit.style.setProperty('--dur', 0.85 + Math.random() * 0.55 + 's');
          layer.appendChild(bit);
          setTimeout(() => bit.remove(), 1600);
        })()
      );
    }
    await Promise.all(jobs);
    await sleep(500);
    clearLayer();
  }

  return {
    playSettle,
    playRecycleBoard,
    playDeal,
    playDispatch,
    playExile,
    playBanditRaid,
    playVictory,
    clearLayer,
    setBanner,
    abortSettle,
    settleSleep,
    isSettleAbort,
  };
})();
