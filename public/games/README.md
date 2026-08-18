# 游戏前端资源

每个游戏一个子目录，与 `server/games/<id>/` 对应：

```
public/games/<id>/
  panel.html   # 对局面板片段（由 boot-games 挂载）
  style.css    # 游戏样式
  ui.js        # 游戏 UI（可选；五子棋用 board.js）
  …            # 图片等其它资源
```

大厅壳在 `public/`，不把具体游戏逻辑塞进 `ui.js`。
