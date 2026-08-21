'use strict';
const fs = require('fs');
const f = 'public/js/ui.js';
let s = fs.readFileSync(f, 'utf8');

function rep(a, b, label) {
  if (!s.includes(a)) {
    console.log('MISS', label || a.slice(0, 50));
    return false;
  }
  s = s.split(a).join(b);
  return true;
}

rep(
  "if (room.local) return '本机';",
  "if (room.local) return t('room.viaLocal');",
  'viaLocal'
);
rep(
  "return viaRaw.includes('mqtt') ? '公网隧道' : '远端';",
  "return viaRaw.includes('mqtt') ? t('room.viaMqtt') : t('room.viaRemote');",
  'viaMqtt'
);
rep(
  '`${availableCount} / ${total} 可用`',
  "t('lobby.peopleAvail', { available: availableCount, total })",
  'avail'
);

const gomokuOld = `        \`黑：\${blackId ? playerNameById(blackId) : '—'}　白：\${
          whiteId ? playerNameById(whiteId) : '—'
        }\` + (my === 1 ? '　你是黑棋' : my === 2 ? '　你是白棋' : '');`;
const gomokuNew = `        t('gomoku.sides', {
          black: blackId ? playerNameById(blackId) : t('common.dash'),
          white: whiteId ? playerNameById(whiteId) : t('common.dash'),
        }) +
          (my === 1
            ? '　' + t('gomoku.youBlack')
            : my === 2
              ? '　' + t('gomoku.youWhite')
              : '');`;
rep(gomokuOld, gomokuNew, 'gomoku sides');

rep("if (game.draw) el.gameStatus.textContent = '平局';", "if (game.draw) el.gameStatus.textContent = t('gomoku.draw');", 'draw');
rep('? `你赢了！（连成五子）`', "? t('gomoku.youWin')", 'youWin');
rep(": `${winName} 获胜`;", ": t('gomoku.win', { name: winName });", 'win');
rep("} else el.gameStatus.textContent = '对局结束';", "} else el.gameStatus.textContent = t('gomoku.ended');", 'ended');
rep("? '轮到你落子'", "? t('gomoku.yourTurn')", 'yourTurn');
rep(
  ': `等待 ${playerNameById(game.currentPlayerId)} 落子`;',
  ": t('gomoku.waitNamed', { name: playerNameById(game.currentPlayerId) });",
  'wait'
);

rep("|| '无法连接房主'", "|| t('toast.connectHostFail')", 'host');
rep("|| '加入失败'", "|| t('toast.joinFail')", 'joinFail');
rep("|| '创建房间失败'", "|| t('toast.createFail')", 'createFail');
rep("|| '未找到房间'", "|| t('toast.roomNotFound')", 'notFound');
rep("|| '当前不可用'", "|| t('toast.unavailable')", 'unavail');
rep("|| '返回本地大厅失败'", "|| t('toast.backLocalFail')", 'back');
rep("|| '自动进入大厅失败，请手动进入'", "|| t('toast.autoLobbyFail')", 'auto');
rep("|| '连接本地服务失败'", "|| t('toast.localFail')", 'local');
rep("|| '重连失败'", "|| t('toast.rejoinFail')", 'rejoinFail');
rep("|| '房间错误'", "|| t('toast.roomError')", 'roomErr');
rep("|| '操作失败'", "|| t('toast.opFail')", 'op');
rep("|| '发送失败'", "|| t('toast.sendFail')", 'send');
rep("|| '有玩家'", "|| t('toast.someone')", 'someone');

rep(
  "bounceToLocalLobby('房间已失效，已返回大厅')",
  "bounceToLocalLobby(t('toast.roomInvalid'))",
  'invalid'
);
rep(
  "bounceToLocalLobby('房间已解散，已返回大厅')",
  "bounceToLocalLobby(t('toast.roomClosed'))",
  'closed'
);
rep(
  "bounceToLocalLobby('已退出对局，返回大厅')",
  "bounceToLocalLobby(t('toast.quitBack'))",
  'quit'
);
rep(
  "err && err.message ? err.message : '房间已失效，已返回大厅'",
  "err && err.message ? err.message : t('toast.roomInvalid')",
  'invalid2'
);

rep(
  `          ? '对局进行中'
          : roomStatus === 'waiting'
            ? '房间等待中'
            : '房间仍在';`,
  `          ? t('toast.rejoinPlaying')
          : roomStatus === 'waiting'
            ? t('toast.rejoinWaiting')
            : t('toast.rejoinStill');`,
  'rejoin status'
);

// rejoin message template
const rejoinMsgOld = `el.rejoinMessage.textContent = \`检测到你曾在房间「\${
          (data && data.roomName) || (data && data.roomId) || ''
        }」\${statusText}，是否重新加入？\`;`;
// try looser match
if (s.includes('检测到你曾在房间')) {
  s = s.replace(
    /el\.rejoinMessage\.textContent = `检测到你曾在房间「\$\{[\s\S]*?\}」\$\{statusText\}，是否重新加入？`;/,
    "el.rejoinMessage.textContent = t('toast.rejoinMsg', {\n          name: (data && data.roomName) || (data && data.roomId) || '',\n          status: statusText,\n        });"
  );
  console.log('rejoin msg patched');
} else console.log('MISS rejoin msg');

if (s.includes("showToast(`${name} 已离开对局`)")) {
  s = s.replace(
    "showToast(`${name} 已离开对局`)",
    "showToast(t('toast.playerLeftGame', { name }))"
  );
  console.log('left game patched');
}

if (s.includes("showToast(`已进入房间「${data.room.name || data.room.id}」`)")) {
  s = s.replace(
    "showToast(`已进入房间「${data.room.name || data.room.id}」`)",
    "showToast(t('room.enteredNamed', { name: data.room.name || data.room.id }))"
  );
  console.log('entered patched');
}

// peers render
if (s.includes("'在线：暂未发现其他实例（双方需保持心跳）'")) {
  s = s.replace(
    "'在线：暂未发现其他实例（双方需保持心跳）'",
    "t('lobby.peersNoneKeepAlive')"
  );
  s = s.replace(
    "'广播：MQTT 未启用，无法跨实例联机'",
    "t('lobby.peersMqttOff')"
  );
  console.log('peers patched');
}

fs.writeFileSync(f, s, 'utf8');
console.log('wrote');
