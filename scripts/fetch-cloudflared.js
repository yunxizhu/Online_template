'use strict';

/**
 * 下载 cloudflared 到 .tools/（提交进 git，clone 即可用）。
 * 维护者更新版本时：npm run fetch-cloudflared
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  downloadFile,
  TOOLS_DIR,
  VENDORED_CLOUDFLARED_FILES,
} = require('../server/tunnel');

const ROOT = path.resolve(__dirname, '..');

const ASSETS = [
  {
    name: 'cloudflared.exe',
    url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',
  },
  {
    name: 'cloudflared-darwin-amd64',
    url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz',
    extract: true,
  },
  {
    name: 'cloudflared-darwin-arm64',
    url: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz',
    extract: true,
  },
];

async function fetchOne(asset) {
  const dest = path.join(TOOLS_DIR, asset.name);
  const tmp = asset.extract ? dest + '.tgz' : dest + '.part';
  console.log('[fetch-cloudflared]', asset.url);
  await downloadFile(asset.url, tmp);
  if (asset.extract) {
    const extracted = path.join(TOOLS_DIR, 'cloudflared');
    try {
      fs.unlinkSync(extracted);
    } catch (_) {
      /* ignore */
    }
    execFileSync('tar', ['-xzf', tmp, '-C', TOOLS_DIR], { stdio: 'inherit' });
    if (!fs.existsSync(extracted)) {
      throw new Error('extract failed: ' + asset.name);
    }
    fs.renameSync(extracted, dest);
    fs.unlinkSync(tmp);
    fs.chmodSync(dest, 0o755);
  } else {
    fs.renameSync(tmp, dest);
  }
  const mb = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);
  console.log('  ->', path.relative(ROOT, dest), `(${mb} MB)`);
}

async function main() {
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  let version = '';
  for (const asset of ASSETS) {
    await fetchOne(asset);
  }
  try {
    const probe = path.join(TOOLS_DIR, 'cloudflared.exe');
    const out = execFileSync(probe, ['--version'], { encoding: 'utf8' });
    version = String(out).trim().split('\n')[0] || '';
  } catch (_) {
    /* ignore on non-Windows */
  }
  const readme =
    '# cloudflared（随仓库分发）\n\n' +
    (version ? `版本：${version}\n\n` : '') +
    '文件：\n' +
    ASSETS.map((a) => `- ${a.name}`).join('\n') +
    '\n\n更新：在项目根目录执行 `npm run fetch-cloudflared`\n';
  fs.writeFileSync(path.join(TOOLS_DIR, 'README.md'), readme, 'utf8');
  console.log('\nDone. Commit .tools/cloudflared* and .tools/README.md');
  console.log('Expected files:', VENDORED_CLOUDFLARED_FILES.join(', '));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
