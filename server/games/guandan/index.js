'use strict';

const engine = require('./engine');

module.exports = {
  id: 'guandan',
  label: '掼蛋',
  minPlayers: 4,
  maxPlayers: 4,
  modes: [{ id: 'standard', label: '标准模式' }],
  client: {
    styles: ['/games/guandan/style.css'],
    scripts: ['/games/guandan/ui.js'],
    panel: '/games/guandan/panel.html',
  },
  createGameState: engine.createGameState,
  applyAction: engine.applyAction,
  publicGameState: engine.publicGameState,
  getActingPlayerIds: engine.getActingPlayerIds,
  onPlayerQuit: engine.onPlayerQuit,
  forceTimeout: engine.forceTimeout,
  /** 掼蛋不需要AI和托管 */
  supportsHosting: false,
};
