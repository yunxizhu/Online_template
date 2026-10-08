'use strict';

/**
 * 固定随机源（A/B 评估的前置条件）。
 *
 * 战争工厂有两处真随机，不钉死的话**同一个 seed 跑两遍结果都不一样**，
 * A/B 的净胜场就全是噪声：
 *   1. createGameState() 用 `Date.now()` 当布局 rng 的种子（总部 / 研究所 / 地形朝向）；
 *   2. unitFire() 用 `Math.random()` 摇瞄准点（溅射落点，直接影响战果）。
 * 这里把两者都换成可复现的：Date.now 冻成常量，Math.random 换成带种子的 LCG。
 */

const FIXED_NOW = 1770000000000;
let installed = false;

function install() {
  if (installed) return;
  installed = true;
  Date.now = () => FIXED_NOW;
}

/** 每局开局前调一次：把 LCG 拨回 seed，让「同 seed 同结果」 */
function resetRandom(seed) {
  install();
  let s = (seed >>> 0) || 1;
  Math.random = function () {
    // xorshift32：够用、无外部依赖
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

module.exports = { install, resetRandom, FIXED_NOW };
