# 完成过渡本地截图与录像

仅供手动运行；开发交付时只执行 `node --check tests/completion-transition-shots.mjs`，不运行此脚本。

在本工作树根目录，用 Node 24+ 执行：

```powershell
node tests/completion-transition-shots.mjs
```

依赖已安装的 Edge、项目依赖、Codex runtime Playwright 和现有本地字体/素材。可用 `PLAYWRIGHT_MODULE` 覆盖 Playwright 的模块路径，用 `FFMPEG_PATH` 覆盖本地 FFmpeg；默认查找 Playwright 缓存中的 FFmpeg。缺少 FFmpeg 时保留未裁剪录像，并在报告中注明。`COMPLETION_SHOTS_DIR` 可覆盖默认输出目录 `D:/chat/拼图/ui-revamp-shots/completion-transition`。

服务端、引擎和客户端构建均放在 `work/completion-shots-tmp/run-*` 内；数据库、会话、录像原片和报告副本也留在该目录。脚本不修改源文件，不触及共享 node_modules，不连接远程服务。网关仅绑定 127.0.0.1 的空闲端口，浏览器阻止所有外部请求。所有房间、票据和玩家均为本次运行通过本地 HTTP 新建；不改数据库来制造完成状态。

每次场景新建 4 人公开房间（48 片），四个座位轮流 claim/drop，保留最后一个未锁定组。页面就绪后从 `app.board` 读取片宽、片高和最后一组首片的归位中心；由 Node 中的玩家 4 claim/drop 到相对归位位置 `dx=1.3*pieceW, dy=0.3*pieceH`，断言仍未锁定、房间未完成且偏移正确，并等待页面棋盘同步。随后把目标中心与碎片中心的中点移至 `board.rect` 中心；844×390 使用 `app.roomZoomBase*1.8`，其余保持当前缩放，调用 `invalidate()`。计算拖动起终点并断言都在视口内后，浏览器使用房主身份完成拖动；3 秒未完成则保留玩家 2 的 HTTP 兜底，报告记录该情况和预摆放坐标。

| 输出 | 内容 |
|---|---|
| `completion-844x390-4p.webm` | 触屏横屏、DSF 1，先缩放 1.8 倍，拖最后一片，真实时间播放过渡；约 1000ms 时玩家 2 发送 popper，持续至弹窗后 1.2 秒。按页面创建时刻换算偏移，用 `-ss` 从拖动前 0.4 秒裁到弹窗后 1.2 秒（约 4.9 秒）；拖动前先等本地游客登录提示被应用自己清掉，避免它出现在画面里。 |
| `t0300-844x390.png` | 接缝和镜头过渡中。 |
| `t1200-844x390.png` | 镜头适配完毕，光带、横幅和彩纸出现。 |
| `t1450-844x390.png` | 光带中途，检查宽柔光带与居中亮芯。 |
| `t2000-844x390.png` | 光带到达右侧，仍展示成品。 |
| `t3500-844x390.png` | 已打开原结算弹窗。 |
| `t2000-390x844.png` | 竖屏的成品庆祝画面。 |
| `t2000-1920x1080.png` | 桌面端成品庆祝画面。 |
| `settle-844x390.png` | 实际点击弹窗关闭按钮后，显示「查看结算」。 |
| `settle-reopen-844x390.png` | 实际点击结算按钮后重新打开弹窗。 |
| `report.json` | 文件 SHA256、房间信息、拖动与兜底、截图偏移、实测过渡至弹窗延时、页面/控制台/网络错误及其他问题。 |

静帧在拖动前安装 rAF 观察器，首次看到 `app.completionFx` 后冻结 `Date.now` 为 `start + offset`；每次调整偏移后等待两帧再截图，最后恢复时钟。录像使用真实时间。相位阈值通过打包导入 `mobile/completion-transition.ts` 复用，避免另设一套完成时间。

