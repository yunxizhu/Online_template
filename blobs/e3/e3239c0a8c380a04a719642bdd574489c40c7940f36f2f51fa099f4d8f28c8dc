'use strict';

/**
 * 三国杀桌面特效：飞牌、光线、弃牌堆字幕
 */
window.SgsFx = (function () {
  function $(id) {
    return document.getElementById(id);
  }

  function rectCenter(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  }

  function rectBox(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  function ensureLayer() {
    const arena = $('sgs-arena');
    if (!arena) return null;
    let layer = $('sgs-fx-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'sgs-fx-layer';
      layer.className = 'sgs-fx-layer';
      arena.appendChild(layer);
    }
    return layer;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function flyCard({ card, faceDown, from, to, duration }) {
    return new Promise((resolve) => {
      if (!from || !to) {
        resolve();
        return;
      }
      ensureLayer();
      const A = window.SgsAssets;
      const el = A.createCardEl(card || null, {
        faceDown: Boolean(faceDown),
        size: 'md',
      });
      el.classList.add('sgs-fx-card');
      const w = 72;
      const h = 100;
      el.style.width = w + 'px';
      el.style.height = h + 'px';
      el.style.left = from.x - w / 2 + 'px';
      el.style.top = from.y - h / 2 + 'px';
      const ms = duration || 450;
      el.style.transition = [
        `left ${ms}ms cubic-bezier(0.22, 0.7, 0.25, 1)`,
        `top ${ms}ms cubic-bezier(0.22, 0.7, 0.25, 1)`,
        `transform ${ms}ms ease`,
        `opacity ${Math.min(ms, 420)}ms ease`,
      ].join(', ');
      document.body.appendChild(el);
      void el.offsetWidth;
      requestAnimationFrame(() => {
        el.style.left = to.x - w / 2 + 'px';
        el.style.top = to.y - h / 2 + 'px';
      });
      setTimeout(() => {
        el.remove();
        resolve();
      }, ms + 40);
    });
  }

  /** 武将卡从选将位飞到角色卡槽（尺寸随路径插值） */
  function animateHeroFly({ portrait, from, to, duration }) {
    return new Promise((resolve) => {
      if (!from || !to) {
        resolve();
        return;
      }
      const A = window.SgsAssets;
      if (!A || !A.createHeroCardEl) {
        resolve();
        return;
      }
      const el = A.createHeroCardEl(portrait, { size: 'self', title: '武将' });
      el.classList.add('sgs-fx-hero');
      const fw = from.w || 156;
      const fh = from.h || Math.round((fw * 320) / 234);
      const tw = to.w || 234;
      const th = to.h || Math.round((tw * 320) / 234);
      el.style.width = fw + 'px';
      el.style.height = fh + 'px';
      el.style.left = from.x + 'px';
      el.style.top = from.y + 'px';
      document.body.appendChild(el);
      // 强制布局后再过渡
      void el.offsetWidth;
      requestAnimationFrame(() => {
        el.style.left = to.x + 'px';
        el.style.top = to.y + 'px';
        el.style.width = tw + 'px';
        el.style.height = th + 'px';
      });
      const ms = duration || 620;
      setTimeout(() => {
        el.remove();
        resolve();
      }, ms + 40);
    });
  }

  /**
   * 身份牌开场：屏幕中央放大展示 → 缩小飞向自己身份牌位置
   * @param {{ identity: string, to: {x,y,w,h}, holdMs?: number, flyMs?: number }} opts
   */
  function animateIdentityReveal(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const identity = opts.identity;
      const to = opts.to;
      const A = window.SgsAssets;
      const url =
        A && typeof A.identityUrl === 'function'
          ? A.identityUrl(identity)
          : null;
      if (!url || !to) {
        resolve();
        return;
      }

      const holdMs = opts.holdMs != null ? opts.holdMs : 1100;
      const flyMs = opts.flyMs != null ? opts.flyMs : 680;
      const bigW = 168;

      const veil = document.createElement('div');
      veil.className = 'sgs-fx-identity-veil';
      document.body.appendChild(veil);

      const el = document.createElement('img');
      el.className = 'sgs-fx-identity';
      el.src = url;
      el.alt =
        (A.identityLabel && A.identityLabel(identity)) || identity || '身份';
      el.draggable = false;
      document.body.appendChild(el);

      const placeCenter = () => {
        const bigH = el.offsetHeight || Math.round(bigW * 1.38);
        el.style.width = bigW + 'px';
        el.style.height = bigH + 'px';
        el.style.left = Math.round(window.innerWidth / 2 - bigW / 2) + 'px';
        el.style.top = Math.round(window.innerHeight / 2 - bigH / 2) + 'px';
      };

      const finish = () => {
        try {
          el.remove();
        } catch (_) {
          /* ignore */
        }
        try {
          veil.remove();
        } catch (_) {
          /* ignore */
        }
        resolve();
      };

      const startFly = () => {
        placeCenter();
        void el.offsetWidth;
        el.classList.add('is-show');
        setTimeout(() => {
          const tw = Math.max(28, to.w || 36);
          const th = Math.max(36, to.h || Math.round(tw * 1.35));
          el.classList.add('is-flying');
          veil.classList.add('is-fade');
          el.style.left = Math.round(to.x) + 'px';
          el.style.top = Math.round(to.y) + 'px';
          el.style.width = tw + 'px';
          el.style.height = th + 'px';
          setTimeout(finish, flyMs + 40);
        }, holdMs);
      };

      if (el.complete && el.naturalWidth) {
        requestAnimationFrame(startFly);
      } else {
        el.onload = () => requestAnimationFrame(startFly);
        el.onerror = finish;
        setTimeout(() => {
          if (!el.classList.contains('is-show')) startFly();
        }, 400);
      }
    });
  }

  function castRay(from, to) {
    if (!from || !to) return;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 8) return;
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    const ray = document.createElement('div');
    ray.className = 'sgs-fx-ray';
    ray.style.left = from.x + 'px';
    ray.style.top = from.y + 'px';
    ray.style.width = len + 'px';
    ray.style.transform = `rotate(${ang}deg)`;
    document.body.appendChild(ray);
    setTimeout(() => ray.remove(), 750);
  }

  async function animateSeatText({ playerId, text, cls }) {
    const pt = seatPoint(playerId);
    if (!pt || !text) return;
    const el = document.createElement('div');
    el.className = 'sgs-fx-seat-text' + (cls ? ' ' + cls : '');
    el.textContent = text;
    el.style.left = pt.x + 'px';
    el.style.top = pt.y + 'px';
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.classList.add('is-show');
    });
    await sleep(820);
    el.remove();
  }

  function damageHostEl(playerId) {
    const seats = document.querySelectorAll('#sgs-opponents .sgs-seat');
    for (const seat of seats) {
      if (seat.dataset.playerId === playerId) return seat;
    }
    const self = $('sgs-self');
    if (self && self.dataset.playerId === playerId) {
      return $('sgs-self-info') || self;
    }
    return null;
  }

  /** 受伤：武将卡抖动；掉血数字先放大，再抖两下，再渐隐 */
  async function animateDamageHit({ playerId, amount }) {
    const host = damageHostEl(playerId);
    const card =
      (host &&
        (host.querySelector('.sgs-hero-card--self') ||
          host.querySelector('.sgs-hero-card'))) ||
      host;
    const box = rectBox(card) || rectBox(host);
    if (host) {
      host.classList.remove('is-hit');
      void host.offsetWidth;
      host.classList.add('is-hit');
      setTimeout(() => host.classList.remove('is-hit'), 560);
    }
    if (!box) return;

    const n = Math.max(1, Math.floor(Number(amount) || 1));
    const el = document.createElement('div');
    el.className = 'sgs-fx-hp-loss';
    el.textContent = `-${n}`;
    const fontPx = Math.max(36, Math.min(76, Math.round(box.w * 0.58)));
    el.style.fontSize = fontPx + 'px';
    el.style.left = box.x + box.w / 2 + 'px';
    el.style.top = box.y + box.h * 0.42 + 'px';
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.classList.add('is-play');
    });
    await sleep(1180);
    el.remove();
    if (host) host.classList.remove('is-hit');
  }

  function setDiscardCaption(text) {
    const el = $('sgs-discard-caption');
    if (!el) return;
    el.textContent = text || '';
    if (text) {
      clearTimeout(setDiscardCaption._t);
      setDiscardCaption._t = setTimeout(() => {
        if (el.textContent === text) el.textContent = '';
      }, 2200);
    }
  }

  function pilePoint(which) {
    const id = which === 'discard' ? 'sgs-discard-visual' : 'sgs-draw-visual';
    return rectCenter($(id)) || rectCenter($('sgs-center'));
  }

  function seatPoint(playerId) {
    const seats = document.querySelectorAll('#sgs-opponents .sgs-seat');
    for (const seat of seats) {
      if (seat.dataset.playerId === playerId) return rectCenter(seat);
    }
    const anchors = document.querySelectorAll('#sgs-opponents .sgs-seat-anchor');
    for (const a of anchors) {
      if (a.dataset.playerId === playerId) {
        return rectCenter(a.querySelector('.sgs-seat')) || rectCenter(a);
      }
    }
    if ($('sgs-self') && $('sgs-self').dataset.playerId === playerId) {
      return rectCenter($('sgs-self'));
    }
    return rectCenter($('sgs-self'));
  }

  function handPoint() {
    return rectCenter($('sgs-hand')) || rectCenter($('sgs-hand-wrap'));
  }

  /** 手牌最右端（新入牌落点） */
  function handEndPoint() {
    const hand = $('sgs-hand');
    if (!hand) return handPoint();
    const cards = hand.querySelectorAll('.sgs-kapai');
    if (cards.length) {
      return rectCenter(cards[cards.length - 1]);
    }
    return handPoint();
  }

  /** 从目标角色处获得牌（顺手牵羊等）：牌面飞向手牌最末端 */
  async function animateGainFromSeat({ card, fromPlayerId, duration }) {
    const from = seatPoint(fromPlayerId) || pilePoint('discard');
    const to = handEndPoint() || handPoint();
    if (!from || !to) return;
    await flyCard({
      card: card || null,
      faceDown: !card,
      from,
      to,
      duration: duration || 920,
    });
    await sleep(160);
  }

  async function animateDraw(count, cardHint) {
    const n = Math.max(1, Math.min(count || 1, 5));
    const from = pilePoint('draw');
    const to = handPoint();
    for (let i = 0; i < n; i++) {
      flyCard({
        card: cardHint || null,
        faceDown: !cardHint,
        from,
        to,
        duration: 420,
      });
      await sleep(90);
    }
    await sleep(360);
  }

  async function animateTargetRays({ fromPlayerId, targetIds }) {
    const from = seatPoint(fromPlayerId) || handPoint();
    if (!from) return;
    const ids = [...new Set((targetIds || []).filter(Boolean))];
    if (!ids.length) return;
    for (const tid of ids) {
      if (tid === fromPlayerId) continue;
      const to = seatPoint(tid);
      if (!to) continue;
      castRay(from, to);
      await sleep(70);
    }
    await sleep(280);
  }

  /** 弃牌：仅飞牌到弃牌堆，不画光线（与摸牌对称） */
  async function animateDiscardToPile({
    count,
    fromPlayerId,
    card,
  }) {
    const n = Math.max(1, Math.min(count || 1, 8));
    const from =
      seatPoint(fromPlayerId) || handPoint() || pilePoint('discard');
    const discard = pilePoint('discard');
    if (!from || !discard) return;
    for (let i = 0; i < n; i++) {
      flyCard({
        card: card || null,
        faceDown: !card,
        from,
        to: discard,
        duration: 420,
      });
      await sleep(90);
    }
    await sleep(360);
  }

  /** 延时锦囊等：牌飞向目标座位（进判定区），以牌为中心，不画「座位→座位」线 */
  async function animatePlayToSeat({
    card,
    fromPlayerId,
    targets,
    caption,
  }) {
    const from =
      seatPoint(fromPlayerId) || handPoint() || pilePoint('discard');
    const ids = [...new Set((targets || []).filter(Boolean))];
    if (!ids.length) {
      const self = seatPoint(fromPlayerId) || from;
      await flyCard({ card, faceDown: false, from, to: self, duration: 520 });
      if (caption) setDiscardCaption(caption);
      return;
    }
    for (const tid of ids) {
      const to = seatPoint(tid) || from;
      await flyCard({ card, faceDown: false, from, to, duration: 520 });
      await sleep(60);
    }
    if (caption) setDiscardCaption(caption);
    await sleep(200);
  }

  async function animatePlayToDiscard({
    card,
    fromPlayerId,
    targets,
    caption,
    equipToPlayerId,
    selfEffect,
  }) {
    const from =
      seatPoint(fromPlayerId) || handPoint() || pilePoint('discard');
    const discard = pilePoint('discard');

    // 出牌：光线 + 飞牌到弃牌堆（以牌为路径中心）
    castRay(from, discard);
    await flyCard({ card, faceDown: false, from, to: discard, duration: 520 });
    if (caption) setDiscardCaption(caption);

    // 指定目标：只从弃牌堆（牌的位置）划向目标，不再从座位直连目标
    if (targets && targets.length) {
      for (const tid of targets) {
        const to = seatPoint(tid);
        if (to) castRay(discard, to);
        await sleep(80);
      }
      await sleep(420);
    } else if (selfEffect) {
      castRay(discard, seatPoint(fromPlayerId) || handPoint() || from);
      await sleep(380);
    } else {
      await sleep(120);
    }

    if (equipToPlayerId) {
      const eq = seatPoint(equipToPlayerId);
      if (eq) {
        await flyCard({
          card,
          faceDown: false,
          from: discard,
          to: eq,
          duration: 420,
        });
      }
    }
  }

  return {
    rectCenter,
    rectBox,
    flyCard,
    animateHeroFly,
    animateIdentityReveal,
    castRay,
    setDiscardCaption,
    pilePoint,
    seatPoint,
    handPoint,
    handEndPoint,
    animateGainFromSeat,
    animateDraw,
    animateDiscardToPile,
    animatePlayToSeat,
    animatePlayToDiscard,
    animateTargetRays,
    animateSeatText,
    animateDamageHit,
  };
})();
