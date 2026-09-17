'use strict';

/**
 * 一次性写入：颜良文丑/袁绍/贾诩/徐晃/祝融/刘禅/鲁肃/姜维
 */
const fs = require('fs');
const path = require('path');
const root = __dirname;

function w(rel, content) {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content, 'utf8');
  console.log('wrote', rel);
}

// ——— yanliangwenchou ———
w(
  'yanliangwenchou/index.js',
  `'use strict';
module.exports = {
  id: 'yanliangwenchou',
  name: '颜良文丑',
  code: 'QUN004',
  title: '虎狼兄弟',
  country: '群',
  maxHp: 4,
  gender: 'male',
  portrait: 'hero_yanliangwenchou.png',
  skills: [
  require('./shuangxiong'),
  ],
};
`
);

w(
  'yanliangwenchou/shuangxiong.js',
  `'use strict';
module.exports = {
  id: 'shuangxiong',
  name: '双雄',
  desc: '摸牌阶段，你可以放弃摸牌并进行一次判定，你获得生效后的判定牌，然后本回合你可以将一张与判定结果颜色不同的牌当【决斗】使用。',
  type: 'viewAs',
  triggers: ['phaseDraw'],
  filter(ctx) {
    if (ctx.trigger === 'phaseDraw') return true;
    const color =
      ctx.player.skillStates && ctx.player.skillStates.shuangxiongColor;
    return Boolean(color);
  },
  content(ctx) {
    const jc = ctx.judge(ctx.player);
    if (!jc) return { ok: true };
    ctx.log(
      ctx.player.name +
        ' 双雄判定为 ' +
        (ctx.suitLabel(jc.suit) || jc.suit) +
        jc.number
    );
    ctx.game.discardPile = ctx.game.discardPile.filter((id) => id !== jc.id);
    ctx.gainToHand(ctx.player, jc.id);
    const color = ctx.suitColor(jc.suit) || jc.color;
    const opposite = color === 'red' ? 'black' : 'red';
    ctx.player.skillStates = ctx.player.skillStates || {};
    ctx.player.skillStates.shuangxiongColor = opposite;
    ctx.player.skillStates._skipNormalDraw = true;
    ctx.log(
      ctx.player.name +
        ' 本回合可将' +
        (opposite === 'red' ? '红' : '黑') +
        '色牌当【决斗】使用'
    );
    return { ok: true };
  },
  viewAs: {
    to: 'juedou',
    includeEquip: true,
    cardFilter(card, ctx) {
      if (!card || !ctx || !ctx.player) return false;
      const need =
        ctx.player.skillStates && ctx.player.skillStates.shuangxiongColor;
      if (!need) return false;
      const color = ctx.suitColor(card.suit) || card.color;
      return color === need;
    },
  },
};
`
);

// ——— yuanshao ———
w(
  'yuanshao/index.js',
  `'use strict';
module.exports = {
  id: 'yuanshao',
  name: '袁绍',
  code: 'QUN005',
  title: '高贵的名门',
  country: '群',
  maxHp: 4,
  gender: 'male',
  portrait: 'hero_yuanshao.png',
  skills: [
  require('./luanji'),
  require('./xueyi'),
  ],
};
`
);

