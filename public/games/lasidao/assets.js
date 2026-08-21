'use strict';

/**
 * 拉斯岛卡牌图片映射
 * 静态根：server/games/lasidao/resourse → /games/lasidao/res/
 * 图片：resourse/picture/* → /games/lasidao/res/picture/*
 */
window.LasidaoAssets = (function () {
  const RES = '/games/lasidao/res';
  const PIC = RES + '/picture';

  /** resource + rich → 文件名 */
  const RESOURCE_IMAGE = {
    'wood:rich': 'dasenlin.png',
    'wood:poor': 'xiaosenlin.png',
    'stone:rich': 'dashitou.png',
    'stone:poor': 'xiaoshitou.png',
    'food:rich': 'danongtian.png',
    'food:poor': 'xiaonongtian.png',
    'iron:poor': 'tiekuang.png',
    'iron:rich': 'tiekuang.png',
  };

  function picUrl(file) {
    if (!file) return '';
    return PIC + '/' + encodeURIComponent(file);
  }

  function resourceImageFile(tile) {
    if (!tile || !tile.resource) return null;
    const richKey = tile.rich ? 'rich' : 'poor';
    return (
      RESOURCE_IMAGE[tile.resource + ':' + richKey] ||
      RESOURCE_IMAGE[tile.resource + ':poor'] ||
      null
    );
  }

  function resourceImageUrl(tile) {
    const file = resourceImageFile(tile);
    return file ? picUrl(file) : '';
  }

  function applyResourceArt(artEl, tile) {
    if (!artEl) return false;
    const url = resourceImageUrl(tile);
    if (!url) {
      artEl.classList.remove('has-image');
      artEl.style.backgroundImage = '';
      return false;
    }
    artEl.classList.add('has-image');
    artEl.style.backgroundImage = 'url("' + url + '")';
    return true;
  }

  return {
    RES,
    PIC,
    resourceImageFile,
    resourceImageUrl,
    applyResourceArt,
  };
})();
