'use strict';

/** 启动前探测主机 OTA（给 启动.bat 打印用） */
const path = require('path');
const { HostUpdateChecker } = require('../server/updateChecker');

async function main() {
  const root = path.resolve(__dirname, '..');
  const checker = new HostUpdateChecker({ rootDir: root });
  console.log('');
  if (checker.disabled) {
    console.log(checker.formatCheckReport({ skipped: true, reason: 'disabled' }));
    return;
  }
  console.log('[update] 正在向 Gitee 拉取更新清单…');
  const result = await checker.check({ force: true });
  console.log(checker.formatCheckReport(result));
}

main().catch((err) => {
  console.warn('[update] 启动前检测异常:', err && err.message ? err.message : err);
});
