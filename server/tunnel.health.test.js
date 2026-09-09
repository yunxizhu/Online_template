'use strict';

/**
 * 隧道探活 P0：公网失败只是旁证；本机不通/对局保护时不换址。
 */
const assert = require('assert');
const { QuickTunnel, HEALTH_FAILS, publicHealthUrl, HEALTH_PATH } =
  require('./tunnel');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function stubTunnel(opts = {}) {
  const t = new QuickTunnel({
    probeLocal: async () => ({ ok: true }),
    shouldProtect: () => false,
    probe: async () => ({ ok: false, reason: 'timeout', fatal: false }),
    ...opts,
  });
  t.ensure = async () => {
    t.publicUrl = t.publicUrl || 'https://fresh-tunnel-test.trycloudflare.com';
    t.proc = t.proc || { kill() {}, killed: false };
    return t.publicUrl;
  };
  t.proc = { kill() {}, killed: false };
  t.publicUrl = opts.publicUrl || 'https://dead-tunnel-test.trycloudflare.com';
  t._port = 39999;
  t._stopped = false;
  t._backoffMs = 20;
  t._healthFails = 0;
  return t;
}

async function ticks(t, n) {
  for (let i = 0; i < n; i += 1) {
    await t._runHealthTick();
  }
}

async function main() {
  assert.strictEqual(
    publicHealthUrl('https://abc.trycloudflare.com'),
    `https://abc.trycloudflare.com${HEALTH_PATH}`
  );
  assert.strictEqual(publicHealthUrl('not a url'), '');

  // 空闲时连续公网失败达阈值才换址
  let lost = 0;
  let ensureCalls = 0;
  let ticksCount = 0;
  const t = stubTunnel({
    probe: async () => {
      ticksCount += 1;
      return { ok: false, reason: 'timeout', fatal: false };
    },
  });
  t.onLost = () => {
    lost += 1;
  };
  t.ensure = async () => {
    ensureCalls += 1;
    t.publicUrl = 'https://fresh-tunnel-test.trycloudflare.com';
    t.proc = { kill() {}, killed: false };
    return t.publicUrl;
  };

  await ticks(t, HEALTH_FAILS - 1);
  assert.strictEqual(lost, 0, '未达阈值前不应换址');
  assert.ok(t.publicUrl, 'URL 应保留');
  await t._runHealthTick();
  assert.strictEqual(lost, 1, '连续失败达阈值应 onLost');
  await sleep(80);
  assert.ok(ensureCalls >= 1, '应自动 scheduleRestart → ensure');
  assert.ok(ticksCount >= HEALTH_FAILS, '应跑满累计次数');

  // 对局保护：公网一直失败也不换址
  lost = 0;
  const tProtect = stubTunnel({
    shouldProtect: () => true,
    probe: async () => ({ ok: false, reason: 'timeout', fatal: false }),
  });
  tProtect.onLost = () => {
    lost += 1;
  };
  await ticks(tProtect, HEALTH_FAILS + 4);
  assert.strictEqual(lost, 0, '对局保护时不应换址');
  assert.ok(
    tProtect.publicUrl.indexOf('dead-tunnel-test') >= 0,
    '保护期间应保留原 URL'
  );

  // 本机不通：不归咎隧道
  lost = 0;
  const tLocal = stubTunnel({
    probeLocal: async () => ({ ok: false, reason: 'ECONNREFUSED' }),
    probe: async () => ({ ok: false, reason: 'timeout', fatal: false }),
  });
  tLocal.onLost = () => {
    lost += 1;
  };
  await ticks(tLocal, HEALTH_FAILS + 2);
  assert.strictEqual(lost, 0, '本机探活失败不应换隧道');

  // 成功一次清零连续失败
  lost = 0;
  let n = 0;
  const tReset = stubTunnel({
    probe: async () => {
      n += 1;
      if (n === HEALTH_FAILS - 1) return { ok: true, status: 200 };
      return { ok: false, reason: 'timeout', fatal: false };
    },
  });
  tReset.onLost = () => {
    lost += 1;
  };
  await ticks(tReset, HEALTH_FAILS);
  assert.strictEqual(lost, 0, '中间成功一次应清零，未达新的连续阈值');

  // 显式 fatal 仍可立刻换址（如 bad-url）
  lost = 0;
  const t3 = stubTunnel({
    probe: async () => ({ ok: false, reason: 'bad-url', fatal: true }),
  });
  t3.onLost = () => {
    lost += 1;
  };
  t3.ensure = async () => {
    t3.publicUrl = 'https://new.trycloudflare.com';
    t3.proc = { kill() {}, killed: false };
    return t3.publicUrl;
  };
  await t3._runHealthTick();
  assert.strictEqual(lost, 1, 'fatal 应立刻换址');

  t.stop();
  tProtect.stop();
  tLocal.stop();
  tReset.stop();
  t3.stop();
  console.log('✓ tunnel health P0 protect / local / consecutive fails');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
