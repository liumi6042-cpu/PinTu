# 小游戏统一内容发布、任务金币与放置网格

日期：2026-10-13。工作由管理后台会话统一协调；本记录是本地实现与冻结部署准备，不代表线上切换。原 PC 工程、后台实际配置、玩家数据库及标准共享构建产物没有被本任务覆盖。微信原生好友入口继续停用，编号好友、私聊和邀请保留。

## 统一内容读取

协议原件为 `content-admin/contracts/content-release.mjs`，已原样复制到 `server/content-release.mjs`，两者 SHA256 均为 `db5641d1de0f7334151062c17ccd496fd9caae07d67eab656bc458993218f65c`。固定读取 `albums.json`、`daily.json`、`game-settings.json`、`task-rewards.json`，可选 `assets.json` 仅描述公开素材交付状态。

`JIGSAW_CONTENT_DIR` 指向公共发布根目录。`current.json` 一次选定不可变发布目录；每个同步游戏请求先读取并完整校验一个快照，再将相册、每日、成长及任务绑定到该快照。每日内部的多次查询和相册归属计算继续使用它。独立的每日定时器另取当次最新快照，不复用上一次玩家请求的版本。没有当前指针时兼容原配置；已有版本损坏则失败，不拼接旧文件或降级到默认奖励。校验在玩家写入与社交限流写入之前进行。

`/healthz` 实际读取并验证当前版本，返回 `contentReleaseId`，未启用或无发布时为 `null`。坏发布返回 503；接口不返回目录、环境变量、数据库或内部原因。预检通过独立的 `scripts/check-content-release.mjs` 在本机/SSH执行，不构造玩家服务、不打开玩家数据库、不启动每日计时器或写出场记录。

预检环境变量：`JIGSAW_CONTENT_RELEASE_DIR`、`JIGSAW_CONTENT_RELEASE_ID`、`JIGSAW_CONTENT_MANIFEST_SHA256`。预检校验完整清单、四份配置摘要、现有运行图片及原图/缩略图资源；成功输出版本 ID、各摘要和相册/图片/任务数量。用户后台的 15 册、187 张归属保持原样，本批只引用已交付的 134 张；53 张待交付素材仍在后台保留，引用缺资源时拒绝发布。

## 任务金币

共用 `jigsaw-task-rewards/v1`：五项 `tasks[].coins`、`invitationShare.coins`、`invitationFriend.coins`、`tenGrid.coins`。整数范围 0～100000，历史缺省 0，旧完整配置的原 `configDigest` 仍能验证。未设置新的实际奖励数值。

礼包授予时保存金币快照；旧礼包、旧分享重放收据缺金币按 0，不按新配置追补。开启礼包及分享奖励调用现有收藏钱包流水，和体力、经验、礼包状态及请求收据处于同一 SQLite 事务；同一来源重复不再次到账，金币失败会回滚整次操作。共享 Canvas / H5 的任务、库存、十格说明和到账提示显示金币，零金币保留原布局。原相册每档金币/装饰展示、稳定里程碑身份及永久购买权益保留。

## 真实放置网格

保留原目标图像边框，按实际 `cols` / `rows` 画内部虚线格；底图之后、全部拼块之前绘制。随相机平移和缩放对齐，保持屏幕 0.6 像素线宽、4/7 像素虚线节奏，浅深主题低对比。原生 Canvas 不支持虚线 API 时使用手绘降级，不改命中、吸附、奖励或房间协议。

- [浅色竖屏实际界面](../outputs/shared-build/content-sync36/placement-grid-light-portrait-390.png)
- [深色横屏实际界面](../outputs/shared-build/content-sync36/placement-grid-dark-landscape-844.png)
- [移动并放大后的实际界面](../outputs/shared-build/content-sync36/placement-grid-dark-portrait-panned-zoomed-390.png)
- [隔离界面检查](../outputs/shared-build/content-sync36/placement-grid-check.json)

截图使用完整共享 App、真实 48 片测试房间及现有原图；测试数据库和预览位于隔离 `work/content-sync-preview`，独立服务已关闭。没有使用正式玩家数据、打开底图或托盘、修改拼块或发放奖励。

## 冻结手机后端包

- 发布：`20261013-content36`，要求原手机发布为 `20261013-social34`。
- [API 差量包](../releases/jigsaw-mobile-upgrade-20261013-content36.tar.gz)：107,521 字节，SHA256 `820e15158f850a616a62f6c0e40531b8b69b6ea8eb53caeebbe23369e497817a`。
- 基准发布清单 SHA256：`9ec988de40d1e0533bf4941aedaf8fd829b7e52303054ee6e57522b2743d2b5e`。
- 20 个运行文件加发布清单共 21 个载荷；451 份原资源逐项相同，复用 396,589,743 字节，未重新上传素材。
- [比较清单](../releases/jigsaw-mobile-upgrade-20261013-content36.tar.gz.json)。包包含共享 reader、运行校验、每日快照适配和只读预检脚本；不包含客户端或后台原始数据。
- [升级脚本](../scripts/upgrade-mobile-backend.py) SHA256：`d62471a7c3ec2bfee6a41641baea093ce223e6080a0e2cc7d97f204423a7d902`。已支持已复用资源的旧发布：解析到手机发布根内的真实不可变 `public`，完整校验后直接引用该目录，拒绝目录越界，不形成多层依赖链。

