'use strict';

const QICE_OPTIONS = [
  { id: 'wuzhong', name: '无中生有' },
  { id: 'guohe', name: '过河拆桥' },
  { id: 'shunshou', name: '顺手牵羊' },
  { id: 'juedou', name: '决斗' },
  { id: 'huogong', name: '火攻' },
  { id: 'tiesuo', name: '铁索连环' },
  { id: 'nanman', name: '南蛮入侵' },
  { id: 'wanjian', name: '万箭齐发' },
];

module.exports = {
  id: 'qice',
  name: '奇策',
  desc: '出牌阶段限一次，你可以将所有手牌当任意一张非延时类锦囊牌使用。',
  type: 'active',
  QICE_OPTIONS,
  filter(ctx) {
    return !ctx.skillUsed(ctx.player, 'qice') && ctx.player.hand.length >= 1;
  },
  content(ctx) {
    ctx.setPending({
      type: 'skill_effect',
      skillId: 'qice',
      step: 'choose_trick',
      playerId: ctx.player.id,
      askId: ctx.player.id,
      options: QICE_OPTIONS.slice(),
      message: '奇策：选择一张非延时锦囊（将全部手牌当该锦囊使用）',
      canPass: true,
    });
    return { ok: true };
  },
};
