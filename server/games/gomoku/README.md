# 五子棋

```
server/games/gomoku/index.js      # 规则
server/games/gomoku/bot.js        # Bot 入口（调用 Carbon）
server/games/gomoku/carbon-js/    # Carbon-Gomoku JS 移植
server/games/gomoku/carbon-src/   # 原版 C++ 源码（参考）
server/games/gomoku/smoke/        # 冒烟
public/games/gomoku/              # 面板 / 棋盘 / 样式
```

AI 算法来自 [Carbon-Gomoku](https://github.com/gomoku/Carbon-Gomoku)（Michał Czardybon）：
模式状态表 + α-β + 候选剪枝，已移植为 Node.js。

难度（搜索时限递增）：
- **简易**：深度 2
- **普通**：~280ms
- **困难**：~700ms
- **困难Plus**：~1200ms
- **地狱**：~1800ms