脚本会断言只有最后一组未锁定、预摆放后仍未完成、页面偏移已同步、拖动两端都在视口内、弹窗延时至少 3200ms、结算按钮存在且能重新打开弹窗、输出数量为 10（9 张 PNG 和 1 个 WebM，另有 `report.json`），以及页面/控制台/网络错误为零。视觉效果仍需人工检查；脚本语法检查不代表截图、录像或视觉验收已通过。

## 首次过渡交付验证（2026-10-27，26bfad7）

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

## 完成流程钩子与捕获修正（2026-10-27）

在 26bfad7 的现有过渡上实现；只改 `mobile/completion-flow.ts`、`mobile/app.ts`、`mobile/puzzle-board.ts`、`mobile/completion-transition.ts`、`tests/mobile-completion-transition.test.mjs` 和本捕获脚本、说明共 7 个文件。

`mobile/completion-flow.ts` 提供纯 `CompletionFlow` 及 `CompletionPhase`、`CompletionPhaseEvent`、`CompletionContext`、`CompletionAction` 类型。阶段不变时不通知；订阅和提供者可注销，异常互不影响；通知中新增监听者不接收当前事件，已移除者跳过；按注册顺序选首个非空标签动作。

`mobile/app.ts` 的 `GameApp` 公开接口为 `get completionPhase():CompletionPhase`、`onCompletionPhase(listener):()=>void`、`openCompletionPopup():boolean`、`closeCompletionPopup():boolean`、`registerCompletionAction(provider):()=>void`。实际完成经历 `idle → transition → popup`（3200ms）；已完成房间重入直接 `idle → popup`；留房关闭或被其他弹窗替换为 `closed`，重开为 `popup`；所有离房路径在清空房间前发送 `idle`，携带离开的 roomId、level、levelId。九格始终为 `idle`。`showModal()` 统一发出 popup/closed 边沿，保留房间的导航关闭也经此入口。

`openCompletionPopup()` 在过渡中复用正常结束路径：最终镜头、整图 reveal 1、清空扫光和过渡帧，按到达时间回放未过期喝彩。`closeCompletionPopup()` 仅关窗，关卡房间仍保留；玩家关闭按钮和 Escape 仍走原有退出关卡行为。扩展动作按最新 snapshot 构建上下文，结果同步前 `levelClear=null`；到达后重画即可获得结果。扩展按钮与原主按钮等分旧行，间距 8px，标签字号按宽度缩至最低 12，下方按钮、喝彩条和内容高度不变。

扫光仍在原有唯一整图覆盖层内：35% 宽柔光峰值 .55，居中的 8% 亮芯峰值 .8，同倾角、裁剪、source-over 并恢复状态。彩纸现为 900ms 的 90 片及 1150ms 的 60 片，仍在 3200ms 前全部过期。

验证结果：`npx.cmd tsc --noEmit --incremental false -p tsconfig.json` 仅出现允许的旧 `vite.config.ts(5,27)` 缺少 `.openai/hosting.json` 错误；`npm.cmd run test:mobile` 为 25 + 106 + 17 = **148 项通过、0 失败**，其中完成过渡/钩子文件 **35 项**。另运行 `node --import ./tests/ts-register.mjs --test tests/mobile-completion-transition.test.mjs tests/mobile-level-completion.test.mjs`，35 + 9 = **44 项通过**；完成文件随后增强了扫光状态恢复和裁剪内按钮边界断言，并已被完整 mobile 套件覆盖。五种尺寸 844×390、740×360、667×375、390×844、1920×1080 均检查了关卡结果、两行相册奖励、扩展动作、下方按钮及喝彩条位置；横屏无需滚动，竖屏保留原有滚动和裁剪。`npm.cmd run check:images` 通过（82 张发布图片、813 个旧哈希衍生图）。`node --check tests/completion-transition-shots.mjs` 通过；未执行截图脚本，未做新的视觉验收。未执行 Git 操作，未修改 server/lib/h5 或其他工作树。