w(
  'yuanshao/luanji.js',
  `'use strict';
module.exports = {
  id: 'luanji',
  name: '乱击',
  desc: '出牌阶段，你可以将两张相同花色的手牌当【万箭齐发】使用。',
  type: 'active',
  filter(ctx) {
    const hand = ctx.player.hand || [];
    if (hand.length < 2) return false;
    const bySuit = {};
    for (const id of hand) {
      const c = ctx.cardById(id);
      if (!c) continue;
      bySuit[c.suit] = (bySuit[c.suit] || 0) + 1;
      if (bySuit[c.suit] >= 2) return true;
    }
    return false;
  },
  content(ctx) {
    const ids = (ctx.payload && ctx.payload.cardIds) || [];
    if (ids.length !== 2) return { ok: false };
    const cards = ids.map((id) => ctx.cardById(id));
    if (cards.some((c) => !c)) return { ok: false };
    if (!ids.every((id) => ctx.player.hand.includes(id))) return { ok: false };
    if (cards[0].suit !== cards[1].suit) return { ok: false };
    for (const id of ids) ctx.discard(ctx.player, id, 'hand');
    ctx.log(ctx.player.name + ' 发动乱击，视为使用【万箭齐发】');
    if (typeof ctx.playWanjian === 'function') {
      const vid = 'virt_wanjian_' + Date.now();
      ctx.game.cards[vid] = {
        id: vid,
        name: '万箭齐发',
        type: 'trick',
        subtype: 'wanjian',
        suit: cards[0].suit,
        number: cards[0].number,
        virtual: true,
        _viewAs: 'luanji',
      };
      ctx.player.hand.push(vid);
      return ctx.playWanjian(ctx.player, ctx.game.cards[vid]);
    }
    const me = ctx.player;
    const alive = ctx.alivePlayers().slice().sort((a, b) => a.seat - b.seat);
    const idx = alive.findIndex((p) => p.id === me.id);
    const victims = [];
    for (let i = 1; i < alive.length; i++) {
      const p = alive[(idx + i) % alive.length];
      if (p.id === me.id) break;
      victims.push(p.id);
    }
    ctx.setPending({
      type: 'aoe_shan',
      sourceId: me.id,
      victims,
      index: 0,
      cardName: '万箭齐发',
      message: '万箭齐发：请打出【闪】',
      askId: victims[0] || null,
    });
    if (typeof ctx.askAoe === 'function') ctx.askAoe();
    else if (victims[0] && ctx.game.pending) {
      const t = ctx.getPlayer(victims[0]);
      ctx.game.pending.askId = victims[0];
      ctx.game.pending.message =
        '万箭齐发：' + (t ? t.name : '') + ' 请响应';
    }
    return { ok: true };
  },
};
`
);

w(
  'yuanshao/xueyi.js',
  `'use strict';
module.exports = {
  id: 'xueyi',
  name: '血裔',
  desc: '主公技，锁定技，你的手牌上限+2X（X为其他群雄角色数）。',
  type: 'locked',
  lord: true,
};
`
);

// ——— jiaxu ———
w(
  'jiaxu/index.js',
  `'use strict';
module.exports = {
  id: 'jiaxu',
  name: '贾诩',
  code: 'QUN006',
  title: '毒士',
  country: '群',
  maxHp: 3,
  gender: 'male',
  portrait: 'hero_jiaxu.png',
  skills: [
  require('./wansha'),
  require('./luanwu'),
  require('./weimu'),
  ],
};
`
);

w(
  'jiaxu/wansha.js',
  `'use strict';
module.exports = {
  id: 'wansha',
  name: '完杀',
  desc: '锁定技，在你的回合，除你以外，其他角色不能使用【桃】救濒死的角色。',
  type: 'locked',
};
`
);

w(
  'jiaxu/luanwu.js',
  `'use strict';
const { limitedUsed, markLimitedUsed } = require('../_infra_helpers');

module.exports = {
  id: 'luanwu',
  name: '乱武',
  desc: '限定技，出牌阶段，你可令所有其他角色依次选择：对距离最近的另一名角色使用【杀】，或失去1点体力。',
  type: 'active',
  filter(ctx) {
    return !limitedUsed(ctx.player, 'luanwu');
  },
  content(ctx) {
    markLimitedUsed(ctx.player, 'luanwu');
    const others = ctx.alivePlayers().filter((p) => p.id !== ctx.player.id);
    if (!others.length) return { ok: true };
    const order = others
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((p) => p.id);
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'luanwu',
      playerId: ctx.player.id,
      askId: order[0],
      order,
      index: 0,
      message: '乱武：对距离最近的角色出【杀】，或失去1点体力',
    });
    return { ok: true };
  },
};
`
);

