'use strict';

/**
 * 地形编辑器冒烟测试：node server/games/warfactory/smoke/editor.js
 *
 * 覆盖三件事（对应任务 #44 / #45 / #47）：
 *   ① 房间不是满员也能走「编辑器开局」，缺位由**占位电脑**补齐；
 *   ② 开局立刻停在 edit 阶段 —— tick 一帧都不推进；
 *   ③ 地图能「导出 → 落盘 → 读回 → 再开局」，且读回来的图与原图逐格一致；
 *   ④ 编辑指令（涂抹 / 建筑 / 单位 / 暂停）真的改到了场上，且暂停开关能来回切。
 */

const fs = require('fs');
const path = require('path');
const mod = require('..');
const roomsMod = require('../../../rooms.js');

const { RoomManager } = roomsMod;

const { applyEditorCommand, takeTerrainChanges, setPaused, exportCurrentMap, maps: WFMaps } = mod;
const __test = mod.__test;
const tick = __test.tick;

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

/** 建一个真房间（不走 socket：直接调 RoomManager 的同名方法） */
function makeEditorRoom(mgr, hostId, maxPlayers, mapFile) {
  mgr.registerPlayer(hostId, '房主');
  const created = mgr.createRoom(hostId, {
    name: '编辑器测试房',
    gameType: 'warfactory',
    maxPlayers,
  });
  if (!created.ok) throw new Error('建房间失败：' + created.error);
  if (mapFile) {
    const pick = mgr.setRoomMap(hostId, mapFile);
    if (!pick.ok) throw new Error('选图失败：' + pick.error);
  }
  return mgr.getRoom(created.room.id);
}

/* ================= ① editor 开局 ================= */

section('① 编辑器开局：填电脑 + 立刻暂停');
{
  const mgr = new RoomManager();
  const room = makeEditorRoom(mgr, 'host1', 4);
  const res = mgr.startEditorGame('host1');
  ok(res.ok, '一个人也能进地形编辑器（' + (res.error || 'ok') + '）');
  if (!res.ok) throw new Error('编辑器开局失败，后续用例无意义');
  ok(res.filledBots === 3, '4 人房间应补齐 3 个占位电脑（实到 ' + res.filledBots + '）');

  const g = room.game;
  const seats = room.players.filter(Boolean);
  ok(seats.length >= 4, '房间座位数 ≥ 4（实到 ' + seats.length + '）');
  ok(
    seats.filter((p) => p.editorDummy).length === 3,
    '占位电脑带 editorDummy 标记（实到 ' + seats.filter((p) => p.editorDummy).length + '）'
  );
  ok(g.players.length === 4, '对局按 4 人摆开（实到 ' + g.players.length + '）');
  ok(g.editor === true, 'game.editor 已置位');
  ok(g.editorOwnerId === 'host1', '编辑者是房主本人');
  ok(g.paused === true && g.phase === 'edit', '开局即暂停（phase = ' + g.phase + '）');
  ok(g.terrain && g.terrain.grid.length === 264, '白图是 264 行');
  ok(g.hqs.length === 4, '4 座总部都在（实到 ' + g.hqs.length + '）');
  ok(g.labs.length === 0, '白图不该带着随机流水线那串研究所（实到 ' + g.labs.length + '）');
  ok(g.factories.length === 0, '白图没有工厂');
  ok(g.units.length > 0, '开局部队已摆好（' + g.units.length + ' 支）');

  // tick 一帧都不推进
  const before = {
    seq: g.seq,
    pos: g.units.map((u) => u.x.toFixed(3) + ',' + u.y.toFixed(3)).join('|'),
    hp: g.units.map((u) => u.hp).join('|'),
  };
  for (let i = 0; i < 30; i++) tick(g);
  const after = {
    seq: g.seq,
    pos: g.units.map((u) => u.x.toFixed(3) + ',' + u.y.toFixed(3)).join('|'),
    hp: g.units.map((u) => u.hp).join('|'),
  };
  ok(after.pos === before.pos, '暂停期间部队一步都没动');
  ok(after.hp === before.hp, '暂停期间没有任何伤害结算');
  ok(after.seq > before.seq, 'seq 照常递增（客户端心跳还要用）');
  ok(g.phase === 'edit', 'tick 之后仍然是 edit 阶段');
}

/* ================= ② 编辑指令 ================= */

