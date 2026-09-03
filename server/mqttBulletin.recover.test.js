'use strict';

/**
 * 隧道中断时房间心跳不得被清空：用旧址续播，新址到手立刻改心跳。
 */
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { MqttBulletin } = require('./mqttBulletin');

function fakeClient(published) {
  return {
    connected: true,
    publish(topic, payload) {
      published.push({ topic, payload });
    },
  };
}

function lastRoomPayload(published) {
  const roomPubs = published.filter(
    (p) => String(p.topic || '').includes('/room/')
  );
  const last = roomPubs[roomPubs.length - 1];
  if (!last) return null;
  if (last.payload === '' || last.payload == null) return { cleared: true };
  return JSON.parse(last.payload);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lianji-mqtt-'));
  const published = [];
  let peek = 'https://old.trycloudflare.com';
  let ensureCalls = 0;

  const b = new MqttBulletin({
    rootDir: tmp,
    instanceId: 'test-host-1',
    getDisplayName: () => '房主',
    getDisplayTag: () => '12345',
    getHostedRooms: () => [
      {
        id: 'ABCD',
        name: '测试房',
        status: 'playing',
        over: false,
        gameType: 'lasidao',
        gameLabel: '拉四刀',
        maxPlayers: 4,
        players: [
          { name: '房主', tag: '12345' },
          { name: '客人', tag: '67890' },
        ],
      },
    ],
    getLobbyPeople: () => [{ name: '房主', status: 'playing' }],
    peekTunnelUrl: () => peek,
    ensureTunnelUrl: async () => {
      ensureCalls += 1;
      return peek;
    },
  });
  assert.ok(b.enabled, '测试目录应启用 MQTT');
  b._started = true;
  b.client = fakeClient(published);

  await b.touchRoom({ skipWarmup: true });
  let payload = lastRoomPayload(published);
  assert.ok(payload && payload.id === 'ABCD', '应先发出房间心跳');
  assert.strictEqual(payload.host, 'https://old.trycloudflare.com');
  assert.ok(!payload.tunnelRecovering);

  peek = '';
  b.markTunnelLost();
  payload = lastRoomPayload(published);
  assert.ok(payload && !payload.cleared, '隧道中断不得清空房间心跳');
  assert.strictEqual(payload.id, 'ABCD');
  assert.strictEqual(payload.host, 'https://old.trycloudflare.com');
  assert.strictEqual(payload.tunnelRecovering, true);
  assert.ok(payload.gameType === 'lasidao', '对局信息应仍挂在心跳上');
  assert.ok(ensureCalls >= 1, '应立刻后台重启隧道');

  peek = 'https://new.trycloudflare.com';
  const flushed = b.flushIfReady(peek, { skipWarmup: true });
  assert.ok(flushed, '新隧道应立刻可广播');
  payload = lastRoomPayload(published);
  assert.ok(payload && !payload.cleared);
  assert.strictEqual(payload.host, 'https://new.trycloudflare.com');
  assert.ok(!payload.tunnelRecovering, '新地址广播后应结束恢复中标记');

  const reloadOk = b.publishReload({
    roomId: 'ABCD',
    host: 'https://new.trycloudflare.com',
    name: '测试房',
    gameType: 'lasidao',
    targets: [{ name: '客人', tag: '67890', sessionId: 'sid-guest' }],
  });
  assert.ok(reloadOk, '应发出房间 reload');
  const reloadPub = published.filter((p) =>
    String(p.topic || '').includes('/reload')
  );
  assert.ok(reloadPub.length, 'reload 应发到 MQTT');
  const reloadMsg = JSON.parse(reloadPub[reloadPub.length - 1].payload);
  assert.strictEqual(reloadMsg.kind, 'reload');
  assert.strictEqual(reloadMsg.roomId, 'ABCD');
  assert.strictEqual(reloadMsg.host, 'https://new.trycloudflare.com');
  assert.strictEqual(reloadMsg.targets[0].name, '客人');

  const hostedView = {
    id: 'ABCD',
    name: '测试房',
    status: 'playing',
    over: false,
    playerCount: 2,
    players: [
      { name: '房主', tag: '12345', left: false },
      { name: '客人', tag: '67890', left: false },
    ],
  };
  const beacon = await b.waitForRoomBeacon('ABCD', () => hostedView, {
    timeoutMs: 2000,
  });
  assert.ok(beacon.ok, '广播确认不应因 payload/大厅房间字段不同而卡住');

  b.stop();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }
  console.log('✓ mqtt bulletin keeps room heartbeat across tunnel rotate');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
