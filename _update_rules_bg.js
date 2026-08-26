'use strict';
const fs = require('fs');

const zhBgTitle = '游戏背景';
const zhBgHtml = [
  '<p>你身为帝国册封的男爵，爵位低微、前程未定。为博取皇帝赏识、建功立业、晋升显贵，你亲自率领麾下子民，扬帆远航，奔赴传闻中资源丰饶、未经开垦的拉斯岛。</p>',
  '<p>你的初衷简单直白：开垦沃土、开采资源、修筑聚落，以一方疆土的繁荣功绩，换取朝堂嘉奖，升官晋爵、光耀部族。</p>',
  '<p>可当船队靠岸、踏上海岛的那一刻，你赫然发现——这片沃土并非为你专属预留。数位身份相当的贵族开拓者，同样怀揣建功晋升的野心，早已先后登岛。</p>',
  '<p>自此，一场无声的拓荒竞赛正式开启。众人同驻一岛，资源有限、机遇均等。你需要伐木筑路、垦田畜牧、开矿通商，扩张领地、发展城邦，巧妙交易资源、布局势力版图。</p>',
  '<p>没有谦让与共存，唯有实力定输赢。率先壮大势力、积攒足够功绩者，便能夺得皇帝青睐，从一众男爵中脱颖而出，登顶拉斯、进阶高阶爵位，成为这片海岛真正的统治者。</p>',
].join('');

const enBgTitle = 'Background';
const enBgHtml = [
  '<p>You are a baron of the empire—low in rank, with an uncertain future. To win the emperor’s favor, earn glory, and rise among the nobility, you lead your people across the sea to the rumored fertile, unclaimed island of Catan.</p>',
  '<p>Your aim is plain: clear the land, gather resources, raise settlements, and turn a thriving domain into courtly praise—promotion, honor, and glory for your house.</p>',
  '<p>But the moment your fleet lands, you discover the island was never reserved for you alone. Other nobles of similar standing, chasing the same climb, have already come ashore.</p>',
  '<p>A silent race to settle begins. You share one island, scarce resources, and equal chances. Chop timber, farm and herd, mine and trade; expand your lands, grow your cities, bargain shrewdly, and shape your sphere of power.</p>',
  '<p>There is no courtesy or coexistence—only strength decides. The first to amass enough prestige wins the emperor’s favor, rises above the other barons, claims Catan, and becomes the island’s true ruler.</p>',
].join('');

function patch(path, bgTitle, bgHtml, setupReplacers) {
  const j = JSON.parse(fs.readFileSync(path, 'utf8'));
  const r = j.lasidao.rules;
  r.backgroundTitle = bgTitle;
  r.backgroundHtml = bgHtml;

  let h = r.flowHtml;
  for (const [from, to] of setupReplacers) {
    if (!h.includes(from)) {
      console.warn('missing fragment in', path, from.slice(0, 40));
    } else {
      h = h.replace(from, to);
    }
  }
  r.flowHtml = h;
  fs.writeFileSync(path, JSON.stringify(j, null, 2) + '\n');
  console.log('ok', path);
}

patch(
  'public/i18n/zh.json',
  zhBgTitle,
  zhBgHtml,
  [
    [
      '<p><strong>开局：</strong>每人 3 名村民、3 间房子（每间 1 分，开局 3 分），无初始资源。开局自动投骰决定先手（平局自动重投），宣布后发牌进入第 1 轮。</p>',
      '<p><strong>游戏准备：</strong>每位玩家初始手牌资源上限 <strong>10</strong>、功能卡上限 <strong>3</strong>、建筑上限 <strong>3</strong>；开局获得 <strong>3 间房子</strong>与 <strong>3 名村民</strong>（每间房子 1 分，开局 3 分），无初始资源。开局自动投骰决定先手（平局自动重投），宣布后发牌进入第 1 轮。</p>',
    ],
    [
      '建筑上限默认 3，功能手牌上限默认 3，<strong>手牌资源上限默认 10</strong>（木/石/小麦/铁合计）。',
      '建筑上限默认 3，功能手牌上限默认 3，手牌资源上限默认 10（木/石/小麦/铁合计），与开局准备一致。',
    ],
  ]
);

patch(
  'public/i18n/en.json',
  enBgTitle,
  enBgHtml,
  [
    [
      '<p><strong>Setup:</strong> 3 villagers and 3 houses each (1 point per house); no starting resources. Auto-roll for first player, then deal into round 1.</p>',
      '<p><strong>Game setup:</strong> Each player starts with resource-hand limit <strong>10</strong>, function-card limit <strong>3</strong>, and building limit <strong>3</strong>; begins with <strong>3 houses</strong> and <strong>3 villagers</strong> (1 point per house → 3 points), and no starting resources. Auto-roll for first player (ties re-roll), then deal into round 1.</p>',
    ],
  ]
);
