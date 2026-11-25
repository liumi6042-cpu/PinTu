# 微信官方联机能力查证

核查日期：2026-10-17。范围：官方公开资料研究；未登录平台后台、未申请开通、未做真机联机、未改代码或服务器。

## 当前结论

不能据现有证据把微信官方房间当成现有跨 Web / TapTap 联机服务的直接替代。旧腾讯云 MGOBE 已停服；微信原生 GameServerManager 仍出现在官方现行 API 类型定义中，但本次未核实当前账号资格、个人主体条件、开通流程、价格与配额。CloudBase Realtime 是另一套云后端实时传输能力，也不能凭频道广播自动替代游戏权威逻辑和持久化。

“接口存在”与“目标账号现在可开通并可用于生产”分开判断；官方文档访问失败和未查到某项说明，都不能作为“平台无法开通 / 无法跨端”的证据。

## 1. 旧腾讯云 MGOBE：已停服

- 腾讯云《游戏联机对战引擎：动态与公告》于 2022-03-29 公告，MGOBE 自 **2022-06-01 停止服务**，要求用户于 2022-05-31 前迁移；2022-01-10 已停止新用户申请。
- 官方公告 PDF：<https://main.qcloudimg.com/raw/document/product/pdf/1038_67671_cn.pdf>，第 4 页。
- 因此，历史 MGOBE 教程里的免费额度、房间、帧同步能力不能作为当前可用服务依据。MGOBE 也不能与微信原生房间 API 混称。

## 2. 微信原生 GameServerManager：接口证据成立，当前可用资格未核实

官方来源：

- 官方类型仓库：<https://github.com/wechat-miniprogram/minigame-api-typings>。仓库说明类型随官方文档自动生成。
- 准确类型文件：<https://raw.githubusercontent.com/wechat-miniprogram/minigame-api-typings/master/types/wx/lib.wx.api.d.ts>。
- 更新记录：<https://github.com/wechat-miniprogram/minigame-api-typings/blob/master/CHANGELOG.md>，本次读到最新条目为 2026-07-27 v3.8.21、API 定义更新至 3.17.0。
- 官方 API 页面入口：<https://developers.weixin.qq.com/minigame/dev/api/game-server-manager/wx.getGameServerManager.html>、<https://developers.weixin.qq.com/minigame/dev/api/game-server-manager/GameServerManager.html>。本次公开抓取失败，未据此判断服务停用。
- 官方帧同步示例：<https://github.com/wechat-miniprogram/minigame-lockstep-demo>；示例是 1v1，不能据此推导平台人数上限。

类型文件可核实：

| 项目 | 已有证据 |
| --- | --- |
| 基础库 | `wx.getGameServerManager()` 最低 2.8.0；部分好友能力 2.9.4、匹配能力 2.14.4 |
| 功能 | 创建/加入房间、广播、上传指令帧、帧同步、补帧、断线重连 |
| 对局时间 | `CreateRoomOption.gameLastTime` 最大 3600；这是对局结束参数，不能等同永久房间或存档保留时间 |
| 扩展信息 | 房间与成员扩展信息各最多 32 字节 |
| 房主退出 | 未指定继任房主策略时，房主退出会销毁房间 |
| 人数 | 有 `maxMemberNum` 字段，但本次读取的官方定义未给出数值上限 |

适配判断（推论）：这些是微信小游戏宿主 API，现有 Web/TapTap 客户端不能只更换 URL 就使用；本次没有找到可据以承诺跨宿主混房的官方通用 SDK/接入方案。是否存在可申请的其他接口或网关方案仍待平台确认，不能直接下“不支持跨端”的绝对结论。若自行桥接，仍需承担桥接服务、身份映射和一致性处理。

## 3. CloudBase Realtime：可替换部分传输职责，不能自动替代游戏后台

- 官方更新记录显示 JS SDK **3.10.0，2026-09-18** 新增 `app.realtime()`，提供兼容 Supabase Realtime 的 Broadcast / Presence / Postgres CDC：<https://docs.cloudbase.net/api-reference/webv3-pg/changelog>。
- 快速开始：<https://docs.cloudbase.net/api-reference/webv3-pg/realtime/quick-start>。文档列出 Web、Node.js、微信小程序接入；小游戏和 TapTap 宿主的完整适配未在本次得到验证。
- Broadcast：<https://docs.cloudbase.net/api-reference/webv3-pg/realtime/broadcast>。默认不回传自己的消息、不等待服务端确认；开启 ack 也只代表服务收到消息，不能据此认定拼图操作已通过游戏规则校验。
- Presence：<https://docs.cloudbase.net/api-reference/webv3-pg/realtime/presence>。用于频道在线状态，不是完整棋盘或存档的权威状态。
- 私有频道可用权限规则控制；浏览器与微信小程序共用环境/频道的架构可行性由 SDK 能力支持，但统一身份、权限规则与项目协议仍需开发验证。
- 约 270 秒双连接热切是适配网关连接存活限制，**不是房间寿命**。私有 Broadcast 回放文档的 limit 上限为 25；示例里的时间范围不是已承诺的保留期。
- CloudBase 本身有套餐与资源计费，不能从 API 文档推导“免费房间”：<https://cloud.tencent.com/document/product/876/75213>、<https://cloud.tencent.com/document/product/876/127357>。本次未核实 Realtime 专项单位价格、免费配额和连接/消息上限。

## 4. 云托管与房间服务的区别

CloudBase Run 是运行后端容器与业务代码的计算托管；把现有服务搬进去，仍须维护房间、规则、存档等业务，只是改变运行位置与计费方式。官方介绍：<https://cloud.tencent.com/document/product/1243/45549>；计费概述：<https://cloud.tencent.com/document/product/1243/90267>。

旧“云开发内嵌云托管”免费额度文档有存量环境限定，2022-08-08 起停止新用户接入，不能拿旧试用资源推算当前免费成本：<https://cloud.tencent.com/document/product/1243/48038>。

## 未核实项与后续判断门槛

| 项目 | 微信原生房间 | CloudBase Realtime |
| --- | --- | --- |
| 目标账号、个人主体资格 | 未核实 | 未核实该账号和小游戏接入条件 |
| 地区可用性与中国大陆网络表现 | 未核实 | SDK 环境地区枚举不等于所有 Realtime 地区均可用；未核实 |
| 免费配额、实际价格 | 未核实 | 只确认有 CloudBase 套餐计费，专项计费未核实 |
| 人数、连接数、消息频率与消息体限制 | 数值未核实 | 数值未核实 |
| 长时间无人房间、持久化恢复 | 无生产验证 | 临时广播/在线状态不等于持久化；保留策略未核实 |
| Web / 微信小游戏 / TapTap 同房 | 无官方通用接入证据，未实测 | Web/小程序有 SDK 依据，小游戏/TapTap 仍需适配验证 |
| 降低当前延迟、减少多少资源 | 未测量 | 未测量；增加中转或地域变化也可能增加延迟 |

建议：保留项目自己的身份、操作裁决、合并/占用处理、存档与结算职责。后续若资格、费用和限制确认，可将光标、拖动预览等短命消息作为受控试验对象，再用目标地区真机对照当前链路。此处只是研究建议，不构成实施或平台开通授权。
