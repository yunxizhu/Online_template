'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MOBILE_WWW = path.join(__dirname, '..', 'www');
const JS_OUT = path.join(MOBILE_WWW, 'js');
const VENDOR_OUT = path.join(MOBILE_WWW, 'vendor');
const I18N_OUT = path.join(MOBILE_WWW, 'i18n');

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log('[sync]', path.relative(MOBILE_WWW, to));
}

function cpDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name);
    const dest = path.join(to, name);
    if (fs.statSync(src).isDirectory()) cpDir(src, dest);
    else copyFile(src, dest);
  }
}

const jsPairs = [
  ['public/js/client.js', 'js/client.js'],
  ['public/js/boot-games.js', 'js/boot-games.js'],
  ['public/js/ui.js', 'js/ui.js'],
  ['public/js/i18n.js', 'js/i18n.js'],
  ['public/js/bgm-volume.js', 'js/bgm-volume.js'],
  ['public/js/mqtt-room-resolve.js', 'js/mqtt-room-resolve.js'],
];

for (const [rel, out] of jsPairs) {
  const from = path.join(ROOT, rel);
  if (!fs.existsSync(from)) {
    console.error('missing', from);
    process.exit(1);
  }
  copyFile(from, path.join(MOBILE_WWW, out));
}

cpDir(path.join(ROOT, 'public', 'i18n'), I18N_OUT);
copyFile(
  path.join(ROOT, 'public', 'css', 'style.css'),
  path.join(MOBILE_WWW, 'css', 'style.css')
);

const socketCandidates = [
  path.join(ROOT, 'node_modules', 'socket.io-client', 'dist', 'socket.io.min.js'),
  path.join(ROOT, 'node_modules', 'socket.io', 'client-dist', 'socket.io.min.js'),
];
const socketSrc = socketCandidates.find((p) => fs.existsSync(p));
if (!socketSrc) {
  console.error('missing socket.io client — run npm install in project root');
  process.exit(1);
}
copyFile(socketSrc, path.join(VENDOR_OUT, 'socket.io.min.js'));

const mqttCandidates = [
  path.join(MOBILE_WWW, 'vendor', 'mqtt.min.js'),
  path.join(ROOT, 'node_modules', 'mqtt', 'dist', 'mqtt.min.js'),
];
const mqttSrc = mqttCandidates.find((p) => fs.existsSync(p));
if (mqttSrc) {
  copyFile(mqttSrc, path.join(VENDOR_OUT, 'mqtt.min.js'));
}

const gamesSrc = path.join(ROOT, 'public', 'games');
const gamesOut = path.join(MOBILE_WWW, 'games');
if (fs.existsSync(gamesSrc)) {
  cpDir(gamesSrc, gamesOut);
  console.log('[sync] games/');
}

try {
  const { listGames } = require(path.join(ROOT, 'server', 'games'));
  fs.writeFileSync(
    path.join(MOBILE_WWW, 'games-info.json'),
    JSON.stringify({ games: listGames() }, null, 2),
    'utf8'
  );
  console.log('[sync] games-info.json');
} catch (err) {
  console.error('games-info.json failed', err);
  process.exit(1);
}

const playSrc = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const playHtml = playSrc
  .replace('<html lang="zh-CN">', '<html lang="zh-CN" data-mobile-play="1">')
  .replace(
    '<title data-i18n="app.pageTitle">联机大厅</title>',
    '<title>联机对局</title>'
  )
  .replace('href="/favicon.svg"', 'href="./favicon.svg"')
  .replace('href="/css/style.css"', 'href="./css/style.css"')
  .replace(
    /\(function \(\) \{\s*try \{\s*var q = new URLSearchParams\(location\.search[\s\S]*?\}\)\(\);/,
    `(function () {
      try {
        document.documentElement.classList.add('boot-joining');
        document.documentElement.dataset.mobilePlay = '1';
      } catch (e) {}
    })();`
  )
  .replace(
    /<script src="\/socket\.io\/socket\.io\.js"><\/script>[\s\S]*?<script src="\/js\/ui\.js"><\/script>/,
    `<link rel="stylesheet" href="./mobile.css" />
  <script src="./vendor/socket.io.min.js"></script>
  <script src="./vendor/mqtt.min.js"></script>
  <script src="./js/i18n.js"></script>
  <script src="./js/bgm-volume.js"></script>
  <script src="./js/mqtt-room-resolve.js"></script>
  <script src="./js/client.js"></script>
  <script src="./js/boot-games.js"></script>
  <script src="./js/ui.js"></script>`
  );

fs.writeFileSync(path.join(MOBILE_WWW, 'play.html'), playHtml, 'utf8');
console.log('[sync] play.html');
