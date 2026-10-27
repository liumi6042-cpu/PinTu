# 完成过渡本地截图与录像

仅供手动运行；开发交付时只执行 `node --check tests/completion-transition-shots.mjs`，不运行此脚本。

在本工作树根目录，用 Node 24+ 执行：

```powershell
node tests/completion-transition-shots.mjs
```

依赖已安装的 Edge、项目依赖、Codex runtime Playwright 和现有本地字体/素材。可用 `PLAYWRIGHT_MODULE` 覆盖 Playwright 的模块路径，用 `FFMPEG_PATH` 覆盖本地 FFmpeg；默认查找 Playwright 缓存中的 FFmpeg。缺少 FFmpeg 时保留未裁剪录像，并在报告中注明。`COMPLETION_SHOTS_DIR` 可覆盖默认输出目录 `D:/chat/拼图/ui-revamp-shots/completion-transition`。

服务端、引擎和客户端构建均放在 `work/completion-shots-tmp/run-*` 内；数据库、会话、录像原片和报告副本也留在该目录。脚本不修改源文件，不触及共享 node_modules，不连接远程服务。网关仅绑定 127.0.0.1 的空闲端口，浏览器阻止所有外部请求。所有房间、票据和玩家均为本次运行通过本地 HTTP 新建；不改数据库来制造完成状态。

每次场景新建 4 人公开房间（48 片），四个座位轮流 claim/drop，保留最后一个未锁定组。浏览器使用房主身份，把最后一组从当前屏幕位置拖到目标位置；3 秒未完成则由玩家 2 经 HTTP 兜底，报告记录该情况。大幅缩放后碎片可能在屏幕外，此时也会留下兜底记录。

| 输出 | 内容 |
|---|---|
| `completion-844x390-4p.webm` | 触屏横屏、DSF 1，先缩放 1.8 倍，拖最后一片，真实时间播放过渡；约 1000ms 时玩家 2 发送 popper，持续至弹窗后 1.2 秒。用 `-sseof` 裁剪至拖动前约 150ms。 |
| `t0300-844x390.png` | 接缝和镜头过渡中。 |
| `t1200-844x390.png` | 镜头适配完毕，光带、横幅和彩纸出现。 |
| `t2000-844x390.png` | 光带到达右侧，仍展示成品。 |
| `t3500-844x390.png` | 已打开原结算弹窗。 |
| `t2000-390x844.png` | 竖屏的成品庆祝画面。 |
| `t2000-1920x1080.png` | 桌面端成品庆祝画面。 |
| `settle-844x390.png` | 实际点击弹窗关闭按钮后，显示「查看结算」。 |
| `settle-reopen-844x390.png` | 实际点击结算按钮后重新打开弹窗。 |
| `report.json` | 文件 SHA256、房间信息、拖动与兜底、截图偏移、实测过渡至弹窗延时、页面/控制台/网络错误及其他问题。 |

静帧在拖动前安装 rAF 观察器，首次看到 `app.completionFx` 后冻结 `Date.now` 为 `start + offset`；每次调整偏移后等待两帧再截图，最后恢复时钟。录像使用真实时间。相位阈值通过打包导入 `mobile/completion-transition.ts` 复用，避免另设一套完成时间。

脚本会断言只有最后一组未锁定、弹窗延时至少 3200ms、结算按钮存在且能重新打开弹窗、输出数量，以及页面/控制台/网络错误为零。视觉效果仍需人工检查；脚本语法检查不代表截图、录像或视觉验收已通过。

## 本次交付验证（2026-10-27）

`npx.cmd tsc --noEmit --incremental false -p tsconfig.json` 仅报告任务允许的 `vite.config.ts(5,27)` 缺少 `.openai/hosting.json`；`npm.cmd run test:mobile` 为 25 + 94 + 17 = 136 项通过，其中新文件 23 项；另运行 `node --import ./tests/ts-register.mjs --test tests/mobile-level-completion.test.mjs`，9 项通过。`npm.cmd run check:images` 通过（82 张发布图片、813 个旧哈希衍生图）；截图脚本 `node --check` 通过。PowerShell 执行策略禁用 `.ps1` 入口，因此 npm/npx 使用对应 `.cmd`。未运行截图脚本，也未做视觉验收。

时间轴：0–900ms 接缝淡出及镜头适配；900ms 单次奖励音、第一批 70 片彩纸及横幅开始；1020ms 横幅不透明；1120ms 横幅缩放结束；1150ms 第二批 50 片彩纸开始，每片额外延迟不超过 600ms；900–2000ms 光带；3200ms 打开结算，全部彩纸此前过期。

结算按钮均为 112×36；以下为逻辑坐标，安全区底部为 0，TapTap 横屏工具栏收起、桌面侧栏展开。完成画面中竖屏礼包热区和横屏聊天气泡为按钮让出空间，保留指定的底边距。

| 尺寸 | 按钮 (x, y) | 距安全区底部 |
|---|---|---|
| 844×390 | (366, 342) | 12 |
| 740×360 | (314, 312) | 12 |
| 390×844 | (139, 794) | 14 |
| 1280×800 | (434, 750) | 14 |
| 1920×1080 | (754, 1030) | 14 |

横屏 Web 常驻 62px 工具列时，前两项 x 分别为 335、283；TapTap 展开 72px 工具列时分别为 330、278。实际截图根据平台 UI 缩放换算到屏幕像素，报告保留实际矩形。
