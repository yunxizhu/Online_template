'use strict';

const engine = require('./engine');

module.exports = {
  id: 'splendor-duel',
  label: '璀璨宝石·对决',
  minPlayers: 2,
  maxPlayers: 2,
  modes: [{ id: 'standard', label: '标准模式' }],
  client: {
    styles: ['/games/splendor-duel/style.css'],
    scripts: ['/games/splendor-duel/ui.js'],
    panel: '/games/splendor-duel/panel.html',
  },
  createGameState: engine.createGameState,
  applyAction: engine.applyAction,
  publicGameState: engine.publicGameState,
  getActingPlayerIds: engine.getActingPlayerIds,
  onPlayerQuit: engine.onPlayerQuit,
  forceTimeout: engine.forceTimeout,
  /** 暂不支持 AI 和托管 */
  supportsHosting: false,
};
