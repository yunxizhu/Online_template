'use strict';

/**
 * 简易多语言：默认中文，localStorage 记忆。
 * 用法：I18n.t('app.title') / I18n.t('x.y', { name: 'A' })
 * DOM：data-i18n="key"  | data-i18n-attr="placeholder:key,title:key2" | data-i18n-html="key"
 */
window.I18n = (function () {
  const STORAGE_KEY = 'lianji.lang';
  const DEFAULT_LANG = 'zh';
  const SUPPORTED = [
    { id: 'zh', labelKey: 'lang.zh' },
    { id: 'en', labelKey: 'lang.en' },
  ];

  let lang = DEFAULT_LANG;
  let packs = { zh: {}, en: {} };
  let ready = false;
  const listeners = new Set();

  function deepGet(obj, path) {
    if (!obj || !path) return undefined;
    const parts = String(path).split('.');
    let cur = obj;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[p];
    }
    return cur;
  }

  function format(str, vars) {
    if (str == null) return '';
    let out = String(str);
    if (vars && typeof vars === 'object') {
      out = out.replace(/\{(\w+)\}/g, (_, k) =>
        vars[k] != null ? String(vars[k]) : ''
      );
    }
    return out;
  }

  function t(key, vars) {
    if (!key) return '';
    let raw = deepGet(packs[lang], key);
    if (raw == null && lang !== DEFAULT_LANG) {
      raw = deepGet(packs[DEFAULT_LANG], key);
    }
    if (raw == null) return String(key);
    return format(raw, vars);
  }

  function applyNode(node) {
    if (!node || node.nodeType !== 1) return;
    const el = node;
    if (el.hasAttribute('data-i18n-manual')) return;
    if (el.hasAttribute('data-i18n')) {
      el.textContent = t(el.getAttribute('data-i18n'));
    }
    if (el.hasAttribute('data-i18n-html')) {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    }
    const attrSpec = el.getAttribute('data-i18n-attr');
    if (attrSpec) {
      for (const part of attrSpec.split(',')) {
        const [attr, key] = part.split(':').map((s) => s && s.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      }
    }
  }

  function applyDom(root) {
    const scope = root || document;
    const nodes = scope.querySelectorAll(
      '[data-i18n],[data-i18n-html],[data-i18n-attr]'
    );
    for (const n of nodes) applyNode(n);
    if (scope.nodeType === 1) applyNode(scope);
  }

  function setLang(next, opts) {
    const id = String(next || DEFAULT_LANG);
    if (!SUPPORTED.some((x) => x.id === id)) return false;
    if (lang === id && !(opts && opts.force)) {
      return true;
    }
    lang = id;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (_) {}
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    applyDom(document);
    for (const fn of listeners) {
      try {
        fn(lang);
      } catch (_) {}
    }
    window.dispatchEvent(
      new CustomEvent('i18n:change', { detail: { lang } })
    );
    return true;
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function i18nBase() {
    try {
      const p = String(window.location.protocol || '').toLowerCase();
      if (p === 'capacitor:' || p === 'file:') return './i18n/';
      if (/\/play\.html$/i.test(String(window.location.pathname || ''))) {
        return './i18n/';
      }
    } catch (_) {}
    return '/i18n/';
  }

  async function loadPack(id) {
    const res = await fetch(i18nBase() + id + '.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('i18n load failed: ' + id);
    return res.json();
  }

  async function init() {
    let saved = DEFAULT_LANG;
    try {
      saved = localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG;
    } catch (_) {}
    if (!SUPPORTED.some((x) => x.id === saved)) saved = DEFAULT_LANG;

    const loaded = await Promise.all(
      SUPPORTED.map(async (s) => {
        try {
          return [s.id, await loadPack(s.id)];
        } catch (e) {
          console.warn(e);
          return [s.id, {}];
        }
      })
    );
    packs = {};
    for (const [id, data] of loaded) packs[id] = data || {};
    ready = true;
    setLang(saved, { force: true });
    return lang;
  }

  return {
    DEFAULT_LANG,
    SUPPORTED,
    t,
    getLang: () => lang,
    setLang,
    applyDom,
    onChange,
    init,
    isReady: () => ready,
  };
})();
