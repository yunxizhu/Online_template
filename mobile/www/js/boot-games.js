'use strict';

/**
 * 按游戏清单挂载面板、样式与脚本。
 * 每个游戏的 client 资源放在 public/games/<id>/ 下。
 * 单游戏失败不拖垮其他游戏；样式/脚本加载带超时，避免永久挂死。
 */
window.GameBoot = (function () {
  const ASSET_LOAD_MS = 20000;

  function absAssetUrl(base, href) {
    const path = String(href || '');
    if (!path) return path;
    if (/^https?:\/\//i.test(path)) return path;
    const root = String(base || '').replace(/\/$/, '');
    return root + (path.startsWith('/') ? path : '/' + path);
  }

  function findAssetEl(tag, href) {
    const nodes = document.querySelectorAll(tag + '[data-game-asset]');
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-game-asset') === href) return nodes[i];
    }
    return null;
  }

  function loadStylesheet(href) {
    return new Promise((resolve, reject) => {
      const existing = findAssetEl('link', href);
      if (existing && existing.dataset.gameAssetOk === '1') {
        resolve();
        return;
      }
      if (existing) existing.remove();

      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.dataset.gameAsset = href;
      let done = false;
      const finish = (ok, err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (ok) {
          link.dataset.gameAssetOk = '1';
          resolve();
        } else {
          try {
            link.remove();
          } catch (_) {}
          reject(err || new Error('样式加载失败: ' + href));
        }
      };
      const timer = setTimeout(
        () => finish(false, new Error('样式加载超时: ' + href)),
        ASSET_LOAD_MS
      );
      // 先绑事件再设 href，避免缓存命中时错过 onload
      link.onload = () => finish(true);
      link.onerror = () => finish(false, new Error('样式加载失败: ' + href));
      link.href = href;
      document.head.appendChild(link);
      try {
        if (link.sheet) finish(true);
      } catch (_) {
        /* 跨域 stylesheet 读 sheet 可能抛错，忽略，等 onload */
      }
    });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = findAssetEl('script', src);
      if (existing && existing.dataset.gameAssetOk === '1') {
        resolve();
        return;
      }
      if (existing) existing.remove();

      const s = document.createElement('script');
      s.dataset.gameAsset = src;
      let done = false;
      const finish = (ok, err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (ok) {
          s.dataset.gameAssetOk = '1';
          resolve();
        } else {
          try {
            s.remove();
          } catch (_) {}
          reject(err || new Error('脚本加载失败: ' + src));
        }
      };
      const timer = setTimeout(
        () => finish(false, new Error('脚本加载超时: ' + src)),
        ASSET_LOAD_MS
      );
      s.onload = () => finish(true);
      s.onerror = () => finish(false, new Error('脚本加载失败: ' + src));
      s.src = src;
      document.body.appendChild(s);
    });
  }

  async function mountOneGame(g, base, mount, opts = {}) {
    const onStep = typeof opts.onStep === 'function' ? opts.onStep : null;
    const client = g && g.client;
    if (!client) return;
    const id = g.id || '';

    for (const href of client.styles || []) {
      await loadStylesheet(absAssetUrl(base, href));
      if (onStep) onStep();
    }

    if (client.panel) {
      const panelUrl = absAssetUrl(base, client.panel);
      const html = await fetch(panelUrl, { cache: 'no-cache' }).then((r) => {
        if (!r.ok) throw new Error('面板加载失败: ' + panelUrl);
        return r.text();
      });
      if (id) {
        const old = document.getElementById('panel-' + id);
        if (old) old.remove();
      }
      mount.insertAdjacentHTML('beforeend', html);
      if (onStep) onStep();
    }

    const scriptUrls = (client.scripts || []).map((src) =>
      absAssetUrl(base, src)
    );
    for (const src of scriptUrls) {
      await loadScript(src);
      if (onStep) onStep();
    }

    // 脚本 onload 但执行报错时，全局 API 仍可能缺失；清掉标签以便下次真正重载
    const needGlobal =
      id === 'lasidao'
        ? 'LasidaoUi'
        : id === 'sgs'
          ? 'SgsUi'
          : id === 'incan'
            ? 'IncanUi'
            : id === 'catan'
              ? 'CatanUi'
              : id === 'gomoku'
                ? 'GomokuBoard'
                : id === 'doudizhu'
                  ? 'DoudizhuUi'
                  : id === 'guandan'
                    ? 'GuandanUi'
                    : id === 'splendor-duel'
                      ? 'SplendorDuelUi'
                      : id === 'blaster'
                        ? 'BlasterUi'
                        : id === 'warfactory'
                          ? 'WarFactoryUi'
                          : null;
    if (needGlobal && !window[needGlobal]) {
      for (const src of scriptUrls) {
        const el = findAssetEl('script', src);
        if (el) el.remove();
      }
      throw new Error(needGlobal + ' 未初始化（脚本可能执行失败）');
    }
    if (onStep) onStep();
  }

  /**
   * @returns {{ ok: string[], fail: { id: string, error: string }[] }}
   */
  async function mountPanels(games, baseUrl, opts = {}) {
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    const mount = document.getElementById('game-panels');
    if (!mount) return { ok: [], fail: [] };
    const base = baseUrl ? String(baseUrl).replace(/\/$/, '') : '';

    const ok = [];
    const fail = [];

    // 计算总步骤数（CSS + panel fetch + script + init check）
    let totalSteps = 0;
    for (const g of games || []) {
      if (!g || !g.client) continue;
      const c = g.client;
      totalSteps += (c.styles || []).length;
      totalSteps += c.panel ? 1 : 0;
      totalSteps += (c.scripts || []).length;
      totalSteps += 1; // init check
    }
    let completedSteps = 0;
    function step() {
      completedSteps += 1;
      if (onProgress && totalSteps > 0) {
        onProgress(Math.min(35, Math.round((completedSteps / totalSteps) * 35)));
      }
    }

    for (const g of games || []) {
      if (!g || !g.client) continue;
      try {
        await mountOneGame(g, base, mount, { onStep: step });
        if (g.id) ok.push(g.id);
      } catch (err) {
        const msg = (err && err.message) || String(err);
        console.warn('[GameBoot] mount failed:', g.id, msg);
        fail.push({ id: g.id || '?', error: msg });
        if (g.id) {
          const panel = document.getElementById('panel-' + g.id);
          if (panel) panel.remove();
        }
        // 失败了也要推进进度，避免卡住
        const c = g.client;
        const skippedSteps = (c.styles || []).length + (c.panel ? 1 : 0) + (c.scripts || []).length + 1;
        for (let i = 0; i < skippedSteps; i++) step();
      }
    }

    if (!ok.length && fail.length) {
      const err = new Error(
        '游戏资源加载失败: ' +
          fail.map((f) => f.id + '(' + f.error + ')').join('; ')
      );
      err.details = fail;
      throw err;
    }
    return { ok, fail };
  }

  return {
    mountPanels,
    absAssetUrl,
    loadStylesheet,
    loadScript,
  };
})();
