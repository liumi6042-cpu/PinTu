# 独立手机后端部署记录

日期：2026-10-11。目标：为同源 TapTap / 微信手机游戏提供线上 API 和图片资源；PC 网站和旧 TapTap H5 代理保持原有运行状态。

客户端、微信模拟器、域名配置与上传进度见[微信小游戏接入状态](./2026-10-11-wechat-integration-status.md)。本文的“未创建玩家/房间”仅描述部署烟测阶段；后续微信模拟器会正常建立自己的测试会话。

## 部署前核对

- 公网 `/h5-mobile-v3/config`、`/taptap-mobile-v3/` 均为 404；旧 `/h5/config` 正常。
- 实际生产主机为 `64.90.2.134`。保存的 SSH 别名 `webhosting-main` 仍指向旧主机，执行时必须明确覆盖 `HostName`。
- Node 为 v24.20.0，Python 为 3.12.3，磁盘剩余约 38 GB。
- PC 服务 `jigsaw-web@3104.service` 正常，current 指向 `/srv/sites/jigsaw/releases/20261006-05/app`。
- 旧 H5 服务 `jigsaw-h5.service` 正常，current 指向 `/srv/sites/jigsaw-h5/releases/20261009-06`，使用 3291。
- 新服务、目录、环境文件、nginx 入口均未存在，3292 空闲。

## 新增发布内容

- 发布号：`20261011-wechat01`。
- 发布包：`releases/jigsaw-mobile-backend-20261011-wechat01.tar.gz`。
- 包大小：397,096,426 字节。
- SHA-256：`6de3e4eff1bca8a6dc99ade49d10889186228a71ca9a20af589b292b3027db93`。
- 459 个运行文件，包含 451 个素材资源；不包含共享 Canvas 前端、本地玩家数据库、环境文件、密钥或原图。
- 新服务位置：`/srv/sites/jigsaw-mobile-v3/releases/20261011-wechat01`，数据库放在同目录树的 `shared`。
- 服务名：`jigsaw-mobile-v3.service`；仅监听 `127.0.0.1:3292`。
- 本轮仅增加 `/h5-mobile-v3/` 反向代理；不发布 `/taptap-mobile-v3/` 页面。
- 新服务广告默认关闭，未把 TapTap 广告位复用于微信。原 TapTap 广告服务不变。

## 可复用工具

`scripts/package-mobile-backend.mjs` 从当前共享服务、当前引擎、同一份素材目录生成 API 专用包；不会改写已有 H5 / 微信前端产物。

```text
node scripts/package-mobile-backend.mjs 20261011-wechat01
```

`scripts/deploy-mobile-backend.py` 是首次安装脚本：目标已存在时停止，防止误覆盖；先核对归档哈希和包内每个文件，再创建新服务。已有 PC / H5 的链接及 service 文件哈希必须前后一致。nginx 仅新增一个 location，原字节其余部分必须一致；验证失败会恢复原 nginx 并停止新手机服务。

## 验证边界

部署包已完成素材登记检查、引擎构建、包内服务初始化验证及部署脚本语法检查。线上验收仅检查健康、公开配置和一张图片字节哈希，不创建演示玩家或测试房间，不改原网站数据库。

## 实际结果

部署完成，`jigsaw-mobile-v3.service` 已启用且 active。外网验收时间为北京时间 2026-10-11 14:28。

| 检查 | 结果 |
|---|---|
| `https://jigsawnook.online/h5-mobile-v3/config` | HTTP 200，`mobileMode=mobile-v3-isolated` |
| 广告配置 | `rewardedAdUnitId` 为空，`adRewardEnabled=false` |
| 新图片路径 | `/h5-mobile-v3/assets/puzzles/alpine-turquoise-reflections-v1-thumbnail-68ee1b368644.webp`，HTTP 200，72,484 字节 |
| 图片 SHA-256 | `68ee1b368644b7a974ffb605dc9dde476ea32de6a9d108d2465f758b3f5a71a3`，与本地发布包相同 |
| 旧 `/h5/config` | HTTP 200，原服务正常 |
| 原 PC / H5 链接与 service 定义 | 前后相同，运行状态持续 active |
| nginx | 仅新增一个 `/h5-mobile-v3/` location；去除该块后与原文件逐字相同，`nginx -t` 通过 |
| 玩家数据 | 未导入本地玩家数据；验收未创建线上测试玩家或房间 |
| 共享 Canvas 前端 | 未部署，交由客户端发布流程处理 |

公共 API 根地址：`https://jigsawnook.online/h5-mobile-v3`；图片根地址：`https://jigsawnook.online/h5-mobile-v3/assets`。

外网证据：`docs/mobile-backend-public-check-20261011.json`。服务器侧记录位于发布目录的 `deployment/result.json`，其 HTTPS 检查为本机真实 TLS 虚拟主机验证；最终外网检查由当前 Windows 客户端独立完成。

初次验收时，Cloudflare 对源站服务器自身的 Python 外网请求返回 1010（旧 `/h5/config` 同样被阻止）。部署脚本主动回退，没有放宽 Cloudflare 规则。随后采用本机真实 HTTPS 路由和操作端外网双重检查；补充 nginx 重载后新 worker 接管的短暂等待后通过。`--resume` 仅允许恢复同一新建、已停止、已自动回退且哈希一致的发布，不作为一般更新入口。

## 回退与后续维护

- 新服务的环境文件：`/etc/webapps/jigsaw-mobile-v3.env`，root 可读；无外部平台秘密。
- 原 nginx 备份位于发布目录的 `deployment/nginx.before.conf`。仅在确认后续没有其他 nginx 改动时，可恢复此备份、执行 `nginx -t` 后 reload，并停止独立 `jigsaw-mobile-v3.service`；不要重启或回退原 PC / 旧 H5。
- 如果后续有其他入口部署，不能用旧备份覆盖整个 nginx 文件，应只撤销本次独立 location。
- 后续源码更新仍使用同一份服务及引擎。重新生成新版本发布包，使用新 release 目录及原 `shared` 数据目录；不可把本机 preview 数据库带到生产。
- 微信正式联网还需要开发者后台配置该域名的合法请求/资源域名。开发工具忽略域名校验不等同于真机联网通过。
