'use strict';

/**
 * 一次性写入界标包武将元数据与技能实现（可重复运行覆盖）
 */
const fs = require('fs');
const path = require('path');
const root = __dirname;

function w(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function heroIndex(h) {
  const skills = h.skills
    .map((s) => `  require('./${s}'),`)
    .join('\n');
  return `'use strict';
module.exports = {
  id: '${h.id}',
  name: '${h.name}',
  code: '${h.code}',
  title: '${h.title}',
  country: '${h.country}',
  maxHp: ${h.maxHp},
  gender: '${h.gender}',
  portrait: '${h.id}.png',
  skills: [
${skills}
  ],
};
`;
}

const heroes = [
  { id: 'caocao', name: '界曹操', code: 'WEI001', title: '魏武帝', country: '魏', maxHp: 4, gender: 'male', skills: ['jianxiong', 'hujia'] },
  { id: 'simayi', name: '界司马懿', code: 'WEI002', title: '狼顾之鬼', country: '魏', maxHp: 3, gender: 'male', skills: ['fankui', 'guicai'] },
  { id: 'xiahoudun', name: '界夏侯惇', code: 'WEI003', title: '独眼的罗刹', country: '魏', maxHp: 4, gender: 'male', skills: ['ganglie'] },
  { id: 'zhangliao', name: '界张辽', code: 'WEI004', title: '前将军', country: '魏', maxHp: 4, gender: 'male', skills: ['tuxi'] },
  { id: 'xuchu', name: '界许褚', code: 'WEI005', title: '虎痴', country: '魏', maxHp: 4, gender: 'male', skills: ['luoyi'] },
  { id: 'guojia', name: '郭嘉', code: 'WEI006', title: '早终的先知', country: '魏', maxHp: 3, gender: 'male', skills: ['tiandu', 'yiji'] },
  { id: 'zhenji', name: '界甄姬', code: 'WEI007', title: '薄倖的美人', country: '魏', maxHp: 3, gender: 'female', skills: ['qingguo', 'luoshen'] },
  { id: 'liubei', name: '界刘备', code: 'SHU001', title: '乱世的枭雄', country: '蜀', maxHp: 4, gender: 'male', skills: ['rende', 'jijiang'] },
  { id: 'guanyu', name: '界关羽', code: 'SHU002', title: '美髯公', country: '蜀', maxHp: 4, gender: 'male', skills: ['wusheng'] },
  { id: 'zhangfei', name: '界张飞', code: 'SHU003', title: '万夫不当', country: '蜀', maxHp: 4, gender: 'male', skills: ['paoxiao'] },
  { id: 'zhugeliang', name: '界诸葛亮', code: 'SHU004', title: '迟暮的丞相', country: '蜀', maxHp: 3, gender: 'male', skills: ['guanxing', 'kongcheng'] },
  { id: 'zhaoyun', name: '界赵云', code: 'SHU005', title: '少年将军', country: '蜀', maxHp: 4, gender: 'male', skills: ['longdan', 'yajiao'] },
  { id: 'machao', name: '界马超', code: 'SHU006', title: '一骑当千', country: '蜀', maxHp: 4, gender: 'male', skills: ['mashu', 'tieji'] },
  { id: 'huangyueying', name: '界黄月英', code: 'SHU007', title: '归隐的杰女', country: '蜀', maxHp: 3, gender: 'female', skills: ['jizhi', 'qicai'] },
  { id: 'sunquan', name: '界孙权', code: 'WU001', title: '年轻的贤君', country: '吴', maxHp: 4, gender: 'male', skills: ['zhiheng', 'jiuyuan'] },
  { id: 'ganning', name: '甘宁', code: 'WU002', title: '锦帆游侠', country: '吴', maxHp: 4, gender: 'male', skills: ['qixi'] },
  { id: 'lvmeng', name: '吕蒙', code: 'WU003', title: '白衣渡江', country: '吴', maxHp: 4, gender: 'male', skills: ['keji'] },
  { id: 'huanggai', name: '黄盖', code: 'WU004', title: '轻身为国', country: '吴', maxHp: 4, gender: 'male', skills: ['kurou'] },
  { id: 'zhouyu', name: '周瑜', code: 'WU005', title: '大都督', country: '吴', maxHp: 3, gender: 'male', skills: ['yingzi', 'fanjian'] },
  { id: 'daqiao', name: '大乔', code: 'WU006', title: '矜持之花', country: '吴', maxHp: 3, gender: 'female', skills: ['guose', 'liuli'] },
  { id: 'luxun', name: '界陆逊', code: 'WU007', title: '儒生雄才', country: '吴', maxHp: 3, gender: 'male', skills: ['qianxun', 'lianying'] },
  { id: 'sunshangxiang', name: '界孙尚香', code: 'WU008', title: '弓腰姬', country: '吴', maxHp: 3, gender: 'female', skills: ['jieyin', 'xiaoji'] },
  { id: 'huatuo', name: '华佗', code: 'QUN001', title: '神医', country: '群', maxHp: 3, gender: 'male', skills: ['jijiu', 'qingnang'] },
  { id: 'lvbu', name: '吕布', code: 'QUN002', title: '武的化身', country: '群', maxHp: 4, gender: 'male', skills: ['wushuang', 'liyu'] },
  { id: 'diaochan', name: '界貂蝉', code: 'QUN003', title: '绝世的舞姬', country: '群', maxHp: 3, gender: 'female', skills: ['lijian', 'biyue'] },
];

// ——— skill implementations ———
const skills = {};

skills.jianxiong = `'use strict';
module.exports = {
  id: 'jianxiong',
  name: '奸雄',
  desc: '你每受到一次伤害，你可以摸一张牌并获得对你造成伤害的牌。',
  type: 'trigger',
  triggers: ['afterDamage'],
  filter(ctx) {
    return true;
  },
  content(ctx) {
    ctx.draw(ctx.player, 1);
    if (ctx.cardId) {
      const c = ctx.cardById(ctx.cardId);
      if (c) {
        ctx.game.discardPile = ctx.game.discardPile.filter((id) => id !== ctx.cardId);
        ctx.gainToHand(ctx.player, ctx.cardId);
        ctx.log(ctx.player.name + ' 获得了伤害牌');
      }
    }
    return { ok: true };
  },
};
`;

skills.hujia = `'use strict';
module.exports = {
  id: 'hujia',
  name: '护驾',
  desc: '主公技，当你需要使用或打出一张【闪】时，你可令其他魏势力角色打出一张【闪】（视为由你使用或打出）。',
  type: 'lord',
  lord: true,
  triggers: ['needShan'],
  filter(ctx) {
    return ctx.alivePlayers().some(
      (p) => p.alive && p.id !== ctx.player.id && p.country === '魏'
    );
  },
  content(ctx) {
    const helpers = ctx.alivePlayers().filter(
      (p) => p.id !== ctx.player.id && p.country === '魏'
    );
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'hujia',
      playerId: ctx.player.id,
      askId: helpers[0].id,
      helpers: helpers.map((p) => p.id),
      index: 0,
      resume: ctx.resume || null,
      message: '护驾：请打出【闪】，或取消',
    });
    return { ok: true };
  },
};
`;

skills.fankui = `'use strict';
module.exports = {
  id: 'fankui',
  name: '反馈',
  desc: '你每受到一次伤害，你可以获得伤害来源的一张牌。',
  type: 'trigger',
  triggers: ['afterDamage'],
  filter(ctx) {
    if (!ctx.sourceId) return false;
    const src = ctx.getPlayer(ctx.sourceId);
    if (!src || !src.alive) return false;
    const n =
      src.hand.length +
      Object.values(src.equips || {}).filter(Boolean).length;
    return n > 0;
  },
  content(ctx) {
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'fankui',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      sourceId: ctx.sourceId,
      message: '反馈：选择获得伤害来源的一张牌',
    });
    return { ok: true };
  },
};
`;

skills.guicai = `'use strict';
module.exports = {
  id: 'guicai',
  name: '鬼才',
  desc: '在判定牌生效前，你可以打出一张牌代替之。',
  type: 'trigger',
  triggers: ['beforeJudge'],
  filter(ctx) {
    const p = ctx.player;
    if (p.hand.length) return true;
    return Object.values(p.equips || {}).some(Boolean);
  },
  content(ctx) {
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'guicai',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      judgeOwnerId: ctx.judgeOwnerId,
      message: '鬼才：打出一张牌替换判定牌，或取消',
      canPass: true,
    });
    return { ok: true };
  },
};
`;

skills.ganglie = `'use strict';
module.exports = {
  id: 'ganglie',
  name: '刚烈',
  desc: '你每受到一次伤害，你可以进行判定：若结果为红色，则伤害来源受到你造成的1点伤害；若结果为黑色，你选择令伤害来源弃置一张牌。',
  type: 'trigger',
  triggers: ['afterDamage'],
  filter(ctx) {
    return Boolean(ctx.sourceId && ctx.getPlayer(ctx.sourceId));
  },
  content(ctx) {
    const jid = ctx.judge(ctx.player);
    if (!jid) return null;
    const jc = ctx.cardById(jid);
    ctx.game.discardPile.push(jid);
    const color = ctx.suitColor(jc.suit);
    ctx.log(
      ctx.player.name +
        ' 刚烈判定 ' +
        ctx.suitLabel(jc.suit) +
        jc.number +
        ' → ' +
        (color === 'red' ? '红色' : '黑色')
    );
    const src = ctx.getPlayer(ctx.sourceId);
    if (!src || !src.alive) return { ok: true };
    if (color === 'red') {
      ctx.dealDamage(ctx.player.id, src.id, 1);
    } else {
      ctx.setPending({
        type: 'skill_effect',
        skillId: 'ganglie',
        playerId: ctx.player.id,
        askId: ctx.player.id,
        sourceId: src.id,
        message: '刚烈：选择令伤害来源弃置的一张牌',
      });
    }
    return { ok: true };
  },
};
`;

skills.tuxi = `'use strict';
module.exports = {
  id: 'tuxi',
  name: '突袭',
  desc: '摸牌阶段，你可以少摸1~2张牌，然后获得1~2名其他角色的各一张手牌。',
  type: 'trigger',
  triggers: ['phaseDraw'],
  filter(ctx) {
    return ctx.alivePlayers().some(
      (p) => p.id !== ctx.player.id && p.hand.length > 0
    );
  },
  content(ctx) {
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'tuxi',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      message: '突袭：选择 1~2 名有手牌的其他角色（将少摸等量牌并获得其各1张手牌），或取消',
      canPass: true,
      maxTargets: 2,
    });
    return { ok: true };
  },
};
`;

skills.luoyi = `'use strict';
module.exports = {
  id: 'luoyi',
  name: '裸衣',
  desc: '摸牌阶段时，你可以翻开牌堆顶3张牌，然后你可以放弃摸牌并获得其中所有武器牌与基本牌，若如此做，本回合你使用【杀】或【决斗】伤害+1。',
  type: 'trigger',
  triggers: ['phaseDraw'],
  filter() {
    return true;
  },
  content(ctx) {
    const shown = [];
    for (let i = 0; i < 3; i++) {
      if (!ctx.game.drawPile.length) break;
      shown.push(ctx.game.drawPile.shift());
    }
    ctx.player.skillStates = ctx.player.skillStates || {};
    ctx.player.skillStates._luoyiShown = shown;
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'luoyi',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      shown,
      message: '裸衣：是否放弃摸牌，获得翻开的武器与基本牌？（本回合杀/决斗伤害+1）',
      canPass: true,
    });
    return { ok: true };
  },
};
`;

skills.tiandu = `'use strict';
module.exports = {
  id: 'tiandu',
  name: '天妒',
  desc: '在你的判定牌生效后，你可以获得此牌。',
  type: 'trigger',
  triggers: ['afterJudge'],
  filter(ctx) {
    return Boolean(ctx.judgeCardId);
  },
  content(ctx) {
    const id = ctx.judgeCardId;
    ctx.game.discardPile = ctx.game.discardPile.filter((x) => x !== id);
    ctx.gainToHand(ctx.player, id);
    return { ok: true };
  },
};
`;

skills.yiji = `'use strict';
module.exports = {
  id: 'yiji',
  name: '遗计',
  desc: '你每受到一次伤害，你可以摸两张牌，并可以把这两张分配给任意角色。',
  type: 'trigger',
  triggers: ['afterDamage'],
  filter() {
    return true;
  },
  content(ctx) {
    const got = ctx.draw(ctx.player, 2);
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'yiji',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      cardIds: got.slice(),
      message: '遗计：可将摸到的牌分配给任意角色（点目标交给其一张，或取消留给自己）',
      canPass: true,
    });
    return { ok: true };
  },
};
`;

skills.qingguo = `'use strict';
module.exports = {
  id: 'qingguo',
  name: '倾国',
  desc: '你可以将一张黑色手牌当【闪】使用或打出。',
  type: 'viewAs',
  triggers: ['needShan'],
  viewAs: {
    to: 'shan',
    cardFilter(card) {
      return card && (card.suit === 'spade' || card.suit === 'club');
    },
  },
};
`;

skills.luoshen = `'use strict';
module.exports = {
  id: 'luoshen',
  name: '洛神',
  desc: '回合开始阶段，你可以进行判定：若为黑色，你获得此牌并可继续判定；若为红色，则获得此牌并停止判定。',
  type: 'trigger',
  triggers: ['phasePrepare'],
  filter() {
    return true;
  },
  content(ctx) {
    const loop = () => {
      const jid = ctx.judge(ctx.player);
      if (!jid) return;
      const jc = ctx.cardById(jid);
      const color = ctx.suitColor(jc.suit);
      ctx.game.discardPile = ctx.game.discardPile.filter((id) => id !== jid);
      ctx.gainToHand(ctx.player, jid);
      ctx.log(
        ctx.player.name +
          ' 洛神判定 ' +
          ctx.suitLabel(jc.suit) +
          jc.number +
          ' → 获得'
      );
      if (color === 'black') {
        ctx.player.skillStates = ctx.player.skillStates || {};
        ctx.setPending({
          type: 'skill_effect',
          skillId: 'luoshen',
          playerId: ctx.player.id,
          askId: ctx.player.id,
          message: '洛神：黑色，是否继续判定？',
          canPass: true,
          continue: true,
        });
      }
    };
    loop();
    return { ok: true };
  },
};
`;

skills.rende = `'use strict';
module.exports = {
  id: 'rende',
  name: '仁德',
  desc: '出牌阶段，你可以将任意数量手牌交给其他角色；若你此回合首次给出的牌不少于两张，你视为使用一张基本牌。',
  type: 'active',
  filter(ctx) {
    return ctx.player.hand.length > 0;
  },
  content(ctx) {
    const ids = (ctx.payload && ctx.payload.cardIds) || [];
    const tid = ctx.payload && ctx.payload.targetId;
    if (!ids.length || !tid) {
      ctx.log('仁德需要指定目标与手牌');
      return { ok: false };
    }
    const target = ctx.getPlayer(tid);
    if (!target || target.id === ctx.player.id) return { ok: false };
    for (const id of ids) {
      if (!ctx.player.hand.includes(id)) return { ok: false };
    }
    for (const id of ids) {
      ctx.takeHand(ctx.player, id);
      target.hand.push(id);
    }
    ctx.log(ctx.player.name + ' 仁德交给 ' + target.name + ' ' + ids.length + ' 张牌');
    ctx.player.skillStates = ctx.player.skillStates || {};
    const given = (ctx.player.skillStates.rendeGiven || 0) + ids.length;
    const first = !ctx.player.skillStates.rendeTriggered;
    ctx.player.skillStates.rendeGiven = given;
    if (first && given >= 2) {
      ctx.player.skillStates.rendeTriggered = true;
      ctx.setPending({
        type: 'skill_effect',
        skillId: 'rende',
        playerId: ctx.player.id,
        askId: ctx.player.id,
        message: '仁德：视为使用一张基本牌（杀/闪/桃/酒），请选择',
        step: 'basic',
      });
    }
    return { ok: true };
  },
};
`;

skills.jijiang = `'use strict';
module.exports = {
  id: 'jijiang',
  name: '激将',
  desc: '主公技，当你需要使用或打出一张【杀】时，你可令其他蜀势力角色打出一张【杀】（视为由你使用或打出）。',
  type: 'lord',
  lord: true,
  triggers: ['needSha'],
  filter(ctx) {
    return ctx.alivePlayers().some(
      (p) => p.id !== ctx.player.id && p.country === '蜀'
    );
  },
  content(ctx) {
    const helpers = ctx.alivePlayers().filter(
      (p) => p.id !== ctx.player.id && p.country === '蜀'
    );
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'jijiang',
      playerId: ctx.player.id,
      askId: helpers[0].id,
      helpers: helpers.map((p) => p.id),
      index: 0,
      message: '激将：请打出【杀】，或取消',
    });
    return { ok: true };
  },
};
`;

skills.wusheng = `'use strict';
module.exports = {
  id: 'wusheng',
  name: '武圣',
  desc: '你可以将一张红色牌当【杀】使用或打出；红桃杀不计入次数，方块杀无视距离。',
  type: 'viewAs',
  triggers: ['needSha', 'phasePlay'],
  viewAs: {
    to: 'sha',
    includeEquip: true,
    cardFilter(card) {
      return card && (card.suit === 'heart' || card.suit === 'diamond');
    },
  },
};
`;

skills.paoxiao = `'use strict';
module.exports = {
  id: 'paoxiao',
  name: '咆哮',
  desc: '锁定技，出牌阶段可无限次使用【杀】；当你使用杀后，本回合使用杀无距离限制。',
  type: 'locked',
  triggers: ['shaLimit', 'afterUseSha'],
  shaLimit() {
    return 99;
  },
  content(ctx) {
    if (ctx.trigger === 'afterUseSha') {
      ctx.player.skillStates = ctx.player.skillStates || {};
      ctx.player.skillStates.paoxiaoNoDistance = true;
    }
    return null;
  },
};
`;

skills.guanxing = `'use strict';
module.exports = {
  id: 'guanxing',
  name: '观星',
  desc: '回合开始阶段，人数≥4观看牌堆顶5张，否则3张，可以任意顺序置于牌堆顶或牌堆底。',
  type: 'trigger',
  triggers: ['phasePrepare'],
  filter() {
    return true;
  },
  content(ctx) {
    const n = ctx.alivePlayers().length >= 4 ? 5 : 3;
    const cards = [];
    for (let i = 0; i < n; i++) {
      if (!ctx.game.drawPile.length) break;
      cards.push(ctx.game.drawPile.shift());
    }
    // 简化：全部放回牌堆顶（保持顺序），完整重排 UI 后续可扩展
    ctx.game.drawPile = cards.concat(ctx.game.drawPile);
    ctx.log(ctx.player.name + ' 观星观看了 ' + cards.length + ' 张牌并放回牌堆顶');
    return { ok: true };
  },
};
`;

skills.kongcheng = `'use strict';
module.exports = {
  id: 'kongcheng',
  name: '空城',
  desc: '锁定技，没有手牌时不能成为【杀】或【决斗】的目标。',
  type: 'locked',
  canBeTarget(ctx) {
    if (ctx.player.hand.length > 0) return true;
    const n = ctx.cardName;
    if (n === '杀' || n === '火杀' || n === '雷杀' || n === '决斗') return false;
    return true;
  },
};
`;

skills.longdan = `'use strict';
module.exports = {
  id: 'longdan',
  name: '龙胆',
  desc: '你可以将【杀】当【闪】、【闪】当【杀】使用或打出。',
  type: 'viewAs',
  triggers: ['needSha', 'needShan', 'phasePlay'],
  viewAsDual: true,
};
`;

skills.yajiao = `'use strict';
module.exports = {
  id: 'yajiao',
  name: '涯角',
  desc: '你于回合外使用或打出牌时，摸一张牌。',
  type: 'trigger',
  triggers: ['afterUseCardOutside', 'afterRespondCard'],
  forced: true,
  filter(ctx) {
    const cur = ctx.game.turnSeat;
    const me = ctx.player.seat;
    return cur !== me;
  },
  content(ctx) {
    ctx.draw(ctx.player, 1);
    return { ok: true };
  },
};
`;

skills.mashu = `'use strict';
module.exports = {
  id: 'mashu',
  name: '马术',
  desc: '锁定技，计算与其他角色的距离 -1。',
  type: 'locked',
  distanceOff() {
    return 1;
  },
};
`;

skills.tieji = `'use strict';
module.exports = {
  id: 'tieji',
  name: '铁骑',
  desc: '当你使用【杀】指定目标后，你可以进行判定，目标须弃置一张与判定花色相同的牌，否则不能响应此杀。',
  type: 'trigger',
  triggers: ['afterShaSpecify'],
  filter() {
    return true;
  },
  content(ctx) {
    const jid = ctx.judge(ctx.player);
    if (!jid) return null;
    const jc = ctx.cardById(jid);
    ctx.game.discardPile.push(jid);
    ctx.log(
      ctx.player.name +
        ' 铁骑判定 ' +
        ctx.suitLabel(jc.suit) +
        jc.number
    );
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'tieji',
      playerId: ctx.player.id,
      askId: ctx.targetId,
      suit: jc.suit,
      shaPendingResume: true,
      message:
        '铁骑：请弃置一张' +
        ctx.suitLabel(jc.suit) +
        '牌，否则不能出闪',
      canPass: true,
    });
    return { ok: true };
  },
};
`;

skills.jizhi = `'use strict';
module.exports = {
  id: 'jizhi',
  name: '集智',
  desc: '当你使用非转化锦囊时，你可以摸一张牌；以此法摸的牌本回合不计入手牌上限。',
  type: 'trigger',
  triggers: ['afterUseTrick'],
  filter(ctx) {
    if (!ctx.card || ctx.card.type !== 'trick') return false;
    if (ctx.card._viewAs) return false;
    return true;
  },
  content(ctx) {
    const got = ctx.draw(ctx.player, 1);
    const turn = ctx.game.turnCount || 0;
    for (const id of got) {
      const c = ctx.cardById(id);
      if (c) c._jizhiMark = turn;
    }
    return { ok: true };
  },
};
`;

skills.qicai = `'use strict';
module.exports = {
  id: 'qicai',
  name: '奇才',
  desc: '锁定技，使用锦囊无距离限制；每回合使用的第一张锦囊不可被无懈。',
  type: 'locked',
  trickNoDistance() {
    return true;
  },
  firstTrickUncounterable(ctx) {
    ctx.player.skillStates = ctx.player.skillStates || {};
    if (ctx.player.skillStates.qicaiUsed) return false;
    ctx.player.skillStates.qicaiUsed = true;
    return true;
  },
};
`;

skills.zhiheng = `'use strict';
module.exports = {
  id: 'zhiheng',
  name: '制衡',
  desc: '出牌阶段限一次，弃置任意张牌然后摸等量牌；若弃光所有手牌则摸牌数+1。',
  type: 'active',
  filter(ctx) {
    return !ctx.skillUsed(ctx.player, 'zhiheng');
  },
  content(ctx) {
    const ids = (ctx.payload && ctx.payload.cardIds) || [];
    if (!ids.length) return { ok: false };
    const allHand =
      ctx.player.hand.length > 0 &&
      ids.filter((id) => ctx.player.hand.includes(id)).length ===
        ctx.player.hand.length &&
      ids.every((id) => ctx.player.hand.includes(id) || true);
    let handDiscarded = 0;
    const handBefore = ctx.player.hand.length;
    for (const id of ids) {
      const z = ctx.player.hand.includes(id)
        ? 'hand'
        : Object.keys(ctx.player.equips || {}).find(
            (s) => ctx.player.equips[s] && ctx.player.equips[s].id === id
          );
      if (z === 'hand') {
        ctx.discard(ctx.player, id, 'hand');
        handDiscarded += 1;
      } else if (z) {
        ctx.discard(ctx.player, id, 'equip:' + z);
      }
    }
    let n = ids.length;
    if (handBefore > 0 && ctx.player.hand.length === 0 && handDiscarded === handBefore) {
      n += 1;
    }
    ctx.draw(ctx.player, n);
    ctx.markSkillUsed(ctx.player, 'zhiheng');
    return { ok: true };
  },
};
`;

skills.jiuyuan = `'use strict';
module.exports = {
  id: 'jiuyuan',
  name: '救援',
  desc: '主公技锁定技，其他吴势力角色在你濒死时对你使用【桃】，你额外回复1点体力。',
  type: 'locked',
  lord: true,
  onTaoHealBonus(ctx) {
    const user = ctx.taoUser;
    if (!user || user.id === ctx.player.id) return 0;
    if (user.country !== '吴') return 0;
    return 1;
  },
};
`;

skills.qixi = `'use strict';
module.exports = {
  id: 'qixi',
  name: '奇袭',
  desc: '出牌阶段，你可以将一张黑色牌当【过河拆桥】使用。',
  type: 'viewAs',
  triggers: ['phasePlay'],
  viewAs: {
    to: 'guohe',
    includeEquip: true,
    cardFilter(card) {
      return card && (card.suit === 'spade' || card.suit === 'club');
    },
  },
};
`;

skills.keji = `'use strict';
module.exports = {
  id: 'keji',
  name: '克己',
  desc: '若你于出牌阶段未使用或打出过【杀】，你可以跳过弃牌阶段。',
  type: 'trigger',
  triggers: ['phaseDiscard'],
  filter(ctx) {
    return !ctx.player.skillStates || !ctx.player.skillStates.usedShaInPlay;
  },
  content(ctx) {
    ctx.player.skillStates = ctx.player.skillStates || {};
    ctx.player.skillStates.skipDiscard = true;
    ctx.log(ctx.player.name + ' 发动克己，跳过弃牌阶段');
    return { ok: true };
  },
};
`;

skills.kurou = `'use strict';
module.exports = {
  id: 'kurou',
  name: '苦肉',
  desc: '出牌阶段，你可以失去1点体力，然后摸两张牌。',
  type: 'active',
  filter() {
    return true;
  },
  content(ctx) {
    ctx.loseHp(ctx.player.id, 1, { reason: '苦肉' });
    if (ctx.player.alive) ctx.draw(ctx.player, 2);
    return { ok: true };
  },
};
`;

skills.yingzi = `'use strict';
module.exports = {
  id: 'yingzi',
  name: '英姿',
  desc: '摸牌阶段，你可以额外摸一张牌。',
  type: 'trigger',
  triggers: ['phaseDrawBonus'],
  forced: false,
  filter() {
    return true;
  },
  content(ctx) {
    ctx._drawBonus = (ctx._drawBonus || 0) + 1;
    if (ctx.drawBonusRef) ctx.drawBonusRef.n += 1;
    return { ok: true };
  },
};
`;

skills.fanjian = `'use strict';
module.exports = {
  id: 'fanjian',
  name: '反间',
  desc: '出牌阶段限一次，令一名其他角色选择花色后获得你一张手牌并展示，若花色不同则你对其造成1点伤害。',
  type: 'active',
  filter(ctx) {
    return !ctx.skillUsed(ctx.player, 'fanjian') && ctx.player.hand.length > 0;
  },
  content(ctx) {
    const tid = ctx.payload && ctx.payload.targetId;
    const target = ctx.getPlayer(tid);
    if (!target || target.id === ctx.player.id) return { ok: false };
    ctx.markSkillUsed(ctx.player, 'fanjian');
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'fanjian',
      playerId: ctx.player.id,
      askId: target.id,
      targetId: target.id,
      message: '反间：请选择一种花色',
      step: 'suit',
    });
    return { ok: true };
  },
};
`;

skills.guose = `'use strict';
module.exports = {
  id: 'guose',
  name: '国色',
  desc: '出牌阶段，你可以将一张方块牌当【乐不思蜀】使用。',
  type: 'viewAs',
  triggers: ['phasePlay'],
  viewAs: {
    to: 'lebu',
    includeEquip: true,
    cardFilter(card) {
      return card && card.suit === 'diamond';
    },
  },
};
`;

skills.liuli = `'use strict';
module.exports = {
  id: 'liuli',
  name: '流离',
  desc: '当你成为【杀】的目标时，你可以弃置一张牌，将此【杀】转移给你攻击范围内的一名其他角色（不能是使用者）。',
  type: 'trigger',
  triggers: ['whenShaTarget'],
  filter(ctx) {
    return ctx.player.hand.length + Object.values(ctx.player.equips || {}).filter(Boolean).length > 0;
  },
  content(ctx) {
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'liuli',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      attackerId: ctx.sourceId,
      message: '流离：弃一张牌并选择转移目标，或取消',
      canPass: true,
    });
    return { ok: true };
  },
};
`;

skills.qianxun = `'use strict';
module.exports = {
  id: 'qianxun',
  name: '谦逊',
  desc: '锁定技，你不能成为【顺手牵羊】和【乐不思蜀】的目标。',
  type: 'locked',
  canBeTarget(ctx) {
    if (ctx.cardName === '顺手牵羊' || ctx.cardName === '乐不思蜀') return false;
    return true;
  },
};
`;

skills.lianying = `'use strict';
module.exports = {
  id: 'lianying',
  name: '连营',
  desc: '当你使用手牌后，若你的手牌数为全场最少（或之一），你可以摸一张牌。',
  type: 'trigger',
  triggers: ['afterUseHand'],
  filter(ctx) {
    const mine = ctx.player.hand.length;
    const min = Math.min(...ctx.alivePlayers().map((p) => p.hand.length));
    return mine <= min;
  },
  content(ctx) {
    ctx.draw(ctx.player, 1);
    return { ok: true };
  },
};
`;

skills.jieyin = `'use strict';
module.exports = {
  id: 'jieyin',
  name: '结姻',
  desc: '出牌阶段限一次，弃置1张手牌并指定一名男性角色：体力较低者回复1点，较高者摸1张；相等则无事发生。',
  type: 'active',
  filter(ctx) {
    return !ctx.skillUsed(ctx.player, 'jieyin') && ctx.player.hand.length > 0;
  },
  content(ctx) {
    const cid = ctx.payload && ctx.payload.cardId;
    const tid = ctx.payload && ctx.payload.targetId;
    if (!cid || !tid) return { ok: false };
    const target = ctx.getPlayer(tid);
    if (!target || target.gender !== 'male') return { ok: false };
    if (!ctx.player.hand.includes(cid)) return { ok: false };
    ctx.discard(ctx.player, cid, 'hand');
    ctx.markSkillUsed(ctx.player, 'jieyin');
    if (ctx.player.hp < target.hp) {
      ctx.recover(ctx.player, 1);
      ctx.draw(target, 1);
    } else if (ctx.player.hp > target.hp) {
      ctx.recover(target, 1);
      ctx.draw(ctx.player, 1);
    }
    return { ok: true };
  },
};
`;

skills.xiaoji = `'use strict';
module.exports = {
  id: 'xiaoji',
  name: '枭姬',
  desc: '当你失去装备区里的一张牌时，你可以摸两张牌。',
  type: 'trigger',
  triggers: ['afterLoseEquip'],
  filter() {
    return true;
  },
  content(ctx) {
    ctx.draw(ctx.player, 2);
    return { ok: true };
  },
};
`;

skills.jijiu = `'use strict';
module.exports = {
  id: 'jijiu',
  name: '急救',
  desc: '你的回合外，你可以将一张红色牌当【桃】使用。',
  type: 'viewAs',
  triggers: ['needTao'],
  filter(ctx) {
    const cur = ctx.game.players.find((p) => p.seat === ctx.game.turnSeat);
    return !cur || cur.id !== ctx.player.id;
  },
  viewAs: {
    to: 'tao',
    includeEquip: true,
    cardFilter(card) {
      return card && (card.suit === 'heart' || card.suit === 'diamond');
    },
  },
};
`;

skills.qingnang = `'use strict';
module.exports = {
  id: 'qingnang',
  name: '青囊',
  desc: '出牌阶段，弃置一张手牌，令一名已受伤角色回复1点体力。',
  type: 'active',
  filter(ctx) {
    return !ctx.skillUsed(ctx.player, 'qingnang') && ctx.player.hand.length > 0;
  },
  content(ctx) {
    const cid = ctx.payload && ctx.payload.cardId;
    const tid = ctx.payload && ctx.payload.targetId;
    const target = ctx.getPlayer(tid);
    if (!cid || !target || target.hp >= target.maxHp) return { ok: false };
    if (!ctx.player.hand.includes(cid)) return { ok: false };
    ctx.discard(ctx.player, cid, 'hand');
    ctx.recover(target, 1);
    ctx.markSkillUsed(ctx.player, 'qingnang');
    return { ok: true };
  },
};
`;

skills.wushuang = `'use strict';
module.exports = {
  id: 'wushuang',
  name: '无双',
  desc: '锁定技，你的【杀】需两张【闪】抵消；与你【决斗】需每次打出两张【杀】。',
  type: 'locked',
  shaNeedShanCount() {
    return 2;
  },
  juedouNeedShaCount() {
    return 2;
  },
};
`;

skills.liyu = `'use strict';
module.exports = {
  id: 'liyu',
  name: '利驭',
  desc: '当你的【杀】对其他角色造成伤害后，你可以获得其区域一张牌；非装备则其摸1张，装备则视为你对另一名角色使用【决斗】。',
  type: 'trigger',
  triggers: ['afterShaDamage'],
  filter(ctx) {
    const t = ctx.getPlayer(ctx.targetId);
    if (!t || !t.alive) return false;
    return (
      t.hand.length +
        Object.values(t.equips || {}).filter(Boolean).length +
        t.judges.length >
      0
    );
  },
  content(ctx) {
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'liyu',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      targetId: ctx.targetId,
      message: '利驭：获得目标区域一张牌，或取消',
      canPass: true,
    });
    return { ok: true };
  },
};
`;

skills.lijian = `'use strict';
module.exports = {
  id: 'lijian',
  name: '离间',
  desc: '出牌阶段限一次，弃置一张牌并选择两名男性角色，视为前者对后者使用【决斗】（不可被无懈）。',
  type: 'active',
  filter(ctx) {
    return !ctx.skillUsed(ctx.player, 'lijian');
  },
  content(ctx) {
    const cid = ctx.payload && ctx.payload.cardId;
    const a = ctx.payload && ctx.payload.targetA;
    const b = ctx.payload && ctx.payload.targetB;
    const pa = ctx.getPlayer(a);
    const pb = ctx.getPlayer(b);
    if (!cid || !pa || !pb || pa.gender !== 'male' || pb.gender !== 'male') {
      return { ok: false };
    }
    if (ctx.player.hand.includes(cid)) ctx.discard(ctx.player, cid, 'hand');
    else {
      const slot = Object.keys(ctx.player.equips || {}).find(
        (s) => ctx.player.equips[s] && ctx.player.equips[s].id === cid
      );
      if (slot) ctx.discard(ctx.player, cid, 'equip:' + slot);
      else return { ok: false };
    }
    ctx.markSkillUsed(ctx.player, 'lijian');
    ctx.player.skillStates = ctx.player.skillStates || {};
    ctx.player.skillStates._lijianJuedou = true;
    // 交给引擎虚拟决斗
    if (typeof ctx.apiStartJuedou === 'function') {
      ctx.apiStartJuedou(pa.id, pb.id, { noWuxie: true });
    } else {
      ctx.setPending({
        type: 'juedou',
        a: pa.id,
        b: pb.id,
        askId: pb.id,
        noWuxie: true,
        message: '离间决斗：' + pb.name + ' 请打出【杀】',
      });
    }
    return { ok: true };
  },
};
`;

skills.biyue = `'use strict';
module.exports = {
  id: 'biyue',
  name: '闭月',
  desc: '回合结束阶段，你可以摸 n 张牌（n 为本回合全场受到的伤害总和，至少为 1）。',
  type: 'trigger',
  triggers: ['phaseEnd'],
  filter() {
    return true;
  },
  content(ctx) {
    const n = Math.max(1, ctx.game.turnDamageTotal || 0);
    ctx.draw(ctx.player, n);
    return { ok: true };
  },
};
`;

for (const h of heroes) {
  w(path.join(root, h.id, 'index.js'), heroIndex(h));
  for (const sid of h.skills) {
    if (!skills[sid]) throw new Error('missing skill ' + sid);
    w(path.join(root, h.id, sid + '.js'), skills[sid]);
  }
}

console.log('wrote', heroes.length, 'jie heroes');
