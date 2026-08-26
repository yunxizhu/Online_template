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
    resource: 'ziyuankabei.png',
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
    enhance: 'gongnengka_qianghua.png',
    recruit: 'gongnengka_zhengzhao.png',
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

  function applyEnvironmentArt(artEl, tile) {
    if (!artEl) return false;
    const url = environmentImageUrl(tile);
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
    if (parts[0] === 'env') {
      const file = ENVIRONMENT_IMAGE[parts[1]];
      return file ? picUrl(file) : cardBackImageUrl('environment');
    }
    return '';
  }

  /** 对局 BGM：resourse/music/* → /games/lasidao/res/music/* */
  const BGM_FILE =
    'ほのぼのとした日常BGM「Positive3」_PerituneMaterial_Positive3_loop.mp3';
  const BGM_SRC = RES + '/music/' + encodeURIComponent(BGM_FILE);
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
    playBgm,
    stopBgm,
  };
})();
