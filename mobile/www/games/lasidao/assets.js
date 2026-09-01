'use strict';

/**
 * 卡拉斯坦卡牌图片映射
 * 静态根：server/games/lasidao/resourse → /games/lasidao/res/
 * 图片：resourse/picture/* → /games/lasidao/res/picture/*
 */
window.LasidaoAssets = (function () {
  const RES = '/games/lasidao/res';
  const PIC = RES + '/picture';
  /** 换图后改这个数字，可绕过浏览器旧缓存（曾 max-age=7d） */
  const ASSET_VER = '20260901a';

  function remoteAssetRoot() {
    try {
      const base = window.__lianjiRemoteAssetBase;
      if (base) return String(base).replace(/\/$/, '');
    } catch (_) {}
    return '';
  }

  function assetPath(path) {
    const p = String(path || '');
    if (!p) return p;
    const root = remoteAssetRoot();
    const abs = root ? root + (p.startsWith('/') ? p : '/' + p) : p;
    if (!ASSET_VER) return abs;
    return abs + (abs.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(ASSET_VER);
  }

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
    resourceCard: 'ziyuankabei.png',
    environment: 'bankuaikabei_shijian.png',
  };

  /** 事件卡面（envType → 文件名） */
  const ENVIRONMENT_IMAGE = {
    prisonersDilemma: 'shijianka_qiutukunjing.png',
    barrenHarvest: 'shijianka_keliwushou.png',
    resistBarbarians: 'shijianka_diyunanman.png',
    clearSky: 'shijianka_qingkongwanli.png',
    enterFray: 'shijianka_yishenruju.png',
    mercenaries: 'shijianka_guyongjun.png',
    oneMountain: 'shijianka_yishanburongerhu.png',
    luckyDraw: 'shijianka_manghe.png',
    fishermanProfit: 'shijianka_yuwengdeli.png',
    firstCome: 'shijianka_xiandaoxiande.png',
    welfareMinimum: 'shijianka_dibaohu.png',
    recall: 'shijianka_zhaohui.png',
    teleport: 'shijianka_chuansong.png',
    keepOverflow: 'shijianka_chibuliaodouzhezou.png',
    weiQiRescueZhao: 'shijianka_weiweijiuzhao.png',
  };

  /** 功能卡面（funcType → 文件名） */
  const FUNCTION_IMAGE = {
    harvest: 'gongnengka_fengshou.png',
    remoteDice: 'gongnengka_yaokongtouzi.png',
    exile: 'gongnengka_quzhu.png',
    redraw: 'gongnengka_chongchou.png',
    banditRaid: 'gongnengka_qiangdaolaixi.png',
    freeExpand: 'gongnengka_mianfeikuojian.png',
    welfareHouse: 'gongnengka_fulifang.png',
    caravan: 'gongnengka_shangduilailin.png',
    robbery: 'gongnengka_qiangjie.png',
    illegalBuild: 'gongnengka_chaiqian.png',
    enhance: 'gongnengka_qianghua.png',
    recruit: 'gongnengka_zhengzhao.png',
  };

  /** 建筑卡面（buildType / resource+tier → 文件名） */
  const BUILDING_IMAGE = {
    'score2': 'jianzhuka_gongdian.png',
    'score1': 'jianzhuka_xuetang.png',
    'exchange': 'jianzhuka_jishi.png',
    'wishWell': 'jianzhuka_xuyuanjin.png',
    'eternalThrone': 'jianzhuka_yonghengwangzuo.png',
    'mixer': 'jianzhuka_daliaoji.png',
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
    return assetPath(PIC + '/' + encodeURIComponent(file));
  }

  /** 内存预热：避免每次 render 重建 DOM 后重复走网络/解码 */
  const _imgWarm = new Map();
  const IMAGE_WARM_MS = 8000;

  function warmImage(url) {
    if (!url) return Promise.resolve(false);
    const hit = _imgWarm.get(url);
    if (hit && hit.complete && hit.naturalWidth > 0) return Promise.resolve(true);
    if (hit && hit._p) return hit._p;
    const img = hit || new Image();
    _imgWarm.set(url, img);
    img._p = new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        if (img._warmTimer) {
          clearTimeout(img._warmTimer);
          img._warmTimer = null;
        }
        img._p = null;
        resolve(ok);
      };
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img._warmTimer = setTimeout(() => finish(false), IMAGE_WARM_MS);
      if (img.src !== url) img.src = url;
      else if (img.complete) finish(img.naturalWidth > 0);
    });
    return img._p;
  }

  let _preloadPromise = null;
  let _preloadDone = false;

  /** 开局预热全部卡面（浏览器 HTTP 缓存 + 内存 decode 缓存）；单图失败/超时不阻断 */
  function preloadPictures() {
    if (_preloadDone) return Promise.resolve(true);
    if (_preloadPromise) return _preloadPromise;
    const urls = [...collectAllPictureFiles()].map((f) => picUrl(f));
    _preloadPromise = Promise.all(urls.map((u) => warmImage(u)))
      .then(() => {
        _preloadDone = true;
        return true;
      })
      .catch(() => {
        // 仍标记完成，避免每次阶段切换反复卡住整局渲染
        _preloadDone = true;
        _preloadPromise = null;
        return false;
      });
    return _preloadPromise;
  }

  function collectAllPictureFiles() {
    const files = new Set();
    const maps = [
      RESOURCE_IMAGE,
      RESOURCE_HAND_IMAGE,
      CARD_BACK_IMAGE,
      ENVIRONMENT_IMAGE,
      FUNCTION_IMAGE,
      BUILDING_IMAGE,
    ];
    for (const m of maps) {
      for (const f of Object.values(m)) {
        if (f) files.add(f);
      }
    }
    return files;
  }

  function isPreloadDone() {
    return _preloadDone;
  }

  function applyBgImage(artEl, url) {
    if (!artEl || !url) return;
    warmImage(url);
    artEl.style.backgroundImage = 'url("' + url + '")';
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

  function environmentImageUrl(tile) {
    const file =
      tile && tile.envType ? ENVIRONMENT_IMAGE[tile.envType] : null;
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
    applyBgImage(artEl, url);
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
    applyBgImage(artEl, url);
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
    applyBgImage(artEl, url);
    return true;
  }

  function applyEnvironmentArt(artEl, tile) {
    if (!artEl) return false;
    const url = environmentImageUrl(tile);
    if (!url) {
      artEl.classList.remove('has-image');
      artEl.style.backgroundImage = '';
      return false;
    }
    artEl.classList.add('has-image');
    applyBgImage(artEl, url);
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
    applyBgImage(artEl, url);
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
    if (parts[0] === 'env') {
      const file = ENVIRONMENT_IMAGE[parts[1]];
      return file ? picUrl(file) : cardBackImageUrl('environment');
    }
    return '';
  }

  /** 对局 BGM：resourse/music/* → /games/lasidao/res/music/* */
  const BGM_FILE =
    'ほのぼのとした日常BGM「Positive3」_PerituneMaterial_Positive3_loop.mp3';
  const BGM_SRC = assetPath(RES + '/music/' + encodeURIComponent(BGM_FILE));
  const BGM_BASE_VOLUME = 0.3;
  const BGM_FADE_MS = 10000;

  function bgmTarget() {
    const B = window.BgmVolume;
    return B && typeof B.effective === 'function'
      ? B.effective(BGM_BASE_VOLUME)
      : BGM_BASE_VOLUME;
  }

  function applyBgmVolumeNow() {
    if (!_bgmAudio || !_bgmPlaying) return;
    cancelBgmFade();
    _bgmAudio.volume = bgmTarget();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('bgmvolumechange', applyBgmVolumeNow);
  }

  let _bgmAudio = null;
  let _bgmPlaying = false;
  let _bgmUnlockBound = false;
  let _bgmFadeRaf = 0;
  let _bgmFadeStart = 0;

  function cancelBgmFade() {
    if (_bgmFadeRaf) {
      cancelAnimationFrame(_bgmFadeRaf);
      _bgmFadeRaf = 0;
    }
    _bgmFadeStart = 0;
  }

  function ensureBgmUnlock() {
    if (_bgmUnlockBound) return;
    _bgmUnlockBound = true;
    const resume = () => {
      if (!_bgmAudio || !_bgmPlaying || !_bgmAudio.paused) return;
      const audio = _bgmAudio;
      const p = audio.play();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          if (audio.volume < bgmTarget() - 0.001 && !_bgmFadeRaf) {
            fadeBgmIn(audio);
          }
        }).catch(() => {});
      }
    };
    document.addEventListener('pointerdown', resume, { passive: true });
    document.addEventListener('keydown', resume);
  }

  function stopBgm() {
    cancelBgmFade();
    _bgmPlaying = false;
    if (_bgmAudio) {
      try {
        _bgmAudio.pause();
        _bgmAudio.removeAttribute('src');
        _bgmAudio.load();
      } catch (_) {
        /* ignore */
      }
      _bgmAudio = null;
    }
  }

  function fadeBgmIn(audio) {
    cancelBgmFade();
    const from = Math.max(0, Number(audio.volume) || 0);
    audio.volume = from;
    _bgmFadeStart = performance.now();
    const step = (now) => {
      if (!_bgmAudio || _bgmAudio !== audio || !_bgmPlaying) return;
      const t = Math.min(1, (now - _bgmFadeStart) / BGM_FADE_MS);
      const target = bgmTarget();
      audio.volume = from + (target - from) * t;
      if (t < 1) {
        _bgmFadeRaf = requestAnimationFrame(step);
      } else {
        _bgmFadeRaf = 0;
        audio.volume = bgmTarget();
      }
    };
    _bgmFadeRaf = requestAnimationFrame(step);
  }

  /** 开始游戏后循环播放，0 → 30% 音量约 10 秒渐入 */
  function playBgm() {
    ensureBgmUnlock();
    if (_bgmPlaying && _bgmAudio) {
      if (_bgmAudio.paused) {
        const audio = _bgmAudio;
        const p = audio.play();
        if (p && typeof p.then === 'function') {
          p.then(() => {
            if (audio.volume < bgmTarget() - 0.001 && !_bgmFadeRaf) {
              fadeBgmIn(audio);
            }
          }).catch(() => {});
        }
      }
      return;
    }
    stopBgm();
    try {
      const audio = new Audio(BGM_SRC);
      audio.loop = true;
      audio.volume = 0;
      _bgmAudio = audio;
      _bgmPlaying = true;
      const p = audio.play();
      if (p && typeof p.then === 'function') {
        p.then(() => fadeBgmIn(audio)).catch(() => {
          /* 自动播放被拦截：保留实例，等待用户手势后由 unlock 继续并渐入 */
        });
      } else {
        fadeBgmIn(audio);
      }
    } catch (_) {
      _bgmAudio = null;
      _bgmPlaying = false;
    }
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
    applyEnvironmentArt,
    environmentImageUrl,
    applyCardBackArt,
    ruleCardImageUrl,
    warmImage,
    preloadPictures,
    isPreloadDone,
    playBgm,
    stopBgm,
  };
})();
