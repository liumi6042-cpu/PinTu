# 本地 WebSocket 光标与宿主适配（2026-10-17）

本线只修改 `jigsaw-nook-taptap` 的 `mobile/ports.ts`、`mobile/platform-web.ts`、`mobile/platform-wechat.ts`、`lib/cursor-client.ts`、`mobile/puzzle-board.ts`，及3份聚焦测试。有限原源码保存在本目录 `before/mobile/` 与 `before/lib/`，不含凭证、玩家数据、依赖或数据库。本线未部署、未安装SDK、未修改服务端和经济规则。

## 传输与宿主

- `Platform.openSocket` 为可选factory，浏览器用原生WebSocket，微信用独立 `wx.connectSocket` SocketTask，不模拟DOM或浏览器。
- 连接只允许与 `apiBase` 相同hostname及有效port；默认HTTPS/WSS端口为443。只允许WSS，开发配置可使用同API主机/端口的loopback WS（127.0.0.1、localhost、[::1]）。拒绝其他主机、端口、用户信息、fragment、空白/反斜线。微信验证无需全局URL构造器。
- `CursorClient` 接收根代理共享实时流的结构接口：`connected`、`subscribeCursors`、`subscribeState`、`sendCursor`。state订阅不立即回调，启动和调度直接读取connected。
- 健康WS发送窗口为 `1000/15` ms。发送只保留一个最新位置，不排队重放中间坐标；空闲不发送心跳式cursor包，也不进行cursor GET/POST轮询。实时流的连接心跳由根代理组件管理。
- 接管HTTP时取消进行中交换；transport revision同时阻断已开始解码、但跨越WS接管/断开后才完成的旧回复。WS发送失败保留最新一点，fallback保留原200ms移动合并及原退避，不提升HTTP请求频率。
- self过滤和serverTime年龄换算保持；序号跨HTTP/WS递增。真正stop发更高seq的null墓碑；WS不可用时走原HTTP keepalive。保留retainUntilLeave，隐藏/临时断网不伪造离房。
- 显式关闭socket会拆除本实例事件；真实关闭也拆除监听。仅转发字符串消息，关闭后的回调不再触达使用者。

## 光标曲线

实查原版是200ms HTTP位置更新，board指数插值时间常数65ms，首帧固定16ms且后续dt限制在1至100ms。本次WS更新目标约15Hz，指数内插改为50ms；后续使用宿主RAF时间戳的实际间隔，首帧按排队至回调的实际时间，旧宿主无timestamp时保留墙钟fallback。

不做速度预测或外推；每步只向最新收到的位置内插，不越过目标。到0.08世界单位内即取精确目标、重画最后一帧并停止RAF。单次位移本来就在该阈值内时直接取精确目标，避免微小残差。相同位置/显示元数据、仅updatedAt改变的包不重画。隐藏会取消RAF并清空动画时钟，显示后不把隐藏时间累计为移动；保留最后房间位置，只有权威leave快照或销毁才移除。

## 聚焦证据

新增：

- `tests/realtime-cursor-client.test.mjs`：6项，最新点合并、HTTP/WS切换、旧回复隔离、隐藏保持、self过滤/服务端时钟、显式离房墓碑。
- `tests/platform-socket.test.mjs`：3项，同API origin端口限制、原生浏览器adapter、无DOM/URL的微信SocketTask及监听拆除。
- `tests/cursor-smoothing.test.mjs`：2项，30/60/120Hz相同曲线、终帧/静止、反向移动、隐藏恢复、小位移精确到达与真实leave。

最终新增11项通过。此前原cursor可见性、共享运行时、图片准备/最终帧、宿主请求与原Web身份适配也已通过（一次41项、一次23项聚焦检查；部分覆盖重叠，不相加为独立项）。最终全项目类型检查与端到端连接由根代理统一收口。

确定性模拟实际结果：

- 1000ms内每1ms产生新坐标，发送15个位置包，发送间隔67ms；待尾窗口结束后只补发最后1000号坐标，不重放其间输入。
- 健康WS空闲30秒，无cursor HTTP请求、无重复位置包；隐藏60秒暂停pending发送，恢复只发最新一点。fallback移动仍在200ms后合并发送。
- 从0到100的台阶，在30、60、120Hz回调下，100ms位置均为86.4664716763（跨帧率误差小于1e-8）；反向移动单调接近新目标，无过冲/无限外推。
- 在50ms时位置63.2120558829，隐藏60秒后显示并再走20ms，只按额外20ms内插，不瞬移到终点。最终确切目标那帧会重画，此后无RAF。

这些是本地确定性调度与宿主桩检查，证明协议调度、插值数学和清理分支。未测真机网络、微信原生SDK线上环境、帧率、电耗或体感改善，不能将15Hz发送上限写成已验证的端到端实时到达率。

## 整合后的测试夹具与独立审阅

`tests/room-latency.test.mjs` 旧Canvas桩只有drawImage，真实PuzzleSprites构造已需要save/restore/translate/scale/clip/stroke。本线仅在测试内统一补齐显式Canvas契约，按名称过滤的“领取响应前跟随指针”“落下后确认前再次拾取”“拒绝领取回退提示”3项均通过，未改产品逻辑。

后续合并重跑发现“落下后确认前再次拾取”仍可能从随机桌边位置开始，第一次pointer-up会触发既有clamp，导致线性预期值偶发失配。本线只把该交互fixture固定为组0偏移100/100、其余组已归位；两次拖动均在安全范围、不会随机吸附，继续原样验证两次drop的坐标、先drop后claim次序和旧回执不取消新drag。该文件连续2次运行，各9项通过，产品clamp/吸附逻辑未改。

只读审阅根代理 `lib/room-realtime.ts` 与RoomClient接入：正常异步宿主路径已有generation隔离旧回调、隐藏/关闭时清计时器、revision合并和本地drags保护，未发现必现关键泄漏。

审阅后根代理授权收口原生队列：Web adapter除检查OPEN状态，还在bufferedAmount大于16KiB时拒绝send并抛错，让RoomRealtime关闭旧连接、转fallback并重连，避免应用继续向拥堵队列追加旧cursor。平台测试已断言恰在16KiB可发送、超过上限不追加、CLOSING状态拒绝，3项再次通过。该限制可界定Web追加行为，不声称已经测过真实网络拥塞恢复。

微信SocketTask没有本适配器可读的等价bufferedAmount，保持SDK原契约，未盲加SDK字段或假定可取消已发送原生数据。微信仍只有应用层最新点合并和连接watchdog；原生队列拥塞后恢复的旧点回放尚未真机验证。
