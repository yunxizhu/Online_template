'use strict';

/**
 * 按游戏清单挂载面板、样式与脚本。
 * 每个游戏的 client 资源放在 public/games/<id>/ 下。
 */
window.GameBoot = (function () {
  function absAssetUrl(base, href) {
    const path = String(href || '');
    if (!path) return path;
    if (/^https?:\/\//i.test(path)) return path;
    const root = String(base || '').replace(/\/$/, '');
    return root + (path.startsWith('/') ? path : '/' + path);
  }

  function loadStylesheet(href) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(
        `link[data-game-asset="${href}"]`
      );
      // 仅复用已成功加载的；失败残留的标签会挡住重试，导致永远缺样式
      if (existing && existing.dataset.gameAssetOk === '1') {
        resolve();
        return;
      }
      if (existing) existing.remove();
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.gameAsset = href;
      link.onload = () => {
        link.dataset.gameAssetOk = '1';
        resolve();
      };
      link.onerror = () => {
        link.remove();
        reject(new Error('样式加载失败: ' + href));
      };
      document.head.appendChild(link);
    });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(
        `script[data-game-asset="${src}"]`
      );
      // 失败残留的 script 标签若被当成已加载，会跳过重试且全局 API 不存在
      if (existing && existing.dataset.gameAssetOk === '1') {
        resolve();
        return;
      }
      if (existing) existing.remove();
      const s = document.createElement('script');
      s.src = src;
      s.dataset.gameAsset = src;
      s.onload = () => {
        s.dataset.gameAssetOk = '1';
        resolve();
      };
      s.onerror = () => {
        s.remove();
        reject(new Error('脚本加载失败: ' + src));
      };
      document.body.appendChild(s);
    });
  }

  async function mountPanels(games, baseUrl) {
    const mount = document.getElementById('game-panels');
    if (!mount) return;
    const base = baseUrl ? String(baseUrl).replace(/\/$/, '') : '';

    // 半截失败后重试：先清空，避免重复插入面板 HTML
    mount.innerHTML = '';

    try {
      for (const g of games || []) {
        const client = g.client;
        if (!client) continue;

        for (const href of client.styles || []) {
          await loadStylesheet(absAssetUrl(base, href));
        }

        if (client.panel) {
          const panelUrl = absAssetUrl(base, client.panel);
          const html = await fetch(panelUrl).then((r) => {
            if (!r.ok) throw new Error('面板加载失败: ' + panelUrl);
            return r.text();
          });
          mount.insertAdjacentHTML('beforeend', html);
        }

        for (const src of client.scripts || []) {
          await loadScript(absAssetUrl(base, src));
        }
      }
    } catch (err) {
      mount.innerHTML = '';
      throw err;
    }
  }

  return { mountPanels, absAssetUrl };
})();