w(
  'jiaxu/weimu.js',
  `'use strict';
module.exports = {
  id: 'weimu',
  name: '帷幕',
  desc: '锁定技，你不能成为黑色锦囊牌的目标。',
  type: 'locked',
  canBeTarget(ctx) {
    const card = ctx.card || (ctx.cardId ? ctx.cardById(ctx.cardId) : null);
    const name = ctx.cardName;
    const trickNames = [
      '顺手牵羊',
      '过河拆桥',
      '决斗',
      '借刀杀人',
      '南蛮入侵',
      '万箭齐发',
      '乐不思蜀',
      '兵粮寸断',
      '闪电',
      '无中生有',
      '铁索连环',
      '火攻',
    ];
    const isTrick =
      (card && (card.type === 'trick' || card.type === 'delayed')) ||
      (name && trickNames.includes(name));
    if (!isTrick) return true;
    let color = null;
    if (card) color = ctx.suitColor(card.suit) || card.color;
    if (!color && ctx.cardColor) color = ctx.cardColor;
    if (color === 'black') return false;
    return true;
  },
};
`
);

// ——— xuhuang ———
w(
  'xuhuang/index.js',
  `'use strict';
module.exports = {
  id: 'xuhuang',
  name: '徐晃',
  code: 'WEI008',
  title: '周亚夫之风',
  country: '魏',
  maxHp: 4,
  gender: 'male',
  portrait: 'hero_xuhuang.png',
  skills: [
  require('./duanliang'),
  ],
};
`
);

w(
  'xuhuang/duanliang.js',
  `'use strict';
module.exports = {
  id: 'duanliang',
  name: '断粮',
  desc: '你可以将一张黑色基本牌或装备牌当【兵粮寸断】使用；你使用【兵粮寸断】的距离为2；当一名角色跳过摸牌阶段后，你可以摸一张牌。',
  type: 'viewAs',
  triggers: ['afterSkipDraw'],
  filter(ctx) {
    if (ctx.trigger === 'afterSkipDraw') return true;
    return true;
  },
  content(ctx) {
    if (ctx.trigger === 'afterSkipDraw') {
      ctx.draw(ctx.player, 1);
      return { ok: true };
    }
    return null;
  },
  viewAs: {
    to: 'bingliang',
    includeEquip: true,
    cardFilter(card) {
      if (!card) return false;
      const black = card.suit === 'spade' || card.suit === 'club';
      if (!black) return false;
      return card.type === 'basic' || card.type === 'equip';
    },
  },
  bingliangMaxDistance() {
    return 2;
  },
};
`
);

// ——— zhurong ———
w(
  'zhurong/index.js',
  `'use strict';
module.exports = {
  id: 'zhurong',
  name: '祝融',
  code: 'SHU008',
  title: '野性的女王',
  country: '蜀',
  maxHp: 4,
  gender: 'female',
  portrait: 'hero_zhurong.png',
  skills: [
  require('./juxiang'),
  require('./lieren'),
  ],
};
`
);

w(
  'zhurong/juxiang.js',
  `'use strict';
module.exports = {
  id: 'juxiang',
  name: '巨象',
  desc: '锁定技，【南蛮入侵】对你无效；当其他角色使用的【南蛮入侵】结算结束后，你获得之。',
  type: 'locked',
  canBeTarget(ctx) {
    if (ctx.cardName === '南蛮入侵') return false;
    return true;
  },
  triggers: ['afterAoeSettle'],
  filter(ctx) {
    return ctx.cardName === '南蛮入侵' && ctx.sourceId !== ctx.player.id;
  },
  content(ctx) {
    const cid = ctx.cardId;
    if (!cid) return { ok: true };
    ctx.game.discardPile = ctx.game.discardPile.filter((id) => id !== cid);
    if (ctx.game.drawPile) {
      ctx.game.drawPile = ctx.game.drawPile.filter((id) => id !== cid);
    }
    ctx.gainToHand(ctx.player, cid);
    ctx.log(ctx.player.name + ' 巨象获得【南蛮入侵】');
    return { ok: true };
  },
};
`
);

