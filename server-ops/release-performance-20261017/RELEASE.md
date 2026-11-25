# 2026-10-17 性能优化正式发布

用户授权：“先把本地版本上传，CDN 目前作为预案”。发布已完成，实际服务器核对时间为北京时间 2026-10-17 02:16。没有访问七牛账号、改 DNS、购包或切换图片域名，没有发布后台内容，也没有向微信/TapTap 平台提交客户端。

## 实际上线范围

| 端 | 当前版本 | 上一版及回退目录 | 当前服务 |
| --- | --- | --- | --- |
| 正式 Web | `20261017-01`，源码提交 `2575fd29b927e0612148842c2943ffc7b57172c1`，共享客户端 `42fc30f0bcb8fcdf` | `/srv/sites/jigsaw/releases/20261016-04/app` | `jigsaw-web@3104.service` |
| 小程序后端 | `20261017-perf42` | `/srv/sites/jigsaw-mobile-v3/releases/20261016-blossom41` | `jigsaw-mobile-v3.service`，3292 |

Web 上线按需绘制、图片 LRU、分批准备、列表返回位置、请求/重画去重、拖动静态缓存、可选省电模式和无建房券的“创建”按钮；正式 Web 后端只改内容缓存辅助模块。默认仍为流畅，省电在“玩法与设置 → 性能”中选择。小程序后端只发布四个经过与真实线上41逐行核对的文件：内容读取缓存、managed 包装、事务内档案 JSON 去重及社交在线时间节流；其余210个非 public 文件及687份公开素材与线上41相同。

没有改会员、购买、任务奖励、身份或图片 Q70 标准；没有新增数据库迁移。客户端本地支持微信构建，但本轮服务器发布不代表微信/TapTap 平台客户端已经更新。

## 发布与验收证据

- `web-rebuild.json`：远端按实际04基线逐项校验，将7.8MB稀疏包重建为完整runtime；3448文件，182传输、3266复用。目标 manifest SHA256 `ad756085142081a774874d933da81af7b96800a41c73a0e2d6b016c98c6c9b6c`。
- `web-deploy.json`：隔离 Linux 完成旧房间、跨版本移动/聊天、图片快照、旧进度及733资源字节检查后暖切换。没有迁移，旧服务3103连接已排空并停用，旧应用目录保留；4927份旧哈希静态文件继续可读，644张相同图片使用不可变硬链接复用。
- `mobile-deploy.json`：42上线，两个SQLite在线备份完成，正式Web/旧H5及受保护环境配置保持不变；目标 manifest SHA256 `fde07727e4bb1939822223c2d8025ed73bb12f2c9d28e9763706ad6f559387bb`。
- `public-verification-2026-10-16T18-15-07-684Z.json`：23项/18请求全部通过。实际HTML入口指向新wrapper及客户端；新脚本identity/gzip/Brotli解压后SHA一致，一年immutable；旧客户端9资源仍可读取，HTML/健康及缺失静态版本为no-store。
- `live-after.json`：两端实际current、manifest、健康、以服务用户执行的只读内容预检均通过；Nginx只替换Web回源端口，原缓存规则逐字保留。旧H5服务正常。
- `admin-settings-after.json`：真实后台SQLite只读核对，草稿revision14/2/2、成长6、任务6及全部document SHA与发布前一致。
- `health-target-update.json`：正式和候选发布连接的Web健康端口从3103改为3104，保留Host及转发协议头；其他字段未改，未触发“提交到双端”。

两端既有内容指针未动，仍为 `release-20261015T183552824Z-baf6e1d6`，当前15册/188张/5任务。指针原始SHA仍为 `6bd1ab08a91757bb106cba1d3c39050ea2ede57204081eb36edb8d0b7c3f3f59`。

