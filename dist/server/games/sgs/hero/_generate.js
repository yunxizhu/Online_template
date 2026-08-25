'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname);

const heroes = [
  {
    id: 'caocao',
    name: '曹操',
    country: '魏',
    maxHp: 4,
    gender: 'male',
    skills: [
      {
        id: 'jianxiong',
        name: '奸雄',
        desc: '当你受到伤害后，你可以获得对你造成伤害的牌。',
        triggers: ['afterDamage'],
      },
      {
        id: 'hujia',
        name: '护驾',
        desc: '主公技，当你需要使用或打出【闪】时，你可以令其他魏势力角色选择是否打出一张【闪】。',
        triggers: ['needShan'],
        lord: true,
      },
    ],
  },
  {
    id: 'simayi',
    name: '司马懿',
    country: '魏',
    maxHp: 3,
    gender: 'male',
    skills: [
      {
        id: 'fankui',
        name: '反馈',
        desc: '当你受到伤害后，你可以获得伤害来源的一张牌。',
        triggers: ['afterDamage'],
      },
      {
        id: 'guicai',
        name: '鬼才',
        desc: '当一名角色的判定牌生效前，你可以打出一张手牌代替之。',
        triggers: ['beforeJudge'],
      },
    ],
  },
  {
    id: 'xiahoudun',
    name: '夏侯惇',
    country: '魏',
    maxHp: 4,
    gender: 'male',
    skills: [
      {
        id: 'ganglie',
        name: '刚烈',
        desc: '当你受到伤害后，你可以进行判定：若结果不为红桃，伤害来源弃置两张手牌或受到1点伤害。',
        triggers: ['afterDamage'],
      },
    ],
  },
  {
    id: 'zhangliao',
    name: '张辽',
    country: '魏',
    maxHp: 4,
    gender: 'male',
    skills: [
      {
        id: 'tuxi',
        name: '突袭',
        desc: '摸牌阶段，你可以少摸任意张牌并获得等量其他角色的各一张手牌。',
        triggers: ['phaseDraw'],
      },
    ],
  },
  {
    id: 'xuchu',
    name: '许褚',
    country: '魏',
    maxHp: 4,
    gender: 'male',
    skills: [
      {
        id: 'luoyi',
        name: '裸衣',
        desc: '摸牌阶段，你可以少摸一张牌，若如此做，本回合你使用【杀】或【决斗】造成的伤害+1。',
        triggers: ['phaseDraw'],
      },
    ],
  },
  {
    id: 'guojia',
    name: '郭嘉',
    country: '魏',
    maxHp: 3,
    gender: 'male',
    skills: [
      {
        id: 'tiandu',
        name: '天妒',
        desc: '当你的判定牌生效后，你可以获得此牌。',
        triggers: ['afterJudge'],
      },
      {
        id: 'yiji',
        name: '遗计',
        desc: '当你受到1点伤害后，你可以观看牌堆顶两张牌，将之交给任意角色。',
        triggers: ['afterDamage'],
      },
    ],
  },
  {
    id: 'zhenji',
    name: '甄姬',
    country: '魏',
    maxHp: 3,
    gender: 'female',
    skills: [
      {
        id: 'qingguo',
        name: '倾国',
        desc: '你可以将一张黑色手牌当【闪】使用或打出。',
        triggers: ['needShan'],
      },
      {
        id: 'luoshen',
        name: '洛神',
        desc: '准备阶段，你可以进行判定：黑色则获得之并可再判定。',
        triggers: ['phasePrepare'],
      },
    ],
  },
  {
    id: 'liubei',
    name: '刘备',
    country: '蜀',
    maxHp: 4,
    gender: 'male',
    skills: [
      {
        id: 'rende',
        name: '仁德',
        desc: '出牌阶段，你可以将任意张手牌交给其他角色；若给出不少于两张，你回复1点体力。',
        triggers: ['phasePlay'],
      },
      {
        id: 'jijiang',
        name: '激将',
        desc: '主公技，当你需要使用或打出【杀】时，你可以令其他蜀势力角色选择是否打出一张【杀】。',
        triggers: ['needSha'],
        lord: true,
      },
    ],
  },
  {
    id: 'guanyu',
    name: '关羽',
    country: '蜀',
    maxHp: 4,
    gender: 'male',
    skills: [
      {
        id: 'wusheng',
        name: '武圣',
        desc: '你可以将一张红色牌当【杀】使用或打出。',
        triggers: ['needSha', 'phasePlay'],
      },
    ],
  },
  {
    id: 'zhangfei',
    name: '张飞',
    country: '蜀',
    maxHp: 4,
    gender: 'male',
    skills: [
      {
        id: 'paoxiao',
        name: '咆哮',
        desc: '锁定技，你使用【杀】无次数限制。',
        triggers: ['shaLimit'],
      },
    ],
  },
  {
    id: 'zhugeliang',
    name: '诸葛亮',
    country: '蜀',
    maxHp: 3,
    gender: 'male',
    skills: [
      {
        id: 'guanxing',
        name: '观星',
        desc: '准备阶段，你可以观看牌堆顶的X张牌（X为存活角色数且最多5），以任意顺序置于牌堆顶或牌堆底。',
        triggers: ['phasePrepare'],
      },
      {
        id: 'kongcheng',
        name: '空城',
        desc: '锁定技，若你没有手牌，你不能成为【杀】或【决斗】的目标。',
        triggers: ['canBeTarget'],
      },
    ],
  },
  {
    id: 'zhaoyun',
    name: '赵云',
    country: '蜀',
    maxHp: 4,
    gender: 'male',
    skills: [
      {
        id: 'longdan',
        name: '龙胆',
        desc: '你可以将【杀】当【闪】、【闪】当【杀】使用或打出。',
        triggers: ['needSha', 'needShan', 'phasePlay'],
      },
    ],
  },
  {
    id: 'machao',
    name: '马超',
    country: '蜀',
    maxHp: 4,
    gender: 'male',
    skills: [
      {
        id: 'mashu',
        name: '马术',
        desc: '锁定技，你计算与其他角色的距离-1。',
        triggers: ['distance'],
      },
      {
        id: 'tieji',
        name: '铁骑',
        desc: '当你使用【杀】指定目标后，你可以进行判定：红色则其不能使用【闪】。',
        triggers: ['afterShaTarget'],
      },
    ],
  },
  {
    id: 'huangyueying',
    name: '黄月英',
    country: '蜀',
    maxHp: 3,
    gender: 'female',
    skills: [
      {
        id: 'jizhi',
        name: '集智',
        desc: '当你使用非延时锦囊牌时，你可以摸一张牌。',
        triggers: ['afterUseTrick'],
      },
      {
        id: 'qicai',
        name: '奇才',
        desc: '锁定技，你使用锦囊牌无距离限制。',
        triggers: ['trickDistance'],
      },
    ],
  },
  {
    id: 'sunquan',
    name: '孙权',
    country: '吴',
    maxHp: 4,
    gender: 'male',
    skills: [
      {
        id: 'zhiheng',
        name: '制衡',
        desc: '出牌阶段限一次，你可以弃置任意张牌，然后摸等量的牌。',
        triggers: ['phasePlay'],
      },
      {
        id: 'jiuyuan',
        name: '救援',
        desc: '主公技，其他吴势力角色对你使用【桃】时回复的体力+1。',
        triggers: ['onTao'],
        lord: true,
      },
    ],
  },
  {
    id: 'ganning',
    name: '甘宁',
    country: '吴',
    maxHp: 4,
    gender: 'male',
    skills: [
      {
        id: 'qixi',
        name: '奇袭',
        desc: '你可以将一张黑色牌当【过河拆桥】使用。',
        triggers: ['phasePlay'],
      },
    ],
  },
  {
    id: 'lvmeng',
    name: '吕蒙',
    country: '吴',
    maxHp: 4,
    gender: 'male',
    skills: [
      {
        id: 'keji',
        name: '克己',
        desc: '若你未于出牌阶段内使用或打出过【杀】，你可以跳过弃牌阶段。',
        triggers: ['phaseDiscard'],
      },
    ],
  },
  {
    id: 'huanggai',
    name: '黄盖',
    country: '吴',
    maxHp: 4,
    gender: 'male',
    skills: [
      {
        id: 'kurou',
        name: '苦肉',
        desc: '出牌阶段，你可以失去1点体力，然后摸两张牌。',
        triggers: ['phasePlay'],
      },
    ],
  },
  {
    id: 'zhouyu',
    name: '周瑜',
    country: '吴',
    maxHp: 3,
    gender: 'male',
    skills: [
      {
        id: 'yingzi',
        name: '英姿',
        desc: '摸牌阶段，你可以多摸一张牌。',
        triggers: ['phaseDraw'],
      },
      {
        id: 'fanjian',
        name: '反间',
        desc: '出牌阶段限一次，你可以令一名其他角色选择一种花色并获得你的一张手牌，若此牌花色与之不同则其受到1点伤害。',
        triggers: ['phasePlay'],
      },
    ],
  },
  {
    id: 'daqiao',
    name: '大乔',
    country: '吴',
    maxHp: 3,
    gender: 'female',
    skills: [
      {
        id: 'guose',
        name: '国色',
        desc: '你可以将一张方块牌当【乐不思蜀】使用。',
        triggers: ['phasePlay'],
      },
      {
        id: 'liuli',
        name: '流离',
        desc: '当你成为【杀】的目标时，你可以弃置一张牌并将此【杀】转移给你攻击范围内的一名其他角色。',
        triggers: ['whenShaTarget'],
      },
    ],
  },
  {
    id: 'luxun',
    name: '陆逊',
    country: '吴',
    maxHp: 3,
    gender: 'male',
    skills: [
      {
        id: 'qianxun',
        name: '谦逊',
        desc: '锁定技，你不能成为【顺手牵羊】和【乐不思蜀】的目标。',
        triggers: ['canBeTarget'],
      },
      {
        id: 'lianying',
        name: '连营',
        desc: '当你失去最后的手牌时，你可以摸一张牌。',
        triggers: ['afterLoseHand'],
      },
    ],
  },
  {
    id: 'sunshangxiang',
    name: '孙尚香',
    country: '吴',
    maxHp: 3,
    gender: 'female',
    skills: [
      {
        id: 'xiaoji',
        name: '枭姬',
        desc: '当你失去装备区里的牌后，你可以摸两张牌。',
        triggers: ['afterLoseEquip'],
      },
      {
        id: 'jieyin',
        name: '结姻',
        desc: '出牌阶段限一次，你可以弃置两张手牌并选择一名已受伤的男性角色，你与其各回复1点体力。',
        triggers: ['phasePlay'],
      },
    ],
  },
  {
    id: 'huatuo',
    name: '华佗',
    country: '群',
    maxHp: 3,
    gender: 'male',
    skills: [
      {
        id: 'jijiu',
        name: '急救',
        desc: '你的回合外，你可以将一张红色牌当【桃】使用。',
        triggers: ['needTao'],
      },
      {
        id: 'qingnang',
        name: '青囊',
        desc: '出牌阶段限一次，你可以弃置一张手牌令一名已受伤角色回复1点体力。',
        triggers: ['phasePlay'],
      },
    ],
  },
  {
    id: 'lvbu',
    name: '吕布',
    country: '群',
    maxHp: 4,
    gender: 'male',
    skills: [
      {
        id: 'wushuang',
        name: '无双',
        desc: '锁定技，你使用的【杀】或【决斗】需要两张【闪】或【杀】来响应。',
        triggers: ['shaNeedShan', 'juedouNeedSha'],
      },
    ],
  },
  {
    id: 'diaochan',
    name: '貂蝉',
    country: '群',
    maxHp: 3,
    gender: 'female',
    skills: [
      {
        id: 'lijian',
        name: '离间',
        desc: '出牌阶段限一次，你可以弃置一张牌并选择两名男性角色，视为其中一名对另一名使用【决斗】。',
        triggers: ['phasePlay'],
      },
      {
        id: 'biyue',
        name: '闭月',
        desc: '结束阶段，你可以摸一张牌。',
        triggers: ['phaseEnd'],
      },
    ],
  },
];

