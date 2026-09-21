'use strict';

const engine = require('./engine');

module.exports = {
  id: 'doudizhu',
  label: '斗地主',
  minPlayers: 3,
  maxPlayers: 3,
  modes: [{ id: 'standard', label: '标准模式' }],
  client: {
    styles: ['/games/doudizhu/style.css'],
    scripts: ['/games/doudizhu/ui.js'],
    panel: '/games/doudizhu/panel.html',
  },
  createGameState: engine.createGameState,
  applyAction: engine.applyAction,
  publicGameState: engine.publicGameState,
  getActingPlayerIds: engine.getActingPlayerIds,
  onPlayerQuit: engine.onPlayerQuit,
  forceTimeout: engine.forceTimeout,
  startNextHand: engine.startNextHand,
  clampMatchGames: engine.clampMatchGames,
  /** 斗地主不需要AI和托管 */
  supportsHosting: false,
};