w(
  'zhurong/lieren.js',
  `'use strict';
const { resolvePinDian } = require('../_infra_helpers');

module.exports = {
  id: 'lieren',
  name: '烈刃',
  desc: '当你使用【杀】对目标角色造成伤害后，你可以与其拼点，若你赢，你获得其一张牌。',
  type: 'trigger',
  triggers: ['afterShaDamage'],
  filter(ctx) {
    const t = ctx.getPlayer(ctx.targetId);
    if (!t || !t.alive) return false;
    if (!ctx.player.hand.length || !t.hand.length) return false;
    return true;
  },
  content(ctx) {
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'lieren',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      targetId: ctx.targetId,
      step: 'pindian',
      message: '烈刃：选择一张手牌拼点，或取消',
      canPass: true,
    });
    return { ok: true };
  },
  // resolvePinDian 供 skillEffects 使用
  _resolvePinDian: resolvePinDian,
};
`
);

// ——— liushan ———
w(
  'liushan/index.js',
  `'use strict';
module.exports = {
  id: 'liushan',
  name: '刘禅',
  code: 'SHU009',
  title: '无为的真命主',
  country: '蜀',
  maxHp: 3,
  gender: 'male',
  portrait: 'hero_liushan.png',
  skills: [
  require('./xiangle'),
  require('./fangquan'),
  require('./ruoyu'),
  ],
};
`
);

w(
  'liushan/xiangle.js',
  `'use strict';
module.exports = {
  id: 'xiangle',
  name: '享乐',
  desc: '锁定技，当其他角色使用【杀】指定你为目标时，需弃置一张基本牌，否则此【杀】对你无效。',
  type: 'locked',
  forced: true,
  triggers: ['whenShaTarget'],
  filter(ctx) {
    return Boolean(ctx.sourceId && ctx.sourceId !== ctx.player.id);
  },
  content(ctx) {
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'xiangle',
      playerId: ctx.player.id,
      askId: ctx.sourceId,
      sourceId: ctx.sourceId,
      targetId: ctx.player.id,
      message: '享乐：弃置一张基本牌，否则此【杀】无效',
      canPass: true,
    });
    return { ok: true };
  },
};
`
);

w(
  'liushan/fangquan.js',
  `'use strict';
module.exports = {
  id: 'fangquan',
  name: '放权',
  desc: '你可以跳过出牌阶段，若如此做，本回合手牌上限等于体力上限，并在回合结束时令一名其他角色获得一个额外的回合。',
  type: 'trigger',
  triggers: ['phasePlay', 'phaseEnd'],
  filter(ctx) {
    if (ctx.trigger === 'phasePlay') return true;
    return Boolean(
      ctx.player.skillStates && ctx.player.skillStates.fangquanPending
    );
  },
  content(ctx) {
    if (ctx.trigger === 'phasePlay') {
      ctx.player.skillStates = ctx.player.skillStates || {};
      ctx.player.skillStates.fangquanHandLimit = true;
      ctx.player.skillStates.fangquanPending = true;
      ctx.player.skipPlay = true;
      ctx.log(ctx.player.name + ' 发动放权，跳过出牌阶段');
      return { ok: true };
    }
    // phaseEnd：选择一名其他角色获得额外回合
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'fangquan',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      message: '放权：选择一名其他角色获得一个额外回合',
      canPass: false,
    });
    return { ok: true };
  },
};
`
);

