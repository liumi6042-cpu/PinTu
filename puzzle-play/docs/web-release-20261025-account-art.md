# 2026-10-25 Web（3104）登录页背景热修复

用户在线程里回复"上线"批准发布。

## 代码
- 线上原版本 web-20261023-h5-feedback（371fa7a）。为了不带上 web-h5-revamp 上尚未发布的共享规则改动，发布包从 6737639 单独 cherry-pick 40f719d 构建（本地分支 web-hotfix-dream-horizon，提交 0847250）。
- 40f719d：登录页背景由未进包的 /intro/dream-horizon.png 改为 /intro/dream-horizon-3c402b70b693.webp（143 KB），登记进 runtime-assets.json，加测试保证 /intro/ 引用都在包里。

## 部署
- 发布包 latest.tar.gz：146,122,545 字节，SHA256 823f98cac18b9557a560b0b51aa95e8067e6f8fab1ee74968613c1ccb8a03783，dirty false，自检通过。与线上相比只多这张图，其余为前端重新打包的哈希文件名。
- 备份：/srv/sites/jigsaw/shared/operations/web-20261025-account-art/puzzle.sqlite（102,264,832 字节，integrity ok，53 表，125 个房间，44 个用户）。
- 新目录 releases/web-20261025-account-art/app，相册图片从上一版硬链接补齐（478 → 674），旧共享客户端全部保留。
- 沙箱 3399：新图 200，/account、/zh/lobby、/play、/api/shared/config 200，前端 account-gate 引用 webp、无 png 引用；随后删除沙箱。
- 切换：slots/3104 和 current 指向新版本，重启后健康 ok，日志无错误；jigsaw-mobile-v3、jigsaw-h5 均 active。
- 公网只读烟测：新图、/account、/zh/lobby、/play、/api/health、/api/shared/config、hero 图、共享客户端 7c67b50d26048bdb/game.js、/h5-mobile-v3/config 均 200。未创建账号或房间。

脚本：[web-release-20261025-account-art.sh](web-release-20261025-account-art.sh)。

## 回退
```sh
bash /root/release-web-20261025-account-art.sh rollback
```
回到 web-20261023-h5-feedback；本次没有数据库迁移。
