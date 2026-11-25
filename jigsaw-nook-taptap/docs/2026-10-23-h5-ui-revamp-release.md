# 2026-10-23 H5 UI 改版：手机后端发布与 TapTap 包

用户批准上线 H5 UI 改版（h5-ui-revamp 分支），并决定取消图片来源/审核校验（全部为用户自有生成图）。本轮只发布正式手机后端 jigsaw-mobile-v3 并制作 TapTap 包；Web（3104）未切换。

## 代码与校验

- 分支合并：h5-ui-revamp 以普通合并进入 codex/taptap-h5（3dfec5f）。
- 图片校验（fdb88d9）：去掉审核、提示词、生成工具、参考图和条款检查；保留原件、哈希、字节、有损 WebP、尺寸、体积和记录/目录一致性。public/puzzles 中旧哈希衍生图仅在对应目录图片存在且为 WebP 时接受。check:images：82 张已发布、813 个旧哈希衍生图。
- release-files（092d2a3）：统一交付下 playSrc 指向 optimized，不再要求 -play- 文件。
- 发布工具（9b3ec8c）：package-mobile-backend 补齐 diagnostic-actions、guest-names 与 realtime 许可，新增 --base / --keep-assets / --asset-fallback；稀疏包按整条声明比较；upgrade-mobile-backend.py 允许网关实际导入的模块。
- TapTap 打包（3b5cd23）：scripts/package-taptap.mjs。
- tsc、check:images、test:h5、test:mobile、图片库测试通过。全量 218 个测试文件中 44 项旧失败与改动前完全相同，列为后续工作。

## 线上差异核对

线上 20261021-beginner-tasks-v1 代码与本地对比：mobile-service、mobile-room-history 与 4480e4c 快照逐字相同；mobile-tasks / economy / collection / social / h5-gateway 线上为旧版，本地是超集（Web 无体力开关默认开启、同桌最近玩家表与在线人数、自由文本私信关闭（线上能力本已为 false）、退役 berry-spark / honey-star 光标、mp3 类型）。没有需要移植的线上独有行为。

图片：全部画作衍生图更换为新哈希，另有 81 张归档图；59 张大图由 3840 降到 2560 像素预算，长宽比不变（房间按行列和固定棋盘计算，不依赖像素）。新目录 634 个图片 URL 已存在于 /srv/sites/jigsaw-content/assets（nginx 直接提供），旧哈希文件仍在。发布包资源清单保留线上全部 1300 项。

## 部署

- 备份：/srv/sites/jigsaw-mobile-v3/shared/operations/20261023-h5-ui-revamp/mobile_db.sqlite（5,074,944 字节，integrity ok，43 表）与 h5_session_db.sqlite；升级脚本另备份到 shared/backups/upgrade-20261023-h5-ui-revamp/。
- 完整包 releases/jigsaw-mobile-backend-20261023-h5-ui-revamp.tar.gz（1,267,177,103 字节，1609 文件）；上传稀疏包 jigsaw-mobile-sparse-20261023-h5-ui-revamp.tar.gz（156,532,990 字节，SHA256 6ff7b30e…faa6，890 传输 / 719 复用），服务器重建并逐文件核验，重建归档 SHA256 3eb3fcde…15b9。
- 切换前在 3299 端口以备份副本数据库沙箱运行（ProtectSystem=strict，仅 /tmp 可写）：健康、配置、lobby（rooms/online/dailyFinished/members）、profile、my-rooms、room-history、connection 通过，mobile_social_recent 建表成功；随后删除临时环境与副本。
- upgrade-mobile-backend.py 预检通过后切换：current → releases/20261023-h5-ui-revamp，上版 20261021-beginner-tasks-v1 保留；服务 active，日志无错误，Web 3104 与旧 H5 状态和链接未变。
- 公网只读烟测：首页 /play、/h5-mobile-v3/config、新旧哈希图片 200 且内容哈希一致。未在生产创建账号、会话或房间（带会话的 lobby 只在副本上验证，因为每次认证请求都会保存游客档案）。

## 回退

```sh
cd /srv/sites/jigsaw-mobile-v3
ln -s releases/20261021-beginner-tasks-v1 current.rollback && mv -T current.rollback current
systemctl restart jigsaw-mobile-v3.service
curl -s http://127.0.0.1:3292/healthz
```

不恢复旧数据库；新增 mobile_social_recent 为兼容性建表，旧代码忽略。

## TapTap 包（未上传）

releases/jigsaw-nook-taptap-20261023-h5-ui-revamp.zip，89,045,997 字节，SHA256 339f234da0f3416ac702348ef02642ca26b7f038f155bfde9be3da7ffb3ad4e5。按线上内容 release-20261020T070831334Z-f6f57f55 的 albums.json 预置 237 张图（122 缩略图、115 正图、19 本相册）。与 20261021-beginner-tasks 包相比：249 个文件路径相同，仅 game.js 变化（670,394 → 714,180 字节，新 UI）；平台配置与内置图映射完全相同。
