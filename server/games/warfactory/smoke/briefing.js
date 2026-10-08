'use strict';

/**
 * 战前选图冒烟测试：node server/games/warfactory/smoke/briefing.js
 *
 * 覆盖「正式进游戏后先停在战前状态，由房主挑地图」这件事（任务 #49 / #50）：
 *   ① 开局停在 briefing：一帧都不推进，带一份能当预览用的战前信息（含缩略图）；
 *   ② 目录能拉出来（每张图带缩略图 / 人数 / 尺寸），非房主也看得见；
 *   ③ 「再随机一张」真的换了一张（seq 递进、地形跟着变）；
 *   ④ 挑一张存档地图 → 局面按它重建，mode 从 random 变 file；
 *   ⑤ 只有房主能换图 / 拍板；
 *   ⑥ 拍板 → 退出战前、起倒计时，之后再调就报「选图阶段已结束」。
 *
 * 不走 socket：直接调 RoomManager 的同名方法（与 editor.js 同一套套路）。
 */

const fs = require('fs');
const path = require('path');
const mod = require('..');
const roomsMod = require('../../../rooms.js');

const { RoomManager } = roomsMod;
const { maps: WFMaps, blankMap } = mod;
const tick = mod.__test.tick;

let failed = 0;
let passed = 0;

function ok(cond, label) {
  if (cond) {
    passed += 1;
    console.log('  ✓ ' + label);
  } else {
    failed += 1;
    console.error('  ✗ ' + label);
  }
}

function section(title) {
  console.log('\n— ' + title + ' —');
}

/** 造一个两人房（房主 h + 客人 g），返回 { mgr, room } */
function makeRoom(maxPlayers) {
  const mgr = new RoomManager();
  mgr.registerPlayer('h', '房主');
  mgr.registerPlayer('g', '客人');
  const created = mgr.createRoom('h', {
    name: '战前房',
    gameType: 'warfactory',
    maxPlayers: maxPlayers || 2,
  });
  if (!created.ok) throw new Error('建房间失败：' + created.error);
  mgr.joinRoom('g', created.room.id);
  return { mgr, room: mgr.getRoom(created.room.id) };
}

/** 落一张能当存档用的图（白图 + 名字），用完记得删 */
function writeTempMap(name, file) {
  const wr = WFMaps.writeMap(
    Object.assign({}, blankMap(2), { name: name }),
    file,
    { overwrite: true }
  );
  return wr;
}

/** 地形指纹：拿它判断「换图后确实不是同一张」 */
function gridKey(game) {
  const g = game.terrain && game.terrain.grid;
  if (!g) return '';
  let h = 0;
  for (let r = 0; r < g.length; r += 13) {
    for (let c = 0; c < g[r].length; c += 13) {
      h = (h * 31 + (g[r][c] | 0)) | 0;
    }
  }
  return String(h);
}

/* ================= ① 开局停在战前 ================= */

section('① 普通开局 → 停在战前状态（briefing）');
{
  const { mgr, room } = makeRoom(2);
  const st = mgr.startGame('h');
  ok(st.ok, '满员可以开局（' + (st.error || 'ok') + '）');
  const g = room.game;
  ok(g && g.phase === 'briefing', '开局停在 briefing（实到 ' + (g && g.phase) + '）');
  ok(g && g.paused === true, '战前是暂停的');
  ok(g && !g.editor, '战前不是编辑态（editor 必须是 false）');
  ok(g && Boolean(g.briefing), '带一份战前信息');

  const b = g && g.briefing;
  ok(b && b.mode === 'random', '没指定图 → 模式是「随机」（实到 ' + (b && b.mode) + '）');
  ok(b && b.hostId === 'h', '战前信息记着房主是谁');
  ok(b && b.seats === 2, '座位数字段存在（实到 ' + (b && b.seats) + '）');
  ok(b && b.thumb && b.thumb.rows > 0 && b.thumb.cols > 0, '随机图也有预览缩略图');
  ok(
    b && b.thumb && typeof b.thumb.data === 'string' && b.thumb.data.length === b.thumb.rows * b.thumb.cols,
    '缩略图数据一格一个字符（' + (b && b.thumb ? b.thumb.data.length : 0) + ' 个）'
  );
  ok(b && Array.isArray(b.thumb.pins) && b.thumb.pins.length > 0, '缩略图上标出了建筑落点');
  ok(b && b.counts && b.counts.factories > 0, '战前信息带着建筑统计（工厂 ' + (b && b.counts.factories) + '）');

  // 一帧都不推进：tick 对「暂停 / briefing」一律返回 false 且不跑 step
  // （seq 是照常 +1 的 —— 那只是催客户端刷新的记号，不是模拟推进）
  const pos = g.units.map((u) => u.x.toFixed(3) + ',' + u.y.toFixed(3)).join('|');
  const hp = g.units.map((u) => u.hp.toFixed(3)).join('|');
  let advanced = false;
  for (let i = 0; i < 5; i++) if (tick(g) !== false) advanced = true;
  ok(!advanced, '战前阶段 tick 一律返回 false（不推进模拟）');
  ok(g.units.map((u) => u.x.toFixed(3) + ',' + u.y.toFixed(3)).join('|') === pos, '战前阶段部队一步都不动');
  ok(g.units.map((u) => u.hp.toFixed(3)).join('|') === hp, '战前阶段不掉血（总部防卫也不开火）');
  ok(g.phase === 'briefing', '战前阶段不会自己跳到下一阶段');
}

