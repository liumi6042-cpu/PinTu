# off-05 离线客户端交付记录（2026-10-27）

已完成任务卡要求的客户端接入，未提交。全部写入位于本工作树；未改服务器、solo batching 或 14 个 shared-core 文件。

## 文件

- `mobile/offline-mode.ts`：目录读取、单实例离线服务、离线页面、通关面板、网络 outbox 防护及同步。
- `mobile/app.ts`：下表 23 个局部 diff hunk；无重排、重命名或整体格式化。
- `mobile/client.ts`：增加 `acceptOfflineProfile`，复用已有档案更新规则。
- `tests/mobile-offline-browser.mjs`：本地静态包的横竖屏断网检查。
- `package.json`：`test:mobile:offline`。
- 本文档。验证产物、截图、日志及临时 `work/vite-runner-preload.mjs` 均在忽略的 `work/` 内。

## app.ts 的每个 hunk

以最终 `git diff --unified=3 -- mobile/app.ts` 为准；下列为新文件行号（含 diff 上下文），括号内列实际改动位置。

| 新行段 | 改动 |
|---|---|
| 1–8（4–5） | 导入离线 helper、缓存及网络错误判断。 |
| 70–80（73–77） | helper 字段、离线房间判断、同步/进入/开房短钩子。 |
| 126–132（129） | 构造 helper，将目录照片供既有绘制路径使用。 |
| 136–142（139） | 社交面板不接收离线房间上下文。 |
| 200–208（203、205） | 离线不显示体力规则，禁用喝彩客户端。 |
| 248–263（251、256、259–260） | onShow 同步/隔离房间查询；成功启动退出离线页面；持久 outbox 网络过滤；3 秒和 9 秒刷新隔离。 |
| 266–272（269） | 恢复联网时不由初始内容/邀请流程替换仍打开的离线棋盘。 |
| 312–321（315、318） | 路由刷新静默停止，在线专用导航显示固定提示。 |
| 331–345（334–335、339、342） | 离线退出返回页面/原路由；关闭完成面板；modal 入口隔离；历史刷新隔离。 |
| 404–412（407、409） | 离线不请求关卡；每次成功在线关卡响应保存缓存。 |
| 431–441（434、436、438） | 离线关卡启动、仅网络错误降级到目录关卡、阻止联网入房。 |
| 452–463（455、459–460） | attachTicket 判断本地房；无 realtime，使用本地 fetch、无 solo outbox、无体力和档案回调。 |
| 465–484（468、471、473、476、481） | 无 cursor；完成后仅本地 flush/在线时同步；辅助不刷新；分享入口固定提示。 |
| 491–497（494） | 辅助激活入口固定提示。 |
| 564–570（567） | 聊天刷新不发送本地房间 ID。 |
| 673–683（676、680） | 加载门禁允许离线画面；独立离线页面调用既有章节绘制函数。 |
| 779–786（782–783） | 启动错误主按钮「离线拼图」，次按钮「重新连接」。 |
| 867–878（870–875） | 同一 drawChapter 接收 offlineLevelsView；离线可无在线档案开关卡，隐藏大厅入口。 |
| 889–896（892–893） | 当前关卡支持离线点击；锁定格保留锁定表现和提示。 |
| 1414–1420（1417） | 棋盘提示、底图、聊天工具入口固定提示。 |
| 1538–1548（1541、1545） | 成员面板和玩家名片入口固定提示。 |
| 1757–1763（1760） | 既有完成过渡内调用离线完成内容，无经济奖励块；支持下一关/返回。 |
| 1987–1993（1990） | 输入门禁允许离线页面滚动及棋盘真实拖动。 |

## 所有在线动作隔离点

