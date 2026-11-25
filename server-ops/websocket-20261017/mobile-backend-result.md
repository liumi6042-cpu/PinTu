# 本地 WebSocket：移动后端结果

日期：2026-10-17。仅本地实现与验证，未部署、未访问线上库、未新增 SDK 或改动 package/lock。修改前相关文件保存在 `before/mobile/`。

## 已实现

- `server/room-realtime.mjs`：复用现有 ws 8.18.0 的通用 Node hub。导出 `createRoomRealtimeHub(options)`，参数为 `server / path / allowOrigin / subscribe(request,message) / readRoom(context,since) / readCursors(context) / writeCursor(context,input) / validate(context)`；可选 `addressOf(request)` 由可信入口决定连接限流 key。返回 `notify(roomId,{room,cursors}) / close() / stats()`。
- 协议：首帧 `subscribe` 携带 roomId、token、可选 session/since；凭证不放 URL。鉴权后 ready；随后发送 room/cursors；支持 ping→pong。房间帧按订阅者身份分别读取，HTTP actor 的 profile、贡献回执、邀请码不被直接广播。
- 安全与清理：Origin 白名单、拒绝握手 query、5 秒首帧期限、4 KiB 消息上限、每秒 40 总消息/25 光标消息、512 总连接/每来源 16 连接、512 KiB 待发背压门槛、5 秒授权复核、30 秒 WS 控制帧心跳、关闭清理。默认按实际 socket 地址限流；移动入口只在既有 `trustLoopbackProxy` 开启且真实来源为 loopback 时，才接受经 IP 校验的专用来源头。
- `server/h5-gateway.mjs`：独立移动服务的 `/h5/realtime` 接入；首帧 H5 opaque session 与既有房间 Bearer token 共同验证。`/h5/config` 仅在实际本地 hub 启用时返回 `realtime:{version:1}`，legacy 代理不报告支持。
- `server/mobile-service.mjs`：所有经 `saveRoom` 落库的合法房间变化在事务提交后发通知；加入、动作、心跳、管理、离房/关闭均走此边界。游戏动作继续原 HTTP 事务、裁决与幂等。WS 光标先更新内存，每 500ms 合并保存，不逐次写 SQLite；原 HTTP 光标读写共用数据。身份、名字、颜色、等级和装饰均来自服务端。断开 WS 不等于离房，真实 leave/成员清理才移除位置。
- 移动构建/全包/升级包加入独立 `outputs/mobile/room-realtime.mjs`，无 node_modules。附带 `server/room-realtime.LICENSE.txt`（ws MIT 许可）；升级校验精确放行这两个路径。
- `scripts/serve-mobile-shared.mjs`：本地前端预览只将精确 `/h5/realtime` 隧道到固定 loopback 后端；不开放其他 WS 路径或 query。处理双向原始 head、握手结果、超时、error/close 和清理。

## 已验证

1. `node --test tests/mobile-service.test.mjs tests/cursor-presence-service.test.mjs tests/mobile-write-throttle.test.mjs tests/h5-gateway.test.mjs tests/room-realtime-http.test.mjs`：**16/16 通过**。
2. 最终 hub 地址限流修正后，`node --test tests/room-realtime-http.test.mjs tests/room-realtime-package.test.mjs`：**4/4 通过**。
3. `node --test tests/shared-preview-realtime.test.mjs`：**1/1 通过**。
4. 升级工具语法与新增精确路径校验通过。

真实 WS 专项覆盖：两位玩家、房主/成员个性化房间数据、HTTP 操作推送、应用 ping/pong、8 次光标内存更新合并为 1 次保存、旧 HTTP 读最新未保存位置、断线保留位置、重连旧序号拒绝覆盖、真实 leave 清理并关闭失效订阅。权限项覆盖恶意 Origin、URL 凭证、错身份、错房间票据、会话过期、超频、超长包、连接上限、背压、关闭后 peer 清理。

无变更专项：等待 450ms（测试将授权复核加速为 200ms）期间房间 snapshot 读取计数保持不变，仅授权复核计数增加，没有 300ms 快照轮询。

独立运行验证：将 20 个最小运行文件复制到系统 Temp（项目目录之外，无 node_modules），启动真实移动网关并成功完成 WS 房间订阅。最终 hub bundle **121706 字节**；这次未生成或发布正式业务包。

通用 hub 最终源码 SHA-256：`1c3f1e974bc3a29a09adbb0015c7bea652f390c80fd957175178d1cdbb0de1bd`。

## 边界

本记录只验收后端与预览隧道。客户端停止轮询、15Hz 发送、插值画面与浏览器整合由根会话验收。当前内存通知面向单 Node 进程；若未来水平扩容，需要共享事件通道。线上反向代理的 Upgrade/Connection 配置及网络效果本轮未操作、未验证。
