# 平台房间服务与当前联机优化评估

2026-10-20 复核与当前建议见文末。本项目现在已有自有 WebSocket 推送和操作通道；下方 10 月 17 日的 HTTP 现状与优先增加 WebSocket 建议属于历史记录。

日期：2026-10-17。用户要求启动管理后台，并核对微信、TapTap提供的房间服务能否节约服务器资源、降低延迟。本轮是调研与建议，没有授权开通、迁移或改造联机协议。管理后台已在127.0.0.1:3214启动，真实HTTP返回200；已请求在应用内打开。

## 结论与建议

TapTap新小游戏服务可确认提供房间管理、自定义消息与帧同步，用户控制台截图标示免费，值得作为通信候选。微信官方仍定义原生房间/帧同步API，但本次未核实目标个人账号当前能否开通、生产计费和免费配额。两边均不能仅凭“有房间”就替代本项目的权威规则、长时间存档和奖励结算。

调研时优先建议：在已有服务上评估统一WebSocket实时推送，保留既有身份与业务校验，减少频繁轮询；TapTap可另做隔离双人通信试验后再决定是否采用。用户随后已授权WebSocket与位置平滑，本地实施和验收见[2026-10-17-realtime-sync.md](./2026-10-17-realtime-sync.md)。平台房间服务、生产服务器、CDN和已发布内容没有因此切换，后文未实施方案保留为本次调研时的候选与边界。

## 官方能力核对

| 服务 | 已确认 | 未确认或对项目的限制 |
| --- | --- | --- |
| TapTap新小游戏多人联机 | `tap.getOnlineBattleManager`，基础库2.7.0+；建房、匹配、入房、玩家通知、自定义消息 | 是Tap宿主API，普通浏览器不能只改URL使用。当前免费服务的独立Web/微信同房、免费CCU/流量上限、长期持久化与自定义权威逻辑接入点未查实。截图的小游戏不依赖登录与教程的登录前提存在差异，不能套用原生SDK登录要求。 |
| TapTap自定义消息 | 单条UTF-8最大2048字节；与房间属性更新共享每秒15次限制 | 文档未说明该频率按房间、连接还是其他口径统计，不能直接算本游戏可容纳人数。500片完整快照不能假定可塞进一条消息；小量光标/拖动预览可列为试验对象。 |
| TapTap帧同步 | 输入按帧分发；开始后房间相关API不可用，停止/输入帧接口除外；存在30分钟自动停止事件 | 不能把帧同步时限说成所有自定义消息房间的寿命。对长时间、可中途加入/离开和隔日恢复的拼图，不建议直接采用竞技类连续帧同步方案。 |
| 微信原生GameServerManager | 微信官方现行自动生成类型仍有创建/加入房间、广播、帧同步与补帧；最低基础库2.8.0，单局gameLastTime最大3600秒，房间/成员扩展各32字节 | 类型定义存在不证明当前账号可开通、免费或可用于生产；账号资格、额度、人数上限及跨宿主接入未核实。上述对局时间也不是长期存档承诺。 |
| 腾讯云旧MGOBE | 官方于2022-03-29公告，2022-06-01下线 | 旧教程里的免费额度、就近节点和房间SDK不应作为今天可接入的方案；它不是微信原生GameServerManager。 |
| CloudBase Realtime | 官方另有Broadcast/Presence/数据库变化订阅，提供Web与小程序接入资料 | 这是另一项云后端传输能力，存在套餐/资源计费；不是微信免费游戏房间。小游戏/TapTap宿主与具体费用未验证，不作为本轮推荐迁移目标。 |

TapTap旧v3多人在线对战JS SDK确实列过Web/微信支持；它属于`@leancloud/play`一代，不能据此承诺截图的新免费服务也能跨端，同样不能笼统说TapTap所有联机产品都不支持Web。当前通用原生v4的20人上限也不直接套到小游戏JS页未写明的人数限制。

## 与本项目现状的对应

- 客户端规则与画面共用，但联机目前仍通过自有HTTP接口。`lib/room-sync.ts`活动调度间隔300ms，空闲退避到2秒、隐藏4秒；`lib/room-cursors.ts`光标最短200ms，实际周期还受请求耗时与退避影响。
- `RoomClient`还有5秒心跳、拖动租约和操作请求；`CursorClient`单独交换光标。服务端在SQLite事务中裁决拼块占用、移动、合并、保存与结算，使用请求ID和唯一约束保护奖励幂等。消息转发或平台ACK不等于这些规则已验证。
- 当前配置中微信与TapTap均使用`/h5-mobile-v3`，正式Web使用自己的`/api/shared`适配和玩家库。共用前端和公开配置不代表三端已经同房互通；本轮不改变原先Web/手机独立的边界。
- `mobile/platform-web.ts`已有Tap请求/广告宿主适配，但没有平台多人房间适配。房间服务不能作为一个新的HTTP地址直接填入配置，需改造传输、身份映射、房间ID映射、掉线恢复和权威确认流程。

## 能节省什么、延迟为何可能降低