section('② 编辑指令：涂抹 / 建筑 / 单位 / 暂停');
{
  const mgr = new RoomManager();
  const room = makeEditorRoom(mgr, 'host2', 2);
  mgr.startEditorGame('host2');
  const g = room.game;
  const cols = g.terrain.cols;
  const idx = (r, c) => r * cols + c;

  ok(!mod.applyEditorCommand(g, { op: 'nope' }), '未知指令不改动任何东西');
  ok(!mod.applyEditorCommand(g, { op: 'paint', cells: [] }), '空的涂抹指令返回 false');

  // 涂一片 6×6 的山
  const cells = [];
  for (let r = 40; r < 46; r++) for (let c = 40; c < 46; c++) cells.push([idx(r, c), 2]);
  ok(mod.applyEditorCommand(g, { op: 'paint', cells }), '涂抹山川返回 true（改动了场上的东西）');
  let allMtn = true;
  for (let r = 40; r < 46; r++) for (let c = 40; c < 46; c++) if (g.terrain.grid[r][c] !== 2) allMtn = false;
  ok(allMtn, '6×6 的山真的落到了格子上');
  ok(!mod.applyEditorCommand(g, { op: 'paint', cells }), '同一笔再涂一次返回 false（没有变化）');

  // 地形分片：长度 = 改动格数 × 2
  const patch = takeTerrainChanges(g);
  ok(Array.isArray(patch) && patch.length === 36 * 2, '地形分片含 36 格（实到 ' + (patch ? patch.length / 2 : 0) + '）');
  ok(takeTerrainChanges(g) === null, '取过一次之后分片就清空了');

  // 擦掉：同样[:,0]格改回平原
  const erase = cells.map((x) => [x[0], 0]);
  ok(mod.applyEditorCommand(g, { op: 'paint', cells: erase }), '擦除也算一次改动');
  let allPlain = true;
  for (let r = 40; r < 46; r++) for (let c = 40; c < 46; c++) if (g.terrain.grid[r][c] !== 0) allPlain = false;
  ok(allPlain, '擦完之后是平原');
  takeTerrainChanges(g);

  // 建筑：新增 / 归属 / 移动 / 删除
  const n0 = g.factories.length;
  ok(mod.applyEditorCommand(g, { op: 'building', kind: 'factory', owner: -1, level: 2, col: 100, row: 100 }), '新增中立二级工厂');
  ok(g.factories.length === n0 + 1, '工厂数 +1');
  const f = g.factories[g.factories.length - 1];
  ok(Math.abs(f.x - 100.5 * 40) < 1 && Math.abs(f.y - 100.5 * 40) < 1, '工厂中心落在格心上');
  ok(f.level === 2 && f.owner === -1, '等级 / 归属按指令里的写');

  ok(mod.applyEditorCommand(g, { op: 'building', kind: 'factory', id: f.id, owner: 1, col: 120, row: 120 }), '改归属并挪位置');
  ok(f.owner === 1 && Math.abs(f.x - 120.5 * 40) < 1, '归属从中立变玩家 2、坐标也挪了');

  ok(mod.applyEditorCommand(g, { op: 'building', kind: 'factory', id: f.id, remove: true }), '删除工厂');
  ok(g.factories.length === n0, '工厂数回到原位');

  // 研究所
  const labs0 = g.labs.length;
  ok(mod.applyEditorCommand(g, { op: 'building', kind: 'lab', owner: -1, col: 60, row: 60 }), '新增研究所');
  ok(g.labs.length === labs0 + 1, '研究所数 +1');
  const lab = g.labs[g.labs.length - 1];
  ok(mod.applyEditorCommand(g, { op: 'building', kind: 'lab', id: lab.id, remove: true }), '删除研究所');
  ok(g.labs.length === labs0, '研究所数回到原位');

  // 总部：只能挪、不能删
  const hq0 = { x: g.hqs[0].x, y: g.hqs[0].y };
  ok(mod.applyEditorCommand(g, { op: 'building', kind: 'hq', owner: 0, col: 10, row: 10 }), '挪动总部');
  ok(Math.abs(g.hqs[0].x - 10.5 * 40) < 1, '总部坐标更新了');
  ok(!mod.applyEditorCommand(g, { op: 'building', kind: 'hq', owner: 0, remove: true }), '总部不许删');
  ok(g.hqs.length === g.players.length, '总部数量不变');
  ok(Math.abs(g.hqs[0].x - hq0.x) > 1, '总部的确动了地方');

  // 单位
  const u0 = g.units.length;
  ok(mod.applyEditorCommand(g, { op: 'unit', owner: 0, type: 'warrior', tier: 2, col: 20, row: 20 }), '新增一个二级兵');
  ok(g.units.length === u0 + 1, '部队数 +1');
  const nu = g.units[g.units.length - 1];
  ok(nu.ownerIdx === 0 && nu.tier === 2 && nu.type === 'warrior', '新兵的归属 / 阶数 / 兵种都对');
  ok(mod.applyEditorCommand(g, { op: 'unit', id: nu.id, remove: true }), '删除这个兵');
  ok(g.units.length === u0, '部队数回到原位');

  // 暂停 / 继续
  ok(!mod.applyEditorCommand(g, { op: 'pause', on: true }), '已经在暂停态再发一次暂停，返回 false');
  const posBefore = g.units.map((u) => u.x.toFixed(3)).join('|');
  ok(mod.applyEditorCommand(g, { op: 'pause', on: false }), '可以继续');
  ok(g.paused === false && g.phase === 'countdown', '继续之后回到倒计时（phase = ' + g.phase + '）');
  // 部队没下命令不会自己走，所以拿「倒计时走完」+「产线真的开始转」当判据。
  // ⚠️ 别拿总部那条线试：开局亲兵全挂在它名下（homeFac = 0），十条名额早就占满了 ——
  //    按产线名额制它就是停产状态，进度冻在原地是**正确行为**，看不出暂停有没有解除。
  //    这里临时加一座我自己的工厂（没有兵占名额），它的进度才会真的涨。
  mod.applyEditorCommand(g, { op: 'building', kind: 'factory', owner: 0, level: 1, col: 30, row: 30 });
  const mine = g.factories[g.factories.length - 1];
  __test.step(g, 0.1, g.phaseEndsAt + 1000);
  ok(g.phase === 'playing', '倒计时到点后自动进入 playing');
  const prod0 = mine.prodProg;
  __test.step(g, 0.1, Date.now() + 60000);
  ok(mine.prodProg > prod0, '继续之后生产进度开始涨（' + prod0.toFixed(4) + ' → ' + mine.prodProg.toFixed(4) + '）');
  ok(g.units.map((u) => u.x.toFixed(3)).join('|') === posBefore, '没下命令的部队仍然原地不动');
  mod.applyEditorCommand(g, { op: 'building', kind: 'factory', id: mine.id, remove: true });
  setPaused(g, true);
  ok(g.paused === true && g.phase === 'edit', '还能再暂停回来');
}

