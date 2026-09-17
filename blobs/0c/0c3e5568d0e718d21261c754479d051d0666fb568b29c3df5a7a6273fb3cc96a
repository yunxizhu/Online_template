'use strict';

/**
 * 三国杀卡牌资源映射与 DOM 渲染
 * 静态根：server/games/sgs/resourse → /games/sgs/res/
 * 图片：resourse/picture/* → /games/sgs/res/picture/*
 * 语音：resourse/music/card/* → /games/sgs/res/music/card/*
 * 背景：resourse/music/bgm/* → /games/sgs/res/music/bgm/*
 * 音效：resourse/music/effect/* → /games/sgs/res/music/effect/*
 */
window.SgsAssets = (function () {
  const RES = '/games/sgs/res';
  /** 所有 png（卡牌/牌背/身份/武将）统一走 picture 子目录 */
  const PIC = `${RES}/picture`;

  const CARD_IMAGE = {
    杀: 'kapai_sha.png',
    火杀: 'kapai_huosha.png',
    雷杀: 'kapai_leisha.png',
    闪: 'kapai_shan.png',
    桃: 'kapai_tao.png',
    酒: 'kapai_jiu.png',
    过河拆桥: 'kapai_guohechaiqiao.png',
    顺手牵羊: 'kapai_shunshouqianyang.png',
    决斗: 'kapai_juedou.png',
    借刀杀人: 'kapai_jiedaosharen.png',
    无中生有: 'kapai_wuzhongshengyou.png',
    无懈可击: 'kapai_wuxiekeji.png',
    铁索连环: 'kapai_tiesuolianhuan.png',
    火攻: 'kapai_huogong.png',
    万箭齐发: 'kapai_wanjianqifa.png',
    南蛮入侵: 'kapai_nanmanruqin.png',
    桃园结义: 'kapai_taoyuanjieyi.png',
    五谷丰登: 'kapai_wugufengdeng.png',
    闪电: 'kapai_shandian.png',
    乐不思蜀: 'kapai_lebusishu.png',
    兵粮寸断: 'kapai_bingliangchunduan.png',
    诸葛连弩: 'kapai_zhugeliannu.png',
    青釭剑: 'kapai_qinggangjian.png',
    雌雄双股剑: 'kapai_cixiongshuanggujian.png',
    寒冰剑: 'kapai_hanbingjian.png',
    古锭刀: 'kapai_gudingdao.png',
    贯石斧: 'kapai_guanshifu.png',
    青龙偃月刀: 'kapai_qinglongyanyuedao.png',
    丈八蛇矛: 'kapai_zhangbashemao.png',
    方天画戟: 'kapai_fangtianhuaji.png',
    朱雀羽扇: 'kapai_zhuqueyusan.png',
    麒麟弓: 'kapai_qilingong.png',
    银月枪: 'kapai_yinyueqiang.png',
    八卦阵: 'kapai_baguazhen.png',
    仁王盾: 'kapai_renwangdun.png',
    藤甲: 'kapai_tengjia.png',
    白银狮子: 'kapai_baiyinshizi.png',
    绝影: 'kapai_jueying.png',
    爪黄飞电: 'kapai_zhuahuangfeidian.png',
    骅骝: 'kapai_hualiu.png',
    的卢: 'kapai_dilu.png',
    大宛: 'kapai_dawan.png',
    赤兔: 'kapai_chitu.png',
    紫骍: 'kapai_zixin.png',
    木牛流马: 'kapai_muniuliuma.png',
  };

  const IDENTITY_IMAGE = {
    zhu: 'shenfen_zhugong.png',
    zhong: 'shenfen_zhongchen.png',
    fan: 'shenfen_fanzei.png',
    nei: 'shenfen_neijian.png',
    xianzhu: 'shenfen_xianzhu.png',
    houzhu: 'shenfen_houzhu.png',
    huangjin: 'shenfen_huangjin.png',
  };

  const IDENTITY_LABEL = {
    zhu: '主公',
    zhong: '忠臣',
    fan: '反贼',
    nei: '内奸',
    xianzhu: '先主',
    houzhu: '后主',
    huangjin: '黄巾',
  };

  const SUIT = {
    spade: { mark: '♠', color: 'black' },
    heart: { mark: '♥', color: 'red' },
    club: { mark: '♣', color: 'black' },
    diamond: { mark: '♦', color: 'red' },
  };

  /** 出牌语音编号（与 music/card/NN【男|女】牌名.mp3 对应） */
  const CARD_VOICE_INDEX = {
    杀: '01',
    火杀: '02',
    雷杀: '03',
    闪: '04',
    决斗: '05',
    酒: '06',
    火攻: '07',
    闪电: '08',
    无懈可击: '09',
    顺手牵羊: '10',
    过河拆桥: '11',
    乐不思蜀: '12',
    兵粮寸断: '13',
    南蛮入侵: '14',
    万箭齐发: '15',
    桃园结义: '16',
    借刀杀人: '17',
    铁索连环: '18',
    无中生有: '19',
    五谷丰登: '20',
  };

  function url(file) {
    return `${PIC}/${file}`;
  }

  function cardVoiceUrl(cardName, gender) {
    if (!cardName) return null;
    const idx = CARD_VOICE_INDEX[cardName];
    if (!idx) return null;
    const sex = gender === 'female' ? '女' : '男';
    const file = `${idx}【${sex}】${cardName}.mp3`;
    return `${RES}/music/card/${encodeURIComponent(file)}`;
  }

  let _cardVoiceAudio = null;

  /** 按角色性别播放对应出牌语音；无资源时静默跳过 */
  function playCardVoice(cardName, gender) {
    const src = cardVoiceUrl(cardName, gender);
    if (!src) return;
    try {
      if (_cardVoiceAudio) {
        try {
          _cardVoiceAudio.pause();
        } catch (_) {
          /* ignore */
        }
        _cardVoiceAudio = null;
      }
      const audio = new Audio(src);
      _cardVoiceAudio = audio;
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) {
      /* ignore */
    }
  }

  /** 背景音乐：大厅等待 / 对局中 */
  const BGM_SRC = {
    lobby: `${RES}/music/bgm/${encodeURIComponent('02【背景】大厅.mp3')}`,
    game: `${RES}/music/bgm/${encodeURIComponent('01【背景】经典.mp3')}`,
  };

  const BGM_BASE_VOLUME = 0.4;

  function bgmTarget() {
    const B = window.BgmVolume;
    return B && typeof B.effective === 'function'
      ? B.effective(BGM_BASE_VOLUME)
      : BGM_BASE_VOLUME;
  }

  function applyBgmVolumeNow() {
    if (!_bgmAudio || !_bgmKey) return;
    _bgmAudio.volume = bgmTarget();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('bgmvolumechange', applyBgmVolumeNow);
  }

  let _bgmAudio = null;
  let _bgmKey = null;
  let _bgmUnlockBound = false;

  function ensureBgmUnlock() {
    if (_bgmUnlockBound) return;
    _bgmUnlockBound = true;
    const resume = () => {
      if (_bgmAudio && _bgmKey && _bgmAudio.paused) {
        const p = _bgmAudio.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    };
    document.addEventListener('pointerdown', resume, { passive: true });
    document.addEventListener('keydown', resume);
  }

  function stopBgm() {
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
    _bgmKey = null;
  }

  /**
   * @param {'lobby'|'game'|null} key lobby=房间等待，game=对局，null/其它=停止
   */
  function playBgm(key) {
    ensureBgmUnlock();
    if (!key || !BGM_SRC[key]) {
      stopBgm();
      return;
    }
    if (key === _bgmKey && _bgmAudio) {
      _bgmAudio.volume = bgmTarget();
      if (_bgmAudio.paused) {
        const p = _bgmAudio.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
      return;
    }
    stopBgm();
    try {
      const audio = new Audio(BGM_SRC[key]);
      audio.loop = true;
      audio.volume = bgmTarget();
      _bgmAudio = audio;
      _bgmKey = key;
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) {
      _bgmAudio = null;
      _bgmKey = null;
    }
  }

  /** 结算音效：resourse/music/effect/ */
  const SFX_FILES = {
    sha: '01【音效】普杀-1.mp3',
    leisha: '03【音效】雷杀-1.mp3',
    huosha: '05【音效】火杀-1.mp3',
    recover: '07【音效】加血.mp3',
    loseHp: '08【音效】自残.mp3',
    shandian: '09【音效】闪电.mp3',
    equip: '10【音效】装备.mp3',
  };

  /** 击杀/救援/回血播报：与背景曲同目录 music/bgm/ */
  const ANNOUNCE_FILES = {
    一破: '01【播报】一破 卧龙出山.mp3',
    双连: '02【播报】双连 一战成名.mp3',
    三连: '03【播报】三连 举世皆惊.mp3',
    四连: '04【播报】四连 天下无敌.mp3',
    五连: '05【播报】五连 诛天灭地.mp3',
    六连: '06【播报】六连 诛天灭地.mp3',
    七连: '07【播报】七连 诛天灭地.mp3',
    无双: '08【播报】无双 万军取首.mp3',
    妙手回春: '11【播报】妙手回春.mp3',
    医术高超: '12【播报】医术高超.mp3',
  };

  let _announceChain = Promise.resolve();

  function playAnnounceFile(file) {
    if (!file) return Promise.resolve();
    ensureBgmUnlock();
    const src = `${RES}/music/bgm/${encodeURIComponent(file)}`;
    return new Promise((resolve) => {
      try {
        const audio = new Audio(src);
        audio.volume = 0.7;
        const done = () => resolve();
        audio.addEventListener('ended', done, { once: true });
        audio.addEventListener('error', done, { once: true });
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => done());
        }
        // 超时兜底，避免队列卡死
        setTimeout(done, 8000);
      } catch (_) {
        resolve();
      }
    });
  }

  function enqueueAnnounce(label) {
    const file = ANNOUNCE_FILES[label];
    if (!file) return;
    _announceChain = _announceChain
      .then(() => playAnnounceFile(file))
      .catch(() => {});
  }

  /** 按战报顺序排队播报（无双紧随连破） */
  function playAnnounceFromLogs(logs) {
    if (!logs || !logs.length) return;
    for (const row of logs) {
      const t = row && row.text;
      if (!t) continue;
      const m = t.match(/【播报】(一破|双连|三连|四连|五连|六连|七连|无双|妙手回春|医术高超)/);
      if (m) enqueueAnnounce(m[1]);
    }
  }

  function playSfx(key) {
    const file = SFX_FILES[key];
    if (!file) return;
    const src = `${RES}/music/effect/${encodeURIComponent(file)}`;
    try {
      ensureBgmUnlock();
      const audio = new Audio(src);
      audio.volume = 0.55;
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) {
      /* ignore */
    }
  }

  /** 根据本帧新增战报播放对应音效（同帧同类只播一次） */
  function playSfxFromLogs(logs) {
    if (!logs || !logs.length) return;
    playAnnounceFromLogs(logs);
    const flags = {
      equip: false,
      sha: false,
      leisha: false,
      huosha: false,
      recover: false,
      loseHp: false,
      shandian: false,
    };
    for (const row of logs) {
      const t = row && row.text;
      if (!t) continue;
      if (/装备【/.test(t)) flags.equip = true;
      if (/被闪电击中/.test(t)) flags.shandian = true;
      if (/的【杀】对 .+ 造成/.test(t)) flags.sha = true;
      if (/的【雷杀】对 .+ 造成/.test(t)) flags.leisha = true;
      if (/的【火杀】对 .+ 造成/.test(t)) flags.huosha = true;
      if (/回复 \d+ 点体力/.test(t)) flags.recover = true;
      // 失去体力（非杀命中伤害）；绝情等转流失也走此音效
      if (/失去 \d+ 点体力/.test(t)) flags.loseHp = true;
    }
    if (flags.equip) playSfx('equip');
    if (flags.sha) playSfx('sha');
    if (flags.leisha) playSfx('leisha');
    if (flags.huosha) playSfx('huosha');
    if (flags.recover) playSfx('recover');
    if (flags.loseHp) playSfx('loseHp');
    if (flags.shandian) playSfx('shandian');
  }

  function rankLabel(n) {
    if (n === 1) return 'A';
    if (n === 11) return 'J';
    if (n === 12) return 'Q';
    if (n === 13) return 'K';
    return String(n);
  }

  function cardFaceUrl(card) {
    if (!card) return url('kabei.png');
    const file = CARD_IMAGE[card.name];
    return file ? url(file) : url('kabei.png');
  }

  function cardBackUrl() {
    return url('kabei.png');
  }

  function generalBackUrl() {
    return url('jiangbei.png');
  }

  function identityUrl(identity) {
    const file = IDENTITY_IMAGE[identity];
    return file ? url(file) : null;
  }

  function identityBackUrl() {
    return url('shenfenkabei.png');
  }

  function identityLabel(identity) {
    return IDENTITY_LABEL[identity] || identity || '？';
  }

  function heroPortraitUrl(portraitOrId) {
    if (!portraitOrId) return null;
    let file = portraitOrId.endsWith('.png')
      ? portraitOrId
      : `${portraitOrId}.png`;
    // 兼容旧名 caocao.png → hero_caocao.png
    if (!file.startsWith('hero_')) {
      file = `hero_${file}`;
    }
    return url(`hero/${file}`);
  }

  /**
   * 角色卡面槽（资源分辨率 234×320）。
   * @param {string|null} portraitOrId
   * @param {{ size?: 'seat'|'pick'|'self', empty?: boolean, title?: string }} opts
   */
  function createHeroCardEl(portraitOrId, opts) {
    opts = opts || {};
    const size = opts.size || 'seat';
    const empty = opts.empty === true;
    const wrap = document.createElement('div');
    wrap.className = 'sgs-hero-card sgs-hero-card--' + size;
    wrap.setAttribute('aria-label', opts.title || '角色卡');
    if (opts.title) wrap.title = opts.title;

    if (!empty && portraitOrId) {
      const src = heroPortraitUrl(portraitOrId);
      if (src) {
        const img = document.createElement('img');
        img.className = 'sgs-hero-card-art';
        img.alt = opts.title || '角色';
        img.draggable = false;
        img.src = src;
        img.onerror = function () {
          img.remove();
          wrap.classList.add('is-empty');
        };
        wrap.appendChild(img);
        return wrap;
      }
    }
    wrap.classList.add('is-empty');
    return wrap;
  }

  function heroCardSlotHtml(opts) {
    opts = opts || {};
    const size = opts.size || 'seat';
    const title = opts.title ? ` title="${String(opts.title).replace(/"/g, '')}"` : '';
    if (opts.faceDown) {
      const src = generalBackUrl();
      return (
        `<div class="sgs-hero-card sgs-hero-card--${size} is-back"${title} aria-label="武将牌背">` +
        `<img class="sgs-hero-card-art" src="${src}" alt="将背" draggable="false" />` +
        `</div>`
      );
    }
    const portrait = opts.portrait || opts.portraitOrId || null;
    if (portrait && opts.empty !== true) {
      const src = heroPortraitUrl(portrait);
      if (src) {
        return (
          `<div class="sgs-hero-card sgs-hero-card--${size}"${title} aria-label="角色卡">` +
          `<img class="sgs-hero-card-art" src="${src}" alt="" draggable="false" onerror="this.parentNode.classList.add('is-empty');this.remove();" />` +
          `</div>`
        );
      }
    }
    return `<div class="sgs-hero-card sgs-hero-card--${size} is-empty"${title} aria-label="角色卡"></div>`;
  }

  /**
   * @param {object|null} card
   * @param {{ selectable?: boolean, selected?: boolean, faceDown?: boolean, size?: 'sm'|'md'|'lg', title?: string }} opts
   */
  function createCardEl(card, opts) {
    opts = opts || {};
    const el = document.createElement(opts.selectable ? 'button' : 'div');
    if (opts.selectable) el.type = 'button';
    el.className =
      'sgs-kapai' +
      (opts.size === 'sm' ? ' sm' : opts.size === 'lg' ? ' lg' : '') +
      (opts.selected ? ' selected' : '') +
      (opts.faceDown ? ' face-down' : '');
    if (card && card.id) el.dataset.cardId = card.id;

    const img = document.createElement('img');
    img.className = 'sgs-kapai-art';
    img.alt = opts.faceDown ? '牌背' : (card && card.name) || '牌';
    img.draggable = false;
    img.src = opts.faceDown ? cardBackUrl() : cardFaceUrl(card);
    el.appendChild(img);

    if (card && (card.virtual || card.mark === '虚')) {
      const badge = document.createElement('div');
      badge.className = 'sgs-kapai-virtual';
      badge.textContent = card.virtualLabel || '虚';
      if (card.virtualTitle) badge.title = card.virtualTitle;
      el.appendChild(badge);
    } else if (card && (card.onMuniu || card.muniuLabel)) {
      const badge = document.createElement('div');
      badge.className = 'sgs-kapai-virtual is-muniu-label';
      badge.textContent = card.muniuLabel || '木牛';
      el.appendChild(badge);
    }

    if (!opts.faceDown && card && card.suit) {
      const suit = SUIT[card.suit] || { mark: card.suitLabel || '?', color: card.color || 'black' };
      const mark = document.createElement('div');
      mark.className = 'sgs-kapai-mark ' + suit.color;
      mark.innerHTML =
        `<span class="sgs-kapai-suit">${suit.mark}</span>` +
        `<span class="sgs-kapai-rank">${rankLabel(card.number)}</span>`;
      el.appendChild(mark);
    }

    el.title =
      opts.title ||
      (opts.faceDown
        ? '手牌'
        : card
          ? `${card.suitLabel || ''}${rankLabel(card.number)} ${card.name}`
          : '牌');
    return el;
  }

  function createBackStack(count, size) {
    const wrap = document.createElement('div');
    wrap.className = 'sgs-pile-stack';
    const layers = Math.min(6, Math.max(1, Math.ceil((count || 0) / 15)));
    for (let i = 0; i < layers; i++) {
      const c = createCardEl(null, { faceDown: true, size: size || 'md' });
      c.style.transform = `translate(${i * 2}px, ${-i * 2}px)`;
      wrap.appendChild(c);
    }
    return wrap;
  }

  let previewTimer = null;
  let previewKey = null;

  function ensurePreviewHost() {
    let host = document.getElementById('sgs-card-preview');
    if (!host) {
      host = document.createElement('div');
      host.id = 'sgs-card-preview';
      host.className = 'sgs-card-preview';
      host.hidden = true;
      host.setAttribute('aria-hidden', 'true');
      document.body.appendChild(host);
    }
    return host;
  }

  function hideCardPreview() {
    if (previewTimer) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
    previewKey = null;
    const host = document.getElementById('sgs-card-preview');
    if (host) {
      host.hidden = true;
      host.classList.remove('is-visible');
      host.innerHTML = '';
    }
  }

  function placePreview(host, anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    const preview = host.firstElementChild;
    const pw = preview ? preview.offsetWidth : 148;
    const ph = preview ? preview.offsetHeight : 204;
    const gap = 12;
    let left = rect.left + rect.width / 2 - pw / 2;
    let top = rect.top - ph - gap;
    const pad = 8;
    left = Math.max(pad, Math.min(left, window.innerWidth - pw - pad));
    if (top < pad) {
      top = Math.min(rect.bottom + gap, window.innerHeight - ph - pad);
    }
    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(top)}px`;
  }

  function showCardPreview(anchorEl, card) {
    if (!card || !anchorEl || !document.body.contains(anchorEl)) return;
    const host = ensurePreviewHost();
    host.innerHTML = '';
    const big = createCardEl(card, { size: 'lg', title: '' });
    big.classList.add('sgs-kapai-preview');
    big.tabIndex = -1;
    host.appendChild(big);
    host.hidden = false;
    placePreview(host, anchorEl);
    requestAnimationFrame(() => {
      if (!host.hidden) host.classList.add('is-visible');
    });
  }

  /**
   * 悬停停顿后，在手牌上方放大单独显示卡面。
   * @param {HTMLElement} el
   * @param {object} card
   * @param {{ delay?: number }} [opts]
   */
  function bindCardHoverPreview(el, card, opts) {
    if (!el || !card || (opts && opts.faceDown)) return;
    const delay = (opts && opts.delay) || 420;
    const key = card.id || `${card.name}-${card.suit}-${card.number}`;

    el.addEventListener('pointerenter', () => {
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        previewTimer = null;
        previewKey = key;
        showCardPreview(el, card);
      }, delay);
    });

    el.addEventListener('pointerleave', () => {
      if (previewTimer) {
        clearTimeout(previewTimer);
        previewTimer = null;
      }
      if (previewKey === key) hideCardPreview();
    });

    el.addEventListener('pointerdown', () => {
      hideCardPreview();
    });
  }

  return {
    RES,
    PIC,
    url,
    rankLabel,
    cardFaceUrl,
    cardBackUrl,
    generalBackUrl,
    identityUrl,
    identityBackUrl,
    identityLabel,
    heroPortraitUrl,
    createHeroCardEl,
    heroCardSlotHtml,
    createCardEl,
    createBackStack,
    bindCardHoverPreview,
    hideCardPreview,
    cardVoiceUrl,
    playCardVoice,
    playBgm,
    stopBgm,
    playSfx,
    playSfxFromLogs,
    playAnnounceFromLogs,
    CARD_VOICE_INDEX,
  };
})();
