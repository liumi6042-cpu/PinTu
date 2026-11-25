# 2026-10-23 H5 反馈 10 项：手机后端发布

用户在项目线程回复"上线"，批准发布 h5-feedback-1023。本轮发布手机后端 jigsaw-mobile-v3；Web（3104）另见 puzzle-play 的 docs/web-release-20261023-h5-feedback.md。TapTap 包已打好，由用户上传，本轮未上传。

## 代码
a4132cf（补给卡、横竖屏、胶囊、单人才可整理、付费图包锁）、dcbbee8（收藏横屏与相册详情）、bbb7d0f（包内缩略图）、69d78ae（右侧面板收起、同桌名片与只读名片接口）。发布工具：aeccb14 / 7835afa / ac120e7（见下文"首次失败"）。
测试：全量 901 项，43 项失败；基线 891 项中 44 项失败，没有新增失败。

## 发布包
releases/jigsaw-mobile-upgrade-20261023-h5-feedback-v2.tar.gz（435,519 字节，SHA256 5fc56027f099428b586060264d6c166de129a921ca9503389365f5dc4b95050b），code-delta，基于 20261023-h5-ui-revamp。相对线上只改 4 个文件：server/mobile-service.mjs、server/mobile-social.mjs、server/mobile-collection.mjs、outputs/mobile/engine.mjs。其余 305 个已安装代码/内容文件原样携带（按基线清单逐一校验哈希）；1300 个公共资源沿用线上目录，资源清单不变，旧哈希图片继续提供。

## 首次失败（已自动回滚）
第一次用 20261023-h5-feedback 发布时，code-delta 只带了 26 个文件。升级脚本会解压到空目录，于是缺少 lib/decoration-policy.mjs 等文件，新进程起不来。upgrade-mobile-backend.py 健康检查失败后自动回滚到 20261023-h5-ui-revamp，中断约 10 秒，数据库未改动。失败目录 releases/20261023-h5-feedback 保留作记录（deployment/rollback.json）。
原因：那次沙箱把 delta 叠在旧版本副本上运行，掩盖了缺文件。修复：package-mobile-upgrade.mjs 新增 --keep-installed-assets，携带全部已安装文件、保留已安装资源清单，并补上 realtime 许可文件；沙箱改为与升级完全相同的布局（空目录 + delta + 公共目录）。

## 部署（20261023-h5-feedback-v2）
- 备份：/srv/sites/jigsaw-mobile-v3/shared/operations/20261023-h5-feedback-v2/mobile-v3.sqlite（5,136,384 字节，integrity ok，44 表）与 sessions.sqlite（integrity ok）。升级脚本另做 12 个在线备份，放在 shared/backups/upgrade-20261023-h5-feedback-v2/。
- 预检（--check-only）通过。
- 沙箱：3299 端口，只用数据库副本，ProtectSystem=strict，只可写 /tmp 沙箱目录。检查项全部通过：健康；PACK_LOCKED（付费图包 blossom-lights 的 lantern-market 用券建房返回 403，建房券和首选机会不变）；多人房整理返回 403"多人房不能整理拼块"；名片接口 200（他人 relationship none，自己 self）；lobby、tasks、gallery 均 200。随后删除沙箱。
- 切换：current → releases/20261023-h5-feedback-v2，20261023-h5-ui-revamp 保留。服务 active，healthz ok，日志无错误，Web 3104 与 H5 未变。
- 公网只读烟测：/h5-mobile-v3/config 200；新相册缩略图和旧哈希大图（ink-mountain-palace-v1-optimized-d2a59e9037fc）均 200。未创建会话或账号。

## 回退
```sh
cd /srv/sites/jigsaw-mobile-v3
ln -s releases/20261023-h5-ui-revamp current.rollback && mv -T current.rollback current
systemctl restart jigsaw-mobile-v3.service
curl -s http://127.0.0.1:3292/healthz
```
不需要恢复数据库：本轮没有改表结构。

## TapTap 包（未上传）
releases/jigsaw-nook-taptap-20261023-h5-feedback.zip，97,487,964 字节，SHA256 54d44264f2e5a2b2056702fcc860a93216512dd3e76259dcb0b5c5e8915753a9。game.json 为竖屏，含名片图标和 115 张包内生成的 640px 缩略图。依赖本次发布的后端接口。