/* ================= ② 目录 ================= */

section('② 地图目录：每张图带预览，谁都看得见');
{
  const wr = writeTempMap('战前测试图', 'smoke-briefing-map.json');
  ok(wr.ok, '有一张现成的存档地图');

  const { mgr, room } = makeRoom(2);
  mgr.startGame('h');
  const list = mgr.briefingMapList('g', 56);
  ok(list.ok, '非房主也能拉目录（看得到才谈得上"这把打哪张"）');
  ok(Array.isArray(list.maps) && list.maps.length >= 1, '目录里有图（' + (list.maps || []).length + ' 张）');
  const m0 = list.maps && list.maps.find((m) => m.file === wr.file);
  ok(Boolean(m0), '刚才存的那张在目录里');
  ok(m0 && m0.thumb && m0.thumb.rows > 0, '目录里的图带缩略图');
  ok(m0 && m0.players === 2, '目录里的图带着人数（' + (m0 && m0.players) + '）');
  ok(m0 && m0.name === '战前测试图', '名字就是存的时候那个（' + (m0 && m0.name) + '）');
  ok(list.briefing && list.briefing.mode === 'random', '顺带返回当前这份战前信息');

  // 人数对不上的时候要提示（图是 2 人图、房间 3 人座）
  const big = makeRoom(3);
  big.mgr.registerPlayer('g3', '三号');
  big.mgr.joinRoom('g3', big.room.id);
  big.mgr.startGame('h');
  const lb = big.mgr.briefingMapList('h', 56);
  ok(lb.ok, '3 人房也能拉目录');
  ok(lb.briefing && lb.briefing.seats === 3, '战前信息里的座位数跟着房间走');

  WFMaps.removeMap(wr.file);
  ok(!WFMaps.readMap(wr.file), '测试图用完就删');
}

/* ================= ③ 再随机一张 ================= */

section('③ 不满意？再随机一张');
{
  const { mgr, room } = makeRoom(2);
  mgr.startGame('h');
  const g0 = room.game;
  const seq0 = Number(g0.briefingSeq) || 0;
  const key0 = gridKey(g0);
  const seed0 = room.mapSeed;

  const got = mgr.briefingPickMap('h', null);
  ok(got.ok, '房主可以「再随机一张」（' + (got.error || 'ok') + '）');
  ok(room.mapSeed !== seed0, '随机换了新种子（不然摇出来还是同一张）');
  ok(room.mapFile === null, '随机之后房间不再指着某张存档图');
  const g1 = room.game;
  ok((Number(g1.briefingSeq) || 0) > seq0, 'briefingSeq 递进（客户端据此重画预览）');
  ok(g1.phase === 'briefing', '换完图还在战前阶段');
  ok(g1.paused === true, '换完图依然暂停');
  ok(gridKey(g1) !== key0, '地形确实换了一张（不是原图重发）');
  ok(g1.briefing && g1.briefing.mode === 'random', '换完还是随机模式');
  ok(g1.briefing && g1.briefing.thumb && g1.briefing.thumb.rows > 0, '新图也有预览');

  ok(!mgr.briefingPickMap('g', null).ok, '非房主不能换图');
}

