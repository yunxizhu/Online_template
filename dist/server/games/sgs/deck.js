'use strict';

const { uid } = require('./constants');

/** A=1 … J=11 Q=12 K=13 */
function card(name, type, suit, number, extra = {}) {
  return {
    id: uid('c'),
    name,
    type,
    suit,
    number,
    ...extra,
  };
}

function add(deck, name, type, suit, number, extra) {
  deck.push(card(name, type, suit, number, extra));
}

function addMany(deck, specs, name, type, extraFn) {
  for (const [suit, number] of specs) {
    add(deck, name, type, suit, number, extraFn ? extraFn(suit, number) : {});
  }
}

/**
 * 军争完整牌堆：基本 85 + 锦囊 50 + 装备 27 = 162
 * 花色点数严格按官方清单。
 */
function buildStandardDeck() {
  const deck = [];

  // ——— 基本牌 85 ———
  // 普通杀 30
  addMany(
    deck,
    [
      ['spade', 7], ['spade', 8], ['spade', 8], ['spade', 9], ['spade', 9], ['spade', 10], ['spade', 10],
      ['club', 2], ['club', 3], ['club', 4], ['club', 5], ['club', 6], ['club', 7],
      ['club', 8], ['club', 8], ['club', 9], ['club', 9], ['club', 10], ['club', 10], ['club', 11], ['club', 11],
      ['heart', 10], ['heart', 10], ['heart', 11],
      ['diamond', 6], ['diamond', 7], ['diamond', 8], ['diamond', 9], ['diamond', 10], ['diamond', 13],
    ],
    '杀',
    'basic',
    () => ({ subtype: 'sha', nature: null })
  );

  // 火杀 5
  addMany(
    deck,
    [
      ['heart', 4], ['heart', 7], ['heart', 10],
      ['diamond', 4], ['diamond', 5],
    ],
    '火杀',
    'basic',
    () => ({ subtype: 'sha', nature: 'fire' })
  );

  // 雷杀 9
  addMany(
    deck,
    [
      ['spade', 4], ['spade', 5], ['spade', 6], ['spade', 7], ['spade', 8],
      ['club', 5], ['club', 6], ['club', 7], ['club', 8],
    ],
    '雷杀',
    'basic',
    () => ({ subtype: 'sha', nature: 'thunder' })
  );

  // 闪 24
  addMany(
    deck,
    [
      ['heart', 2], ['heart', 2], ['heart', 8], ['heart', 9], ['heart', 11], ['heart', 12], ['heart', 13],
      ['diamond', 2], ['diamond', 2], ['diamond', 3], ['diamond', 4], ['diamond', 5],
      ['diamond', 6], ['diamond', 6], ['diamond', 7], ['diamond', 7], ['diamond', 8], ['diamond', 8],
      ['diamond', 9], ['diamond', 10], ['diamond', 10], ['diamond', 11], ['diamond', 11], ['diamond', 11],
    ],
    '闪',
    'basic',
    () => ({ subtype: 'shan' })
  );

  // 桃 12
  addMany(
    deck,
    [
      ['heart', 3], ['heart', 4], ['heart', 5], ['heart', 6], ['heart', 6],
      ['heart', 7], ['heart', 8], ['heart', 9], ['heart', 12],
      ['diamond', 2], ['diamond', 3], ['diamond', 12],
    ],
    '桃',
    'basic',
    () => ({ subtype: 'tao' })
  );

  // 酒 5
  addMany(
    deck,
    [
      ['spade', 3], ['spade', 9],
      ['club', 3], ['club', 9],
      ['diamond', 9],
    ],
    '酒',
    'basic',
    () => ({ subtype: 'jiu' })
  );

  // ——— 锦囊 50 ———
  const trickSpecs = [
    // 过河拆桥 6
    ['过河拆桥', 'trick', 'guohe', 'spade', 3],
    ['过河拆桥', 'trick', 'guohe', 'spade', 4],
    ['过河拆桥', 'trick', 'guohe', 'spade', 12],
    ['过河拆桥', 'trick', 'guohe', 'club', 3],
    ['过河拆桥', 'trick', 'guohe', 'club', 4],
    ['过河拆桥', 'trick', 'guohe', 'heart', 12],
    // 顺手牵羊 5
    ['顺手牵羊', 'trick', 'shunshou', 'spade', 3],
    ['顺手牵羊', 'trick', 'shunshou', 'spade', 4],
    ['顺手牵羊', 'trick', 'shunshou', 'spade', 11],
    ['顺手牵羊', 'trick', 'shunshou', 'diamond', 3],
    ['顺手牵羊', 'trick', 'shunshou', 'diamond', 4],
    // 决斗 3
    ['决斗', 'trick', 'juedou', 'spade', 1],
    ['决斗', 'trick', 'juedou', 'club', 1],
    ['决斗', 'trick', 'juedou', 'diamond', 1],
    // 借刀杀人 2
    ['借刀杀人', 'trick', 'jiedao', 'club', 12],
    ['借刀杀人', 'trick', 'jiedao', 'club', 13],
    // 无中生有 4
    ['无中生有', 'trick', 'wuzhong', 'heart', 7],
    ['无中生有', 'trick', 'wuzhong', 'heart', 8],
    ['无中生有', 'trick', 'wuzhong', 'heart', 9],
    ['无中生有', 'trick', 'wuzhong', 'heart', 11],
    // 无懈可击 7
    ['无懈可击', 'trick', 'wuxie', 'spade', 11],
    ['无懈可击', 'trick', 'wuxie', 'spade', 13],
    ['无懈可击', 'trick', 'wuxie', 'club', 12],
    ['无懈可击', 'trick', 'wuxie', 'club', 13],
    ['无懈可击', 'trick', 'wuxie', 'heart', 1],
    ['无懈可击', 'trick', 'wuxie', 'heart', 13],
    ['无懈可击', 'trick', 'wuxie', 'diamond', 12, { mark: 'EX' }],
    // 铁索连环 6
    ['铁索连环', 'trick', 'tiesuo', 'spade', 11],
    ['铁索连环', 'trick', 'tiesuo', 'spade', 12],
    ['铁索连环', 'trick', 'tiesuo', 'club', 10],
    ['铁索连环', 'trick', 'tiesuo', 'club', 11],
    ['铁索连环', 'trick', 'tiesuo', 'club', 12],
    ['铁索连环', 'trick', 'tiesuo', 'club', 13],
    // 火攻 3
    ['火攻', 'trick', 'huogong', 'heart', 2],
    ['火攻', 'trick', 'huogong', 'heart', 3],
    ['火攻', 'trick', 'huogong', 'diamond', 12],
    // 万箭齐发 1
    ['万箭齐发', 'trick', 'wanjian', 'heart', 1],
    // 南蛮入侵 3
    ['南蛮入侵', 'trick', 'nanman', 'spade', 7],
    ['南蛮入侵', 'trick', 'nanman', 'spade', 13],
    ['南蛮入侵', 'trick', 'nanman', 'club', 7],
    // 桃园结义 1
    ['桃园结义', 'trick', 'taoyuan', 'heart', 1],
    // 五谷丰登 2
    ['五谷丰登', 'trick', 'wugu', 'heart', 3],
    ['五谷丰登', 'trick', 'wugu', 'heart', 4],
    // 延时 7
    ['闪电', 'delayed', 'shandian', 'spade', 1],
    ['闪电', 'delayed', 'shandian', 'heart', 12, { mark: 'EX' }],
    ['乐不思蜀', 'delayed', 'lebu', 'spade', 6],
    ['乐不思蜀', 'delayed', 'lebu', 'heart', 6],
    ['乐不思蜀', 'delayed', 'lebu', 'club', 6],
    ['兵粮寸断', 'delayed', 'bingliang', 'spade', 10],
    ['兵粮寸断', 'delayed', 'bingliang', 'club', 4],
  ];

  for (const row of trickSpecs) {
    const [name, type, subtype, suit, number, extra] = row;
    add(deck, name, type, suit, number, { subtype, ...(extra || {}) });
  }

  // ——— 装备 27 ———
  const equips = [
    // 武器 13
    ['诸葛连弩', 'club', 1, 'weapon', 'zhuge', 1],
    ['诸葛连弩', 'diamond', 1, 'weapon', 'zhuge', 1],
    ['青釭剑', 'spade', 6, 'weapon', 'qinggang', 2],
    ['雌雄双股剑', 'spade', 2, 'weapon', 'cixiong', 2],
    ['寒冰剑', 'spade', 2, 'weapon', 'hanbing', 2, { mark: 'EX' }],
    ['古锭刀', 'spade', 1, 'weapon', 'guding', 2],
    ['贯石斧', 'diamond', 5, 'weapon', 'guanshi', 3],
    ['青龙偃月刀', 'spade', 5, 'weapon', 'qinglong', 3],
    ['丈八蛇矛', 'spade', 12, 'weapon', 'zhangba', 3],
    ['方天画戟', 'diamond', 12, 'weapon', 'fangtian', 4],
    ['朱雀羽扇', 'diamond', 1, 'weapon', 'zhuque', 4],
    ['麒麟弓', 'heart', 5, 'weapon', 'qilin', 5],
    ['银月枪', 'diamond', 12, 'weapon', 'yinyue', 2, { mark: 'SP' }],
    // 防具 6
    ['八卦阵', 'spade', 2, 'armor', 'bagua', 0],
    ['八卦阵', 'club', 2, 'armor', 'bagua', 0],
    ['仁王盾', 'club', 2, 'armor', 'renwang', 0, { mark: 'EX' }],
    ['藤甲', 'spade', 2, 'armor', 'tengjia', 0],
    ['藤甲', 'club', 2, 'armor', 'tengjia', 0],
    ['白银狮子', 'club', 1, 'armor', 'baiyin', 0],
    // +1 马 4
    ['绝影', 'spade', 5, 'horsePlus', 'jueying', 0],
    ['爪黄飞电', 'heart', 13, 'horsePlus', 'zhuahuang', 0],
    ['骅骝', 'diamond', 13, 'horsePlus', 'hualiu', 0],
    ['的卢', 'club', 5, 'horsePlus', 'dilu', 0],
    // -1 马 3
    ['大宛', 'spade', 13, 'horseMinus', 'dawan', 0],
    ['赤兔', 'heart', 5, 'horseMinus', 'chitu', 0],
    ['紫骍', 'diamond', 13, 'horseMinus', 'zixin', 0],
    // 宝物 1
    ['木牛流马', 'diamond', 5, 'treasure', 'muniu', 0],
  ];

  for (const row of equips) {
    const [name, suit, number, slot, subtype, range, extra] = row;
    add(deck, name, 'equip', suit, number, {
      subtype,
      slot,
      range: range || undefined,
      ...(extra || {}),
    });
  }

  return deck;
}