/* ================= ③ 地图存取 ================= */

section('③ 地图文件：导出 → 落盘 → 读回 → 再开局');
{
  const mgr = new RoomManager();
  const room = makeEditorRoom(mgr, 'host3', 2);
  mgr.startEditorGame('host3');
  const g = room.game;
  // 摆点东西再存
  const cols = g.terrain.cols;
  const cells = [];
  for (let r = 10; r < 20; r++) for (let c = 10; c < 20; c++) cells.push([r * cols + c, 4]);
  for (let r = 200; r < 210; r++) for (let c = 200; c < 210; c++) cells.push([r * cols + c, 2]);
  mod.applyEditorCommand(g, { op: 'paint', cells });
  takeTerrainChanges(g);
  mod.applyEditorCommand(g, { op: 'building', kind: 'factory', owner: -1, level: 3, col: 150, row: 150 });
  mod.applyEditorCommand(g, { op: 'building', kind: 'lab', owner: 1, col: 151, row: 152 });
  mod.applyEditorCommand(g, { op: 'unit', owner: 0, type: 'ranger', tier: 3, col: 30, row: 30 });

  const exported = exportCurrentMap(g);
  ok(exported.format === WFMaps.FORMAT, '导出带正确的 format 标记');
  ok(typeof exported.terrain === 'string' && exported.terrain.length > 10, '地形压成了字符串（' + exported.terrain.length + ' 字符）');
  ok(exported.buildings.length === 2 + 2, '建筑含 2 座总部 + 工厂 + 研究所 = ' + exported.buildings.length);
  ok(exported.units.length === g.units.length, '部队全导出');

  const NAME = '冒烟测试地图';
  const wr = WFMaps.writeMap(exported, null, { overwrite: true });
  ok(wr.ok, '落盘成功（' + wr.file + '）');
  ok(/^[\w一-龥-]+\.json$/.test(wr.file || ''), '文件名是安全的（无路径分隔符）');
  const wr2 = WFMaps.writeMap(exported, wr.file, { overwrite: false });
  ok(wr2.ok && wr2.file !== wr.file, '不覆盖重名 → 另起一个文件名（' + wr2.file + '）');

  const listed = WFMaps.listMaps();
  ok(listed.some((m) => m.file === wr.file), 'listMaps 能看到刚存的两张图');

  const loaded = WFMaps.loadMap(wr.file);
  ok(Boolean(loaded), '读回来了');
  ok(loaded.grid.rows === 264 && loaded.grid.cols === 264, '网格尺寸一致');
  let same = true;
  for (let r = 0; r < 264 && same; r++) {
    for (let c = 0; c < 264; c++) {
      if (loaded.grid2[r][c] !== g.terrain.grid[r][c]) {
        same = false;
        break;
      }
    }
  }
  ok(same, '读回来的地形**逐格一致**（RLE 编码是无损的）');
  ok(loaded.buildings.length === exported.buildings.length, '建筑数一致');
  ok(loaded.units.length === exported.units.length, '部队数一致');

  // 用这张图再开一局（走正常的 startGame）
  const mgr2 = new RoomManager();
  mgr2.registerPlayer('h', '房主');
  mgr2.registerPlayer('p2', '玩家二');
  const created2 = mgr2.createRoom('h', { name: '选图房', gameType: 'warfactory', maxPlayers: 2 });
  ok(created2.ok, '建房间成功');
  const r2 = mgr2.getRoom(created2.room.id);
  const joined = mgr2.joinRoom('p2', r2.id);
  ok(joined.ok, '第二个人进房（' + (joined.error || 'ok') + '）');
  ok(mgr2.canStart(r2), '两人房已经可以开局');
  mgr2.setRoomMap('h', wr.file);
  const st = mgr2.startGame('h');
  ok(st.ok, '带图开局成功（' + (st.error || 'ok') + '）');
  const g2 = r2.game;
  let same2 = Boolean(g2 && g2.terrain);
  if (same2) {
    for (let r = 0; r < 264 && same2; r++) {
      for (let c = 0; c < 264; c++) {
        if (g2.terrain.grid[r][c] !== loaded.grid2[r][c]) {
          same2 = false;
          break;
        }
      }
    }
  }
  ok(same2, '按文件摆出来的地形与文件逐格一致');
  ok(g2 && g2.factories.length === 1 && g2.factories[0].level === 3, '工厂按文件复原（等级 3）');
  ok(g2 && g2.labs.length === 1 && g2.labs[0].owner === 1, '研究所的归属也复原了');
  // 战前选图上线后：普通开局不再直接倒计时，而是停在 briefing 等房主拍板。
  // 与「编辑态」的区别是 editor 标志：briefing 里 editor 必须是 false。
  ok(g2 && !g2.editor && g2.phase === 'briefing', '普通开局停在战前选图（briefing，不是编辑态）');
  ok(g2 && g2.paused === true, '战前阶段是暂停的（等房主拍板才开打）');
  ok(g2 && g2._pausePhase === 'countdown', '战前阶段记着恢复目标（拍板后回 countdown）');
  ok(g2 && g2.terrain.heights, '普通开局把高度场也算好了');

  // 清理测试产生的两张图
  WFMaps.removeMap(wr.file);
  WFMaps.removeMap(wr2.file);
  ok(!WFMaps.readMap(wr.file), '删完之后读不到了');
  ok(!WFMaps.listMaps().some((m) => m.file === wr.file), '列表里也看不见了');
}

