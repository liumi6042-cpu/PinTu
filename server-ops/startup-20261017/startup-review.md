# 启动首屏只读审查（2026-10-17）

已读独立项目 AGENTS.md。未编辑 app.ts/client.ts，未启动、停止或修改本地服务，未接触原 puzzle-play。本记录只描述当前源码和本地预览脚本，不表示已完成实现或浏览器验证。

**结论：**过场来自 `GameApp.draw()` 中 `!ready → drawBoot()`。`GameApp.start()` 等 `GameClient.start()` 完成配置与身份/档案读取才设 ready。已有后台拆分仅覆盖身份完成之后：`loadInitialContent()` 不等待图库和社交，但仍等待大厅。建议先让大厅外壳绘制，保留 ready 表示身份可用；不要靠构造时 ready=true 绕过身份门控。后台启动不应使用全局 busy，否则又出现持续“正在处理”。

源码入口：`mobile/app.ts` 的 start/destroy/loadInitialContent/handleQuery（125–160）、loadLobby/loadView（108–112、204–221）、draw/drawBoot/drawLobby（302–330、374–397）；`mobile/client.ts` 的 session/start/request（30–64）；`mobile/boot.ts`（7–27）已先安排首帧再 fire-and-forget app.start。

| 场景 | 当前边界与实现时应保留的行为 |
| --- | --- |
| 首次 | guest-device 顺序为 config → session → profile，正式 Web 为 config → restoreWebIdentity（auth/me，必要时 guest）→ profile。大厅框架可先画、用户数值用待载入占位；配置未到不能误显示默认体力/券/广告权限。每日按钮已有 !profile 禁用，但 enterRoom/launch 自身无 ready guard。收藏、好友、筛选点击也会触发请求，必须让身份相关动作共享启动完成屏障。 |
| 回访 | guest-device 本地 token 仅省去 session POST；config/profile 仍重取。正式 Web 重用原 guest secret/cookie，不能从展示缓存恢复可写身份。loadLobby 的 ownerKey 与 serial、loadView 的 ownerKey 与 revision 保护须保留：过早以空 owner 发出的响应会在 profile 到达后被丢弃。 |
| 401/离线 | 正式 Web 401 清 profile/account/ticket、置 authRequired，并通过 onChange 让 app 退出房间；不要为了大厅首帧绕过此隔离或自动重放建房/购买。guest 过期头会清 token/ticket，但不会清一个此前成功的 startPending；若重连按钮再次只调 client.start，可能拿旧已完成 promise，需确保重连实际刷新身份。错误应在大厅内给重试/登录入口，不能重新退到整页 boot。 |
| 邀请 | 初始 loadInitialContent 保留“邀请优先于无关图库/大厅请求”。建议首帧大厅可见后，身份完成再执行邀请一次。handleQuery 在 !ready 时直接 return，且执行前就记入 handledQueries；onShow 在启动中收到的新 query 可能丢失，失败后的 query 也可能无法重试。不要并发派发相同 query/重复 join。 |
| 销毁 | 当前 start 在 client.start 后和 initialContent 后检查 destroyed，避免晚注册 timers；destroy 会清 onChange、监听、interval 和 view revision。新增后台 promise 的所有回调同样要检查 destroyed/owner。特别是 onShow 已经开始的 refresh/query、等待 join 的 enterRoom，不应在销毁后创建 board/cursor 或回写页面。 |
| 重复启动 | GameClient.startPending 合并启动中请求，失败后可重试，成功后永久复用。GameApp.start 当前没有自己的单次/并发保护，会重复注册 hide/show 和三组 interval；新重连入口应复用生命周期监听，不能重复调用整套 start 注册逻辑。 |

**最小聚焦验证建议（一个新启动测试文件即可）：**

1. 延迟 config/session/profile 三段，真实 GameApp 的第一帧已绘制“拼图大厅”且没有 drawBoot；此时数字占位、需要身份的操作不发 mutation，不出现“空大厅已加载”的假结论。各段放行后只补齐真实数据。
2. 回访 token/cookie 两条路径：token 不新建 session，正式 Web 不发 H5 session；gallery/social 一直 pending 也不阻止大厅和首批房间；账号变更丢旧响应。
3. config 网络失败、profile 401、guest 过期后重试：大厅保留、显示可用重试/登录；重连确实重取且不重放 mutation。
4. 带初始邀请、启动过程中 onShow 相同邀请：首帧大厅后只 join 一次，gallery/social 不抢前；邀请失败可显式重试。
5. 分别在 config/profile/lobby/join pending 时 destroy，然后 resolve/reject：不创建新 timers、board/cursor，不晚写 UI；重复 start 两次只有一组监听、三只 interval 和一次初始化请求链。
6. 浏览器仅做一个定向检查：拦住 profile，让 Canvas 首帧文字包含大厅且没有“正在连接游戏”；放行后可加入一个本地房间。失败路径/身份分支优先用异步单测，不扩大全库或重复画面套件。

