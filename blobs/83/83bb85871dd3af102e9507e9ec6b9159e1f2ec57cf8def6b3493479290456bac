'use strict';

/**
 * 断肠：死亡时，杀死你的角色失去全部武将技能。
 * 引擎在 killPlayer 中调用 onDeath(ctx)。
 */
function onDeath(ctx) {
  const killerId = ctx.sourceId || (ctx.deathMeta && ctx.deathMeta.sourceId);
  if (!killerId) return { ok: false };
  const killer = ctx.getPlayer(killerId);
  if (!killer || !killer.alive) return { ok: false };
  killer.skills = [];
  killer.extraSkillIds = [];
  killer.skillsLost = true;
  killer.skillStates = killer.skillStates || {};
  killer.skillStates._duanchang = true;
  if (killer.skillStates) {
    for (const k of Object.keys(killer.skillStates)) {
      if (k.startsWith('temp:')) delete killer.skillStates[k];
    }
  }
  ctx.log(killer.name + ' 因断肠失去所有武将技能');
  return { ok: true };
}

module.exports = {
  id: 'duanchang',
  name: '断肠',
  desc: '锁定技，当你死亡时，杀死你的角色失去所有武将技能。',
  type: 'locked',
  forced: true,
  triggers: [],
  onDeath,
  content(ctx) {
    return onDeath(ctx);
  },
};
