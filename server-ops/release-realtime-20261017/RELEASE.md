# 2026-10-17 大厅首屏与房间实时推送发布

状态：用户明确授权“ok 上传吧”后已完成。实际服务器、公开入口与数据边界均核对通过；本记录覆盖此前本地文档“未上线”的阶段状态。邀请体力/二级成长仅评估，未实现或发布。

## 上线范围

| 范围 | 新版本 | 前版/回退 | 服务 |
|---|---|---|---|
| 正式Web | `20261017-02`，源码`d7b967e71585d9f4932664a74826a34dfb1aaab9`，共享客户端`90bd8c68bf335127` | `/srv/sites/jigsaw/releases/20261017-01/app` | `jigsaw-web@3103.service` |
| 移动后端 | `20261017-realtime43` | `/srv/sites/jigsaw-mobile-v3/releases/20261017-perf42` | `jigsaw-mobile-v3.service`，3292 |

- Web包含上轮大厅先绘制、资料随后补齐及脚本预载；本轮房间状态/光标WS推送、目标15Hz位置发送、按时间平滑与HTTP回退。正式操作仍经原HTTP权限/事务/幂等，不把光标消息当落子/结算。
- 移动后端严格基于真实perf42移植，仅改gateway/service并增加独立hub及MIT许可；212份其他运行文件和687份素材保留，既有内容缓存/档案/社交节流继续保留。光标合并保存，不随15Hz逐条写SQLite。
- 线上新增两条精确WS代理`/api/shared/realtime`、`/h5-mobile-v3/realtime`；Nginx语法和reload通过，原缓存/压缩/其他路径完整保留，Web回源3104→3103随暖切换更新。
- 微信/Tap客户端生产归档仅本地保留，未提交平台，未新增尚未公开的Tap前端入口，旧Tap/H5服务3291保持。微信合法socket域名与平台客户端发布另按平台流程处理；不能把后端上线称为微信客户端已更新。
- CDN、域名解析、邀请奖励与其他运营配置未改，未触发后台“提交到双端”。

## 当前内容与玩家数据

本次以实际新保存内容为准，没有恢复旧基线。两端内容指针仍为`release-20261016T191737757Z-4ba6feec`，manifest `4dbc830027cda0cf4b6e469923a3e15a964f5fbadd581d1a3f3d62f300f455f7`。两端只读内容检查均为15册/187图/5任务。

后台草稿revision15/2/2、成长10、任务6的document摘要在发布前后逐项一致。正式/候选连接仅将Web健康端口3104改为3103，Host/转发协议及其他字段保持，后台每次读取连接配置无需重启。

三个当前SQLite文件仍为原inode，WAL及quick_check均为ok，没有新迁移、没有从旧数据库覆盖恢复。新旧版本隔离库验证旧房间种子、进度、图片快照、移动、聊天及已购访问/钱包保护；生产验证未新建测试玩家。最近10分钟最多1000行日志未发现数据库锁/磁盘满错误，不据此承诺容量或节省比例。

## 可复核证据

- `web/preparation-report.json`与`web/source-boundaries.json`：干净源码和生产配置，2401依赖、18迁移、644图片及默认数值配置与01一致；没有邀请奖励。正式新standalone使用最新公开内容副本、隔离数据库验证HTTP与实际WS订阅/光标/动作推送。
- `web-rebuild.json`：7,841,577B稀疏传输包在远端逐项验证后重建3451运行文件，211传输/3240复用。稀疏SHA`7abbf49d0d38d67dadff7aa3ac5d3f2edc296f5f72b5f180c35cdca1d4e109b5`，目标manifest `f71edfc064ba2f5373ddb15947abd3b6565e16fab0b65b2756d8812dcc4ecf57`。
- `web-deploy.json`：733份资源和隔离跨版本图片/房间检查通过，暖切换完成，旧3104连接已排空并停用。保留4987份旧哈希资源，644份相同图片不可变硬链接复用。没有强刷已开网页。
- `mobile/backend-report.json`、`mobile-preflight.json`、`mobile-deploy.json`：冻结候选/权限/真实WS等16项相关检查通过，服务器预检及部署成功。归档SHA`c57a894b72a29b31413925454b5d2a6044ccd548a8f428073afc2a07bbdb0ae2`，目标manifest `8dc573bb5909842344466606f9ba0b0b7bff6269cd265bbb746a145ff7088720`。
- `public-realtime.json`：8项公网检查通过，实际HTML指向90bd客户端，新/旧客户端脚本gzip解压SHA一致且immutable；两端`wss`实际完成101并拒绝无身份订阅401。此处只读验证公网链路和权限，未冒充公网双人游玩测试；带身份双人/落子/重连在隔离实际浏览器与运行服务验证。
- `live-after.json`、`admin-settings-after.json`：current/服务、回退目录、内容指针、两端只读check、三份数据库完整性/原inode、备份SHA及最新后台值保持。
- `proxy-apply.json`与`admin-health-update.json`：代理精确追加与健康端口变更收据。最终NginxSHA`8e90e9069f89c62d621ea5ee5cddbba513372fc31dc3520fff033d03380b601a`。

移动专项中一个源Web-profile节流夹具在精确旧42与候选43均失败（期待1次实际3次）；保留两侧原日志，使用移动自然恢复/双实例专项验证。没有为通过测试修改经济规则或将失败记绿。完整边界见`mobile/PREPARED.md`。

## 备份、回退与空间

- Web在线备份：`/srv/sites/jigsaw/shared/backups/jigsaw-2026-10-16T19-29-29.922Z.sqlite`，quick_check及SHA通过，摘要`89bb4e633cbb2e620081577801d30d14da07c179c57115856af5d6dcd1019d54`。
- 移动两库在线备份：`/srv/sites/jigsaw-mobile-v3/shared/backups/upgrade-20261017-realtime43/`，两份摘要和完整性通过，详情见`live-after.json`。
- Nginx变更前备份：`/srv/sites/jigsaw/shared/backups/realtime-nginx-1792178777/`。回退Web应先启动/检查旧3104，再回退current和回源3103→3104，排空新3103并同步后台健康端口；移动回退current到perf42后重启该服务。始终继续使用当前shared玩家库，禁止旧备份覆盖增长中的数据。旧代码无WS时新客户端会走HTTP回退。
- 发布验收后按精确路径及完整SHA移除了单个服务器临时重建归档`/tmp/jigsaw-nook-d34ac5d23fdadd6d.tar.gz`，释放1,063,680,766B。旧应用、原素材、数据库及备份保留；不能重跑依赖已删除归档的旧部署命令。收据`transient-cleanup.json`。
- 本地重复平台构建目录在逐项与保留客户端校验后清掉约14.1MB；冻结包、证据及必要运行结果保留。

## 邀请奖励：仅方案

见`D:/chat/拼图/jigsaw-nook-taptap/docs/plans/2026-10-17-invitation-growth.md`。已核对当前成长10：五级累计102XP、基础体力上限`min(100,30+2L)`、每2分钟恢复1点；未使用旧默认值替换后台。官方平台条款摘录与当前数值只读证据均在本目录。

建议先审查一代真实邀请/合作里程碑，永久加成独立等级并设累计上限；二级仍为待评估候选。当前游客身份、防环及业务里程碑幂等需另做。等级5不等于真人或合规证明，Web继续无体力。没有把本方案加入代码、后台配置或本次发布。