相关本地专项已通过：84项客户端、26项真实Canvas逐像素/失效/释放、16项实际浏览器，以及正式Web28项Node、3项部署helper和TypeScript。移动发布的52项相关检查通过。一个历史collection ledger夹具假定默认装饰为null，在未改的41与42上都失败；原始失败日志保留，没有恢复旧默认值或弱化断言。不能将局部测量换算为线上整局性能、耗电收益或并发承诺。

## 发布中发现并修正的问题

原移动code-delta部署器将public做目录符号链接，与严格图片安全校验不兼容，首轮在数据库备份和current切换之前被拦截，线上仍为41。`mobile-deploy.first-failed.json`保留原失败；失败暂存目录精确移至 `/srv/sites/jigsaw-mobile-v3/shared/backups/stage-rejected-20261017-perf42`，没有递归删除或跟随public链接。

部署器改为普通public目录和逐项SHA/尺寸/inode核对的不可变素材硬链接，仍拒绝符号链接、junction及特殊文件，并执行原完整manifest和artwork检查。Linux5项专项全部通过，再重新预检和上线。修正部署器SHA256为 `ba0c6609222fa61dedf666192da2e586e230e14c428ae6be18d5d5555b1ddb45`；服务归档保持原SHA `bc6c63fa3f41d5b20f71222b40ccc1fc990fb2f0b9b76720eba2efc0ad3270b7`。详见`mobile-deployer-repair.json`及`mobile/deployer-audit/`。

`mobile-deploy.json`中的历史字段`publicResourceDependency`记录素材来源41；实际42的public为普通目录、素材文件为硬链接，旧版保留作为回退点。禁止对共用素材原地改写或chmod。

## 数据库、备份与回退

当前使用SQLite `node:sqlite`，Web和移动主库均为WAL；Web约39.4MiB，移动约2.51MiB。三个在线数据库quick_check均为ok。发布前24小时取得的有限服务日志、发布后30分钟窗口均未发现SQLite锁冲突或数据库满错误；日志样本较小，不能作为持续负载容量证明。

按当前实际规模SQLite足够，暂不迁移。WAL允许读写并行，写事务仍串行，后续应根据写锁等待、接口延迟、长事务和磁盘增长判断；出现持续写竞争或多服务器共用存储需求再评估PostgreSQL，不按注册人数给固定上限。官方依据：[适用场景](https://www.sqlite.org/whentouse.html)、[WAL](https://www.sqlite.org/wal.html)。

本次在线备份均保留并再次核对摘要和完整性：

- Web：`/srv/sites/jigsaw/shared/backups/jigsaw-2026-10-16T18-14-35.563Z.sqlite`，完整性ok，SHA256 `ec17833538b9715ad4054e30dbee9318a1993596c074a6c2597eb8d069eefd78`。
- 移动主库与会话：`/srv/sites/jigsaw-mobile-v3/shared/backups/upgrade-20261017-perf42/`，两份摘要记录在`live-after.json`及新release的`deployment/backup.json`。

回退应只回退应用current/槽位和Nginx回源端口，继续使用当前shared数据库；不得将旧SQLite备份覆盖正在增长的玩家库。Web回退时应启动3103、健康检查后指回旧app与3103再排空3104，并同步后台健康端口；移动回退指回41后重启移动服务。备份是恢复事故的独立手段，不是代码回退步骤。

## 空间和剩余边界

发布核验后，按精确路径与完整SHA删除服务器 `/tmp/jigsaw-nook-968a76ca451afdcd.tar.gz` 单个临时重建归档，释放1,063,639,513B；回退版本、原素材、数据库和备份均保留。收据为`transient-cleanup.json`。本轮准备文档中“尚未部署”是当时状态，最终以本记录为准；该完整临时归档已清除，不能直接重跑旧命令。

CDN候选文件仍为 `server-ops/performance-20261017/delivery-audit/ymxc-cdn-trial-plan.pending.json`，未应用。未来候选为真实手机耗时/内存/耗电采样、联机请求量与字节统计；本次未做生产压测或协议改造。