function summarizeDeck(deck) {
  const byName = {};
  for (const c of deck) {
    byName[c.name] = (byName[c.name] || 0) + 1;
  }
  const basic = deck.filter((c) => c.type === 'basic').length;
  const trick = deck.filter(
    (c) => c.type === 'trick' || c.type === 'delayed'
  ).length;
  const equip = deck.filter((c) => c.type === 'equip').length;
  return { total: deck.length, basic, trick, equip, byName };
}

/** 核对清单数量是否达标 */
function assertDeckCounts(deck) {
  const s = summarizeDeck(deck);
  const expect = {
    杀: 30,
    火杀: 5,
    雷杀: 9,
    闪: 24,
    桃: 12,
    酒: 5,
    过河拆桥: 6,
    顺手牵羊: 5,
    决斗: 3,
    借刀杀人: 2,
    无中生有: 4,
    无懈可击: 7,
    铁索连环: 6,
    火攻: 3,
    万箭齐发: 1,
    南蛮入侵: 3,
    桃园结义: 1,
    五谷丰登: 2,
    闪电: 2,
    乐不思蜀: 3,
    兵粮寸断: 2,
    诸葛连弩: 2,
    青釭剑: 1,
    雌雄双股剑: 1,
    寒冰剑: 1,
    古锭刀: 1,
    贯石斧: 1,
    青龙偃月刀: 1,
    丈八蛇矛: 1,
    方天画戟: 1,
    朱雀羽扇: 1,
    麒麟弓: 1,
    银月枪: 1,
    八卦阵: 2,
    仁王盾: 1,
    藤甲: 2,
    白银狮子: 1,
    绝影: 1,
    爪黄飞电: 1,
    骅骝: 1,
    的卢: 1,
    大宛: 1,
    赤兔: 1,
    紫骍: 1,
    木牛流马: 1,
  };
  const errors = [];
  if (s.total !== 162) errors.push(`总数 ${s.total} ≠ 162`);
  if (s.basic !== 85) errors.push(`基本牌 ${s.basic} ≠ 85`);
  if (s.trick !== 50) errors.push(`锦囊 ${s.trick} ≠ 50`);
  if (s.equip !== 27) errors.push(`装备 ${s.equip} ≠ 27`);
  for (const [name, n] of Object.entries(expect)) {
    if ((s.byName[name] || 0) !== n) {
      errors.push(`${name} ${s.byName[name] || 0} ≠ ${n}`);
    }
  }
  return { ok: errors.length === 0, errors, summary: s };
}

module.exports = {
  buildStandardDeck,
  card,
  summarizeDeck,
  assertDeckCounts,
};