/* ================= ④ 房间层的小细节 ================= */

section('④ 房间层：权限与容错');
{
  const mgr = new RoomManager();
  mgr.registerPlayer('h', '房主');
  mgr.registerPlayer('g', '客人');
  const room = mgr.createRoom('h', { name: '权限房', gameType: 'warfactory', maxPlayers: 2 });
  mgr.joinRoom('g', room.id);
  ok(!mgr.startEditorGame('g').ok, '非房主进不去编辑器');
  const bad = new RoomManager();
  bad.registerPlayer('x', '房主');
  const room2 = bad.createRoom('x', { name: 'bad', gameType: 'lasidao', maxPlayers: 2 });
  ok(!bad.startEditorGame('x').ok, '非战争工厂不支持编辑器');
  // 不存在的地图文件
  ok(!mgr.setRoomMap('h', '不存在的图.json').ok, '选一张不存在的图会被拒绝');
  ok(!mgr.startEditorGame('h', { mapFile: 'nope.json' }).ok, '按不存在的图开局会被拒绝');
  ok(mgr.startEditorGame('h').ok, '清掉坏图之后还能正常开编辑器');
  // 目录穿越
  ok(WFMaps.safeFileName('../evil.json') === '', '文件名里带 ../ 会被拒');
  ok(WFMaps.safeFileName('a/b.json') === '', '文件名里带分隔符会被拒');
  ok(WFMaps.safeFileName('ok.json') === 'ok.json', '正常文件名放行');
}

