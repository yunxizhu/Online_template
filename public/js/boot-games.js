'use strict';

/**
 * 按游戏清单挂载面板、样式与脚本。
 * 每个游戏的 client 资源放在 public/games/<id>/ 下。
 */
window.GameBoot = (function () {
  function loadStylesheet(href) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`link[data-game-asset="${href}"]`)) {
        resolve();
        return;
      }
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.gameAsset = href;
      link.onload = () => resolve();
      link.onerror = () => reject(new Error('样式加载失败: ' + href));
      document.head.appendChild(link);
    });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-game-asset="${src}"]`)) {
        resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.dataset.gameAsset = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('脚本加载失败: ' + src));
      document.body.appendChild(s);
    });
  }

  async function mountPanels(games) {
    const mount = document.getElementById('game-panels');
    if (!mount) return;

    for (const g of games || []) {
      const client = g.client;
      if (!client) continue;

      for (const href of client.styles || []) {
        await loadStylesheet(href);
      }

      if (client.panel) {
        const html = await fetch(client.panel).then((r) => {
          if (!r.ok) throw new Error('面板加载失败: ' + client.panel);
          return r.text();
        });
        mount.insertAdjacentHTML('beforeend', html);
      }

      for (const src of client.scripts || []) {
        await loadScript(src);
      }
    }
  }

  return { mountPanels };
})();
