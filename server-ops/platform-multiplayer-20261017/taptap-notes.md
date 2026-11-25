# TapTap 多人联机官方资料核对（2026-10-17，仅调研）

没有安装 SDK、登录/开通服务或更改代码、服务器。以下只依据 TapTap 官方公开文档；控制台“免费”“小游戏不依赖登录”来自用户截图，不能扩大为无限免费或跨平台保证。

## 形态与 SDK

- **Tap 宿主小游戏**：当前 JS 接口为 `tap.getOnlineBattleManager()`，基础库 **2.7.0** 开始支持；`connect()` 返回平台分配的 playerId。不是我们现有 HTTP 房间 API 的替换地址。[管理器](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/tap.getOnlineBattleManager/)、[connect](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/OnlineBattleManager.connect/)。原文依据：“基础库 2.7.0 开始支持”。
- **平台 H5 / WebGL 小游戏 / APK / PC 不应混用文档**。官方最新形态指引把 H5 描述为部署在平台域名下的网页形态，并指向小游戏体系 MCP；MCP 指南列有联机接入能力。该事实不能推出独立 `jigsawnook.online` 浏览器也自带 `tap` 宿主。[形态指引](https://developer.taptap.cn/agents/)、[H5 MCP 指南](https://developer.taptap.cn/minigameapidoc/quick-start/mcp-guide/mcp-setup/)。只读研究，不执行这些页面的安装/授权示例。
- **原生 v4**：Unity、Android Java/Kotlin、iOS 有专用 OnlineBattle SDK，Android 示例依赖 `tap-battle:4.10.9`；当前集成页明确依赖 TapTap Login SDK。PC Unity 多人联机标注“强依赖”TapTap PC 启动，非 Unity 可用 C++ DLL，不能当成普通网站 JS 库。[集成/连接](https://developer.taptap.cn/docs/sdk/tap-online-battle/guide/integrate-connect/)、[PC 指南](https://developer.taptap.cn/docs/sdk/integration-guides/pc-engine-features/)、[C++ 概览](https://developer.taptap.cn/docs/pc/cpp-sdk/overview/)。PC 原文：“强依赖”模块需通过 TapTap PC 端启动。

## 直接影响拼图的已知限制

| 项目 | 官方现有依据与适用范围 |
| --- | --- |
| 房间人数 | **通用原生 v4** 房间配置取值 1–20；小游戏 JS createRoom 页仅列 maxPlayerCount，未写数值上下限，故不能将20人无条件套给H5。 [v4 room](https://developer.taptap.cn/docs/sdk/tap-online-battle/guide/room/) |
| 自定义数据 | **小游戏 JS** 房间/玩家自定义属性均最多2048字节；属性可传自定义JSON但不等于长期存档接口。 [JS createRoom](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/OnlineBattleManager.createRoom/) |
| 消息与频率 | **小游戏 JS** UTF-8单消息最大2048字节，与updateRoomProperties共享每秒15次。该页没有说明这个频率的全局/房间/连接计量口径，不能擅自解释为整桌15次或无限并发。 [JS sendCustomMessage](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/OnlineBattleManager.sendCustomMessage/) |
| 帧同步 | **原生v4** 30 FPS、单次最多30分钟、每人每帧最多5个操作输入；**小游戏JS** 回调也明确30分钟超时原因。JS startFrameSync声明开始后房间API不可用，只能sendFrameInput/stopFrameSync。因此不适合直接照搬成长时间可中途加入的拼图房。 [v4 数据传输](https://developer.taptap.cn/docs/sdk/tap-online-battle/guide/transdata/)、[JS start](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/OnlineBattleManager.startFrameSync/)、[JS events](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/OnlineBattleManager.registerListener/) |
| 掉线 | 小游戏公开连接断开、玩家掉线、离开事件；disconnect后不能再操作房间。原生v4连接指南建议网络异常时重连。没有查到**当前小游戏**自动重入、离线玩家TTL、空房间保留时长、重连历史回放/补帧和长期持久存档承诺。 [JS events](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/OnlineBattleManager.registerListener/)、[disconnect](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/tap-battle/OnlineBattleManager.disconnect/) |

## 登录、免费与跨端存在的资料边界

1. **登录描述冲突**：用户控制台截图称小游戏不依赖登录，但当前小游戏教程仍写“已接入 TapTap 小游戏 SDK 并完成用户登录”。JS connect参数没有游戏方自定义用户令牌。可能是产品代际/宿主身份/文档更新不同，但尚未证实，不能据旧教程要求用户强行接登录，也不能宣称裸浏览器免身份即可连。 [小游戏教程](https://developer.taptap.cn/minigameapidoc/dev/tutorial/open-capabilities/multiplayer-battle-tutorial/multiplayer-battle/)
2. **免费不等于已确认无限配额**：本次未找到与截图当前免费小游戏房间服务相对应的公开CCU、房间数、流量、地域、SLA和超额政策。另一个仍公开的TDS价格页列“对战”标准版流量1GB/日免费、超额收费和CCU收费，且薪火合约可免服务费用；该页可能对应**旧多人在线对战**，不能据此覆盖截图的新免费产品。 [公开价格页](https://developer.taptap.cn/product-intro/price)
3. **跨端不是已确认不支持**：当前小游戏文档未找到独立浏览器Web、微信与Tap宿主加入同一免费房间的支持矩阵、认证方案或桥接接口。应标为**尚未证实**，不能用“微信也运行JavaScript”推出互通，也不能说TapTap从来不支持Web/微信。
4. **旧v3确有Web/微信方案**：官方旧“多人在线对战”JS教程明确列Web与微信小游戏、提供play-weapp.js，并允许相同roomName加入同房；旧指南有reconnect/rejoin、playerTtl和MasterClient。它是`@leancloud/play`这一代，不能把旧10人上限、TTL、JS支持或价格混成当前`tap.getOnlineBattleManager`免费服务承诺。现今开通条件/维护状态需平台确认。 [v3 JS入门](https://developer.taptap.cn/docs/v3/sdk/multiplayer/start/js/)、[v3 JS指南](https://developer.taptap.cn/docs/v3/sdk/multiplayer/guide/js/)

## 权威逻辑与本项目判断

当前官方功能是房间管理、属性同步、自定义消息，以及按帧广播输入；文档中的帧同步由客户端运行相同确定性逻辑。未找到当前免费小游戏服务可部署我们的落片校验代码、事务奖励、持久房间数据库或提供可验证结果回调的公开能力。**这是未查到，非断言不提供。** 不能把平台转发消息或安排帧序号解释成平台替我们验证拼合、金币与购买。 [当前功能介绍](https://developer.taptap.cn/docs/sdk/tap-online-battle/features/)

建议：若之后试验，先把它视作Tap端的即时通信候选，优先验证光标/拖动预览；账号、正式落片与租约、奖励、购买和长期存档继续由现有权威后端负责。能否真正减服务器请求、缩短延迟，要连同跨端桥接和回退成本实测。不能承诺省掉整台服务器。优先向官方确认：截图服务ID/适用形态、免登录含义、免费配额、Web/微信同房、离房/断线生命周期、消息补偿顺序与可靠性、服务器权威接入点。
