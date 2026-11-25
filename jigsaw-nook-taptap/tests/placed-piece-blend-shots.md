# 拼好的块融进画面：改前 / 改后截图

仅供手动、本地运行；开发交付时只执行 `node --check tests/placed-piece-blend-shots.mjs`。需要 Node 24+、已安装的 Edge、Codex runtime 里的 Playwright 和本地字体/素材。服务端和 TapTap Canvas 客户端都构建在运行目录 `work/blend-shots-tmp/run-*` 里，网关只绑 127.0.0.1，浏览器拦截所有外部请求，房间和玩家全部通过本地 HTTP 新建，不改数据库。

```powershell
$env:BLEND_SHOTS_LABEL='before'; node tests/placed-piece-blend-shots.mjs   # 在基线提交上
$env:BLEND_SHOTS_LABEL='after';  node tests/placed-piece-blend-shots.mjs   # 改后；before 图都在时自动拼对比图
```

| 环境变量 | 含义 | 默认 |
|---|---|---|
| `BLEND_SHOTS_DIR` | 输出目录 | `D:/chat/拼图/ui-revamp-shots/placed-piece-blend` |
| `BLEND_SHOTS_LABEL` | 文件名前缀（字母、数字、`_`、`-`） | `after` |
| `BLEND_SHOTS_PIECES` | `48` 或 `108`（108 张图会拟合成 14×7=98 片） | `108` |
| `BLEND_SHOTS_SEED_TIME` | 建房时冻结的服务端时钟（决定 seed、块形状和散落位置） | 当天 UTC 零点 |

同一天跑的改前、改后是同一盘：建房接口不收 seed，脚本只在建房那一次请求里把进程内 `Date.now` 冻结到 `BLEND_SHOTS_SEED_TIME`，所以块形状和散落位置一致。除最后两行和倒数第二行右半边以外全部通过 HTTP 拼好；倒数第一行右数第二块放在已拼好的湖面上、偏离网格半格（玩家说的“拖进拼好的地方就找不到了”）；另一块散块放在空槽里，供拖动帧拿起。

| 输出 | 内容 |
|---|---|
| `<label>-board.png` | 844×390 横屏、DPR 2，整盘。 |
| `<label>-zoom.png` | 同一位置放大，看压在湖面上的散块。 |
| `<label>-drag.png` | 手指按住空槽里的散块拖到已拼好的区域上，未松手时截图。 |
| `compare-<label>-{board,zoom,drag}.png` | 改前在上、改后在下的对比图（before 三张都在时生成）。 |
| `<label>-report.json` | 图片 id、seed、房间布局、相机、文件 SHA256、页面/控制台/网络错误、接缝检查结果。 |

改后（页面上有 `placedSurface` 时）还会再通过 HTTP 实时拼好一块，检查拼好层：增量重绘和整层重绘里，拼好区域内部（上下左右 3 像素都不透明）不能有 alpha 低于 250 的像素，也就是不能有接缝。外轮廓的抗锯齿在两种重绘之间允许有细微差别，只记录在报告里。视觉效果需要人工检查。
