# 武将目录（自动注册）

每个武将一个子文件夹，技能各自独立文件。

```
hero/
  index.js          # 扫描并注册全部武将（一般不用改）
  _generate.js      # 一次性生成脚本（可选）
  caocao/
    index.js        # 武将元数据 + skills 列表
    jianxiong.js    # 技能实现
    hujia.js
  guanyu/
    index.js
    wusheng.js
```

## 新增武将

1. 在 `hero/` 下新建文件夹，目录名建议与 `id` 一致（如 `zhangchunhua`）
2. 写 `index.js`：

```js
module.exports = {
  id: 'zhangchunhua',
  name: '张春华',
  country: '魏',
  maxHp: 3,
  gender: 'female',
  portrait: 'zhangchunhua.png', // 对应 resourse/picture/hero/
  skills: [
    require('./jueqing'),
    require('./shangshi'),
  ],
};
```

3. 每个技能一个文件，导出：

```js
module.exports = {
  id: 'jueqing',
  name: '绝情',
  desc: '…',
  triggers: ['beforeDamage'], // 引擎钩子名
  onTrigger(ctx) {
    // 实现逻辑；暂不发动则 return null
    return null;
  },
};
```

4. 将立绘放到 `server/games/sgs/resourse/picture/hero/<portrait>`  
   访问路径：`/games/sgs/res/picture/hero/<portrait>`

**无需修改** `hero/index.js` 或 `games/index.js`，重启服务即可被扫描进将池。

## 技能钩子（triggers）

引擎通过 `runSkillTrigger(trigger, ctx)` 调用。常用：

| trigger | 时机 |
|---------|------|
| afterDamage | 受到伤害后 |
| phasePrepare / phaseDraw / phasePlay / phaseDiscard / phaseEnd | 回合阶段 |
| needSha / needShan / needTao | 需要杀/闪/桃 |
| canBeTarget | 能否成为目标 |
| shaLimit / distance | 锁定技类查询 |

技能逻辑尚未全部实现时保持 `onTrigger` 返回 `null` 即可。