/* ================= ④ 挑一张存档图 ================= */

section('④ 挑一张存档地图');
{
  const wr = writeTempMap('挑中的图', 'smoke-briefing-pick.json');
  const { mgr, room } = makeRoom(2);
  mgr.startGame('h');

  const got = mgr.briefingPickMap('h', wr.file);
  ok(got.ok, '房主可以挑一张存档图（' + (got.error || 'ok') + '）');
  ok(room.mapFile === wr.file, '房间记下了挑中的这张');
  const g = room.game;
  ok(g.phase === 'briefing', '挑完还在战前阶段');
  ok(g.briefing && g.briefing.mode === 'file', '模式变成「存档」（实到 ' + (g.briefing && g.briefing.mode) + '）');
  ok(g.briefing && g.briefing.file === wr.file, '战前信息里记着文件名');
  ok(g.briefing && g.briefing.name === '挑中的图', '文件名即地图名（' + (g.briefing && g.briefing.name) + '）');
  ok(g.briefing && g.briefing.thumb && g.briefing.thumb.rows > 0, '挑中的图也有预览');
  ok(Boolean(g.mapFile), '局面自己也记着图（保存时默认还是它）');

  // 不存在的图
  const bad = mgr.briefingPickMap('h', '肯定没有这张.json');
  ok(!bad.ok, '挑一张不存在的图会被拒绝');
  ok(room.mapFile === wr.file, '挑错了不会把原来那张弄丢');
  ok(room.game.phase === 'briefing', '挑错了也不会意外开打');

  // 挑完之后还能再随机回去
  ok(mgr.briefingPickMap('h', null).ok, '挑完还能改主意回到随机');
  ok(room.game.briefing && room.game.briefing.mode === 'random', '回到随机模式');

  WFMaps.removeMap(wr.file);
}

/* ================= ⑤ / ⑥ 拍板 ================= */

section('⑤⑥ 拍板开打：只有房主能按，按完就起倒计时');
{
  const { mgr, room } = makeRoom(2);
  mgr.startGame('h');
  const g = room.game;

  ok(!mgr.briefingConfirm('g').ok, '非房主不能拍板');
  ok(g.phase === 'briefing', '客人乱按不会开打');

  const cf = mgr.briefingConfirm('h');
  ok(cf.ok, '房主可以拍板（' + (cf.error || 'ok') + '）');
  ok(g.phase === 'countdown', '拍板后进入倒计时（实到 ' + g.phase + '）');
  ok(g.paused === false, '拍板后不再是暂停的');
  ok(g.briefing === null, '战前信息已清空（客户端据此收起面板）');
  ok(g._pausePhase === null, '恢复目标也清掉了');
  ok(g.phaseEndsAt > Date.now(), '倒计时有个明确的截止时刻');

  // 倒计时结束后真的开打（tick 走真实时钟，把截止时刻拨到过去即可）
  g.phaseEndsAt = Date.now() - 1;
  tick(g);
  ok(g.phase === 'playing', '倒计时走完进入 playing（实到 ' + g.phase + '）');

  ok(!mgr.briefingConfirm('h').ok, '已经开打就不能再拍板了');
  ok(!mgr.briefingPickMap('h', null).ok, '已经开打就不能再换图了');
  ok(!mgr.briefingMapList('h').ok, '已经开打就不该再拉目录了');
}

/* ================= ⑦ 不支持战前选图的游戏 ================= */

section('⑦ 别的游戏不受影响');
{
  const mgr = new RoomManager();
  mgr.registerPlayer('h', '房主');
  mgr.registerPlayer('g', '客人');
  const created = mgr.createRoom('h', { name: '拉密道', gameType: 'lasidao', maxPlayers: 2 });
  mgr.joinRoom('g', created.room.id);
  mgr.startGame('h');
  const room = mgr.getRoom(created.room.id);
  ok(room.game && room.game.phase !== 'briefing', '非战争工厂不会停在战前（phase = ' + (room.game && room.game.phase) + '）');
  ok(!mgr.briefingMapList('h').ok, '非战争工厂没有战前目录');
  ok(!mgr.briefingConfirm('h').ok, '非战争工厂没有战前拍板');
}

console.log('\n结果：✓ ' + passed + ' / ✗ ' + failed);
process.exit(failed ? 1 : 0);
