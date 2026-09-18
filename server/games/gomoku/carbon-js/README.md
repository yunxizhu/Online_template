# Carbon-Gomoku（JS 移植）

算法来自 [gomoku/Carbon-Gomoku](https://github.com/gomoku/Carbon-Gomoku)（Michał Czardybon）。

- `engine.js`：AICarbon 搜索 / 评估的 Node 移植
- `tables/`：由 `../carbon-src/convert-tables.js` 从原版 STATUS1 / PRIOR / CONFIG / COUNT5 生成

重新生成表：

```bash
node server/games/gomoku/carbon-src/convert-tables.js
```
