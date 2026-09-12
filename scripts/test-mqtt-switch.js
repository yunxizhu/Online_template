'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const { MqttBulletin } = require('../server/mqttBulletin');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'm-'));
  const b = new MqttBulletin({
    rootDir: root,
    instanceId: 't1',
    getDisplayName: () => 'a',
    getHostedRooms: () => [],
    getLobbyPeople: () => [{ name: 'a', status: 'idle' }],
    ensureTunnelUrl: async () => '',
    peekTunnelUrl: () => '',
  });
  await b.start();
  await new Promise((r) => setTimeout(r, 8000));
  console.log('status', JSON.stringify(b.getStatus(), null, 2));
  const sw = await b.switchToNextBroker();
  console.log('switch', sw);
  b.stop();
  fs.rmSync(root, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
