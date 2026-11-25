# 列表返回、无变化刷新与图片准备状态

日期：2026-10-17。此说明只覆盖本轮 `mobile/app.ts` 与新增专项测试；未发布。

## 文件和范围

- 进入本轮实现前已备份：`baseline/app/app.ts`。
- 实现：`../../jigsaw-nook-taptap/mobile/app.ts`。
- 新增专项：`../../jigsaw-nook-taptap/tests/shared-navigation-refresh.test.mjs`。
- 本分工没有修改拼图画板、社交面板、ViewRequests、服务端、协议、经济规则或正式数据库。

## 最终行为

- 使用当前会话的列表快照，保存图库来源/图包/筛选/选图、收藏页签/相册/相册侧栏位置、装饰筛选/选择、大厅筛选与列表滚动；保留 routeStack 的导航规则，并保存对应每层语义快照。
- 进入房间前保存来源及返回栈。房间左上退出仍完成 cursor stop、解绑、取消订阅、leave 与 board destroy，然后回到来源列表；可继续返回原先图库或图包列表。侧栏进入大厅仍明确去大厅。
- 真正改变方向、筛选、相册、收藏页签、图包或装饰拥有状态时回顶；重复选择相同条件不再清零。账户切换清空导航快照及进房来源。无跨登录/跨浏览器持久化。
- 将主页面滚动 clamp 移到当前场景布局/extent 计算完成之后，防止恢复位置被上一页 extent 截断；内容缩短和视口变化后仍进入合法范围。浮动任务窗口继续使用自己的滚动值。
- 大厅 quiet 读取比较卡片实际展示/可加入语义，忽略 serverTime、elapsed 等未展示字段。相同结果保留 rooms 数组并不触发重画；人数、进度、标题、缩略图、加入状态、卡片增减/顺序、分页 cursor 等变化继续生效。quiet 请求不展示瞬时加载状态；主动加载、分页和错误仍完成可见状态更新。
- 空聊天不建立 Map、不替换 messages、不重画；重复语义消息也保留原数组。新消息、消息显示字段变化及实际未读状态变化继续更新；cursor 与 seen 始终按响应推进。
- 使用画板 `imagePreparation` 的真实阶段显示“正在加载图片…”或“正在准备碎片 x/y…”。只有 ready 才将 imageReady 设为 true。重试再次失败会恢复 imageError，保留重试入口。

## 已完成的必要验证

运行：

```text
node --test tests/shared-navigation-refresh.test.mjs tests/shared-view-performance.test.mjs tests/shared-web-navigation.test.mjs
```

首轮结果：22 项通过，0 失败（新增 8 项、既有页面性能 11 项、既有 Web 导航 3 项）。新增测试在真实 GameApp 方法上替换房间网络/画板图像工作，覆盖 attachTicket → exitRoom → 多层 back 及完整离房清理，免费图库和图包来源的独立位置，相册/装饰选择，未变化/改变的筛选，账户隔离，当前布局与内容缩短 clamp，大厅 quiet 相同与变化/分页/错误/过期账户响应，空聊天/重复/真实消息，以及真实准备阶段和再次失败后的重试按钮。

独立审查追加修正：账号清理时无条件将浮动任务页签重置为 `tasks`，避免其他底页上打开的礼包浮窗继承前一个账号页签。新增第 9 项通过真实 `start → client.onChange` 验证该行为。修正后只重跑受影响的新专项文件，结果 9 项通过、0 失败。当前三个文件合计 23 项，最终组合复核交由根代理统一执行。

运行严格依赖闭包类型检查：

```text
node node_modules/typescript/bin/tsc --noEmit --skipLibCheck --strict --esModuleInterop --resolveJsonModule --target ES2020 --module ESNext --moduleResolution bundler --lib dom,dom.iterable,esnext mobile/app.ts h5/ads.ts
```

结果：退出码 0。`h5/ads.ts` 提供现有 `Window.tap` 全局声明；单独只传 app.ts 时会漏掉该声明，补入已有声明源后检查通过。

本分工未运行全库测试、完整构建、浏览器画面验收或发布；根代理负责本轮统一集成检查及必要浏览器验证。