function skillSource(skill) {
  const lines = [
    "'use strict';",
    '',
    '/**',
    ` * 【${skill.name}】`,
    ` * ${skill.desc}`,
    ' * 实现状态：桩（接口预留，后续在此文件补全逻辑）',
    ' */',
    'module.exports = {',
    `  id: '${skill.id}',`,
    `  name: '${skill.name}',`,
    `  desc: '${skill.desc}',`,
    `  triggers: ${JSON.stringify(skill.triggers || [])},`,
  ];
  if (skill.lord) lines.push('  lord: true,');
  lines.push(
    '  onTrigger(ctx) {',
    '    // TODO: 实现技能逻辑',
    '    return null;',
    '  },',
    '};',
    ''
  );
  return lines.join('\n');
}

for (const h of heroes) {
  const dir = path.join(root, h.id);
  fs.mkdirSync(dir, { recursive: true });
  const reqs = h.skills.map((s) => `  require('./${s.id}'),`).join('\n');
  const index = [
    "'use strict';",
    '',
    '/**',
    ` * ${h.name}（${h.country}）`,
    ' * 武将定义 + 技能列表。新增技能：在本目录加文件并在 skills 中 require。',
    ' */',
    'module.exports = {',
    `  id: '${h.id}',`,
    `  name: '${h.name}',`,
    `  country: '${h.country}',`,
    `  maxHp: ${h.maxHp},`,
    `  gender: '${h.gender}',`,
    `  portrait: '${h.id}.png',`,
    '  skills: [',
    reqs,
    '  ],',
    '};',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'index.js'), index, 'utf8');
  for (const s of h.skills) {
    fs.writeFileSync(path.join(dir, `${s.id}.js`), skillSource(s), 'utf8');
  }
}

console.log('generated', heroes.length, 'heroes under', root);
