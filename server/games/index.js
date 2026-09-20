'use strict';

const gomoku = require('./gomoku');
const incan = require('./incan');
const sgs = require('./sgs');
const lasidao = require('./lasidao');
const catan = require('./catan');
const doudizhu = require('./doudizhu');
const guandan = require('./guandan');
const splendorDuel = require('./splendor-duel');

/** @type {Record<string, object>} 顺序即创建房间下拉默认顺序 */
const GAMES = {
  [sgs.id]: sgs,
  [gomoku.id]: gomoku,
  [incan.id]: incan,
  [lasidao.id]: lasidao,
  [catan.id]: catan,
  [doudizhu.id]: doudizhu,
  [guandan.id]: guandan,
  [splendorDuel.id]: splendorDuel,
};

function gameSupportsBot(game) {
  return Boolean(game && typeof game.decideBotAction === 'function');
}

/** 对局中玩家托管（由电脑代操作）；默认仅显式声明的游戏支持 */
function gameSupportsHosting(game) {
  return Boolean(game && game.supportsHosting === true);
}

function listGames() {
  return Object.values(GAMES).map((g) => ({
    id: g.id,
    label: g.label,
    minPlayers: g.minPlayers,
    maxPlayers: g.maxPlayers,
    modes: g.modes || null,
    client: g.client || null,
    /** 是否接入 AI（游戏模块导出 decideBotAction，通常来自 bot.js） */
    supportsBot: gameSupportsBot(g),
    /** 是否允许对局中玩家托管 */
    supportsHosting: gameSupportsHosting(g),
  }));
}

function getGame(gameType) {
  return GAMES[gameType] || null;
}

function resolveGameType(gameType) {
  if (gameType && GAMES[gameType]) return gameType;
  return sgs.id;
}

module.exports = {
  GAMES,
  listGames,
  getGame,
  resolveGameType,
  gameSupportsBot,
  gameSupportsHosting,
};
