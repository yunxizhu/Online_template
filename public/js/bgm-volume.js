'use strict';

/** 全局 BGM 音量（0–1），localStorage 持久化，供各游戏 assets 与菜单共用 */
window.BgmVolume = (function () {
  const STORAGE_KEY = 'lianji.bgmVolume';
  const DEFAULT = 0.1;

  function clamp(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return DEFAULT;
    return Math.max(0, Math.min(1, n));
  }

  function get() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw == null) return DEFAULT;
      return clamp(parseFloat(raw));
    } catch (_) {
      return DEFAULT;
    }
  }

  function set(v) {
    const vol = clamp(v);
    try {
      localStorage.setItem(STORAGE_KEY, String(vol));
    } catch (_) {
      /* ignore */
    }
    window.dispatchEvent(
      new CustomEvent('bgmvolumechange', { detail: { volume: vol } })
    );
    return vol;
  }

  /** @param {number} base 游戏内基准音量 0–1 */
  function effective(base) {
    return clamp(base) * get();
  }

  function percent() {
    return Math.round(get() * 100);
  }

  return { get, set, effective, percent, DEFAULT };
})();
