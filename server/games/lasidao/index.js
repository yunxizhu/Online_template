'use strict';

const engine = require('./engine');

module.exports = {
  id: 'lasidao',
  label: '拉斯岛',
  minPlayers: 2,
  maxPlayers: 5,
  modes: [{ id: 'standard', label: '标准模式' }],
  client: {
    styles: ['/games/lasidao/style.css'],
    scripts: [
      '/games/lasidao/assets.js',
      '/games/lasidao/fx.js',
      '/games/lasidao/ui.js',
    ],
    panel: '/games/lasidao/panel.html',
  },
  createGameState: engine.createGameState,
  applyAction: engine.applyAction,
  publicGameState: engine.publicGameState,
  getActingPlayerIds: engine.getActingPlayerIds,
  forceTimeout: engine.forceTimeout,
  onPlayerQuit: engine.onPlayerQuit,
  finishInitAnnounce: engine.finishInitAnnounce,
  INIT_ANNOUNCE_MS: engine.INIT_ANNOUNCE_MS,
};
