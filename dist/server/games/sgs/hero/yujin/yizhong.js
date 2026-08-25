'use strict';

/**
 * 毅重：未装备防具时黑色杀无效（引擎 armorBlocksSha 按 skill id 挂钩）。
 */
module.exports = {
  id: 'yizhong',
  name: '毅重',
  desc: '锁定技，当你没装备防具时，黑色的【杀】对你无效。',
  type: 'locked',
  forced: true,
  triggers: [],
};