w(
  'liushan/ruoyu.js',
  `'use strict';
const { awakened, markAwakened, gainSkill } = require('../_infra_helpers');

module.exports = {
  id: 'ruoyu',
  name: '若愚',
  desc: '主公技，觉醒技，准备阶段，若你的体力为全场最少（或之一），你加1点体力上限，回复1点体力，并获得技能【激将】。',
  type: 'lord',
  lord: true,
  forced: true,
  triggers: ['phasePrepare'],
  filter(ctx) {
    if (awakened(ctx.player, 'ruoyu')) return false;
    const mine = ctx.player.hp;
    const min = Math.min(...ctx.alivePlayers().map((p) => p.hp));
    return mine <= min;
  },
  content(ctx) {
    markAwakened(ctx.player, 'ruoyu');
    ctx.player.maxHp += 1;
    ctx.recover(ctx.player, 1);
    gainSkill(ctx.player, {
      id: 'jijiang',
      name: '激将',
      desc: '主公技，当你需要使用或打出【杀】时，可令其他蜀势力角色打出【杀】。',
      lord: true,
    });
    ctx.log(ctx.player.name + ' 若愚觉醒：体力上限+1并获得【激将】');
    return { ok: true };
  },
};
`
);

// ——— lusu ———
w(
  'lusu/index.js',
  `'use strict';
module.exports = {
  id: 'lusu',
  name: '鲁肃',
  code: 'WU009',
  title: '独断的外交家',
  country: '吴',
  maxHp: 3,
  gender: 'male',
  portrait: 'hero_lusu.png',
  skills: [
  require('./haoshi'),
  require('./dimeng'),
  ],
};
`
);

w(
  'lusu/haoshi.js',
  `'use strict';
module.exports = {
  id: 'haoshi',
  name: '好施',
  desc: '摸牌阶段，你可以额外摸两张牌，若此时手牌数大于5，则将一半的手牌（向下取整）交给手牌最少的一名其他角色。',
  type: 'trigger',
  triggers: ['phaseDrawBonus', 'afterDraw'],
  filter(ctx) {
    if (ctx.trigger === 'phaseDrawBonus') return true;
    return Boolean(
      ctx.player.skillStates && ctx.player.skillStates.haoshiGive
    );
  },
  content(ctx) {
    if (ctx.trigger === 'phaseDrawBonus') {
      ctx._drawBonus = (ctx._drawBonus || 0) + 2;
      if (ctx.drawBonusRef) ctx.drawBonusRef.n += 2;
      ctx.player.skillStates = ctx.player.skillStates || {};
      ctx.player.skillStates.haoshiGive = true;
      ctx.markSkillUsed(ctx.player, 'haoshi');
      return { ok: true };
    }
    delete ctx.player.skillStates.haoshiGive;
    if (ctx.player.hand.length <= 5) return { ok: true };
    const give = Math.floor(ctx.player.hand.length / 2);
    if (give <= 0) return { ok: true };
    const others = ctx.alivePlayers().filter((p) => p.id !== ctx.player.id);
    if (!others.length) return { ok: true };
    const min = Math.min(...others.map((p) => p.hand.length));
    const candidates = others.filter((p) => p.hand.length === min);
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'haoshi',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      giveCount: give,
      candidateIds: candidates.map((p) => p.id),
      message:
        '好施：将 ' +
        give +
        ' 张手牌交给手牌最少的一名角色',
    });
    return { ok: true };
  },
};
`
);

