# 独立手机后端升级准备

日期：2026-10-13。本记录保留升级准备过程，并追加实际执行结果：独立手机后端已成功升级到 `20261013-social34`。升级对象仅为现有 `jigsaw-mobile-v3.service`，未操作原 PC、旧 H5、nginx、环境文件或平台秘密。

## 固定交付

- 发布号：`20261013-social34`；包的基准发布及执行前手机发布为 `20261011-wechat01`，现已完成切换。
- [正式使用的升级脚本](../scripts/upgrade-mobile-backend.py)：SHA256 `8df8c63294c6c0cd17c700f3d1d16e46fc2466dc3b05441be8e530ce0f592e60`。早期准备版本 SHA 为 `42ed72a5e6b03d8441949dd56e7c310f736943f183211ed1805ac8d298fe517a`；后续增加严格校验的 `--pc-service` 参数，正式执行使用新版。
- [API 差量包](../releases/jigsaw-mobile-upgrade-20261013-social34.tar.gz)：93,379 字节；SHA256 `2f72e7858d6a541cedee198ab7156fb5f8a6dcdd2b8dece4705ba85486191d37`。
- [发布比较清单](../releases/jigsaw-mobile-upgrade-20261013-social34.tar.gz.json)；包内含 11 个运行文件和 1 个完整资源清单 `release.json`。
- 基准清单 SHA256：`013fa9d9802832dba4052b70018b7eb4febba6a38cd565784db65bd41baffc83`。

当前运行资源与旧发布逐项核对：451 个资源路径、长度和 SHA256 全部相同，无新增、删除或变更，合计 396,589,743 字节。差量包因此不重复上传图片；新发布的 `public` 目录链接到已经完整校验的旧发布 `public`。旧发布必须保留，不能在后续清理时删除。没有使用可覆盖旧文件的硬链接。

新增运行依赖：`server/mobile-social.mjs`、`config/social-phrases.json`、`server/daily-content.mjs`。更新现有网关、移动服务、收藏服务、任务服务与当前引擎；经验经济模块、收藏目录及图片资源清单没有内容变化。差量打包脚本遇到任何资源差异会停止，要求改用完整后端包，不会静默遗漏新素材。

## 数据与回退

正式执行前，在服务仍运行时用 SQLite 官方在线备份保存 `shared` 下的运行数据库，含当前 `mobile-v3.sqlite` 和 `sessions.sqlite`；每份备份执行 `quick_check`。备份放在 `shared/backups/upgrade-20261013-social34/`，记录位于新发布 `deployment/backup.json`。各数据库分别保持事务一致，备份不是所有数据库共同停机的同一时刻快照。

升级校验压缩包 SHA、全部文件清单、路径与文件 SHA；拒绝路径穿越、软/硬链接、设备文件、重复与未登记文件。支持正规 tar/ZIP。仅原子切换手机服务 `current` 链接并重启 `jigsaw-mobile-v3.service`；检查健康、配置和一张原资源。原 PC/H5 链接、服务状态、service 文件、nginx 和手机环境文件指纹必须保持一致。

切换后验证失败时切回旧 `current`，只重启手机服务。**不把旧数据库备份覆盖回去**，保留期间真实玩家的最新进度和会话。失败发布和备份保留供排查。

## 推荐操作

以下由主任务确认目标主机后执行；脚本要求 root，不调用 sudo。SSH 保存别名曾指向旧主机，因此明确覆盖 `HostName`。

```powershell
scp -o HostName=64.90.2.134 scripts/upgrade-mobile-backend.py webhosting-main:/tmp/upgrade-mobile-backend-social34.py
scp -o HostName=64.90.2.134 releases/jigsaw-mobile-upgrade-20261013-social34.tar.gz webhosting-main:/tmp/jigsaw-mobile-upgrade-20261013-social34.tar.gz
```

先核对远端脚本和归档 SHA，再只读检查：

```text
python3 /tmp/upgrade-mobile-backend-social34.py --release 20261013-social34 --sha256 2f72e7858d6a541cedee198ab7156fb5f8a6dcdd2b8dece4705ba85486191d37 --archive /tmp/jigsaw-mobile-upgrade-20261013-social34.tar.gz --expect-current 20261011-wechat01 --pc-service jigsaw-web@3104.service --check-only
```

`--check-only` 不创建文件、不备份、不切换或重启。检查成功后正式执行同一命令，去掉 `--check-only`。执行后由主任务核对新好友接口及实际手机预览。生产烟测本脚本不创建测试玩家、房间或发消息。

## 本地集中验证

Python 语法和 Node 打包脚本语法通过；[7 项安全检查](../tests/mobile-upgrade-safety.py)全部通过，覆盖固定差量包完整校验、非法路径、tar 链接/重名/未登记成员、篡改、合法 ZIP、ZIP 链接拒绝及真实隔离 SQLite 在线备份。后续在同组检查内补充了 PC 服务参数的端口范围和命令校验，仍为 7 项全部通过。

## 实际执行结果

首次 SSH/SCP 在认证前被关闭。用户把 `64.90.2.134` 加入 Clash 绕过后，后续 SSH 恢复；“Clash 是根因”属于用户判断，未独立确认具体网络拦截环节。连接目标保持 `64.90.2.134:22`，没有使用用户另一个服务器、改变端口或关闭主机校验。

早期 `--check-only` 因保护规则默认检查旧 PC 服务 3104，而当时实际 PC 服务为 3103，停止且没有写入。脚本补充显式 `--pc-service` 参数，保留完整 PC 保护。另一会话随后更新 PC 服务，最终成功的只读检查和正式执行实际均使用 `--pc-service jigsaw-web@3104.service`。

正式升级返回：发布 `20261013-social34`、旧发布 `20261011-wechat01`、`active=true`、`backupCount=2`、`sharedDataPreserved=true`、`pcAndLegacyUnchanged=true`。手机 `current` 已切到新发布，两个运行数据库已在线备份，原 shared 玩家进度和会话保留；未覆盖旧数据库。451 份资源复用旧发布，**`20261011-wechat01/public` 必须继续保留**。[部署回执](../outputs/shared-build/wechat-social34/backend-deployment.json)。

本次固定包只包含社交等冻结时已有后端实现，没有包含另一会话后来新增的“任务奖励后台配置”及其 `task-reward-settings.mjs` 依赖。那部分本地源码没有被撤销或覆盖，但不能据此声称已随此包上线。

微信新预览二维码已生成，未调用 upload、提审或正式发布；原生组件双手机互加好友和私聊仍待真机验证。

线上自建社交 [12 项烟测通过](../outputs/shared-build/wechat-social34/production-social-check.json)：两个独立自有测试身份完成编号查询、申请与接收、接受后双方关系、多行私聊和反向发送、未读与阅读清除、删除关系，以及非好友 403、匿名 401。只创建 2 个测试身份和 2 条测试消息，结束后移除测试好友；没有创建房间、发放奖励或生成举报，没有读取真实微信好友关系或消息。该结果证明自建后端流程，不代替微信原生组件双手机操作验收。
