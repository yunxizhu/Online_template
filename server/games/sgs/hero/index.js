'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 自动扫描本目录下各武将子文件夹并注册。
 * 新增武将：新建 hero/<id>/index.js（及技能文件）即可，无需改此文件。
 */

function normalizeSkill(skill, heroId) {
  if (!skill || !skill.id) {
    throw new Error(`武将 ${heroId} 存在无效技能定义`);
  }
  return {
    id: skill.id,
    name: skill.name || skill.id,
    desc: skill.desc || '',
    lord: Boolean(skill.lord),
    type: skill.type || (skill.lord ? 'lord' : 'trigger'),
    forced: Boolean(skill.forced),
    triggers: Array.isArray(skill.triggers) ? skill.triggers.slice() : [],
    // 保留技能模块上的钩子函数
    onTrigger: typeof skill.onTrigger === 'function' ? skill.onTrigger : null,
    canTrigger: typeof skill.canTrigger === 'function' ? skill.canTrigger : null,
    _raw: skill,
  };
}

function normalizeHero(mod, folderName) {
  const hero = mod && mod.default ? mod.default : mod;
  if (!hero || !hero.id) {
    throw new Error(`武将目录 ${folderName} 缺少 id`);
  }
  const skills = (hero.skills || []).map((s) => normalizeSkill(s, hero.id));
  return {
    id: hero.id,
    name: hero.name || hero.id,
    country: hero.country || '群',
    maxHp: hero.maxHp || 4,
    gender: hero.gender || 'male',
    portrait: hero.portrait || `hero_${hero.id}.png`,
    title: hero.title || '',
    skills,
    enabled: hero.enabled !== false,
  };
}

const SKILL_LIB = Object.create(null);

function registerSkillRaw(skill) {
  if (skill && skill.id) SKILL_LIB[skill.id] = skill._raw || skill;
}

function loadAllHeroes() {
  const root = __dirname;
  const list = [];
  for (const name of fs.readdirSync(root)) {
    if (name.startsWith('_') || name === 'index.js') continue;
    const full = path.join(root, name);
    if (!fs.statSync(full).isDirectory()) continue;
    if (!fs.existsSync(path.join(full, 'index.js'))) continue;
    // eslint-disable-next-line import/no-dynamic-require, global-require
    let mod;
    try {
      mod = require(full);
    } catch (err) {
      console.warn(`[sgs/hero] skip ${name}:`, err.message);
      continue;
    }
    const hero = normalizeHero(mod, name);
    for (const s of hero.skills) registerSkillRaw(s);
    list.push(hero);
  }
  list.sort((a, b) => {
    const order = { 魏: 0, 蜀: 1, 吴: 2, 群: 3 };
    const ca = order[a.country] ?? 9;
    const cb = order[b.country] ?? 9;
    if (ca !== cb) return ca - cb;
    return a.id.localeCompare(b.id);
  });
  return list;
}

const ALL_HEROES = loadAllHeroes();
const GENERALS = ALL_HEROES.filter((h) => h.enabled);

registerSkillRaw(require('../equip/muniu'));
registerSkillRaw(require('./dengai/jixi'));

function getSkillRaw(skillId) {
  return SKILL_LIB[skillId] || null;
}

function getGeneral(id) {
  return GENERALS.find((g) => g.id === id) || null;
}

function getHero(id) {
  return getGeneral(id);
}

function dealGeneralChoices(count, excludeIds = []) {
  const pool = GENERALS.filter((g) => !excludeIds.includes(g.id));
  const shuffled = pool.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * 触发武将技能钩子。
 * @param {string} trigger 如 'afterDamage' | 'phasePrepare' | ...
 * @param {object} ctx { game, player, ... }
 * @returns {object[]} 各技能返回值
 */
function runSkillTrigger(trigger, ctx) {
  const player = ctx.player;
  if (!player || !player.alive) return [];
  const hero = getHero(player.generalId);
  if (!hero) return [];
  const results = [];
  for (const skill of hero.skills) {
    if (skill.lord && !player.isLordSkillEnabled) continue;
    if (skill.triggers.length && !skill.triggers.includes(trigger)) continue;
    const raw = skill._raw;
    if (typeof raw.canTrigger === 'function' && !raw.canTrigger(ctx, skill)) {
      continue;
    }
    if (typeof raw.onTrigger === 'function') {
      const r = raw.onTrigger(ctx, skill);
      if (r) results.push({ skillId: skill.id, result: r });
    } else if (typeof raw[trigger] === 'function') {
      const r = raw[trigger](ctx, skill);
      if (r) results.push({ skillId: skill.id, result: r });
    }
  }
  return results;
}

module.exports = {
  ALL_HEROES,
  GENERALS,
  SKILL_LIB,
  getGeneral,
  getHero,
  getSkillRaw,
  dealGeneralChoices,
  runSkillTrigger,
  loadAllHeroes,
};
