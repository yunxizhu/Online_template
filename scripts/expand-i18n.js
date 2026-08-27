'use strict';
/**
 * Expand i18n packs with lobby/ui runtime strings, then patch public/js/ui.js
 * to call I18n.t for display text.
 */
const fs = require('fs');
const path = require('path');

const extraZh = {
  'app.localLobby': '本机大厅',
  'app.connectedHost': '已连到房主',
  'app.inRoom': '房间内',
  'app.playerLeft': '{name}（已离开）',
  'chat.placeholderAll': '所有人…',
  'chat.placeholderRoom': '房间频道…',
  'create.hintIncanFull':
    '印加宝藏：3–8 人；同时抉择继续/返回，全员锁定后才揭晓并结算。',
  'create.hintLasidaoFull':
    '卡拉斯坦：2–5 人；生产派遣→拉斯维加斯式抵消结算→建造；先到 10 分获胜。',
  'create.hintSgsH2h':
    '三国杀·2V2：4 人交叉座位（1·4 vs 2·3）；队友手牌共享；先 Ban 将再选将。',
  'create.hintSgs1v2':
    '三国杀·1V2：3 人叫地主；主公有【跋扈】【飞扬】，体力+1；反贼击杀主公即胜。',
  'create.hintSgsXianzhu':
    '三国杀·先主黄巾：5/8 人；先主 5 选 1、其余 3 选 1；先主体力+1（后主不加），可传位；黄巾可感染，人数达存活一半（向上取整）时起义（剩 2 人不起义）。',
  'create.hintSgsIdentity':
    '三国杀·标准身份：5/8 人满员开局；主公亮明且 5 选 1，其余角色 3 选 1；主公体力+1。',
  'create.hintRange': '{label}：{min}–{max} 人',
  'create.gameOption': '{label}（{min}–{max}人）',
  'lobby.join': '加入',
  'lobby.roomFull': '房间已满员',
  'lobby.peersNoneKeepAlive': '在线：暂未发现其他实例（双方需保持心跳）',
  'lobby.peersMqttOff': '广播：MQTT 未启用，无法跨实例联机',
  'lobby.peersFound': '在线：发现 {n} 个实例',
  'lobby.peersFoundWith': '在线：发现 {n} 个实例（{bits}）',
  'lobby.broadcastN': '广播 {n}',
  'lobby.statusOffline': '离线',
  'lobby.statusPlaying': '对局中',
  'lobby.statusInRoomNamed': '房间：{name}',
  'lobby.statusInRoom': '房间中',
  'lobby.statusIdle': '空闲',
  'lobby.reasonOffline': '对方已离线',
  'lobby.reasonSelf': '不能加入自己的房间',
  'lobby.reasonLeaveFirst': '请先离开当前房间',
  'lobby.reasonNotInRoom': '对方不在房间中',
  'lobby.reasonFull': '房间已满员',
  'lobby.noActions': '暂无可用操作',
  'lobby.peopleAvail': '{available} / {total} 可用',
  'lobby.refreshing': '正在刷新大厅…',
  'lobby.refreshingPeople': '正在刷新大厅状态…',
  'lobby.mqttHint': '跨网默认使用 MQTT 广播，无需填写地址',
  'room.turnThink': ' · 思考{time}',
  'room.seated': '已入座',
  'room.startHintCount':
    '至少 {min} 人即可开始（当前 {cur}/{max}）。人齐后房主可直接开局。',
  'room.enteredNamed': '已进入房间「{name}」',
  'room.viaLocal': '本机',
  'room.viaMqtt': '公网隧道',
  'room.viaRemote': '远端',
  'room.gameFallback': '游戏',
  'gomoku.youBlack': '你是黑棋',
  'gomoku.youWhite': '你是白棋',
  'gomoku.sides': '黑：{black}　白：{white}',
  'gomoku.youWin': '你赢了！（连成五子）',
  'gomoku.ended': '对局结束',
  'gomoku.waitNamed': '等待 {name} 落子',
  'toast.nickUpdated': '昵称已更新',
  'toast.roomFull': '房间已满员',
  'toast.joinFail': '加入失败',
  'toast.createFail': '创建房间失败',
  'toast.needCode': '请输入房间码',
  'toast.roomNotFound': '未找到房间',
  'toast.connectHostFail': '无法连接房主',
  'toast.dnsHint': '{base}（若持续失败，请以管理员身份运行 修复DNS.bat 后重开浏览器）',
  'toast.backLocalFail': '返回本地大厅失败',
  'toast.autoLobbyFail': '自动进入大厅失败，请手动进入',
  'toast.rejoinPlaying': '对局进行中',
  'toast.rejoinWaiting': '房间等待中',
  'toast.rejoinStill': '房间仍在',
  'toast.rejoinMsg': '检测到你曾在房间「{name}」{status}，是否重新加入？',
  'toast.needSeat': '缺少本地座位记录，无法强匹配重连',
  'toast.rejoining': '正在重新加入对局…',
  'toast.rejoined': '已重新加入对局',
  'toast.rejoinSeatFail': '重连失败：未能回到原座位',
  'toast.rejoinFail': '重连失败',
  'toast.rejoinCancel': '已取消重连，留在大厅',
  'toast.localFail': '连接本地服务失败',
  'toast.unavailable': '当前不可用',
  'toast.roomInvalid': '房间已失效，已返回大厅',
  'toast.roomClosed': '房间已解散，已返回大厅',
  'toast.recovering': '连接异常，正在恢复对局…',
  'toast.roomError': '房间错误',
  'toast.opFail': '操作失败',
  'toast.sendFail': '发送失败',
  'toast.playerLeftGame': '{name} 已离开对局',
  'toast.someone': '有玩家',
  'toast.quitBack': '已退出对局，返回大厅',
  'toast.tunnelLost': '公网隧道中断，正在查找新地址…',
  'toast.tunnelFound': '已找到新隧道，正在回到对局…',
  'toast.tunnelBack': '已重新连上对局',
  'toast.reconnect': '连接中断，正在重连…',
  'toast.disconnected': '与服务器断开连接',
  'toast.wsErrorHint':
    '{base}（若持续失败，请以管理员身份运行 修复DNS.bat 后重开浏览器）',
  'common.sec': '{n}秒',
  'common.unlimited': '不限',
};

