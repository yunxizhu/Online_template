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

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
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

  function slotNumEl(area, number) {
    return document.querySelector(
      `.las-slot[data-area="${area}"][data-num="${number}"] .las-slot-num`
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
    return new Promise((resolve) => {
      if (!el) {
        resolve();
        return;
      }
      if (!from || !to) {
        el.remove();
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
        el.style.left = to.x + 'px';
        el.style.top = to.y + 'px';
        if (fade) {
          el.style.opacity = String(fadeTo);
          el.style.transform = 'translate(-50%, -50%) scale(0.55)';
        }
      });
      setTimeout(() => {
        if (el && el.parentNode) el.parentNode.removeChild(el);
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

  /** ???? 1200px/s??? 0.1s */
  function flyDurationMs(from, to) {
    const d = distPx(from, to);
    return Math.max(100, Math.round((d / 1200) * 1000));
  }

  const DEAL_FLIP_MS = 200;
  /** ???????????????????? */
  const DEAL_STAGGER_MS = 300;

  function makeDealCard(item) {
    const kind =
      item.area === 'function' ? 'fn' : item.area === 'building' ? 'bld' : 'res';
    const wrap = document.createElement('div');
    wrap.className = 'las-fx-deal is-' + kind;
    const inner = document.createElement('div');
    inner.className = 'las-fx-deal-inner';
    const back = document.createElement('div');
    back.className = 'las-fx-deal-face las-fx-deal-back';
    back.textContent = t('lasidao.faceDown');
    const front = document.createElement('div');
    front.className = 'las-fx-deal-face las-fx-deal-front';
    front.textContent = item.faceDown
      ? t('lasidao.faceDown')
      : item.label || areaLabel(item.area);
    inner.appendChild(back);
    inner.appendChild(front);
    wrap.appendChild(inner);
    return wrap;
  }

  async function flipDealCard(card) {
    void card.offsetWidth;
    card.classList.add('is-flipped');
    await sleep(DEAL_FLIP_MS);
  }

  function revealDealtTile(item, toEl) {
    if (toEl && toEl.classList && toEl.classList.contains('is-dealing')) {
      toEl.classList.remove('is-dealing');
    } else {
      const real = tileEl(item.id);
      if (real) real.classList.remove('is-dealing');
    }
  }

  /** ??????????? ?? ? ???????????????? */
  async function dealOneCard(layer, item, from, to, toEl) {
    const fly = makeDealCard(item);
    fly.style.left = from.x + 'px';
    fly.style.top = from.y + 'px';
    layer.appendChild(fly);
    if (!item.faceDown) {
      await flipDealCard(fly);
    }
    const ms = flyDurationMs(from, to);
    await flyToPoint(fly, from, to, ms, { fade: false, ease: 'linear' });
    revealDealtTile(item, toEl);
  }

  async function playDeal(newcomers) {
    const layer = ensureLayer();
    if (!layer || !newcomers || !newcomers.length) return;
    const list = newcomers.slice().sort((a, b) => {
      if (a.area !== b.area) {
        const order = { resource: 0, function: 1, building: 2 };
        return (order[a.area] || 0) - (order[b.area] || 0);
      }
      return (a.number || 0) - (b.number || 0);
    });
    setBanner(t('lasidao.fx.dealStart'));
    const inflight = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const fromEl = deckEl(item.area);
      const toEl = tileEl(item.id) || slotEl(item.area, item.number);
      const from = rectCenter(fromEl);
      const to = rectCenter(toEl);
      if (!from || !to) {
        revealDealtTile(item, toEl);
      } else {
        // ?????? await ????????????????
        inflight.push(dealOneCard(layer, item, from, to, toEl));
      }
      if (i < list.length - 1) {
        await sleep(DEAL_STAGGER_MS);
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
    const layer = ensureLayer();
    const boardSlot = slotEl(slot.area, slot.number);
    if (!layer || !boardSlot) return;

    const areaLab = areaLabel(slot.area);
    setBanner(
      t('lasidao.fx.slotFocus', { area: areaLab, number: slot.number })
    );

    boardSlot.classList.add('las-settle-focus');

    const before = slot.before || {};
    const cancelledSet = new Set(
      (slot.cancelled || []).map((c) => c.pid)
    );
    const chips = [];

    for (const [pid, count] of Object.entries(before)) {
      if (!count) continue;
      const chip = spawnWorkerChip(
        layer,
        boardSlot,
        pid,
        count,
        nameOf(game, pid),
        false
      );
      if (chip) chips.push({ el: chip, pid, cancelled: cancelledSet.has(pid) });
    }
    await sleep(450);

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
          setTimeout(() => mark.remove(), 700);
        }
      }
      await sleep(750);
      for (const c of cancelChips) c.el.classList.add('is-gone');
      await sleep(350);
      for (const c of cancelChips) c.el.remove();
    }

    const winner = (slot.ranked && slot.ranked[0]) || null;
    const remainChips = chips.filter((c) => !c.cancelled);
    if (winner) {
      setBanner(
        t('lasidao.fx.slotWinner', {
          name: winner.name,
          count: winner.count,
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
            setTimeout(() => crown.remove(), 900);
          }
        } else {
          c.el.classList.add('is-second');
        }
      }
      boardSlot.classList.add('las-settle-winner');
      await sleep(700);
    } else if (Object.keys(before).length) {
      setBanner(
        t('lasidao.fx.slotNobody', { area: areaLab, number: slot.number })
      );
      await sleep(500);
    }

    if (slot.area === 'resource' && (slot.gains || []).length) {
      for (const g of slot.gains) {
        const target = playerEl(g.pid);
        setBanner(
          t('lasidao.fx.gainRes', {
            name: g.name,
            share: t(
              g.rank === 1 ? 'lasidao.fx.largeShare' : 'lasidao.fx.smallShare'
            ),
            amount: g.amount,
          })
        );
        for (const d of g.detail || []) {
          const fly = document.createElement('div');
          fly.className = 'las-fx-loot is-res';
          fly.textContent =
            (resLabel(d.resource) || d.resource) + '+' + d.amount;
          const from = rectCenter(boardSlot);
          if (from) {
            fly.style.left = from.x + 'px';
            fly.style.top = from.y + 'px';
            layer.appendChild(fly);
            await flyTo(fly, target);
          }
        }
      }
    } else if (
      (slot.area === 'function' || slot.area === 'building') &&
      slot.claimedBy
    ) {
      const claim = slot.claimedBy;
      const target = playerEl(claim.pid);
      const kind = areaLabel(slot.area);
      setBanner(
        t('lasidao.fx.claimCards', { name: claim.name, kind })
      );
      for (const tile of slot.tiles || []) {
        const fly = document.createElement('div');
        fly.className =
          'las-fx-loot ' + (slot.area === 'function' ? 'is-fn' : 'is-bld');
        fly.textContent =
          tile.faceDown && !tile.label
            ? t('lasidao.faceDown')
            : tile.label || '?';
        const src = tileEl(tile.id) || boardSlot;
        const from = rectCenter(src);
        if (from) {
          fly.style.left = from.x + 'px';
          fly.style.top = from.y + 'px';
          layer.appendChild(fly);
          if (src && src.classList && src.classList.contains('las-tile')) {
            src.style.opacity = '0.15';
          }
          await flyTo(fly, target);
        }
      }
    }

    for (const c of remainChips) {
      if (c.el && c.el.parentNode) c.el.remove();
    }
    boardSlot.classList.remove('las-settle-focus', 'las-settle-winner');
    await sleep(120);
  }

  async function playSettle(game) {
    const report = game && game.lastSettle;
    if (!report) return;
    const layer = ensureLayer();
    if (!layer) return;
    clearLayer();

    const slots = (report.slots || []).filter(
      (s) => s && Object.keys(s.before || {}).length > 0
    );

    if (!slots.length) {
      setBanner(t('lasidao.fx.noWorkers'));
      await sleep(600);
      setBanner('');
      return;
    }

    setBanner(t('lasidao.fx.start'));
    await sleep(400);

    for (const slot of slots) {
      await playSlot(game, slot);
    }

    if ((report.buildings || []).length) {
      setBanner(t('lasidao.fx.buildingProduce'));
      for (const b of report.buildings) {
        const target = playerEl(b.pid);
        const fly = document.createElement('div');
        fly.className = 'las-fx-loot is-res';
        fly.textContent = `${b.label}+${b.amount}`;
        const from = target ? rectCenter(target) : null;
        if (from && target) {
          fly.style.left = from.x + 'px';
          fly.style.top = from.y - 30 + 'px';
          layer.appendChild(fly);
          await sleep(200);
          fly.classList.add('is-pop');
          await sleep(500);
          fly.remove();
        }
      }
    }

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
        await sleep(1100);
        target.classList.remove('las-mvp-flash');
      } else {
        await sleep(900);
      }
    }

    setBanner('');
    clearLayer();
  }

  return { playSettle, playDeal, playDispatch, clearLayer, setBanner };
})();
