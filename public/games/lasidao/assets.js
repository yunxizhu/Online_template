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

  /** 资源卡面（玩家手牌展示用） */
  const RESOURCE_HAND_IMAGE = {
    wood: 'ziyuan_mutou.png',
    stone: 'ziyuan_shitou.png',
    food: 'ziyuan_xiaomai.png',
    iron: 'ziyuan_tiekuang.png',
  };

  /** 卡背 */
  const CARD_BACK_IMAGE = {
    function: 'bankuaikabei_gongneng.png',
    building: 'bankuaikabei_jianzhu.png',
    resource: 'bankuaikabei_ziyuan.png',
  };

  /** 功能卡面（funcType → 文件名） */
  const FUNCTION_IMAGE = {
    harvest: 'gongnengka_fengshou.png',
    remoteDice: 'gongnengka_yaokongtouzi.png',
    exile: 'gongnengka_quzhu.png',
    redraw: 'gongnengka_chongchou.png',
    banditRaid: 'gongnengka_qiangdaolaixi.png',
    expand: 'gongnengka_kuorong.png',
    robbery: 'gongnengka_qiangjie.png',
  };

  /** 建筑卡面（buildType / resource+tier → 文件名） */
  const BUILDING_IMAGE = {
    'score2': 'jianzhuka_gongdian.png',
    'exchange': 'jianzhuka_jishi.png',
    'wishWell': 'jianzhuka_xuyuanjin.png',
    'wood:rich': 'jianzhuka_damucaizuofang.png',
    'wood:poor': 'jianzhuka_xiaomucaizuofang.png',
    'stone:rich': 'jianzhuka_dashicaizuofang.png',
    'stone:poor': 'jianzhuka_xiaoshicaizuofang.png',
    'food:rich': 'jianzhuka_daxiaomaizuofang.png',
    'food:poor': 'jianzhuka_xiaoxiaomaizuofang.png',
    'iron:rich': 'jianzhuka_xiaotiekuangzuofang.png',
    'iron:poor': 'jianzhuka_xiaotiekuangzuofang.png',
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

  function resourceHandImageUrl(resourceType) {
    const file = RESOURCE_HAND_IMAGE[resourceType];
    return file ? picUrl(file) : '';
  }

  function cardBackImageUrl(kind) {
    const file = CARD_BACK_IMAGE[kind];
    return file ? picUrl(file) : '';
  }

  function functionImageUrl(tile) {
    const file = tile && tile.funcType ? FUNCTION_IMAGE[tile.funcType] : null;
    return file ? picUrl(file) : '';
  }

  function buildingImageFile(tile) {
    if (!tile) return null;
    if (tile.buildType === 'produce' && tile.resource) {
      const richKey = tile.rich ? 'rich' : 'poor';
      return BUILDING_IMAGE[tile.resource + ':' + richKey] || null;
    }
    if (tile.buildType) {
      return BUILDING_IMAGE[tile.buildType] || null;
    }
    return null;
  }

  function buildingImageUrl(tile) {
    const file = buildingImageFile(tile);
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

  function applyFunctionArt(artEl, tile) {
    if (!artEl) return false;
    const url = functionImageUrl(tile);
    if (!url) {
      artEl.classList.remove('has-image');
      artEl.style.backgroundImage = '';
      return false;
    }
    artEl.classList.add('has-image');
    artEl.style.backgroundImage = 'url("' + url + '")';
    return true;
  }

  function applyBuildingArt(artEl, tile) {
    if (!artEl) return false;
    const url = buildingImageUrl(tile);
    if (!url) {
      artEl.classList.remove('has-image');
      artEl.style.backgroundImage = '';
      return false;
    }
    artEl.classList.add('has-image');
    artEl.style.backgroundImage = 'url("' + url + '")';
    return true;
  }

  function applyCardBackArt(artEl, kind) {
    if (!artEl) return false;
    const url = cardBackImageUrl(kind);
    if (!url) {
      artEl.classList.remove('has-image');
      artEl.style.backgroundImage = '';
      return false;
    }
    artEl.classList.add('has-image');
    artEl.style.backgroundImage = 'url("' + url + '")';
    artEl.style.backgroundSize = 'cover';
    artEl.style.backgroundPosition = 'center';
    artEl.style.backgroundRepeat = 'no-repeat';
    return true;
  }

  function ruleCardImageUrl(spec) {
    if (!spec) return '';
    const parts = String(spec).split(':');
    if (parts[0] === 'func') {
      const file = FUNCTION_IMAGE[parts[1]];
      return file ? picUrl(file) : cardBackImageUrl('function');
    }
    if (parts[0] === 'build') {
      const kind = parts[1];
      const tile =
        parts.length >= 3
          ? {
              buildType: 'produce',
              resource: parts[1],
              rich: parts[2] === 'rich',
            }
          : { buildType: kind };
      return buildingImageUrl(tile) || cardBackImageUrl('building');
    }
    return '';
  }

  return {
    RES,
    PIC,
    resourceImageFile,
    resourceImageUrl,
    applyResourceArt,
    resourceHandImageUrl,
    cardBackImageUrl,
    functionImageUrl,
    buildingImageUrl,
    applyFunctionArt,
    applyBuildingArt,
    applyCardBackArt,
    ruleCardImageUrl,
  };
})();
