# 2026-10-23 Web（3104）H5 反馈批次发布

用户回复"上线"批准发布。手机后端已先发布：jigsaw-nook-taptap 的 docs/2026-10-23-h5-feedback-release.md，版本 20261023-h5-feedback-v2。

## 代码（web-h5-revamp）
- 5eb4b36：只读同桌名片接口 GET /api/mobile/players/:code/card。包含名字、等级、装饰、收藏统计、本局拼合数（仅房间成员可见）和好友关系；不写数据库，内存限速每分钟 120 次。
- 371fa7a：共享客户端 7c67b50d26048bdb，由 jigsaw-nook-taptap h5-feedback-1023 69d78ae 用线上 Web 配置构建，导出文件新增名片图标图集。
- 测试：全量 400 项，39 项失败，与基线相同，没有新增失败。

## 部署
- 发布包 latest.tar.gz：145,978,147 字节，SHA256 aab9adadf763ff1023bc98740156b1e777bd9ccb7da46978e66b1c56e9276f11，对应 371fa7a，未带未提交改动，自检通过。
- 备份：/srv/sites/jigsaw/shared/operations/web-20261023-h5-feedback/puzzle.sqlite（102,264,832 字节，integrity ok，53 表，143 个房间，44 个用户）。
- 新目录 releases/web-20261023-h5-feedback/app，上一版 web-20261023-h5-revamp 保留。相册图片从上一版硬链接补齐（puzzles 478 → 674），旧共享客户端目录全部保留。
- 沙箱：3399 端口，环境副本里的 DATABASE_PATH 和每日记录目录均指向 /tmp 副本（已核对）。检查项：/play、新客户端与金币音效、建房、各共享接口、新手任务；两名游客拼完后，完成页排行与成员贡献正确，最近同桌正确；名片 200（本局拼合 56，拼完 1 张）。随后删除沙箱。
- 切换：slots/3104 和 current 指向新版本，重启后健康 ok，日志无错误；jigsaw-mobile-v3、jigsaw-h5 均 active。
- 公网只读烟测：/play、/account、/api/health、/api/shared/config（uiBase 为 /shared-client/7c67b50d26048bdb/）、新客户端 game.js（与本地构建逐字节一致）、名片图标、金币音效、旧客户端 e56d8d85e887d928、相册图片、/h5-mobile-v3/config 均 200。未创建账号或房间。

脚本：[web-release-20261023-h5-feedback.sh](web-release-20261023-h5-feedback.sh)。

## 回退
```sh
cd /srv/sites/jigsaw
ln -sfn /srv/sites/jigsaw/releases/web-20261023-h5-revamp/app slots/3104.next && mv -T slots/3104.next slots/3104
ln -sfn /srv/sites/jigsaw/releases/web-20261023-h5-revamp/app current.next && mv -T current.next current
systemctl restart jigsaw-web@3104.service
```
（或在服务器执行 bash /root/release-web-20261023-feedback.sh rollback）。不需要恢复数据库，本轮没有新的迁移。