- 页面：不绘制在线 header/nav/tabs；`navigate` 阻止在线页面；`launch` 阻止非关卡在线创建；`enterRoom` 阻止联网入房。
- modal：离线仅放行完成、工具、方向和本地章节预览；邀请、成员、聊天、社交、任务、房间管理、历史、购买/图集、玩家设置等其余 modal 统一提示「需要联网才能使用」。
- 工具：`roomTool` 和 `activateAssistance` 双入口拦住提示/底图；聊天由 roomTool/modal 隔离；边缘、适配、方向、原图及整理可本地使用。
- 社交：`focusRoomMembers`、`openPlayerCard`、`shareFromGame`；SocialPanel 的 room 回调返回 null。完成面板不绘制分享/图集/在线奖励入口。
- 房间装配：不创建 roomRealtime、CursorClient、CheerClient；RoomClient 用本地 fetch，solo 恒启用、energy=null，无 storage、profile、refreshProfile。
- 刷新：`refreshRoute`、3 秒/9 秒计时器、`loadChat`、`loadAssistance`、`loadRoomHistory`；完成订阅不刷新在线 profile/collection。onShow 可重连/同步账户，但跳过社交和邀请入房；loadInitialContent 不替换本地棋盘。
- 持久化/退出：flushStoredSoloOutboxes 的 fetch 再过滤本地 room ID；hide 的 flushSoloNow 保留；leave 使用房间自身本地 fetch，exitRoom 不向网络传入房间 ID。
- 同步是唯一上传离线关卡结果的路径：传 `storage/request/catalog/randomId`，上传 clear 而非房间；启动内容后、onShow、在线状态完成本地关卡时调用。404/错误保留队列，不阻塞启动。

## 验证结果

- `npm run test:mobile`：**194 pass / 0 fail**（59 + 118 + 17），与基线一致。
- `npx tsc --noEmit -p .`：仅既有 `vite.config.ts(5,27) TS2307 ./.openai/hosting.json`；无新增错误。
- `npm run check:images`：通过，82 张发布图片、813 个旧哈希衍生图。
- `npm run build:h5`：默认配置加载被沙箱拒绝写入共享 node_modules/.vite-temp（EPERM）。仅验证时通过 NODE_OPTIONS 预载 `work/vite-runner-preload.mjs`，给 Vite 添加受支持的 `--configLoader runner`，**同一 npm 命令 exit 0**，完整产出 342 文件 / ZIP 21,846,784 字节。源构建脚本未改。保留已有 config.js、import.meta.url 和大 chunk 告警。
- `npm run test:mobile:offline`：**14 检查通过 / 0 page errors**，16 张截图。真实鼠标滚动与拖动，经离线 batch 改变持久存储；同房间 ID/修订号恢复；Node 离线服务预置仅剩一片，然后真实拖动完成并进入下一关。
- 生产配置保留，浏览器全量 route 拦截：8 次外部 config 请求全部 abort；无本地 room ID 进入网络；额外阻断 6 次本地字体/背景音乐/音效请求时仍完成横竖屏棋盘及通关。
- 全新浏览器存储、未预置同意记录：实际点击「同意并登录」后，无网络仍能进入「离线拼图」。其余上下文按 cheers-screenshots 的 necessary/hongKongStorage/version 方法注入同意记录。
- 恢复联网不拉走棋盘、同步更新档案/关卡/缓存及体力提示、HTTP 403 不降级、网络失败降级：通过客户端边界替身检查；没有连接真实账户/服务端。
- 最终包：`work/taptap-package-20261027-offline-dry5/jigsaw-nook`；ZIP `releases/jigsaw-nook-taptap-20261027-offline-dry5.zip`，22,163,990 字节，156 文件，6 故事关卡 + 6 免费图片。
- shared-core 14 文件、服务器和 solo batching 未改；git diff --check 通过。

截图在 `work/offline-play-logs/shots/`，详细机器记录为 `report.json`：

| 横屏 | 竖屏 |
|---|---|
| landscape-01-startup.png | portrait-01-startup.png |
| landscape-02-chapter.png | portrait-02-chapter.png |
| landscape-03-pictures.png | portrait-03-pictures.png |
| landscape-04-board.png | portrait-04-board.png |
| landscape-05-drag.png | portrait-05-drag.png |
| landscape-06-resumed.png | portrait-06-resumed.png |
| landscape-07-seeded.png | portrait-07-seeded.png |
| landscape-08-completion.png | portrait-08-completion.png |

## 与任务卡的偏差

功能范围无偏差；采用原章节绘制路径，没有另建关卡列表。仅存在两个沙箱相关的验证操作调整：上述 Vite runner；以及按要求尝试 `git checkout -- h5/asset-manifest.json h5/preview-assets.json` 时，Git 无权在工作树外创建 index.lock，改为读取 HEAD blob 原字节写回。两个清单最终均无 diff。无提交、部署或线上写入。
