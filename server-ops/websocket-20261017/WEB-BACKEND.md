# 正式 Web 自建实时连接适配（2026-10-17，本地）

范围：`work/dual-managed-release-20261014`。本轮只准备本地代码、隔离验证与代理预案，没有部署服务器、切换环境或发布后台内容。用户当前相册草稿和玩家数据库均未修改；验证使用独立的内存 SQLite。

## 行为与权限

- `/api/shared/realtime` 使用 Cookie + 首帧房间 token，不把凭据放入 URL。Origin、Host、房间成员及账号有效性继续由既有规则检查，Web 忽略客户端传入的小程序 session。
- 订阅、房间快照/增量和光标数据经同机 loopback 调用既有共享 HTTP 路由；每个接收者使用自己的认证视图。claim/move/drop 等操作仍走原 HTTP 事务，成功提交后再通知同房间连接读取。
- 高频光标驻内存，每 250ms 合并写入既有光标路由；保留原序列、新旧标签接管、null 不隐藏规则。冷启动/缓存清理后先用已持久化序列初始化，旧消息不能覆盖新坐标。旧 HTTP 标签页更新光标时也会让 WS 接收者同步。
- WS 关闭不等于离房；最后坐标保持。明确离房、账号失效、封禁及房间关闭仍由原权限规则移除。每 5s 复核身份，权限读取失败时关闭 WS。
- 采用共享 transport 的总连接、每来源连接、消息频率、载荷、背压、订阅超时和 ping/pong 边界；Node 入口仅对真实 loopback 请求接受 nginx 覆盖的 X-Real-IP，避免所有玩家共用代理 IP 导致全站被限制为 16 条连接。

## 构建与运行入口

- `server/node-entry.mjs` 使用 vinext 返回的真实 `http.Server` 挂接 Upgrade。
- `scripts/build-room-realtime.mjs` 在原 standalone 生成后加入入口与独立 ESM 实时 bundle，包含 ws 运行代码及 MIT 许可证，不额外复制编译器或平台二进制依赖。
- 只有这个支持 WS 的 Node 入口设置 `PUZZLE_REALTIME_ENABLED=1`，共享配置才返回 `realtime: {version:1}`；旧入口/Worker 不会错误声明能力。
- `scripts/build-server.mjs` 与 `scripts/release-files.mjs` 已纳入这些 runtime 文件。既有 dirty 的 play 页面预载和性能文档保留。
- `jigsaw-web-realtime.location.pending.conf` 是尚未应用的 HTTPS location 预案。下一次协调窗口应匹配实际 Node 端口，再检查 nginx 配置及 HTTPS Upgrade。现有静态缓存与其他路径不改变。

## 聚焦验证证据

`node --test tests/web-room-realtime.test.mjs tests/shared-client.test.mjs tests/release-staging.test.mjs tests/release-package.test.mjs`：**22/22 通过**。

新增 5 项使用真实 Node HTTP Server、真实 WebSocket 客户端与原共享 API/原 SQLite 规则：能力开关、两玩家 HTTP claim/move/drop 广播、15Hz 光标与旧 HTTP 客户端互通、断线/重连/明确离房、冷上下文旧 seq、防非法坐标/跨身份/封禁/Origin/URL 凭据。

本次约 1 秒的 15 个移动输入合并成 6 次 SQLite 光标写入（不同运行在 5–6 次之间），棋盘 revision 未变化。null、重连、HTTP 混用及 leave 也被覆盖，不把这些后续动作误算成这一秒的写入数。

正式 Web TypeScript 无输出通过；Node 入口与 bundle 构建脚本语法检查通过。

独立打包 smoke：在项目外系统 Temp、没有 node_modules 祖先的目录生成 147300 字节的实时 bundle，成功导入 `attachWebRoomRealtime`，并检查入口与许可证存在。位置：`C:/Users/ADMINI~1/AppData/Local/Temp/jigsaw-web-ws-a4b347d2c93d4f5e97831d389268851d`。

首阶段边界：当时只验证实时 bundle 的依赖独立性。后续已补正式源码 standalone 构建及实际新入口运行，见下一节。线上 nginx 和整站发布仍未执行。源码备份沿用 `server-ops/realtime-20261017/web-baseline`，未重复复制。

## 补充：当前正式源码 standalone 与新入口实际运行

按根会话追加要求，使用当前正式源码及原 vinext CLI 完成了实际 Node standalone 构建。没有更改正式源码的构建配置，也没有修改共享 node_modules。仅在本次自有临时构建目录/子进程中，跳过了 vinext emitter 额外复制 `standalone/public` 的那一次操作；这份重复目录本来就不属于正式发布白名单。原图校验使用硬链接，不复制全图库；最终运行目录只装入一个受控样本的 3 份交付图片。

- 构建脚本：`build-formal-node-smoke.mjs`；校验脚本：`verify-formal-node-smoke.mjs`。
- 原 vinext 5 阶段编译及 standalone emitter 全部成功；构建耗时约 20 秒。
- 保留 runtime：`server-ops/websocket-20261017/standalone-web-local-1792178089275`，2721 个运行文件，33202491 字节（约 31.7 MiB），未打大归档。
- 真正启动的是该 runtime 根目录的新 `server.js`，不是测试 HTTP handler。父环境显式去掉 `PUZZLE_REALTIME_ENABLED` 后，实际 `/api/shared/config` 仍返回 `realtime: {version:1}`，确认能力由新入口声明。
- `/api/health` 实际返回 `ok:true` 与受控内容版本 `local-node-ws-smoke`。
- 使用新建独立 SQLite、仅一个模拟账户和一册受控免费内容，通过真实 HTTP 创建房间。随后真实 WS 收到 ready、单玩家房间和光标；光标 echo 与 HTTP claim 后推送的房间 revision 均通过。
- 隔离运行校验后已停止该 Node 子进程。用户玩家库、后台保存内容和公网服务没有访问或改写。
- 临时构建源已由原清理器删除，receipt 为 `work/dual-managed-release-20261014/work/release-cleanup/1792178089276-a5f0f690-14fd-4d83-8aaf-9a4d2ef85f40.json`，`ok:true`、`residualPaths:[]`。保留有用运行结果与小型模拟库，便于审查。

证据：`formal-standalone-build.json`、`formal-standalone-build.log`、`formal-standalone-inventory.json`、`formal-node-runtime.json`、`formal-node-runtime.log`。

与完整生产发布的区别：该本地 runtime 只带单张样本素材，受控测试内容和模拟玩家库不属于生产内容；没有检验全图库 HTTP 交付、HTTPS/nginx Upgrade 或公网部署。后续正式发布仍应使用原 release-files/materialize 白名单完整交付素材，并在明确窗口验证线上代理。
