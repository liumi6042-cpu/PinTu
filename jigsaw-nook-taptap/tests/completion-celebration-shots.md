# 拼好啦撒花 改前 / 改后截图与录像

仅供手动、本地运行；开发交付时只执行 `node --check tests/completion-celebration-shots.mjs`。需要 Node 24+、已安装的 Edge、Codex runtime 里的 Playwright 和本地字体/素材，机制与 `tests/completion-transition-shots.mjs` 相同（服务端和客户端都构建在运行目录里，网关只绑 127.0.0.1，浏览器拦截所有外部请求，房间、玩家全部通过本地 HTTP 新建，不改数据库）。

```powershell
$env:CELEBRATION_SHOTS_LABEL='before'; $env:CELEBRATION_SHOTS_SET='compare'; node tests/completion-celebration-shots.mjs   # 在基线提交上
$env:CELEBRATION_SHOTS_LABEL='after';  $env:CELEBRATION_SHOTS_SET='full';    node tests/completion-celebration-shots.mjs   # 改后
```

| 环境变量 | 含义 | 默认 |
|---|---|---|
| `CELEBRATION_SHOTS_DIR` | 输出目录 | `D:/chat/拼图/ui-revamp-shots/completion-celebration` |
| `CELEBRATION_SHOTS_LABEL` | 文件名前缀（字母、数字、`_`、`-`） | `after` |
| `CELEBRATION_SHOTS_SET` | `compare` 或 `full` | `compare` |

运行目录为 `work/celebration-shots-tmp/run-*`（数据库、会话、录像原片、报告副本都在这里）。每个场景新建 4 人公开 48 片房间，固定用同一张图：按 id 排序后第一张新游客可用、支持 48 片的目录图片，`mode:'selected'` 建房；接口不接受 seed，报告里记录每个房间的实际 seed。最后一片由房主在页面里拖进去，触发真实的完成过渡。

| 输出 | 套件 | 内容 |
|---|---|---|
| `<label>-t1200-844x390.png` / `t1600` / `t2400` | compare、full | 844×390 触屏横屏，过渡开始后 1.2 / 1.6 / 2.4 秒（冻结 `Date.now` 截静帧）。 |
| `<label>-popper-t0300-844x390.png` / `t0700` | compare、full | 时钟拨到 3600ms（结算弹窗已开），玩家 2 通过 HTTP 发「撒花」喝彩，页面收到后在喝彩开始后 0.3 / 0.7 秒截图。 |
| `<label>-t1600-390x844.png` | full | 竖屏 1.6 秒。 |
| `<label>-t1600-1920x1080.png` | full | 桌面 1.6 秒。 |
| `<label>-completion-844x390.webm` | full | 真实时间录像，不发喝彩；从过渡开始前 0.3 秒起截 4.2 秒（到弹窗后约 0.7 秒）。过渡起点用页面自己的时钟换算到 Node 墙钟；录到片段结束后再多录 1.5 秒才关闭页面，因为 Playwright 会丢掉关闭前最后一段画面。录像帧本身比墙钟慢约 0.3 秒，弹窗在片段 3.7–4.0 秒出现。 |
| `<label>-report.json` | 全部 | 标签、套件、图片 id、各房间 seed、截图时刻、实测弹窗延时、文件 SHA256、页面/控制台/网络错误。 |

脚本断言：所有房间使用同一张图、预摆放后房间未完成、拖动两端在视口内、真实时间弹窗延时在 3200–3700ms、喝彩开始时刻等于冻结时钟、文件数量（compare 5 张 PNG；full 7 张 PNG + 1 个 WebM）、页面/控制台/网络错误为零。脚本只引用 `COMPLETION_POPUP_MS` 和 `COMPLETION_CELEBRATE_MS`，改前改后都能运行。视觉效果需要人工检查。
