'use strict';

const engine = require('./engine');

module.exports = {
  id: 'lasidao',
  label: '卡拉斯坦',
  minPlayers: 2,
  maxPlayers: 5,
  modes: [
    { id: 'h2h', label: '组队模式', seats: [4] },
    { id: 'melee', label: '各自为战', seats: [2, 3, 4, 5], default: true, defaultSeat: 2 },
  ],
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
  finishSettleAnimForce: engine.finishSettleAnimForce,
  INIT_ANNOUNCE_MS: engine.INIT_ANNOUNCE_MS,
  SETTLE_ANIM_MAX_MS: engine.SETTLE_ANIM_MAX_MS,
};