/* ================= ⑤ 建房时就指定地图 ================= */

section('⑤ 建房即选图（不再只能先进房再换）');
{
  const mgr = new RoomManager();
  mgr.registerPlayer('h', '房主');
  // 先造一张能落盘的图
  const wr = WFMaps.writeMap(
    Object.assign({}, mod.blankMap(2), { name: '建房选图测试' }),
    'smoke-create-map.json',
    { overwrite: true }
  );
  ok(wr.ok, '有一张现成的地图文件可供选择');

  const created = mgr.createRoom('h', {
    name: '指定图的房间',
    gameType: 'warfactory',
    maxPlayers: 2,
    mapFile: wr.file,
  });
  ok(created.ok, '建房时带上 mapFile 能创建成功');
  ok(created.ok && created.room.mapFile === wr.file, '房间里记下了这张图');
  ok(created.ok && created.room.wfMap === null, '图不在这里读盘（等开局再读，免得改了也没跟上）');

  const before = roomsMod.fullRoomView(created.room).mapFile;
  ok(before === wr.file, '房间视图把地图带给了客户端（' + before + '）');
  mgr.clearPendingLobby(created.room.id); // 隧道就绪前房间是不进大厅列表的
  ok(
    mgr.listLobbyRooms().some((r) => r.id === created.room.id && r.mapFile === wr.file),
    '大厅列表里也能看到这张图'
  );

  const bad = mgr.createRoom('h', {
    name: '坏图房',
    gameType: 'warfactory',
    maxPlayers: 2,
    mapFile: '肯定没有这张图.json',
  });
  ok(!bad.ok, '建房时指定不存在的图会被拒绝');
  ok(mgr.rooms.size === 1, '创建失败不会留下一个空房间');
  ok(mgr.players.get('h').roomId === created.room.id, '创建失败不会把房主踢出原来的房间');

  // 换回随机生成：必须还处在等待阶段（开局之后不许换图）
  ok(mgr.setRoomMap('h', null).ok, '等待期间可以把图退掉');
  ok(created.room.mapFile === null, '退掉之后回到随机生成');
  const back = mgr.setRoomMap('h', wr.file);
  ok(back.ok && created.room.mapFile === wr.file, '还能再选回来');

  // 满员开局：走的就是这张图，不是随机生成
  mgr.registerPlayer('p2', '二号');
  mgr.joinRoom('p2', created.room.id);
  const started = mgr.startGame('h');
  ok(started.ok, '两人到齐后可以正常开局');
  const g = created.room.game;
  const loaded = WFMaps.loadMap(wr.file);
  let same = true;
  for (let r = 0; r < loaded.grid2.length && same; r += 7) {
    for (let c = 0; c < loaded.grid2[r].length; c += 7) {
      if (g.terrain.grid[r][c] !== loaded.grid2[r][c]) {
        same = false;
        break;
      }
    }
  }
  ok(same, '开局用的确实是那张图（而不是随机生成）');
  ok(created.room.mapFile === wr.file, '开局之后房间仍记着图（重开局照用）');
  ok(!mgr.setRoomMap('h', null).ok, '已经开局就不许再换图了');

  try {
    fs.unlinkSync(path.join(WFMaps.MAP_DIR, wr.file));
  } catch (_) {
    /* ignore */
  }
}

console.log('\n结果：✓ ' + passed + ' / ✗ ' + failed);
process.exit(failed ? 1 : 0);
