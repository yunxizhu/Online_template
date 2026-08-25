'use strict';

/**
 * 绝情：即将造成的伤害改为失去体力（引擎 dealDamage 按 skill id 挂钩）。
 */
module.exports = {
  id: 'jueqing',
  name: '绝情',
  desc: '锁定技，你即将造成的伤害均视为失去体力。',
  type: 'locked',
  forced: true,
  triggers: [],
};
