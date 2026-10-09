# 战争工厂 开发笔记（长文，从 MEMORY.md 拆出来）

> 速查表在 `.workbuddy/memory/MEMORY.md`；逐次实验过程在 `.workbuddy/memory/YYYY-MM-DD.md`。
> 本文放「不长但必须记住、又不适合塞进速查表」的操作细节。2026-10-09 从 MEMORY.md 拆分。

## 炮塔 / 兵种造型
- 两层角度：`u.angle` 车体（朝行进）/ `u.turret` 炮塔（朝攻击），两层角速度见 `data.js` 的 `turn` 段。
  `turnHull/turnTurret` 一 tick 限额 `rate×dt`，额度记 `u._turnLeft`（`updateUnits` 每 tick 置 null，防一 tick 转两次）；
  车体转时炮塔平移同量；无目标时炮塔按角速度收回车体朝向。
- 快照 `u` 行 20 列，**炮塔角在末尾**；`row[4]`（车体角）/`row[19]`（炮塔角）各自插值。
- 客户端绘制：车体 `rotate(u.ang)`；炮塔 `translate(pivot) → rotate(turRelOf(u)) → translate(-pivot)`。
  6 个兵种函数都带 `part` 参数（`if (tur)` / `if (!tur)`）；`drawBulk` 只属车体层；`turretPivot()` = 座圈。
- 炮管 2026-10-09 按职能重做：锐士=坦克炮（直管+炮盾+制退器）/盾卫=**无炮管**近战肉盾（层叠甲板+撞角+铲刀）/
  游侠=长身狙击管（最长 2.22× 车体）/轰击=斜上扬迫击炮/燎原=长条喇叭喷嘴/激光=棱镜。
  通用构件 `turretBase`/`mantlet`/`barrelTube`/`muzzleBrake`（**前四个没有 `col` 参数**）。
  配色收敛成一个色系：结构件一律墨阶，**整座炮塔只有一个彩色点 = 炮口那一小段**（`muzzleBrake` 末参 `tipCol`）；
  兵种识别靠轮廓不靠颜色；车体层仍留阵营色（归属识别）。
- ⚠️ **改炮管必同步四处**：① `turretPivot` 与 `turretBase` 位置逐字一致（否则座圈与旋转中心错位）；
  ② 服务端 `MUZZLE_K` + 客户端 `MUZZLE_X` 同口径（枪口焰位置）；③ 后坐 `RECOIL_K[type]`；
  ④ 激光光束起点 = `muzzleReachOf(u)*S`。
- 探针 `scripts/_wf-turret-probe.js`（vm + Proxy ctx 逐格调色）。⚠️ 写这类桩的三个假通过陷阱：
  ① `set(t,p,v)` 不记 calls ⇒ 永远报「没彩色」；② 颜色解析只认 `rgb()` ⇒ `#rrggbb` 被当墨；
  ③ 注入锚点写死 `\n` 而源文件是 CRLF ⇒ ANCHOR_MISS，用 `lastIndexOf('return {')`。
- 出口 `Ui.drawUnitParts/turretRel/turretPivot`；预览 `scripts/warfactory-turret-gallery.js` → `docs/warfactory-turret-gallery.html`。
- ⚠️ 拆块两坑：跨块变量（`px0..th`、`ax`、`bw`）必须提到 prologue；「外层 `if (!tur)` 里再写 `if (tur)`」恒假。
- 兵种绘制几何：helper 不能叫 `panel`；别用阵营色 × 恰好 0.6 透明度；tier 缩放 1/1.275/1.478；本体绘制内别再嵌 `c.scale`；
  **造型 = 方形构图**（BODY_SPAN 长宽比 0.92~0.96，三阶相同）。

## 编辑器 / 地图文件 / 战前选图
- 入口：房间里 Ctrl+Shift + ↑↓←→（2.5 秒内，捕获阶段 + stopPropagation）→ `room:startEditor`，补占位电脑 `editorDummy`，停在 `phase:'edit'`。
  指令 `wf:edit`（12 条/秒），地形回播 `wf:terrain`；建筑/单位增删要置 `room.game._editDirty = true`。