w(
  'lusu/dimeng.js',
  `'use strict';
module.exports = {
  id: 'dimeng',
  name: '缔盟',
  desc: '出牌阶段限一次，你可以选择两名其他角色，弃置X张牌（X为两人手牌数之差），然后交换他们的手牌。',
  type: 'active',
  filter(ctx) {
    return (
      !ctx.skillUsed(ctx.player, 'dimeng') &&
      ctx.alivePlayers().filter((p) => p.id !== ctx.player.id).length >= 2
    );
  },
  content(ctx) {
    const tids =
      (ctx.payload && ctx.payload.targetIds) ||
      [
        ctx.payload && ctx.payload.targetA,
        ctx.payload && ctx.payload.targetB,
      ].filter(Boolean);
    if (!tids || tids.length !== 2) return { ok: false };
    const a = ctx.getPlayer(tids[0]);
    const b = ctx.getPlayer(tids[1]);
    if (!a || !b || a.id === ctx.player.id || b.id === ctx.player.id) {
      return { ok: false };
    }
    if (a.id === b.id) return { ok: false };
    const diff = Math.abs(a.hand.length - b.hand.length);
    const discards = (ctx.payload && ctx.payload.cardIds) || [];
    if (discards.length !== diff) return { ok: false };
    for (const id of discards) {
      if (ctx.player.hand.includes(id)) ctx.discard(ctx.player, id, 'hand');
      else {
        const slot = Object.keys(ctx.player.equips || {}).find(
          (s) => ctx.player.equips[s] && ctx.player.equips[s].id === id
        );
        if (slot) ctx.discard(ctx.player, id, 'equip:' + slot);
        else return { ok: false };
      }
    }
    const ha = a.hand.slice();
    const hb = b.hand.slice();
    a.hand = hb;
    b.hand = ha;
    ctx.markSkillUsed(ctx.player, 'dimeng');
    ctx.log(
      ctx.player.name + ' 缔盟：' + a.name + ' 与 ' + b.name + ' 交换手牌'
    );
    return { ok: true };
  },
};
`
);

// ——— jiangwei ———
w(
  'jiangwei/index.js',
  `'use strict';
module.exports = {
  id: 'jiangwei',
  name: '姜维',
  code: 'SHU010',
  title: '龙的衣钵',
  country: '蜀',
  maxHp: 4,
  gender: 'male',
  portrait: 'hero_jiangwei.png',
  skills: [
  require('./tiaoxin'),
  require('./zhiji'),
  ],
};
`
);

w(
  'jiangwei/tiaoxin.js',
  `'use strict';
module.exports = {
  id: 'tiaoxin',
  name: '挑衅',
  desc: '出牌阶段限一次，你可以令攻击范围内含有你的一名角色选择一项：对你使用一张【杀】，或令你弃置其一张牌。',
  type: 'active',
  filter(ctx) {
    if (ctx.skillUsed(ctx.player, 'tiaoxin')) return false;
    return ctx.alivePlayers().some((p) => {
      if (p.id === ctx.player.id) return false;
      return ctx.inAttackRange(p.id, ctx.player.id);
    });
  },
  content(ctx) {
    const tid = ctx.payload && ctx.payload.targetId;
    const target = ctx.getPlayer(tid);
    if (!target || target.id === ctx.player.id) return { ok: false };
    if (!ctx.inAttackRange(target.id, ctx.player.id)) return { ok: false };
    ctx.markSkillUsed(ctx.player, 'tiaoxin');
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'tiaoxin',
      playerId: ctx.player.id,
      askId: target.id,
      targetId: target.id,
      message: '挑衅：对发动者使用【杀】，或被弃置一张牌',
      canPass: true,
    });
    return { ok: true };
  },
};
`
);

w(
  'jiangwei/zhiji.js',
  `'use strict';
const { awakened, markAwakened, gainSkill } = require('../_infra_helpers');

module.exports = {
  id: 'zhiji',
  name: '志继',
  desc: '觉醒技，准备阶段，若你没有手牌，你回复1点体力或摸两张牌，然后减1点体力上限，并获得技能【观星】。',
  type: 'trigger',
  forced: true,
  triggers: ['phasePrepare'],
  filter(ctx) {
    if (awakened(ctx.player, 'zhiji')) return false;
    return ctx.player.hand.length === 0;
  },
  content(ctx) {
    markAwakened(ctx.player, 'zhiji');
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'zhiji',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      message: '志继：选择回复1点体力或摸两张牌',
      step: 'choose',
    });
    return { ok: true };
  },
  _gainSkill: gainSkill,
};
`
);

console.log('done');
