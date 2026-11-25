# 小程序后端重复写入收敛（2026-10-17）

已在 `jigsaw-nook-taptap` 本地实现，未部署，未改运行配置、后台设置、真实数据库、密钥、原 `puzzle-play` 或正式 Web 工作树。

## 改动

- `server/mobile-service.mjs`：请求事务开始时创建“档案已持久化字节”映射，读取时记录原始 JSON；相同 JSON 直接跳过保存，成功写入后更新映射，提交/回滚/任何错误后清空。SQL UPSERT 额外加内容变化条件，覆盖未经过 `readProfile` 的保存调用。没有跨请求的档案缓存，每次请求仍读 SQLite。
- `server/mobile-social.mjs`：已有社交身份仅在距数据库中的 `last_seen` 满 10 秒、此前尚未上线或时钟回退时写入；新身份仍即时创建编号与在线时间。判断读取共享数据库，交替请求不同服务实例不会各自重复刷新。
- `tests/mobile-write-throttle.test.mjs`：新增 4 个专项测试，覆盖初始化、重复读取、满体力时间戳、真实修改单次保存、幂等、自然恢复回滚、失败身份初始化回滚、跨实例读取/节流、90 秒在线边界、离线重连与时钟回退。

## 实际 SQL 行写入证据

`evidence-mobile-writes.mjs` 在项目 `work/` 内为每个对照创建一次性 SQLite 数据库，通过 `AFTER INSERT/UPDATE` 触发器计数，结束即关闭删除。基线只加载本轮修改前备份的两份服务源码，其余依赖与新版本相同。原始计数在 `mobile-write-counts.json`。

每个场景先初始化同一身份，再执行 60 次 `GET /api/mobile/profile`，每次前进 1 秒：

| 场景 | 原 profile UPDATE | 现 profile UPDATE | 原 presence UPDATE | 现 presence UPDATE |
| --- | ---: | ---: | ---: | ---: |
| 移动端满体力 | 120 | 60 | 60 | 6 |
| 移动端不足体力、尚未到恢复点 | 120 | 0 | 60 | 6 |
| Web 运行档案 | 120 | 0 | 60 | 6 |

首次身份初始化原为 profile INSERT 1 + UPDATE 1 + presence INSERT 1；现在为 profile INSERT 1 + presence INSERT 1。

复核（从 `jigsaw-nook-taptap` 目录运行，Node 24+）：

```powershell
node ../server-ops/performance-20261017/remaining/evidence-mobile-writes.mjs
```

这是指定两张表的实际行写入次数，不是所有 SQL、磁盘字节、事务锁时长、真实在线负载或总体延迟的测量。

## 验证与保留边界

通过 49/49 个测试：

```powershell
node --test tests/mobile-write-throttle.test.mjs tests/mobile-social.test.mjs tests/mobile-tasks.test.mjs tests/mobile-collection.test.mjs tests/game-settings-runtime.test.mjs
node --import ./tests/ts-register.mjs --test tests/mobile-service.test.mjs tests/shared-web-profile.test.mjs
```

其中 HTTP 移动服务检查正常启动本地随机端口。覆盖经济升级与溢出、自然恢复、任务/邀请/礼包、购买与账本、多人结算、最后一点体力的跨实例决策、幂等和失败回滚；Web 无建房券能力与普通移动端建房券规则均通过现有检查。前端类型检查由主线负责，本包未新增画面验证。

所有请求的 `BEGIN IMMEDIATE`、独立持久化限流 `social.guard`、房间成员在线规则及社交 90 秒在线阈值保留。`restoreEnergy` 原语义完整保留，因此满体力 `energyAt` 随时间变化仍会产生一次真实保存；没有为追求所有 GET 零写而跳过该时间戳。社交时间戳最多有不足 10 秒的持久化粒度，在线窗口未延长，持续活跃请求会每 10 秒续期。

有限备份：`baseline/server/mobile-service.mjs`（SHA-256 `A16E4815077FC218C5BB5AE7202ED855F714A1B2B959352DA5F244089C7720A7`）、`baseline/server/mobile-social.mjs`（SHA-256 `ED76C9F74143BC9A92ECCC7EB94B29D9BBAB81C61ABAB5EBFCB6D3B747AB505C`）。只供本轮相对差异与复核，不含任何数据库或私密配置。
