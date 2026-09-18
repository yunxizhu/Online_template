# 五子棋

```
server/games/gomoku/index.js   # 规则
server/games/gomoku/bot.js     # AI（三级难度，minimax）
server/games/gomoku/smoke/     # 冒烟
public/games/gomoku/           # 面板 / 棋盘 / 样式
```

AI 逻辑：棋型威胁识别 + α-β（参考 [lihongxun945/gobang](https://github.com/lihongxun945/gobang) 的棋型体系）：
- **简易**：高分候选中随机（仍保证成五/挡五）
- **普通**：深度 4 + 必应层（活四/双活三）
- **困难**：深度 6 + 更强防守偏置，主动做活三/冲四压迫
