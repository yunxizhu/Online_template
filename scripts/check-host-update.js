'use strict';

/**
 * 启动前主机 OTA：检测 → 有更新则直接下载覆盖（不询问）→ 返回后由 启动.bat 拉起服务并打开客户端。
 */
const path = require('path');
const { HostUpdateChecker } = require('../server/updateChecker');

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return v + ' B';
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
  return (v / (1024 * 1024)).toFixed(1) + ' MB';
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const checker = new HostUpdateChecker({ rootDir: root });
  console.log('');
  if (checker.disabled) {
    console.log(checker.formatCheckReport({ skipped: true, reason: 'disabled' }));
    return;
  }

  console.log('[update] 正在检查主机版本…');
  console.log('[update] 清单: ' + checker.manifestUrl);
  const result = await checker.check({ force: true });

  if (result.error) {
    console.log(checker.formatCheckReport(result));
    console.warn('[update] 检查失败，跳过自动升级，继续启动。');
    return;
  }

  if (!result.available) {
    console.log(checker.formatCheckReport(result));
    return;
  }

  const total = result.changedCount || (result.changed && result.changed.length) || 0;
  console.log('[update] -------- 检测到升级 --------');
  console.log(
    '[update] 本地版本: ' +
      (result.localVersion || '?') +
      '  →  目标版本: ' +
      (result.remoteVersion || '?')
  );
  if (result.notes) console.log('[update] 说明: ' + result.notes);
  console.log(
    '[update] 待更新: ' + total + ' 个文件 / 约 ' + formatBytes(result.totalBytes || 0)
  );
  console.log('[update] 无需确认，开始自动升级…');

  let lastPhase = '';
  let lastRetryMsg = '';
  const applied = await checker.apply({
    restart: false,
    onProgress: (p) => {
      if (!p) return;
      if (p.retrying && p.message && p.message !== lastRetryMsg) {
        lastRetryMsg = p.message;
        console.warn('[update] ' + p.message);
        if (p.error) console.warn('[update] 原因: ' + p.error);
        return;
      }
      if (p.phase === 'verify') {
        if (p.message === '全量校验已下载文件…') {
          console.log('[update] 下载完成，开始全量校验…');
        } else if (p.message && p.message.startsWith('发现 ')) {
          console.warn('[update] ' + p.message);
          if (p.error) console.warn('[update] 原因: ' + p.error);
        } else if (
          p.message &&
          p.message.startsWith('校验 ') &&
          ((p.current || 0) === 0 ||
            (p.current || 0) + 1 === (p.total || 0) ||
            ((p.current || 0) + 1) % 10 === 0)
        ) {
          console.log(
            '[update] 校验中 ' +
              Math.min((p.current || 0) + 1, p.total || 0) +
              '/' +
              (p.total || '?') +
              '：' +
              (p.file || '')
          );
        }
        lastPhase = p.phase || lastPhase;
        return;
      }
      if (p.phase === 'download' && p.message && p.message.startsWith('重新下载 ')) {
        console.log('[update] ' + p.message);
        return;
      }
      if (p.phase === 'download' && p.message && p.message.startsWith('下载 ')) {
        const idx = Math.min((p.current || 0) + 1, p.total || 0);
        console.log(
          '[update] 正在下载 ' +
            idx +
            '/' +
            (p.total || '?') +
            '：' +
            (p.file || p.message.replace(/^下载\s+/, ''))
        );
      } else if (p.phase === 'download' && p.message && p.message.startsWith('已下载 ')) {
        // 单文件完成时可略，避免刷屏；保留关键节点即可
      } else if (p.phase === 'apply' && p.message === '写入文件…') {
        console.log('[update] 下载完成，开始覆盖本地文件…');
      } else if (p.phase === 'apply' && p.message && p.message.startsWith('已写入 ')) {
        console.log(
          '[update] 覆盖中 ' +
            (p.current || 0) +
            '/' +
            (p.total || '?') +
            '：' +
            (p.file || p.message.replace(/^已写入\s+/, ''))
        );
      } else if (p.phase !== lastPhase && p.message) {
        if (p.phase === 'prepare') console.log('[update] ' + p.message);
        if (p.phase === 'done') console.log('[update] 升级完成');
      }
      lastPhase = p.phase || lastPhase;
    },
  });

  console.log(
    '[update] 升级完成：' +
      (applied.from || '?') +
      ' → ' +
      (applied.to || '?') +
      '（' +
      (applied.files || 0) +
      ' 个文件）'
  );
  console.log('[update] 即将启动服务并打开客户端…');
  console.log('[update] --------------------------------');
}

main().catch((err) => {
  console.warn(
    '[update] 启动前升级异常（已重试仍失败，将继续启动）:',
    err && err.message ? err.message : err
  );
});
