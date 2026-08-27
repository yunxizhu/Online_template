'use strict';

/**
 * 隧道僵死探活：不拉起真实 cloudflared，用注入 probe 验证强制换址。
 */
const assert = require('assert');
const { QuickTunnel } = require('./tunnel');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // DNS 失败不再 fatal：需累计到 HEALTH_FAILS（默认 4）才换址
  let lost = 0;
  let ensureCalls = 0;
  let ticks = 0;
  const t = new QuickTunnel({
    probe: async () => {
      ticks += 1;
      return { ok: false, reason: 'dns:ENOTFOUND', fatal: false };
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
  t.proc = { kill() {}, killed: false };
  t.publicUrl = 'https://dead-tunnel-test.trycloudflare.com';
  t._port = 39999;
  t._stopped = false;
  t._backoffMs = 20;
  t._healthFails = 0;

  await t._runHealthTick();
  assert.strictEqual(lost, 0, 'DNS 失败第一次不应立刻换址');
  assert.ok(t.publicUrl, 'URL 应保留');
  await t._runHealthTick();
  await t._runHealthTick();
  assert.strictEqual(lost, 0, '未达阈值前不应换址');
  await t._runHealthTick();
  assert.strictEqual(lost, 1, '连续失败达阈值应 onLost');
  await sleep(80);
  assert.ok(ensureCalls >= 1, '应自动 scheduleRestart → ensure');
  assert.ok(ticks >= 4, '应跑满累计次数');

  // 连续 timeout 同样累计换址
  lost = 0;
  ensureCalls = 0;
  let failsLeft = 4;
  const t2 = new QuickTunnel({
    probe: async () => {
      failsLeft -= 1;
      return { ok: false, reason: 'timeout', fatal: false };
    },
  });
  t2.onLost = () => {
    lost += 1;
  };
  t2.ensure = async () => {
    ensureCalls += 1;
    t2.publicUrl = 'https://ok.trycloudflare.com';
    t2.proc = { kill() {}, killed: false };
    return t2.publicUrl;
  };
  t2.proc = { kill() {}, killed: false };
  t2.publicUrl = 'https://stale.trycloudflare.com';
  t2._port = 39998;
  t2._backoffMs = 20;
  t2._healthFails = 0;

  await t2._runHealthTick();
  assert.strictEqual(lost, 0, '第一次 timeout 不应立刻换址');
  await t2._runHealthTick();
  await t2._runHealthTick();
  assert.strictEqual(lost, 0, '第三次仍不换');
  await t2._runHealthTick();
  assert.strictEqual(lost, 1, '连续失败达阈值应 onLost');
  await sleep(80);
  assert.ok(ensureCalls >= 1, '应触发重连');

  // 显式 fatal 仍可立刻换址（如 bad-url）
  lost = 0;
  const t3 = new QuickTunnel({
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
  t3.proc = { kill() {}, killed: false };
  t3.publicUrl = 'https://bad.trycloudflare.com';
  t3._port = 39997;
  t3._backoffMs = 20;
  await t3._runHealthTick();
  assert.strictEqual(lost, 1, 'fatal 应立刻换址');

  t.stop();
  t2.stop();
  t3.stop();
  console.log('✓ tunnel health force-rotate');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