## 协调会话的初次上线步骤

1. 同一窗口核对当前手机发布、PC 实际服务单元和两端代码包，执行手机升级脚本 `--check-only`。PC 服务单元使用实际观测值，不假定端口。
2. 预先保留手机 shared 在线数据库备份、旧代码和原资源发布。当前资源来自 `20261011-wechat01/public`，必须保留；回退不会覆盖真实玩家新进度。
3. 配置 `JIGSAW_CONTENT_DIR=/srv/sites/jigsaw-content`。**必须显式配置 `MOBILE_DAILY_APPEARANCES=/srv/sites/jigsaw-mobile-v3/shared/daily-appearances`**，确保出场事实跨代码升级保留；若已有出场记录，先核对并保留迁移，不能清空或覆盖。该目录由 `web-jigsaw` 可读写，发布目录与公开 JSON 对该用户可读。
4. 由协调会话安装适配代码和环境后，仅初次重启手机服务 `jigsaw-mobile-v3.service`；不更换原 PC / 旧 H5 / nginx 或玩家数据库。后续配置更新只原子切共享 `current.json`。
5. 在切指针前，以 `runuser -u web-jigsaw` 和 `/usr/local/bin/node` 运行新代码中的 `scripts/check-content-release.mjs`，传入待提交不可变版本目录、ID 和预期清单 SHA。两端预检成功后，由管理后台一次切同一指针，再核对手机 `127.0.0.1:3292/healthz` 与 Web 返回同一 ID。
6. 新虚线与金币共享客户端已经在 `outputs/shared-build/content-sync36/client` 完成隔离生产构建，见下节。协调会话可在统一窗口使用该交付；后续源码变化应另选新输出目录重新构建。手机预览需使用生产 HTTPS API，不能沿用旧本地调试输出。本任务没有生成新二维码、upload、提审或部署。

## 聚焦验证

已通过任务金币与旧数据相关 40 项、虚线/拼图区 17 项、每日配置 14 项、只读发布与预检 6 组、实际切版与健康接口集成 4 组，以及升级脚本 7 项安全检查。类型、服务语法、包内清单校验和图片来源检查通过。旧 H5 网关安全与身份流程也通过；最终记录为 `outputs/shared-build/content-sync36/content-sync-check.json`。

切版集成证明一次请求只读一次发布，读取期间换指针仍使用原相册/每日/成长/任务；下一请求使用新版本。坏配置在社交限流和玩家写入前停止，SQLite 业务表逐行快照保持原样。健康检查识别新 ID、坏版本 503，且不创建玩家或泄露路径。每日计时器在下一日读取新配置，旧当天出场事实保持原样。所有集成数据库与配置都在隔离 work 中，测试完成后已清理并关闭服务。

## 隔离生产共享客户端交付

按协调要求，唯一共享构建脚本支持显式 `outputRoot`，默认标准构建方式保留。此次调用 `buildMobileShared({outputRoot:'outputs/shared-build/content-sync36/client',production:true,prepareAssets:false})`，使用当前金币 UI 和虚线源码，复用已准备的音效、像素数据与字体；字体实查已含金币/任务相关字形。新输出目录必须尚不存在，避免覆盖既有交付或旧预览。

- 微信项目：`outputs/shared-build/content-sync36/client/wechat-game/`，入口 `game.js`，配置 `project.config.json` / `game.json`。AppID 为 `wx8d8511fdd7dd5c7e`，合法域名校验启用，原生好友插件没有声明。
- 微信主包：3,346,349 字节，总包：7,070,237 字节；这是本地文件统计，尚未执行微信工具预览/上传打包。
- TapTap / 共用网页：`outputs/shared-build/content-sync36/client/shared-web/`，入口 `index.html` 与 `game.js`，总包：6,785,145 字节。
- 两端 `apiBase`：`https://jigsawnook.online/h5-mobile-v3`；`assetBase`：`https://jigsawnook.online/h5-mobile-v3/assets`。构建明确 `development:false`，不采纳继承的本地 API 环境覆盖；实际 bundle 的嵌入地址与记录一致。
- [完整构建配置、大小和逐文件 SHA](../outputs/shared-build/content-sync36/client/build-record.json)。各平台依赖输入记录位于同目录的 `records/`，没有改标准 inputs 记录。
- [原产物保护与独立核验](../outputs/shared-build/content-sync36/client/preservation-check.json)：标准共享产物、旧二维码、旧 QA 及旧隔离预览共 140 个既有文件、32,063,834 字节，大小和 SHA 全部相同，变化列表为空；新平台文件全部与构建清单匹配。

本轮只构建独立客户端目录，没有更改后台真实配置、玩家数据库、标准 `outputs/wechat-game` / `outputs/shared-web` 或旧预览，没有生成二维码、upload、提审或线上部署。`content36` 冻结后端包保持原 SHA，统一发布窗口仍由协调会话控制。