现有 `tests/shared-view-performance.test.mjs` 11 项已覆盖 in-flight 去重、跨账号响应、mutation revision、销毁、身份完成后图库/社交不挡大厅及邀请优先，但 fixture 默认 ready=true，不能证明本次首帧目标。可保留该文件与 `tests/shared-web-cookie.test.mjs`，新增上面启动边界；无需为未改画板重复跑 board 性能采样。

**3223 本地预览方式：**从 `D:/chat/拼图/jigsaw-nook-taptap` 运行 `node scripts/start-web-shared-preview.mjs`。脚本默认前台 3223、后端 3221，只绑定回环，先检查两端口未占用；复用准备好的 engine（缺失才编译）、以 prepareAssets:false 构建 outputs/shared-desktop-web，再启动 isolated gateway 和静态代理。数据在 data/shared-web-preview，不继承生产指针/真实玩家库，可只读使用 content-admin 现有配置。`config/mobile-platforms.json` 的本地 web 未设 web-cookie，因此它验证 guest-device + web runtime 外观；正式 Web cookie/401 分支需要现有 cookie 单测或显式测试配置，不能仅凭 3223 成功声称正式登录链完整。已有 3223 时不要再开第二个后端或贸然重启，主代理按其进程复用/重建本轮 bundle。

根会话最终收口：3221/3223 已有服务，本轮只重建客户端，没有停服务/清库。桌面及横屏的延迟网络浏览器4项通过，截图已目测，细节见browser-report.json。Stage旧down.target跨身份失效边缘已由根会话修正：authRequired回调发送现有cancel输入并清pointer，原401测试组增加真实down→身份失效→up不能触发旧业务动作的断言，启动8项仍通过。最终源摘要与构建摘要见verification.json；大厅首屏及正式Web预载均只在本地，未上线。

## 实现后新增专项结果

根代理完成产品实现后，独立新增 `tests/shared-startup.test.mjs`，只改测试和本记录；没有修改 app/client/ui/boot 等产品源文件。补入空 onShow 保留初始邀请回归后，运行 `node --test tests/shared-startup.test.mjs`，最终 8 项通过、0 失败，日志为本目录 `shared-startup-test.log`。

测试使用真实 GameApp、Stage、GameClient 的内存 bundle 与可控延迟网络：手机和桌面在 config/profile pending 时已绘制大厅/金额占位、无“正在连接游戏”，真实 Stage 无底层动作 hit、不发业务写请求；首次 session 正常创建，回访复用；双 start/onShow 只有一次初始化、一组监听和三只 interval；离线失败在大厅内点击真实 Stage 重连恢复；正式 cookie 401 在大厅显示登录且重试保留身份恢复顺序；启动中邀请只 join 一次且先于图库/大厅；config/profile 的迟到成功或失败不在销毁后建立 timers/回写 UI；join 在销毁或身份失效后返回不创建 room/board/cursor。邀请先后测试仅在 attachTicket 边界替换无关房间图像循环，最后一项直接调用真实 attachTicket 检查晚响应拒绝。

追加第 8 项固定 `initialQuery={room:roomId}`，profile 挂起时触发空 onShow，放行后由真实 GameClient 只发送一次该房间 join，且 join pending 期间不先发 gallery/lobby。根代理的非空 query 覆盖条件满足此回归。

本轮 start/Stage 生命周期复看未发现需立即修复的新问题：startupPending 合并并发，startupHooks 避免重装监听，timers 仅建一组，destroyed 分支阻止晚注册；withoutInput 用 try/finally 复原 inputSuspended，真实首屏未注册旧身份动作。一个既有低影响边缘是 Stage 保存 pointer-down 的旧 target，若按住按钮途中身份失效，单纯重绘会清 hits 而不清该 down target，松手可调用一次旧按钮回调；服务端与 client 身份校验仍拦业务操作。本轮未改此既有输入行为，也未扩大测试/产品范围。
