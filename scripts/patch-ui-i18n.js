'use strict';
const fs = require('fs');
const file = 'public/js/ui.js';
let s = fs.readFileSync(file, 'utf8');

const reps = [
  [/el\.chatHeadUnread\.textContent = '新消息';/g, "el.chatHeadUnread.textContent = t('chat.newMessage');"],
  [/state\.chatChannel === 'room' \? '房间内暂无消息' : '还没有人发言'/g, "state.chatChannel === 'room' ? t('chat.emptyRoom') : t('chat.empty')"],
  [/state\.chatChannel === 'room' \? '房间频道…' : '所有人…'/g, "state.chatChannel === 'room' ? t('chat.placeholderRoom') : t('chat.placeholderAll')"],
  [/state\.chatChannel === 'room' \? '房间' : '所有人'/g, "state.chatChannel === 'room' ? t('chat.channelRoom') : t('chat.channelAll')"],
  [/message \|\| \(mode === 'create' \? '创建中…' : '进入房间中…'\)/g, "message || (mode === 'create' ? t('create.creating') : t('create.joining'))"],
  [/showToast\(was === 'create' \? '创建房间超时，请重试' : '进入房间超时，请重试'\);/g, "showToast(was === 'create' ? t('create.createTimeout') : t('create.joinTimeout'));"],
  [/showRoomBusy\('join', '进入房间中…'\);/g, "showRoomBusy('join', t('create.joining'));"],
  [/el\.meLabel\.textContent = '未进入大厅';/g, "el.meLabel.textContent = t('app.notInLobby');"],
  [/const remote = net\.isOnRemoteHost\(\) \? '已连到房主' : '本机大厅';/g, "const remote = net.isOnRemoteHost() ? t('app.connectedHost') : t('app.localLobby');"],
  [/const st = state\.room\.status === 'playing' \? '对局中' : '房间内';/g, "const st = state.room.status === 'playing' ? t('app.titleGame') : t('app.inRoom');"],
  [/el\.gameHint\.textContent = '选择游戏后查看人数要求。';/g, "el.gameHint.textContent = t('create.hintDefault');"],
  [/\: \[\{ id: 'standard', label: '标准模式' \}\];/g, ": [{ id: 'standard', label: t('create.modeStandard') }];"],
  [/el\.gameHint\.textContent = '五子棋：双人局，房主执黑先手。';/g, "el.gameHint.textContent = t('create.hintGomoku');"],
  [/el\.gameHint\.textContent =\s*'印加宝藏：3–8 人；同时抉择继续\/返回，全员锁定后才揭晓并结算。';/g, "el.gameHint.textContent = t('create.hintIncanFull');"],
  [/el\.gameHint\.textContent =\s*'卡拉斯坦：2–5 人；生产派遣→拉斯维加斯式抵消结算→建造；先到 10 分获胜。';/g, "el.gameHint.textContent = t('create.hintLasidaoFull');"],
  [/el\.gameHint\.textContent =\s*'三国杀·2V2：4 人交叉座位（1·4 vs 2·3）；队友手牌共享；先 Ban 将再选将。';/g, "el.gameHint.textContent = t('create.hintSgsH2h');"],
  [/el\.gameHint\.textContent =\s*'三国杀·1V2：3 人叫地主；主公有【跋扈】【飞扬】，体力\+1；反贼击杀主公即胜。';/g, "el.gameHint.textContent = t('create.hintSgs1v2');"],
  [/el\.gameHint\.textContent =\s*'三国杀·先主黄巾：5\/8 人；先主 5 选 1、其余 3 选 1；先主体力\+1（后主不加），可传位；黄巾可感染，人数达存活一半（向上取整）时起义（剩 2 人不起义）。';/g, "el.gameHint.textContent = t('create.hintSgsXianzhu');"],
  [/el\.gameHint\.textContent =\s*'三国杀·标准身份：5\/8 人满员开局；主公亮明且 5 选 1，其余角色 3 选 1；主公体力\+1。';/g, "el.gameHint.textContent = t('create.hintSgsIdentity');"],
  [/btn\.textContent = '加入';/g, "btn.textContent = t('lobby.join');"],
  [/btn\.title = '房间已满员';/g, "btn.title = t('lobby.roomFull');"],
  [/if \(person\.status === 'offline'\) return '离线';/g, "if (person.status === 'offline') return t('lobby.statusOffline');"],
  [/if \(person\.status === 'playing'\) return '对局中';/g, "if (person.status === 'playing') return t('lobby.statusPlaying');"],
  [/return person\.roomName \? `房间：\$\{person\.roomName\}` : '房间中';/g, "return person.roomName ? t('lobby.statusInRoomNamed', { name: person.roomName }) : t('lobby.statusInRoom');"],
  [/return '空闲';/g, "return t('lobby.statusIdle');"],
  [/if \(person\.status === 'offline'\) joinReason = '对方已离线';/g, "if (person.status === 'offline') joinReason = t('lobby.reasonOffline');"],
  [/else if \(isMe\) joinReason = '不能加入自己的房间';/g, "else if (isMe) joinReason = t('lobby.reasonSelf');"],
  [/else if \(state\.room\) joinReason = '请先离开当前房间';/g, "else if (state.room) joinReason = t('lobby.reasonLeaveFirst');"],
  [/joinReason = '对方不在房间中';/g, "joinReason = t('lobby.reasonNotInRoom');"],
  [/if \(theirRoom && isRoomFull\(theirRoom\)\) joinReason = '房间已满员';/g, "if (theirRoom && isRoomFull(theirRoom)) joinReason = t('lobby.reasonFull');"],
  [/hint\.textContent = actions\.joinReason \|\| '暂无可用操作';/g, "hint.textContent = actions.joinReason || t('lobby.noActions');"],
  [/right\.textContent = isHost \? '房主' : '已入座';/g, "right.textContent = isHost ? t('room.host') : t('room.seated');"],
  [/showToast\('房间已满员'\);/g, "showToast(t('toast.roomFull'));"],
  [/showToast\('请输入房间码'\);/g, "showToast(t('toast.needCode'));"],
  [/showRoomBusy\('create', '创建中…'\);/g, "showRoomBusy('create', t('create.creating'));"],
  [/showToast\('跨网默认使用 MQTT 广播，无需填写地址'\);/g, "showToast(t('lobby.mqttHint'));"],
  [/updateRoomBusyMessage\(\(data && data\.message\) \|\| '创建中…'\);/g, "updateRoomBusyMessage((data && data.message) || t('create.creating'));"],
  [/showToast\('连接中断，正在重连…'\);/g, "showToast(t('toast.reconnect'));"],
  [/showToast\('与服务器断开连接'\);/g, "showToast(t('toast.disconnected'));"],
  [/showToast\('正在刷新大厅…'\);/g, "showToast(t('lobby.refreshing'));"],
  [/showToast\('正在刷新大厅状态…'\);/g, "showToast(t('lobby.refreshingPeople'));"],
  [/showToast\('已取消重连，留在大厅'\);/g, "showToast(t('toast.rejoinCancel'));"],
  [/showToast\('正在重新加入对局…'\);/g, "showToast(t('toast.rejoining'));"],
  [/showToast\('已重新加入对局'\);/g, "showToast(t('toast.rejoined'));"],
  [/showToast\('重连失败：未能回到原座位'\);/g, "showToast(t('toast.rejoinSeatFail'));"],
  [/showToast\('缺少本地座位记录，无法强匹配重连'\);/g, "showToast(t('toast.needSeat'));"],
  [/showToast\('昵称已更新'\);/g, "showToast(t('toast.nickUpdated'));"],
  [/showToast\('公网隧道中断，正在查找新地址…'\);/g, "showToast(t('toast.tunnelLost'));"],
  [/showToast\('已找到新隧道，正在回到对局…'\);/g, "showToast(t('toast.tunnelFound'));"],
  [/showToast\('已重新连上对局'\);/g, "showToast(t('toast.tunnelBack'));"],
  [/showToast\('连接异常，正在恢复对局…'\);/g, "showToast(t('toast.recovering'));"],
  [/ \|\| '玩家'/g, " || t('app.playerDefault')"],
  [/ \|\| '玩家'/g, " || t('app.playerDefault')"],
];

