'use strict';

const engine = require('./engine');

module.exports = {
  id: 'catan',
  label: '卡坦岛',
  minPlayers: 3,
  maxPlayers: 4,
  modes: [{ id: 'standard', label: '标准模式' }],
  client: {
    styles: ['/games/catan/style.css'],
    scripts: ['/games/catan/board-view.js', '/games/catan/ui.js'],
    panel: '/games/catan/panel.html',
  },
  supportsHosting: false,
  createGameState: engine.createGameState,
  applyAction: engine.applyAction,
  publicGameState: engine.publicGameState,
  getActingPlayerIds: engine.getActingPlayerIds,
  forceTimeout: engine.forceTimeout,
  onPlayerQuit: engine.onPlayerQuit,
};
