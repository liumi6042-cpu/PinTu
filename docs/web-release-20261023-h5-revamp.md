# 2026-10-23 Web（3104）共享界面改版发布

用户批准方案 A：Web 后端补齐新版共享 Canvas 客户端所需接口并上线。手机端 jigsaw-mobile-v3 当日已单独发布，本次未改动。

## 代码（分支 web-h5-revamp，基于线上 c3c072e）

| 提交 | 内容 |
| --- | --- |
| 6ff3552 / 60c74d1 | 线上 room-history、daily-dimensions 补丁还原为源码（与线上逐字一致） |
| 3c655f5 | runtime.node.mjs 换行符统一（无内容变化） |
| a82f88f | 大厅：在线人数、今日完成数、在座成员、游客名字 |
| 265aa99 | 最近同桌（迁移 0022_shared_recent_tablemates） |
| b1cf7c9 | 新手任务：累计有效拼合 10/50/100 次奖励 10/50/100 金币，各一次 |
| 27016d4 | 房间成员贡献数与完成页贡献排行（与手机端同序、同截断） |
| def1108 | 新共享客户端 e56d8d85e887d928（jigsaw-nook-taptap codex/taptap-h5 0e80082，线上 Web 配置 apiBase /api/shared），补金币音效 |
| 8f71f97 | 公共房清理测试对齐线上“只清理已完成房间”规则 |
| 2500a1f | 最近同桌 / 好友 / 按 ID 搜索中游客显示房间同名，不再显示“拼图朋友” |

测试：全量 395 项，39 项失败；基线（c3c072e）360 项中 40 项失败，逐条对比无新增失败。tsc 通过。

## 本地验收

发布包解压后在本机以生产库副本运行。电脑 1440×900 与手机 390×844 走通游客进入、大厅、图库、建房、手机经分享链接加入、拼完、完成页排行、任务（含新手任务）、好友（含最近同桌）、收藏、账号页。截图：`D:\chat\拼图\ui-revamp-shots\web\`。未用真实账号登录。

## 部署

- 发布包 latest.tar.gz：145,710,203 字节，SHA256 65c0219efca0462c5a475cf8a4aec24cf5647d51f79ffa69a9dc9747758b920f，对应 2500a1f，未带未提交改动，自检通过。
- 备份：/srv/sites/jigsaw/shared/operations/web-20261023-h5-revamp/puzzle.sqlite（101,928,960 字节，sqlite3 .backup，integrity ok，52 表，143 房间，44 用户）。
- 新目录 releases/web-20261023-h5-revamp/app；上一版 web-20261021-daily-dimensions 保留。已交付相册图和旧共享客户端只存在于旧版本目录，因此从上一版硬链接补齐：puzzles 478 → 674（与上一版一致），旧 shared-client 目录全部保留。
- 沙箱：systemd-run，3399 端口，ProtectSystem=strict，只可写 /tmp 下的数据库副本与每日记录副本。第一次误用生产环境文件中的 DATABASE_PATH（EnvironmentFile 覆盖 Environment），被只读保护拦截，未写入生产。改为副本环境文件后通过：health、/play、新客户端与金币音效、建房、profile/tasks/gallery/collection/social/recent、新手任务、两名游客拼完、mobileResult.ranking 与成员贡献、最近同桌游客名字。随后删除沙箱与副本。
- 切换：slots/3104 与 current 指向新目录，重启 jigsaw-web@3104；ExecStartPre 迁移通过并执行 0022（只新增表）。健康 ok，contentReleaseId 仍为 release-20261020T070831334Z-f6f57f55，日志无错误；jigsaw-mobile-v3、jigsaw-h5 均 active，3103 未动。
- 公网只读烟测：/play、/account、/api/health、/api/shared/config（uiBase 为 /shared-client/e56d8d85e887d928/）、新客户端 game.js（哈希与本地构建一致）、金币音效、图标、旧客户端 31d12aea1e22cda3、新旧图片、/h5-mobile-v3/config 均 200；/ 为 307 跳转。未在生产创建账号或房间。

部署脚本：[web-release-20261023-h5-revamp.sh](web-release-20261023-h5-revamp.sh)（stage / sandbox / switch / rollback）。

## 回退

```sh
cd /srv/sites/jigsaw
ln -sfn /srv/sites/jigsaw/releases/web-20261021-daily-dimensions/app slots/3104.next && mv -T slots/3104.next slots/3104
ln -sfn /srv/sites/jigsaw/releases/web-20261021-daily-dimensions/app current.next && mv -T current.next current
systemctl restart jigsaw-web@3104.service
curl -s -H Host:jigsawnook.online -H X-Forwarded-Proto:https http://127.0.0.1:3104/api/health
```

不需要恢复数据库：0022 只新增 puzzle_shared_recent_tablemates，旧代码忽略。

## 遗留

- /intro/dream-horizon.png 线上原本就 404（账号页插图），本次未处理。
- 真实账号登录流程未在本轮测试。
- nginx 的 /shared-client 白名单不含 mobile-coin.wav，目前由 Node 提供（200）；如需由 nginx 直出需另改配置。
- 39 项改动前就存在的失败测试仍待处理。
