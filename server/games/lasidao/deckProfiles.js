'use strict';

/**
 * 卡拉斯坦牌堆数量配置（两套互相独立，可直接改数字；允许为 0）。
 *
 * - PEACEFUL_DECK：和平发育（创建房间默认）
 * - CONFLICT_DECK：非和平发育
 *
 * resources: 各资源 富/贫 张数
 * functions: 功能卡种类 → 张数
 * buildings.produce: 生产建筑 富/贫 张数
 * buildings.*: 其他建筑张数
 * environment: 事件牌 envType → 张数
 *
 * 改完后开新局即生效。
 */

/** 和平发育牌堆配置（默认） */
const PEACEFUL_DECK = {
  id: 'peaceful',
  resources: {
    wood: { rich: 5, poor: 5 }, // 木头：富=森林 / 贫=灌木丛
    stone: { rich: 5, poor: 5 }, // 石头：富=石头山 / 贫=小石堆
    food: { rich: 5, poor: 5 }, // 小麦：富=大麦田 / 贫=野生麦田
    iron: { rich: 0, poor: 6 }, // 铁矿（仅贫矿）
  },
  functions: {
    harvest: 4, // 丰收
    remoteDice: 0, // 遥控骰子
    exile: 0, // 驱逐
    redraw: 0, // 重抽
    banditRaid: 0, // 强盗来袭
    robbery: 0, // 抢劫
    illegalBuild: 0, // 拆迁
    welfareHouse: 0, // 福利房
    caravan: 4, // 商队来临
    enhance: 4, // 强化
    recruit: 4, // 征召
    shelter: 0, // 收留
  },
  buildings: {
    produce: {
      wood: { rich: 0, poor: 4 }, // 木头建筑·富 / 贫
      stone: { rich: 0, poor: 4 }, // 石头建筑·富 / 贫
      food: { rich: 0, poor: 4 }, // 小麦建筑·富 / 贫
      iron: { rich: 0, poor: 4 }, // 铁矿建筑·富 / 贫
    },
    score2: 2, // 宫殿(+2)
    score1: 8, // 学堂(+1)
    exchange: 6, // 集市
    wishWell: 4, // 许愿井
    mixer: 0, // 打料机（0 = 不进堆）
  },
  environment: {
    prisonersDilemma: 1, // 囚徒困境
    barrenHarvest: 0, // 颗粒无收
    resistBarbarians: 2, // 抵抗南蛮
    clearSky: 2, // 晴空万里
    enterFray: 1, // 以身入局
    oneMountain: 0, // 一山不容二虎
    luckyDraw: 2, // 幸运一抽
    fishermanProfit: 0 , // 渔翁得利
    firstCome: 2, // 先到先得
    welfareMinimum: 1, // 低保户
    recall: 0, // 召回
    weiQiRescueZhao: 0, // 围魏救赵
    teleport: 1, // 传送
    keepOverflow: 2, // 吃不了兜着走
    mercenaries: 1, // 雇佣军
  },
};

/** 非和平发育牌堆配置（初始与和平相同，可单独改） */
const CONFLICT_DECK = {
  id: 'conflict',
  resources: {
    wood: { rich: 5, poor: 8 }, // 木头：富=森林 / 贫=灌木丛
    stone: { rich: 5, poor: 8 }, // 石头：富=石头山 / 贫=小石堆
    food: { rich: 5, poor: 8 }, // 小麦：富=大麦田 / 贫=野生麦田
    iron: { rich: 0, poor: 9 }, // 铁矿（仅贫矿）
  },
  functions: {
    harvest: 3, // 丰收
    remoteDice: 3, // 遥控骰子
    exile: 3, // 驱逐
    redraw: 3, // 重抽
    banditRaid: 3, // 强盗来袭
    robbery: 3, // 抢劫
    illegalBuild: 3, // 拆迁
    welfareHouse: 3, // 福利房
    caravan: 3, // 商队来临
    enhance: 5, // 强化
    recruit: 3, // 征召
    shelter: 3, // 收留
  },
  buildings: {
    produce: {
      wood: { rich: 0, poor: 5 }, // 木头建筑·富 / 贫
      stone: { rich: 0, poor: 5 }, // 石头建筑·富 / 贫
      food: { rich: 0, poor: 5 }, // 小麦建筑·富 / 贫
      iron: { rich: 0, poor: 5 }, // 铁矿建筑·富 / 贫
    },
    score2: 3, // 宫殿(+2)
    score1: 10, // 学堂(+1)
    exchange: 7, // 集市
    wishWell: 5, // 许愿井
    mixer: 0, // 打料机（0 = 不进堆）
  },
  environment: {
    prisonersDilemma: 1, // 囚徒困境
    barrenHarvest: 1, // 颗粒无收
    resistBarbarians: 2, // 抵抗南蛮
    clearSky: 2, // 晴空万里
    enterFray: 2, // 以身入局
    oneMountain: 2, // 一山不容二虎
    luckyDraw: 2, // 幸运一抽
    fishermanProfit: 2, // 渔翁得利
    firstCome: 2, // 先到先得
    welfareMinimum: 2, // 低保户
    recall: 1, // 召回
    weiQiRescueZhao: 1, // 围魏救赵
    teleport: 1, // 传送
    keepOverflow: 2, // 吃不了兜着走
    mercenaries: 1, // 雇佣军
  },
};

/**
 * @param {boolean} peacefulDev 是否和平发育；默认 true
 */
function getDeckProfile(peacefulDev) {
  return peacefulDev === false ? CONFLICT_DECK : PEACEFUL_DECK;
}

module.exports = {
  PEACEFUL_DECK,
  CONFLICT_DECK,
  getDeckProfile,
};
