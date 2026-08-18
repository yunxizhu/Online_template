'use strict';

const gomoku = require('./gomoku');
const incan = require('./incan');
const sgs = require('./sgs');

/** @type {Record<string, object>} 顺序即创建房间下拉默认顺序 */
const GAMES = {
  [sgs.id]: sgs,
  [gomoku.id]: gomoku,
  [incan.id]: incan,
};

function listGames() {
  return Object.values(GAMES).map((g) => ({
    id: g.id,
    label: g.label,
    minPlayers: g.minPlayers,
    maxPlayers: g.maxPlayers,
    modes: g.modes || null,
    client: g.client || null,
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
};