- 地图文件 `maps/warfactory/*.json`（`maps.js`，RLE，`safeFileName`）。**房间只记 `room.mapFile`**。
- 战前选图：`phase` 新增 `briefing`，指令 `briefing:list/pick/confirm`。⚠️ 换图会换 game 对象 ⇒ `briefingSeq = prevSeq+1`；pick 之后必须 `startRealtimeLoop`。
- ⚠️ **预览画布逻辑边长绝不能从 `cv.width` 推**（dpr 反复相乘 ⇒ 越点越糊），走 `brCanvasSide()`。

## 产线名额 / 伤害与观感
- 名额按「建筑 key + 线号」记账：工厂 `f<id>`、总部 `h<ownerIdx>`（**总部不能按 id 建 key**：HQ id 从 1 起而 HQ 兵 `homeFac=0`，会串）。
  快照：`f` 行 11 列、`hq` 行 13 列、`u` 行 20 列。产线面板按钮 class 用 `wfp-lpick`。
- **所有兵种 `dmg` 都是「每次伤害」**；唯一按秒结算的是灼烧地形 `fireTiers[].dps`，火场**敌我通吃**且只烧单位。
- **火舌范围伤害按距离衰减**：`flame.r`(4.5 格)/`flame.edgeMul`(0.5)，按**目标最近边缘**算 `gap=d−r`；`flameFalloff()`；**地上的灼烧地形不衰减**。
- **子弹效果随进化变大**：服务端 `shot`/`hit`/`boom` 带 `ty`+`ti`；客户端 `fxScaleOf(type,tier)`
  （弹体 `BULLET_TIER_MUL=[1,1.38,1.76]`，燎原/激光 `BEAM_TIER_MUL`）；枪口焰按射手体型 `e.r`，不重复放大。
- 激光观感跟着伤害走，服务端单一真源（`data.js` 的 `laser` → `meta.consts`），用 log2 而非线性。
- ⚠️ **攻速浮点残渣已修**：`cdLeft -= dt` 留 6.9e-17 ⇒ 每次攻击多等一帧；按 `left > 1e-9 ? left : 0` 夹掉（`Math.max(0,…)` 无效）。

## 弹道与命中
- `TICK_MS=100` → `dt=0.1`（`MAX_DT` 0.25），别按 0.05 想。
- ✅ 命中改**线段 vs 圆**（`segCircleT()`，四处目标）；直射弹「越过落点」必须在瞄的 `(b.tx,b.ty)` 爆炸。
  ⚠️ 探针 `_hitprobe.js`：靶子死后被 `reapDead` 移出，不放回会统计出假 0%。
- 已修：`updateBullets` 里 `continue` 写成 `return`；`stop`/`move` 没清 `targetFac/Lab/Hq`；出局清场不记战损（抽 `tallyDead()`）；
  `step()` 开头清 `_captures` 抹脏标记（改末尾）；导航缓存永不失效；编辑器 `push(...changes)` RangeError；`move` 落点不按连通分量矫正 ⇒ 指令卡死。

## 兵种克制（第三轮，2026-10-07；全表见 `docs/warfactory-matchup-2026-10-07.md`）
- 推演台 `scripts/warfactory-matchup.js` 唯一权威（**确定性、无 rng**）：`table/matrix/aoe/front/siege/defend/rank/duel`。
- ⚠️ `rampMs` 是「+1 倍的周期」不是「爬满用时」：`mul = min(maxMul, 1 + held/rampMs)`。用例 `lockStart` 别用 0（falsy）。
- ⚠️ **团战结论与 1v1 完全相反**，关键是 **AoE 实际命中数**。
- 野战 10v10：1 阶 轰击 +42 > 燎原 +41 > 盾卫 +38 > 锐士 −16 > 游侠 −33 > 激光 −79；
  3 阶 轰击 +56 > 盾卫 +36 > 燎原 +23 > 锐士 −6 > 游侠 −35 > 激光 −75。**激光两阶垫底**。
- 攻城（3 阶×20）激光 18s 最快 ⇒ **激光 = 攻城特攻**；守家 **轰击之王**（唯一站防卫圈外、零战损）> 燎原；激光守家 0/10。
- 轰击：溅射随阶 30/45/60px + 衰减 `burstSplash.edgeMul 0.35` + `minRange 100/110/120px`（贴脸打不到）；
  生效点 `findTarget`/`laserHeldTarget`/`inRange`/`explodeShell`。遗留：弹速随阶变慢（440/360/280）⇒ 高阶命中差。