实时推送或平台广播可以减少空轮询、重复HTTP头和部分序列化/转发负担，光标和拖动预览有机会更及时地传给同房玩家。它不会自动减少原图/缩略图下载、账号与后台接口、正式存档、购买或奖励校验的开销；目前没有统计各项在总账单中的占比，不能承诺省掉整台服务器或给出节省百分比。

延迟主要取决于玩家到接入节点的往返时间、排队与消息发送方式。去掉主动等待下一次轮询的时间是明确方向，但任何平台迁移都仍需目标地区真机测量，增加桥接还可能增加往返。接入某个平台不等于所有用户必然更快。

如果只把光标/拖动预览搬到平台，而正式状态仍继续原频率轮询，资源收益也会有限。要实质减少房间读取，应让服务端在合法操作后主动发送已确认增量，并保留断线时版本校验/补快照；不能靠客户端相互宣称“已经拼合/已经领奖”来删掉权威接口。

## 后续可审查的小范围方案（未实施）

1. 用现有后端与两个隔离客户端记录当前消息数、上下行字节、操作至对端可见时间及服务器CPU，选普通拖动、光标移动、空闲和重连四个场景。
2. 在同一套业务规则外增加传输适配，先比较自有WebSocket与Tap宿主自定义消息候选。账号、付费相册、租约/合并裁决、长期存档和奖励仍留原后端。若平台没有可验证的服务器接入点，不用客户端转发结果替代确认。
3. 用同图同人数比较延迟中位数及较慢场景、消息/字节和CPU，同时验证双人抢同一片、重连恢复、房主离开、重复落子与奖励不重复。平台免费配额、当前宿主可用性及跨端范围先得到明确依据再扩大迁移。

上述平台对比及生产压测尚未执行；后续授权的自有WebSocket本地检查单独记录，不将其当成TapTap/微信房间服务已接入。上一轮大厅首屏增量仍为本地待上传，本次未顺带发布。

## 来源与原始笔记