let n = 0;
for (const [re, to] of reps) {
  const before = s;
  s = s.replace(re, to);
  if (s !== before) n++;
  else console.log('MISS', String(re).slice(0, 60));
}
console.log('applied', n, 'of', reps.length);

// more careful replacements
const more = [
  [
    "el.gameHint.textContent = `${g.label}：${g.minPlayers}–${g.maxPlayers} 人`;",
    "el.gameHint.textContent = t('create.hintRange', { label: gameLabelOf(g.id, g.label), min: g.minPlayers, max: g.maxPlayers });",
  ],
  [
    "opt.textContent = `${g.label}（${g.minPlayers}–${g.maxPlayers}人）`;",
    "opt.textContent = t('create.gameOption', { label: gameLabelOf(g.id, g.label), min: g.minPlayers, max: g.maxPlayers });",
  ],
  [
    "opt.textContent = m.label;",
    "opt.textContent = modeLabelOf(m.id, m.label);",
  ],
  [
    "const gameLabel = room.gameLabel || room.gameType || '游戏';",
    "const gameLabel = gameLabelOf(room.gameType, room.gameLabel || room.gameType || t('room.gameFallback'));",
  ],
  [
    "return playerHasLeft(id) ? `${name}（已离开）` : name;",
    "return playerHasLeft(id) ? t('app.playerLeft', { name }) : name;",
  ],
  [
    "if (room.local) return '本机';\n    return viaRaw.includes('mqtt') ? '公网隧道' : '远端';",
    "if (room.local) return t('room.viaLocal');\n    return viaRaw.includes('mqtt') ? t('room.viaMqtt') : t('room.viaRemote');",
  ],
  [
    "return n > 0 ? `${n}秒` : '不限';",
    "return n > 0 ? t('common.sec', { n }) : t('common.unlimited');",
  ],
  [
    "el.roomStartHint.textContent = `至少 ${min} 人即可开始（当前 ${room.players.length}/${room.maxPlayers}）。人齐后房主可直接开局。`;",
    "el.roomStartHint.textContent = t('room.startHintCount', { min, cur: room.players.length, max: room.maxPlayers });",
  ],
  [
    "(isMe ? ' <span class=\"you\">(你)</span>' : '') +",
    "(isMe ? ' <span class=\"you\">(' + t('common.you') + ')</span>' : '') +",
  ],
  [
    "(isHost ? ' <span class=\"badge\">房主</span>' : '');",
    "(isHost ? ' <span class=\"badge\">' + t('room.host') + '</span>' : '');",
  ],
  [
    "` · 思考${formatTurnTime(room.turnTimeSec)}`",
    "t('room.turnThink', { time: formatTurnTime(room.turnTimeSec) })",
  ],
  [
    "`?${availableCount} / ${total} 可用`",
    "t('lobby.peopleAvail', { available: availableCount, total })",
  ],
];

// fix people avail - check actual string
for (const [a, b] of more) {
  if (s.includes(a)) {
    s = s.split(a).join(b);
    n++;
  } else {
    console.log('MISS2', a.slice(0, 70));
  }
}

fs.writeFileSync(file, s, 'utf8');
console.log('done, total hits ~', n);