- 激光锁定死咬：仅 ① 目标死亡/易主 ② 离开攻击范围 ③ 玩家改派 才解锁。

## bot（`server/games/warfactory/bot.js`）
- 实时制：`getActingPlayerIds()` 返回 `[]`；自建 `driveBots(room,now)` 挂在 tick 之前，`BOT_THINK_MS=700±200`。
  指令唯一通道 `setPlayerInput(game,id,cmd,now)`（**第 4 参传游戏内时钟**）。think 输出 `cmds.slice(0,6)`。
- 阶段判据：`desperate`(总部<40%) / `endgame`(敌总部<45% 或 战力>敌 1.6× 或 中立抢光且己方≥2 厂 或 dps≥220 且≥2 厂) /
  `skirmish`(≥1 厂) / `develop`。
- ⚠️ 建筑目标**只下 `move` 不许发 `attack`**（会顶掉自动索敌 + 落点不同 ⇒ 0.7s 自激振荡、净位移 0）。
- ⚠️ 拆总部用围城站位 `siegeRing()`（站 `HQ_DEF_R+12=212px` 白嫖）。⚠️ 已总攻后不能再按「离集结点多远」判继续。
  ⚠️ `updateProbe` 25s 无进展即拉黑是赢的关键。
- ⚠️ **不要用自播诊断调参，A/B 才是标准**：`smoke/_det.js`（冻结 `Date.now`/`Math.random`）+ `_ab.js`/`_t.js`/`_4p.js`。
  ⚠️ `room.id` 参与地形种子，必须与 `_ab.js` 一字不差。⚠️ 噪声底随版本变，每批种子当场重测；候选至少两批种子同号。
- 当前基线：vs 冻结基线 **净胜 37:2~46:1、成对血差 8200~9100**。高地利用 v2 已落地（采样点必须 `standable`）。
- 已 A/B 证伪**必须回退**：研究所权重抬高、产线上限 14、3 股分兵、守军比例下调、`STAGE_OFF 700`、`spdCap 20`、
  rally 上限 3、提速提到进化前、近战兵分兵偷厂、`PROBE_MS 20s`、目标粘性 2.5、距离折扣 3000、`STAGE_R 1000/1500`、
  接战集火、旧版高地利用、守军改前排/高速优先、前后排阵型、激光当量 ×18、分兵骚扰。

## 验证与调试技巧
- `cp index.js _old_index.js` 短路新逻辑对照；「是不是我改坏的」用 `git worktree add /tmp/xxx HEAD --detach` 做 A/B（**别 stash**）；
  ⚠️ HEAD 常落后，A/B 前先确认 HEAD 里有相关代码。
- 快速关新逻辑：临时把 `data.js` 对应值改极值（`turn.hull=1e9`/`moveCos=-1`/`moveMin=1`）；本次新加的开关是 `WF_NODESPECKLE=1`。
- 渲染验证：`client-check §34`。⚠️ 桩的 `log.gradients`/`log.arcs` 必须限量，否则从 114s 拖到跑不完；
  `pump()` 清 rects/strokes/points 但**不清** arcs/gradients；抓地形贴图要 `pump()` → 清记录 →
  `Ui.editor.applyTerrainPatch({full,heights,levels,ramps})`（**ramps 必须带**）。
- 其它测试：`smoke/path.js`/`turret.js`/`bot.js`、`scripts/warfactory-cliff-check.js`/`-ramp-check.js`/`-terrain-check.js`（~7min）、4 人局 `smoke/_4p.js <seed> <秒>`。
- 两份前端：`public/games/warfactory/` 与 `mobile/www/games/warfactory/`（**mobile 落后很多，要移植不要覆盖**）；
  大厅外壳 `npm run sync:js` 同步，出包跑 `打包.bat`。⚠️ mobile 缺 `gridCell()`/`repaintTerrainRows()`/地形编辑器/战前选图/行军路线预览/炮塔分层。