- [Tap小游戏管理器](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/tap.getOnlineBattleManager/)、[消息限制](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/OnlineBattleManager.sendCustomMessage/)、[帧同步限制](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/OnlineBattleManager.startFrameSync/)、[事件与超时](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/OnlineBattleManager.registerListener/)。
- [Tap当前功能说明](https://developer.taptap.cn/docs/sdk/tap-online-battle/features/)、[旧v3 JS支持范围](https://developer.taptap.cn/docs/v3/sdk/multiplayer/start/js/)。
- [微信官方类型仓库](https://github.com/wechat-miniprogram/minigame-api-typings)、[准确类型文件](https://raw.githubusercontent.com/wechat-miniprogram/minigame-api-typings/master/types/wx/lib.wx.api.d.ts)。官方API正文公开抓取失败，未用失败推断停服或不可开通。
- [腾讯云MGOBE停服公告PDF，第4页](https://main.qcloudimg.com/raw/document/product/pdf/1038_67671_cn.pdf)。
- [CloudBase Realtime快速开始](https://docs.cloudbase.net/api-reference/webv3-pg/realtime/quick-start)。
- 完整按产品代际区分的资料与未核实项：`D:/chat/拼图/server-ops/platform-multiplayer-20261017/taptap-notes.md`、`wechat-notes.md`。

## 2026-10-20：哪些功能适合交给 TapTap

用户在讨论 CDN 和预置图片后提出“要不接入 TapTap 提供的多人联机能力，看看哪些可以交给它”。本轮完成当前官方文档复核和代码职责对照；没有开通服务、迁移协议、改生产或上传包。此前 50–100 MB/玩家小时只是没有真实会话测量支持的采购假设，已向用户撤回，不能拿它证明本次迁移一定有多少收益。

### 本轮重新确认的官方事实

以下依据小游戏专用 `tap.getOnlineBattleManager` 文档，不把原生 v4 或旧 LeanCloud JS SDK 的支持范围混用。

- [管理器入口](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/tap.getOnlineBattleManager/)：基础库 2.7.0 起，低版本需要兼容；获取全局单例。文档已列建房、匹配、列表、入房、离房、踢人、属性、自定义消息和事件。
- [连接](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/OnlineBattleManager.connect/)：平台分配 `playerId`。它不能直接当作已有游戏账号 ID，需要与现有登录和游戏房间成员绑定。
- [建房](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/OnlineBattleManager.createRoom/)及[房间属性](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/OnlineBattleManager.updateRoomProperties/)：房间、玩家自定义属性最多 2048 字节，房间属性仅房主修改。这是元数据渠道，不是可直接容纳完整拼图的存档库。
- [自定义消息](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/OnlineBattleManager.sendCustomMessage/)：UTF-8 消息最多 2048 字节；支持房间内或队伍内所有玩家；与房间属性修改共享每秒 15 次限制。文档仍没有给出限制的按玩家/按房间等统计口径。不能套用原生 v4 的定向用户列表能力。
- [帧同步](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/OnlineBattleManager.startFrameSync/)开始后房间相关 API 受限，明确仅可发送帧输入、停止帧同步；[事件页](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/OnlineBattleManager.registerListener/)有 30 分钟超时停止原因。该时限适用于帧同步，不是自定义消息房间寿命。
- 自定义消息、玩家进出/掉线事件有公开接口；本轮仍未读到当前小游戏服务明确的空房保留、消息补发、重新进房、服务器发布已校验结果或部署自定义业务逻辑的承诺。应保留为待确认，不能断言平台不提供。
- 事件页的表格、参数段和示例回调名称不一致（如 `onCustomMessageReceived` 与 `onCustomMessage`）；后续适配须以目标宿主双端真实回调验证，不能只复制示例宣布接通。
- [公开 TDS 价格页](https://developer.taptap.cn/product-intro/price)仍有多个服务与旧对战计费。无法据此证明当前小游戏联机入口的无限免费，也不能拿旧服务价格直接报价；当前账号是否开通、免费并发/流量额度、超额规则均未在本轮后台核实。

### 对照当前代码的交接表

| 游戏职责 | 建议归属 | 原因与边界 |
| --- | --- | --- |
| 鼠标/手指位置、拖动中的视觉预览 | 优先试用 Tap 自定义消息 | 高频、临时信息，最适合减少自有服务器的持续转发。只改变预览，不把客户端广播当作正式落片。 |
| 在线通信房间的创建、加入、离开、掉线通知 | Tap 可承接会话层 | 对应平台房间与事件；游戏自己的稳定房间 ID、8 人准入和权限仍由游戏服务保存及检查。 |
| 选图、片数、就绪/暂停等小元数据 | Tap 属性或自定义消息可承接 | 属性仅作在线展示，实际图片授权、当前游戏版本和模式仍以游戏服务确认信息为准。 |
| 表情、预设短语的即时展示 | 可走 Tap 消息 | 历史记录、屏蔽、举报和文字内容治理仍需原有业务层；不是把自由聊天与记录一起移走。 |
| 抢块、拿起、放下、合并、最终位置 | 继续由游戏后端裁决 | `lib/room-engine.ts` 的租约、合并、序号与边界校验及 `server/mobile-service.mjs` 的事务/幂等不可省略。通信 SDK 不替我们判断谁有权移动和是否真的拼合。 |
| 已确认结果向同房玩家分发 | 后续可研究平台承接 | 需要平台可验证的服务端发布入口，或签名结果转发、版本补偿等设计；当前原生客户端转发不能视为可信结果，先保留原通道。 |
| 长期共享拼图进度、最近十间、自己的房间列表删除与名额 | 保留自有服务器 | 这些是跨会话业务记录，不能依赖临时平台房间存活；所有人退出后仍须能恢复。 |
| 账号、金币、体力、任务、图鉴、购买、结算 | 保留自有服务器 | 属于权威业务与资产，平台房间和消息模块没有替代现有校验与事务的已确认能力。 |
| 独立 Web / 微信与 Tap 同房 | 继续现有能力，另核跨端支持 | 独立浏览器没有 Tap 宿主 API；未证实新小游戏联机服务的跨端认证和共房支持。旧 v3 JS 可跨端不能直接套用。 |

当前客户端 `lib/room-realtime.ts` 已有实时流接口，光标在 `lib/cursor-client.ts` 最高约 15 次/秒，正式操作另有独立有序通道；服务端 `server/room-realtime.mjs` 按接收方认证上下文发送拼图增量和光标列表。Tap 消息不能原样替换 WebSocket URL，且原有 15 Hz 光标已经触及文档频率数字，需要合并消息、留余量和真机确定限制口径。

### 推荐的第一阶段（方案，未实施）

1. 只针对 Tap 宿主、优先在 Tap 玩家专用测试房增加平台通信适配。Web 与微信保留已有传输，平台能力缺失或连接失败时有明确回退；避免双通道同时重复发送同一份坐标。
2. 将光标和拖动预览合并为小消息，经 Tap 分发。需要先获游戏服务器的拼块占用许可，预览不触发奖励；服务器租约心跳保留，只有最终放下才以合法序号提交正式位置与结算。不能只额外广播预览，却保留全部原高频 `move`，然后声称已节省。
3. 正式 claim / drop / release、保存与回读继续使用现有服务。落片失败、体力不足、租约过期或重连时以服务器状态修正预览。完整快照仍从现有后端读取，不拆成无保障的 2 KB 房间属性存档。
4. 平台房间只是在线通信渠道。保留稳定游戏房间 ID 与会话房间映射的可更新关系；即使平台空房消失，也可从已有存档重新建立通信会话，不改变历史记录、自己的房间列表删除及长期保存规则。映射的并发创建、过期和成员绑定需在原型中验证。
5. 混合宿主同房会需要桥接或回退，这可能保留部分自有转发量；不可暗中把原本可同房的手机玩家拆开。独立 Web 与手机线上库本来独立，本轮不合并也不新增拆分。

### 进入真实迁移前的最小核对

- 当前账号/H5 宿主实际有此 API，基础库与服务开通满足条件；无需为了研究擅自升级、购买或同意服务条款。
- 免费范围、并发/人数/流量限制和超额行为有当前账号的明确依据；多宿主是否同房单独确认。
- 双手机验证回调名称、发送身份与游戏成员绑定、消息顺序/丢失、8 人频率限制、切后台/房主退出和全员离开后恢复。
- 在相同操作、同人数下记录自有服务器下行字节、平台消息数和操作至对端可见延迟；单人、双人和多人分开统计。不能用“接通了”代替更省或更快的证据。
- 不使用 30 分钟帧同步来承载可玩几小时、可中途加入并隔日续玩的房间；首阶段采用自定义消息，业务服务器继续持有唯一正式进度。

本轮文档公开读取证据：`work/taptap-platform-review-20261020/official-round1.json`、`official-round2.json`、`official-round3.json`。未对正式游戏做任何迁移，没有产生平台联机服务费用。

## 2026-10-20：第一阶段本地实现与联调结果

用户确认“好的，开始吧”后，已完成指定 TapTap 测试私房的光标与拖动预览适配。状态为**代码、本地联调和本地打包完成；真实 TapTap 双机未验证；未部署、未上传、未切换正式房间**。上文“推荐的第一阶段（方案，未实施）”保留为实施前的方案记录，以本节为当前结果。

### 开启范围与职责

- 默认关闭。测试后端通过 `MOBILE_TAP_PREVIEW_ROOM_IDS` 配置逗号分隔的房间 ID；空白名单不启用，最多 32 间。房间必须为未完成、非 diagnostic 的私房。程序化本地联调可传 `createMobileService({tapPreviewRoomIds: Set})`。
- `POST /api/rooms/:id/tap-preview` 提供 `reserve / publish / ready / renew / leave`。沿用房间 Bearer、session 与成员校验，并要求已绑定 TapTap；它不提供金币、体力、存档或奖励写入接口。
- 平台会话及玩家映射仅保存在内存；创建者租期 12 秒、成员绑定有效期 20 秒、客户端每 7 秒续期。epoch 与递增 serial 防止旧响应覆盖新会话。稳定游戏房间 ID、最近十间、自己的房间列表规则不变。
- `mobile/tap-preview.ts` 包装原实时流；`lib/room-preview.ts` 定义可丢弃预览。`server/tap-preview.mjs` 负责测试会话协调，三个后端打包清单已包含它。Web、微信、普通房和缺少宿主接口的情况保留原通道。
- 平台消息只投影到渲染状态，不修改权威拼图。claim 确认且租约有效后才发送拖动预览，lease 增加随机 `previewId` 区分新旧拖动。claim、drop、release、心跳、存档与奖励继续由原服务器校验。

### 消息验证与回退

- 同房活跃成员必须全部具有唯一 ready 平台绑定，并通过 nonce 双向消息确认，才停止原高频坐标发送。SDK 返回“入房成功”不足以启用；无法收到消息时原通道继续，探测约 6 秒失败后关闭平台会话。
- 光标和拖动合并为最多 2 KB 的小消息；每人最多约 4 Hz，并随人数按 `floor(10/N)` 降频。原生发送仅允许一个在途，只保留最新值。该频率是保守实现，尚未证明满足平台实际统计口径与所有并发限制。
- 校验发送者平台 ID、游戏成员绑定、epoch、消息序号、租约代号与有效期；兼容官方两种自定义消息回调名称，重复消息去重。平台不能产生动作 ACK 或消耗权威操作序号。
- 平台消息静默中断约 3.5 秒后恢复原通道；回退同时保留原光标发送及接收，清空旧拖动预览，恢复后不重放旧坐标。普通成员加入、切后台、离房、过期租约或平台失败也会停止预览。
- 原生单例只在入房后获取。退出先等待已发出的原生调用与解绑，避免不同房间调用交叉；原生超时无法取消时保守禁用该单例的再次使用，继续原同步，重新进入游戏后再尝试。

### 验证与证据边界

- 38 项定向测试通过，TypeScript 类型检查通过。覆盖测试房准入、抢块、幂等奖励、预览投影、消息去重、限频、慢发送、缺接口、混合成员、旧租约、丢包、回退光标收发、原生超时及离房交叉等。
- 两个独立 GameClient/session 连接真实本地 HTTP/WebSocket 网关和内存 SQLite 服务；平台 SDK/消息转发为模拟。20 次拖动输入在健康平台阶段没有产生后端 `move`，后端仅有 claim；失效后新移动恢复原通道，再正式 drop，权威序列为 `claim, move, drop`，ordinal 为 `1,2,3`。预览期间权威拼图保持不变。
- 最新生成入口的延迟宿主注入、临时登录失败恢复检查通过；这是模拟宿主的启动检查，不是真机多人验证。
- 未验证真实 TapTap 账号服务资格、免费额度、真实回调、双手机延迟、多人限频、长时间与切后台表现；不能给出真实节省百分比，也不再使用未经实测的 50–100 MB/玩家小时作为基线。
- 全库图片检查仍报原有 `衍生图片记录无效：cel-coastal-family-v1`；未放松校验或修改素材。旧 `tests/room-client.test.mjs` 使用过期 `seaside` 夹具，在创建房间时即失败（400/201），尚未执行到 RoomClient；未纳入通过数量。本次入包图片已由规划器核对内容哈希、字节数和 WebP 头。

验证命令：

```powershell
node --import ./tests/ts-register.mjs --test tests/tap-preview.test.mjs tests/tap-preview-integration.test.mjs tests/diagnostic-drag-pipeline.test.mjs tests/realtime-cursor-client.test.mjs tests/mobile-room-client.test.mjs
node node_modules/typescript/bin/tsc --project work/room-history-typecheck.json --noEmit --incremental false
node --import ./tests/ts-register.mjs work/taptap-preview-20261020/bundle-smoke.mjs
```

记录位于 `work/taptap-preview-20261020/`：`focused-tests.log`、`typecheck.log`、`verification.json`、`bundle-smoke.json`、`implementation.diff`、`final-source-hashes.json`。54 个客户端构建输入的 `source-receipt.json` 已与当前源码复核一致。

### 最新本地产物与后续真机条件

- 包：`releases/jigsaw-nook-taptap-20261020-platform-preview-verified.zip`
- SHA-256：`3ae97aad24339b5dd1842d891356547ecde1e88d817ff8acab7db99eb2433ba3`
- 88,975,611 字节、248 文件。包含当前手机可见的 115 张拼图用图和 122 张主题缩略图；网页图库专属图不打包。资源依据内容版本 `release-20261020T070831334Z-f6f57f55` 规划，哈希变化时保留在线回退。
- 官方 CLI 仅 dry-run，包结构无违规、无警告，`networkRequests=0`。记录为 `upload-dry-run-verified.json`；未执行上传或审核主包绑定。
- 同目录此前的 `platform-preview-local.zip`、`platform-preview-local-final.zip` 是较早代码产物，已被本包替代，不作为本轮最终交付。
- 此包需要配套当前源码的隔离测试后端和明确指定的测试私房；现有正式后端不会提供本次测试描述。它不是现在就能扫码体验平台通道的线上包，也不能直接替换审核主包。
- 下一阶段先确认账号服务与额度，再配套隔离测试后端、指定私房及自测包，完成真实双手机验证后决定是否扩大范围。本轮未改生产数据库、房间、余额或正式 Web/手机发布指针，`puzzle-play` 保持不变。

### 后续：用户授权上传自测版本

用户明确要求“上传，我去自测”后，已上传上述 SHA-256 对应的 verified 包。TapTap 自测版本 **337676**、上传包 **102425**，回读 `boundMainPackage=false`、`is_releasing=false`；二维码为 `releases/taptap-test-337676.png`。未绑定主包、未提交审核、未发布、未部署后端。

上传前已再次核对：客户端仍连接 `https://jigsawnook.online/h5-mobile-v3`，该正式后端尚未部署本次平台预览接口/白名单。本二维码可用于当前客户端启动、预置图片和原同步路径的设备检查，**不能据此验收新的 TapTap 平台同步通道**。测试平台通道仍需配套隔离测试后端及指定私房；上传本身不代表该条件已满足。此前各构建记录中的 `uploaded=false` 为构建时状态，以本节及上传回执为最新上传状态。

上传及回读证据：`work/taptap-preview-20261020/upload-result.json`、`before-list.json`、`after-list.json`、`qr-result.json`、`selftest-status.json`。

## 2026-10-21：独立真机测试后端（当前）

用户明确要求“配置后端，我需要测试这个功能”，已新增独立测试服务。上节 337676 仍连接原手机后端，应改用本节配套的新自测包。真实 TapTap 双机消息互通仍由用户扫码验证，后端上线不等于平台通道已在真机通过。

### 部署与隔离

- API：`https://jigsawnook.online/h5-tap-preview`；WebSocket：同路径 `/realtime`；健康检查：同路径 `/healthz`。
- 服务：`jigsaw-tap-preview.service`，仅监听 `127.0.0.1:3297`。代码：`/srv/sites/jigsaw-tap-preview/releases/20261020-preview-v1`，独立数据库及会话：`/srv/sites/jigsaw-tap-preview/shared/`。
- 仅白名单私房 `993f1b85bd048ccf71155f74d0d9c597` 启用，随机选图 `new-c9d0f62b9a9536ed-v1`，300 片档实际网格 299 片。创建后已让准备账号离房，两个公网检查账号也已退出，不占活跃人数。
- 使用同一应用的真实 TapTap 登录校验；必要配置只在服务器内读取并写入 root 可读的独立环境文件，密钥未下载、未打印、未入客户端。没有伪造平台绑定或为真机测试放宽身份校验。
- 新库不导入正式账号、金币、历史、聊天或房间。正式手机及 Web release 指针未变，没有重启正式游戏服务。Nginx 只增加带独立标记的测试路径，并完成配置检查、reload 与公网回读。
- 静态图片固定引用手机 release `20261020-ad-energy` 的只读资源和现有公共内容，正式数据库未复制。测试服务的所有数据库及衍生写入都在自己的 shared 目录；关闭广告奖励，避免把本轮联机检查扩展到广告发奖。

### 自测入口与状态

新的客户端只在该独立构建内携带 `previewTestRoom`，并将 API 指向测试路径。`mobile/entry-web.ts` 仅在 TapTap 且 API 路径精确为 `/h5-tap-preview` 时采用该配置，登录后自动进入指定私房；标准包未设置此字段，保持原行为。

测试房上方显示当前通道；设置内显示平台消息发送/接收数量和失败阶段。单人就绪仅显示“等待另一账号”，有对端双向消息确认才显示“平台同步已接通”。测试状态每秒刷新，仅影响带测试配置的包。

推荐设备检查：

1. 两部手机、两个不同 TapTap 账号扫描新的同一个二维码，登录后进入同一私房；首次进入仍需完成现有隐私选择。
2. 两端等待“平台同步已接通”，在设置内观察发送/接收计数随拖动增加。只有原服务器同步字样时，不能算平台通道通过；保留失败状态供定位。
3. 一端拿起并拖动，另一端观察预览；松手检查双方最终位置一致，再反向操作。
4. 一端切后台、返回或退出，检查另一端继续可操作、回退无卡死；本阶段失败后保守沿用原通道，若要重新尝试平台会话，退出测试房并重入，或结束游戏后重新扫码。重新进入时原拼图进度应仍在。
5. 两端抢同一片、拼合及退出重进仍以原后端结果为准。独立测试服的金币、体力与进度不计入正式服。

### 检查结果与产物

- 公网 HTTPS、TapTap 实际来源 CORS、两个独立会话入私房、私房测试描述和公网 WSS 均通过。未绑定 TapTap 的会话访问预览协调接口得到 403，身份边界保留。公网入房首检因漏加现有素材快照头返回 409，修正检查请求头后通过；未修改服务端兼容规则。
- 后端实际部署文件哈希与本地 overlay 清单一致，正式 Web、正式手机和测试服务均 active，正式 release 指针回读保持原值。
- 38 项联机定向测试、TypeScript 检查通过；新生成入口的晚注入登录、临时登录失败恢复和独立私房自动加入检查通过。平台 SDK 的真实双手机表现、账号平台服务资格/配额及真实节流口径仍待设备验证。
- 客户端：`releases/jigsaw-nook-taptap-20261020-platform-preview-device.zip`，88,976,201 字节；SHA-256 `c31759099df1cb23e017c12dc390ce696096282ae938f115e7ec2ae2b4e95e4c`。保留 115 张拼图用图及 122 张主题缩略图，不包含网页图库专属图片。
- 已上传自测版本 **337768**、上传包 **102455**；回读未绑定主包且 `is_releasing=false`，未提审、未发布。新二维码：`releases/taptap-test-337768.png`；该码替代上一轮仍连正式后端的 337676，确实指向本节隔离测试服务。最终状态：`work/taptap-preview-backend-20261020/selftest-status.json`。
- 证据集中在 `work/taptap-preview-backend-20261020/`：`deployment.json`、`public-smoke.json`、`final-server-readback.json`、`verification.json`、`source-receipt.json`、`client-increment.diff` 及构建/上传回执。不新增另一套重复策划文档。

### 停止测试与回退

`work/taptap-preview-backend-20261020/rollback-remote.py` 为已保存、未执行的服务器侧停止脚本：核对 Nginx 测试块完整匹配，只移除本次测试块，配置检查通过后 reload，再 disable/stop `jigsaw-tap-preview.service`；保留独立测试数据供复查。若标记块被后来工作修改，脚本会停止并要求检查，不整份恢复历史 Nginx 配置。正式 Web、手机服务与审核主包不在该脚本操作范围。

## 2026-10-21：真机 platform-unavailable 后的诊断增量

用户截图显示两名成员同房，但状态为 `原通道 · platform-unavailable`，说明平台分流未成功，画面中的联机仍由原服务器处理。旧客户端将初始化过程中所有异常汇总成同一条错误，不能据此判断为基础库过低、服务未开通或某个原生方法失败。本轮按用户继续排查要求增加诊断；未改帧同步策略，未重启或更新测试后端，也未变更正式后端与审核主包。

### 已增加的证据

- `mobile/tap-preview.ts` 分开保留接口获取、事件注册、连接、成员登记、建房、入房、绑定确认和消息发送的失败步骤，原生回调及 Promise 拒绝的短错误码均可显示。清理连接时的错误不能覆盖最初故障。
- 只保留步骤、分类和符合格式的短错误码；平台原始 `errMsg`、URL、登录 code、token 和身份值均不存入诊断。错误分类只依据少量关键词，属于排查线索，不代表平台返回码的官方解释。
- 设置页显示真实 `tap.getSystemInfoSync()` 返回的 `tapSDKVersion`（基础库）、`version`（TapTap 客户端版本），以及 `getOnlineBattleManager` 是否存在。缺少字段显示“宿主未返回”，不从包体最低运行版本推断实际基础库。
- 顶部测试状态条可点击打开设置，不再需要用户寻找入口；正式包未配置 `previewTestRoom` 时不显示测试信息。诊断不会获取多人单例、创建平台房间或读取额外设备标识。

### 验证与下一步

43 项定向检查、类型检查及新生成入口的登录恢复/自动加入私房检查通过。新增检查覆盖缺接口、连接失败、建房失败、Promise 入房失败、短错误码保留、原始内容不泄漏以及只读版本检查不会初始化平台单例。源码回执已与构建输入核对。

独立测试后端健康检查和配置在真实 TapTap 来源头下均返回 200；无来源的 Python 请求返回 403，保持现有来源限制，不为排查放宽访问规则。公网 WSS 的完整检查沿用本节之前已保存的部署证据，本轮未重复创建测试玩家或读写房间。

待用户使用新诊断包在一台手机上查看设置，提供失败步骤、错误码、接口是否提供及基础库版本。若缺接口或版本低于 2.7.0，先核对宿主更新与当前 H5 接口支持；若接口存在而原生调用失败，再按真实错误码核对平台服务与权限。仍需后续双机确认才能认定分流成功，不能把新增诊断写成已修复真实平台故障。

当前包：`releases/jigsaw-nook-taptap-20261021-preview-diagnostics.zip`，88,977,509 字节；SHA-256 `66c830223bc9fa550da19f00cea8480798b8290bf6787be6dc1cccc688ddfd12`。API 与测试私房保持本节前述隔离配置，房间进度不重置。

已上传诊断自测版本 **337893**、上传包 **102508**，回读 `boundMainPackage=false`、`is_releasing=false`，未提审、未发布。二维码 `releases/taptap-test-337893.png` 替代上一版 337768；最终上传状态见本轮 `selftest-status.json`。

证据：`work/taptap-preview-diagnostics-20261021/` 内的 `focused-tests.log`、`typecheck.log`、`bundle-smoke.json`、`verification.json`、`implementation.diff`、`backend-readback.json`、`source-receipt.json` 与上传回执。

本轮重新读取的官方依据：[多人管理器及基础库要求](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/tap.getOnlineBattleManager/)、[连接回调和错误码字段](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/OnlineBattleManager.connect/)、[实际基础库和客户端版本字段](https://developer.taptap.cn/minigameapidoc/dev/api/base/system/tap.getSystemInfoSync/)。

## 2026-10-21：返回玩家编号无效——兼容性修正

用户复测诊断版报告“返回玩家编号无效”。该提示来自我方对连接返回值的检查，说明已进入连接结果处理分支；尚未拿到真机原始字段结构，不能认定具体是编号字符格式、包装层还是桥接确认对象先返回，更不能当成 TapTap 已判定玩家账号无效。

### 本轮修正

- 官方 `connect` 文档规定 `playerId` 为字符串，没有给出字母数字横线的字符集限制。移除我方额外施加的 128 字符/受限字符集假设，新增共享的 `lib/tap-platform-id.mjs`：平台 ID 作为原样 JSON 值，保留标点、禁止空白和控制字符、限制为 256 字符。客户端与测试后端使用同一规则；游戏房间自己的 32 位十六进制 ID 规则不变。
- 桥接层安全整数形式的 ID 可无损转为字符串；不将不安全大整数、浮点数、对象或其他账号字段当作平台 ID。接收消息的发送者编号也作相同规范化，再按已绑定的成员身份精确匹配。
- connect、createRoom、joinRoom 只在收到有有效 `playerId` 或 `roomInfo.id` 的结果后完成。Callback 与 Promise 哪个先返回有效结果就采用哪个；只有 `errMsg`、空对象或无内容的确认不再抢先结束连接。始终只调用一次原生方法，不重发连接或建房。
- 兼容一层 `data` 的桥接包装；根字段已存在但无效时不尝试换用另一个身份值，不递归搜索，不用 openid/userId 替代。创建和加入平台房间也同步修正，避免通过连接后遇到相同问题。
- 若在原有时限内仍无有效返回，继续原通道，并保守禁止复用不能确认已结束的原生单例。设置中额外显示固定字段的类型、字符串长度及来自 Callback/Promise，不显示字段值、任意响应字段或凭据。
- 三个标准后端打包清单已包含新的共享库，避免只更新客户端而测试后端仍拒绝同一编号。

### 实际更新范围与验证

仅将独立测试服务从 `/srv/sites/jigsaw-tap-preview/releases/20261020-preview-v1` 切换至 `20261021-id-compat-v1`，复用原 shared 数据库和私房 `993f1b85bd048ccf71155f74d0d9c597`，没有重新建房或重置进度。运行时只覆盖 `server/tap-preview.mjs` 并新增共享库。部署失败时脚本会恢复旧测试 release 并重启该服务；正式手机/Web release 指针、Nginx 路由及审核主包未改。

48 项定向检查、类型检查和新生成入口自动加入私房检查通过。新增场景覆盖带标点的原样 ID、整数桥接 ID、Callback/Promise 确认与实际结果的先后竞争、一层包装、不使用其他身份字段，以及两个模拟平台客户端的身份匹配和预览互通。测试后端健康与配置公网回读 200，部署文件与本地源码哈希一致。平台 SDK 本身仍为模拟，真机具体返回变体与分流效果待本包复测，未宣称已确认唯一根因。

新包：`releases/jigsaw-nook-taptap-20261021-preview-id-compat.zip`，88,977,927 字节，SHA-256 `8f26b35e5c471bec67c16548273a1f5ab8816f169ba65f03f35aed98ed3994b9`。素材配置和测试私房保持不变。证据位于 `work/taptap-preview-id-compat-20261021/`，含 `backend-deployment.json`、`backend-readback.json`、`focused-tests.log`、`verification.json`、`implementation.diff` 和构建/上传回执。

已上传新自测版本 **337933**、上传包 **102531**，回读未绑定主包且未发布，未提审。二维码 `releases/taptap-test-337933.png` 替代 337893；先结束旧测试游戏后重新扫码，避免沿用旧脚本与原生连接状态。如仍失败，查看设置中的“返回结构”继续定位。

官方复核：[connect 返回结构与 Callback/Promise](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/OnlineBattleManager.connect/)、[createRoom 的 roomInfo.id 字符串结构](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/OnlineBattleManager.createRoom/)。一层包装和整数适配为我方兼容措施，不写成官方承诺或已观察到的真机事实。

## 2026-10-21：提频、码 11 与 CDN/高防入口方案（未实施）

用户报告新包“一切正常”，期间一次出现调用失败、拖动仍正常；追问后明确诊断为“原通道 · 加入平台房间：调用失败（码11）”。这是 joinRoom 阶段故障，不是 sendCustomMessage 发送频率故障。该失败分支会停止平台预览并保留原服务器同步，故拖动正常不能直接证明当时仍在平台分流。未拿到官方针对当前小游戏入口的码11解释，不把其他 SDK 的事件编号11或系统 errno11套用为限流结论；具体原因及恢复策略待进一步定位。

### 同步频率与平滑建议

- 当前每人上限约4次/秒，并按 `max(1,min(4,floor(10/活跃人数)))` 降频；原生单发送在途与100ms轮询也会影响实际频率，因此上限不等于真机稳定实测速率。自己的拼片本地即时响应，消息频率主要影响他人看到的运动。
- 当前手机端 `syncRemote` 直接替换非本地保护拼片的位置，未提供平台拖动预览专用插值。优先候选是双人上限6Hz（目标约167ms/次）配合对端短时插值，仅平滑预览，最终落片仍采用服务器结果。
- 官方当前 sendCustomMessage 文档仍标明与 updateRoomProperties 共享15次/秒，没有明确按玩家/房间的统计口径。候选先将全房目标预算控制在12次/秒，按人数分配：2人最多6Hz、3人4Hz、4人3Hz、更多人继续下降；不能承诺8人都达到6Hz，更不能直接设为30/60Hz。
- 提频前后都需确认两端平台消息收发计数和已接通状态，记录入房失败与回退；先验证入房恢复，再逐步提频。此节为建议，尚未改频率、插值或上传新版本。

### 用户网络方向与当前证据

用户准备将 Web 域名接入 CDN，并考虑购买高防服务器后让小程序直接访问 IP。已按要求读取引用会话 `01a159f3-752c-7cd2-b09c-314f02454071`（标题“配置七牛云 TapTap CDN 中继”），并读取 `D:/chat/拼图/server-ops/qiniu-cdn-20261020/README.md`。该会话已完成的是海外普通 CDN 的 `api.ymxc.top` 手机 API 中继、IP回源、证书及自动续期，不是 Web 主站全站加速；没有替另一个会话发送消息或改其配置。

本轮从 `https://api.ymxc.top/h5-mobile-v3/config` 带实际 TapTap 来源读取，返回200、正确 CORS、`Cache-Control:no-store`、`mobile-v3-isolated`。只验证了公共配置，没有创建会话、测写入、WebSocket或真实业务链路。客户端配置仍是现有地址，尚未切换到七牛。

推荐网络划分（候选，未迁移）：

| 内容/通道 | 推荐入口 |
| --- | --- |
| Web 页面、脚本、公共缩略图 | 七牛 CDN，按资源类型设置缓存 |
| Web 房间实时连接、账号与存档写入 | 支持动态业务的入口，或独立 HTTPS/WSS 域名直连高防接入IP；不缓存玩家响应 |
| TapTap 账号、存档、最终落片及回退通道 | 专用 HTTPS/WSS 域名直接解析到高防接入IP，绕过 CDN/Cloudflare |
| TapTap 已验证可用的光标、拖动预览 | Tap 平台消息；失败回到上述自有接口 |

域名直接解析到高防IP已经是直连，不必将裸IP写入包体。保留域名有利于 HTTPS/WSS 证书校验、平台网络配置与后续换IP；裸IP若要 HTTPS，需要证书实际覆盖IP并核对宿主兼容性，不称为绝对不能实现。新服务器未提供，无本轮迁移或购买操作。

普通 CDN 不能因为设置 no-store 就自动支持 WebSocket；Web主域名切换前要明确 WS 的直连域名或采购服务的 WS 能力。当前客户端还校验实时连接与API的主机/端口，Web/手机入口拆分要配套修改客户端、来源与认证，不是只改 DNS 即完成。

手机若直连与Web共用的高防IP，该IP可被获知，Web CDN本身不能同时实现“隐藏这个共用IP”。若目标是隐藏实际业务后端，需要高防代理入口与业务后端分离并限制回源；高防能力和国内线路质量分别验收，不能将高防规格当作低延迟保证。

本轮依据：[自定义消息15次/秒与2KB限制](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/OnlineBattleManager.sendCustomMessage/)、[TapTap request 的HTTPS要求](https://developer.taptap.cn/minigameapidoc/dev/api/network/request/tap.request/)及上列实际代码/七牛配置记录。
