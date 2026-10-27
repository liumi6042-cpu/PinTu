# off-03 离线客户端核心交付

范围：仅 `work/offline-play`，未提交。实现离线核心和测试；应用入口及服务端接线仍属于后续卡片。

## 改动

- `lib/offline-play.ts`：无 DOM、无定时器。注入 storage/now/randomId 的本地房间服务，提供房间创建、未完成续玩、设备身份、快照、动作/批量动作、完成计时、24 房间淘汰和持久化恢复；所有 storage 调用捕获异常。关卡通关只在该房间第一次完成时排队，免费图片不排队，不发放在线奖励。
- 同文件提供通关队列、在线关卡缓存及验证、离线关卡视图、最多 20 条通关同步和网络错误分类。同步只移除本次发送且被确认 accepted/duplicate/rejected 的记录；deferred、未知回执、HTTP 失败和网络错误保留。返回的 accepted 是本批接受数量，energy 是接受记录的能量合计，levels/profile 原样交给调用方。
- 离线视图只排除目录网格 cols/rows，其余剧情字段完整透传；夹具验证 timeLabel/intro/comic 和未知嵌套 JSON 扩展。可用性按整章图片完整性判断，previous 跨章节延续，与当前 `server/mobile-levels.mjs view()` 一致；不可用的上一关不能解锁下一关。
- 房间 photo/artwork 直接取 `catalog.photos[imageId]`；网格和 requestedPieces 分别保留目录数值，实际网格片数不必等于请求片数。真实 dry2 目录的六关已验证。
- `lib/room-client.ts`：仅添加内部 offline 类型和一个空 lease 豁免判断（附说明）。卡片规定离线快照 leases 始终为空、claim 无操作；原客户端会在 claim 回复时立即判定 lease 丢失，取消拖动。新增非本地模式测试先复现 acquire=false，再验证该最小修正支持 claim/drop、心跳及通关。在线快照继续执行原 lease 检查。
- `tests/mobile-offline-play.test.mjs`：16 项测试，包括启用/未启用 solo 本地模式的真实 RoomClient、批次、落块、续玩、计时、两种淘汰顺序、故事扩展、跨章解锁、异常存储、同步及真实目录。
- `package.json`：只把新增测试加入 `test:mobile` 的 ts-register 阶段。

## 接线约定及卡片差异

`syncOfflineClears` 额外接受可选的 `catalog`、`randomId`。接线建议始终传入包内 catalog 和平台 randomId，保证没有在线缓存时也按目录顺序发送，并支持平台随机源。若不传 catalog，使用已缓存服务器关卡顺序；两者都没有时只能保留队列插入顺序，因为卡片原签名仅提供 storage/request，无法获知目录顺序。未知关卡排在已知关卡后。

同步请求去掉仅供本地使用的 roomId，发送 off-04 定义的 clearId/levelId/completedAt/elapsedMs/pieces。调用方应使用返回的 levels 更新在线缓存，并发布返回的 profile。core 不处理 UI、登录或服务端奖励。

除上述可选输入、确有必要的 RoomClient 空 lease 判断、测试注册和本交付文档外，没有扩展卡片范围。

## 验证（2026-10-27）

- `node --import ./tests/ts-register.mjs --test tests/mobile-offline-play.test.mjs`：16/16 通过，未跳过真实 dry2 目录测试。
- `npm.cmd run test:mobile`：178/178 通过（43 + 118 + 17），相对 off-02 基线 162 新增 16，无失败、跳过。
- `npm.cmd run check:images`：82 张已发布图片、813 个旧哈希衍生图通过。
- `npx.cmd tsc --noEmit -p .`：仅原有 `vite.config.ts:5` TS2307，缺少 `.openai/hosting.json`；本次文件无新增错误。
- 额外旧测试 `node --import ./tests/ts-register.mjs --test tests/room-client.test.mjs`：0/1，通过不了创建夹具步骤（400，预期 201），尚未执行到 RoomClient。独立调用当前未修改的 makeRoom 证实 `PHOTO_IDS` 不含该测试的 `seaside`，抛出“请选择有效图片与片数”。未改动此范围外旧夹具。
- `git diff --check` 通过；共享核心文件保持 HEAD 状态（13 个存在文件内容一致，清单中的 `lib/managed-decoration-art.ts` 在 HEAD 和本工作树均不存在）。
