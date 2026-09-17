# 三国杀（Sanguosha）

本目录包含三国杀的全部服务端逻辑；前端资源在 `public/games/sgs/`。

## 结构

```
server/games/sgs/
  hero/             # 武将（一将一目录，技能分文件，自动扫描）
  resourse/
    picture/        # 全部 png（卡牌、牌背、身份、武将立绘）
      kapai_*.png
      hero/         # 武将立绘
    music/
      card/         # 出牌语音 mp3
  ...
```

## 模式

- `identity` 标准身份（5/8）
- `h2h` 2V2（4）
- `1v2` 1V2（3）

## 冒烟

```bash
node server/games/sgs/smoke/identity.js
node server/games/sgs/smoke/h2h.js
node server/games/sgs/smoke/1v2.js
# 或兼容入口：
node scripts/smoke-sgs-h2h.js
```