const extraEn = {
  'app.localLobby': 'Local lobby',
  'app.connectedHost': 'Connected to host',
  'app.inRoom': 'In room',
  'app.playerLeft': '{name} (left)',
  'chat.placeholderAll': 'Everyone…',
  'chat.placeholderRoom': 'Room channel…',
  'create.hintIncanFull':
    'Incan Gold: 3–8 players; choose together, reveal after all lock.',
  'create.hintLasidaoFull':
    'Kalastan: 2–5 players; produce → cancel settle → build; first to 10 wins.',
  'create.hintSgsH2h': 'Sanguosha 2v2: 4 players, shared teammate hands, ban then pick.',
  'create.hintSgs1v2': 'Sanguosha 1v2: 3 players, landlord mode.',
  'create.hintSgsXianzhu': 'Sanguosha Xianzhu mode: 5/8 players.',
  'create.hintSgsIdentity': 'Sanguosha identity: 5/8 players, lord revealed.',
  'create.hintRange': '{label}: {min}–{max} players',
  'create.gameOption': '{label} ({min}–{max})',
  'lobby.join': 'Join',
  'lobby.roomFull': 'Room is full',
  'lobby.peersNoneKeepAlive': 'Online: no other instances (keep heartbeats)',
  'lobby.peersMqttOff': 'Broadcast: MQTT off, cannot link instances',
  'lobby.peersFound': 'Online: {n} instance(s)',
  'lobby.peersFoundWith': 'Online: {n} instance(s) ({bits})',
  'lobby.broadcastN': 'broadcast {n}',
  'lobby.statusOffline': 'Offline',
  'lobby.statusPlaying': 'In game',
  'lobby.statusInRoomNamed': 'Room: {name}',
  'lobby.statusInRoom': 'In a room',
  'lobby.statusIdle': 'Idle',
  'lobby.reasonOffline': 'They are offline',
  'lobby.reasonSelf': 'Cannot join your own room',
  'lobby.reasonLeaveFirst': 'Leave your current room first',
  'lobby.reasonNotInRoom': 'They are not in a room',
  'lobby.reasonFull': 'Room is full',
  'lobby.noActions': 'No actions available',
  'lobby.peopleAvail': '{available} / {total} available',
  'lobby.refreshing': 'Refreshing lobby…',
  'lobby.refreshingPeople': 'Refreshing lobby status…',
  'lobby.mqttHint': 'Cross-network uses MQTT by default; no address needed',
  'room.turnThink': ' · think {time}',
  'room.seated': 'Seated',
  'room.startHintCount':
    'Need at least {min} (now {cur}/{max}). Host can start when ready.',
  'room.enteredNamed': 'Entered room “{name}”',
  'room.viaLocal': 'Local',
  'room.viaMqtt': 'Public tunnel',
  'room.viaRemote': 'Remote',
  'room.gameFallback': 'Game',
  'gomoku.youBlack': 'You are Black',
  'gomoku.youWhite': 'You are White',
  'gomoku.sides': 'Black: {black}  White: {white}',
  'gomoku.youWin': 'You win! (five in a row)',
  'gomoku.ended': 'Game over',
  'gomoku.waitNamed': 'Waiting for {name}',
  'toast.nickUpdated': 'Nickname updated',
  'toast.roomFull': 'Room is full',
  'toast.joinFail': 'Join failed',
  'toast.createFail': 'Create failed',
  'toast.needCode': 'Enter a room code',
  'toast.roomNotFound': 'Room not found',
  'toast.connectHostFail': 'Cannot reach host',
  'toast.dnsHint': '{base} (if it persists, run FixDNS.bat as admin)',
  'toast.backLocalFail': 'Failed to return to local lobby',
  'toast.autoLobbyFail': 'Auto-enter lobby failed; please enter manually',
  'toast.rejoinPlaying': 'Game in progress',
  'toast.rejoinWaiting': 'Waiting in room',
  'toast.rejoinStill': 'Room still open',
  'toast.rejoinMsg': 'You were in room “{name}” ({status}). Rejoin?',
  'toast.needSeat': 'Missing seat record; cannot hard-match reconnect',
  'toast.rejoining': 'Rejoining game…',
  'toast.rejoined': 'Rejoined',
  'toast.rejoinSeatFail': 'Reconnect failed: seat not restored',
  'toast.rejoinFail': 'Reconnect failed',
  'toast.rejoinCancel': 'Cancelled; staying in lobby',
  'toast.localFail': 'Failed to connect local server',
  'toast.unavailable': 'Unavailable',
  'toast.roomInvalid': 'Room invalid; back to lobby',
  'toast.roomClosed': 'Room closed; back to lobby',
  'toast.recovering': 'Connection issue; recovering…',
  'toast.roomError': 'Room error',
  'toast.opFail': 'Action failed',
  'toast.sendFail': 'Send failed',
  'toast.playerLeftGame': '{name} left the game',
  'toast.someone': 'A player',
  'toast.quitBack': 'Left game; back to lobby',
  'toast.tunnelLost': 'Tunnel lost; searching new address…',
  'toast.tunnelFound': 'New tunnel found; returning…',
  'toast.tunnelBack': 'Reconnected to game',
  'toast.reconnect': 'Disconnected; reconnecting…',
  'toast.disconnected': 'Disconnected from server',
  'toast.wsErrorHint': '{base} (if it persists, run FixDNS.bat as admin)',
  'common.sec': '{n}s',
  'common.unlimited': 'Unlimited',
};

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function mergeExtra(base, extra) {
  const out = JSON.parse(JSON.stringify(base));
  for (const [k, v] of Object.entries(extra)) setPath(out, k, v);
  return out;
}

const dir = path.join(__dirname, '..', 'public', 'i18n');
const zh = mergeExtra(JSON.parse(fs.readFileSync(path.join(dir, 'zh.json'), 'utf8')), extraZh);
const en = mergeExtra(JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8')), extraEn);
fs.writeFileSync(path.join(dir, 'zh.json'), JSON.stringify(zh, null, 2), 'utf8');
fs.writeFileSync(path.join(dir, 'en.json'), JSON.stringify(en, null, 2), 'utf8');
console.log('merged extras into packs');
