'use strict';

const engine = require('./engine');

module.exports = {
  id: 'sgs',
  label: '三国杀',
  minPlayers: 3,
  maxPlayers: 8,
  modes: [
    { id: 'identity', label: '标准身份', seats: [5, 8] },
    { id: 'xianzhu', label: '先主·黄巾', seats: [5, 8] },
    { id: 'h2h', label: '2V2', seats: [4] },
    { id: '1v2', label: '1V2', seats: [3] },
  ],
  client: {
    styles: ['/games/sgs/style.css'],
    scripts: ['/games/sgs/assets.js', '/games/sgs/fx.js', '/games/sgs/ui.js'],
    panel: '/games/sgs/panel.html',
  },
  createGameState: engine.createGameState,
  applyAction: engine.applyAction,
  publicGameState: engine.publicGameState,
  getActingPlayerIds: engine.getActingPlayerIds,
  forceTimeout: engine.forceTimeout,
  onPlayerQuit: engine.onPlayerQuit,
};
