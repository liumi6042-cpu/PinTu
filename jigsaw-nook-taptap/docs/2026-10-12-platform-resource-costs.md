# 小游戏平台免费资源与图库分发建议

核查日期：2026-10-12。初次核查范围：官方公开政策与本地项目只读审计。用户随后授权实施缓存，并确认暂无云资源，先完成缓存和接入准备；实施记录见文末。没有开通云资源、申请合作、迁移线上图库或修改线上配置；具体账号权益和实际账单未查询。

2026-10-17 另核对了平台的房间/实时联机服务，见[平台联机评估](2026-10-17-platform-multiplayer-review.md)。该服务与图片分发、旧TDS云服务价格分开判断；本轮只有调研和启动本地管理后台，未迁移联机或云资源。

## 结论

平台可以承担游戏包分发，并提供部分云服务免费额度；不能把这些额度视为面向所有游戏的无限免费图库下载服务。图片存储容量与玩家下载流量分别计费。建议优先补手机持久缓存，再采用一套对象存储和 CDN 分发图库；保留现有房间同步、体力与奖励后端。微信、TapTap、后续抖音共用内容和图库，不分叉为三套内容项目。

## 官方政策

| 平台 | 可用免费资源 | 与图库有关的限制 |
| --- | --- | --- |
| 微信可用的腾讯云 CloudBase | 开发测试免费体验环境每月 3000 资源点 | 有功能及到期限制；文档规定小程序发布后体验环境到期日改为上线后第 15 天。控制台体验环境续期政策不适用于微信体验版。不能据此承诺小游戏长期生产图库免费，实际环境权益需核对。 |
| 抖音 | 小游戏用户 KV 云存储免费且无需申请，仅供小量用户基本数据；抖音云文档型云数据库、配置中心目前免费但有限频 | 图片对象存储及 CDN 属火山引擎计费资源。用户 KV 云存储不能用来塞图片，也不能替代权威多人同步与奖励结算。 |
| TapTap TDS | 文件存储 10 GB；结构化数据 1 GB、读写 3 万次/天等额度 | 国内 HTTP 文件下载每天 500 MB 免费，但 HTTPS 无免费流量，国内 0.36 元/GB。当前项目要求 HTTPS，不能套用 HTTP 免费额度。 |

TapTap 另有两项需单独确认的合作权益：

- 小游戏 CDN 仅开放部分合作游戏，文档未写明普遍免费额度；是否接纳本项目、流量由谁承担、是否允许跨平台使用，需工单确认。
- 价格页列明“薪火计划”合作游戏在合约有效期内免费使用 TDS 技术服务；不能把该权益视为注册即可获得，也未确认本项目符合申请条件。

来源：

1. [CloudBase 资源点价格与免费体验政策](https://cloud.tencent.com.cn/document/product/876/127357)
2. [CloudBase 微信小游戏原生接入](https://docs.cloudbase.net/quick-start/frameworks/wechat-minigame-native)
3. [抖音小游戏免费用户 KV 存储](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/server/data-caching/set-user-storage)
4. [抖音云产品定价](https://developer.open-douyin.com/docs/resource/zh-CN/developer/tools/cloud/charge/price)
5. [TapTap 价格及薪火计划说明](https://developer.taptap.cn/product-intro/price)
6. [TapTap 文件存储说明](https://developer.taptap.cn/product-intro/cloud-storage)
7. [TapTap 小游戏合作 CDN](https://developer.taptap.cn/minigameapidoc/dev/dev-support/CDN/)

## 实施前的项目现状

本地共 134 张素材，源 PNG 约 428.48 MB、旧无损 play 约 318.56 MB、优化拼图图约 58.50 MB、缩略图约 6.58 MB。前两类保留文件不等于玩家每次需下载的体积，不应将整个素材目录作为单次访问预算。

公开 82 张图：优化图合计约 39.0 MB，平均约 476 KB，最大约 1.81 MB；缩略图合计约 4.13 MB，平均约 50 KB。手机加载一张完整拼图图后在本地切片，不会每拼一块重新下载图片。

估算例：6 张缩略图加 1 张平均完整图，约 0.78 MB；1 万次这种全部未命中缓存的访问约 8 GB。以 TapTap 国内 HTTPS 文件流量公开单价估算，该部分流量约 3 元；不是项目总账单，不包含更多图库浏览、其他资源、接口和后端费用，也不是已采用该服务的实测账单。

实现依据：

- `config/mobile-platforms.json`：微信和 TapTap 共用 `https://jigsawnook.online/h5-mobile-v3/assets`，`assetBase` 已可独立配置。
- `scripts/build-mobile-shared.mjs`：包内主要为 UI 图标、字体、音效等，图库照片远程加载。
- `server/h5-gateway.mjs`：静态图片代码路径经 Node 同步读取，缓存头 `public, max-age=86400`。本次未读取线上 CDN 命中率和服务器峰值指标。
- `mobile/ui.ts`、`mobile/platform-wechat.ts`：已有运行期间内存图片缓存，尚未实现带容量管理的微信图片持久文件缓存，不能保证退出重开后避免重复下载。

## 初始实施建议

1. 增加有容量上限的手机图片持久缓存，按内容版本区分文件，空间不足淘汰最久未使用图片。
2. 图片走一套对象存储和 CDN，由分发节点直接发图；保留统一图片 ID、目录与发布流程。各平台若取得专属补贴，可仅改变资源地址配置；跨平台使用范围先核对服务条款。
3. 内容哈希地址启用长期缓存，更新图片换地址；私人图片、账号及动态接口不套公开图片缓存策略。
4. 若暂不接 CDN，可先让 Nginx 直接发送允许公开的静态图片，降低 Node 阻塞。该措施减少后端负担，不会自动减免公网流量费。
5. 优先核实 TapTap 合作 CDN / 薪火计划资格；未确认前按普通 HTTPS 付费分发预算，避免上线后依赖不适用的免费额度。

不因图库分发改造重写游戏同步后端。原 PC 网站继续保持既定独立运行方式。

## 实施记录：image-cache32

用户确认“暂时没有，先完成缓存和接入准备”，本轮未开通或切换任何云服务。

### 微信图片持久缓存

- `mobile/wechat-image-cache.ts` 实现 32 MiB / 256 文件的缓存，单张最多 8 MiB，按最近使用顺序淘汰；仅处理配置图库目录下带内容哈希的 WebP。会话、玩家资料、私图、接口返回、包内 UI 不进入该缓存。
- 大厅、图鉴、图包预览和拼图区统一经 `Platform.setImageSource` 调用。缓存能跨启动复用；校验文件大小、WebP 标识和解码结果，坏文件清理后重下；配额或文件系统失败时自动走网络/已验证临时文件。
- 相同 URL 合并下载，缓存下载最多并发 3 个；大图优先于缩略图排队，大图等位超过 1 秒后直接走宿主图片网络加载，避免缓存队列耗尽进房超时。原生回退请求不属于这 3 个缓存下载槽位。
- 切换房间和销毁拼图区会取消旧图片消费者；已经开始的共享缓存下载可完成，但不再改写旧消费者的图片或回调。
- 成功落盘后移除本次下载的临时副本。落盘失败而继续显示的临时文件由微信管理，不计入本模块持久缓存的 32 MiB；系统清理小游戏数据后会重新下载。
- 兼容开发工具 `http://tmp` 与真机 `wxfile` 路径，不依赖小游戏中可能缺失的全局 URL / crypto。

### 统一图库分发准备

- `scripts/package-mobile-assets.mjs` 生成 `outputs/mobile-assets/`，目录中 `objects/` 为待上传对象，保留 `/puzzles/` 文件名与所有图片 ID。
- 本次产物为 82 张公开 + 52 张归档图片，268 个 WebP，65,083,688 字节。包含当前共享客户端引用的大图和缩略图；不含原 PNG、未使用旧版本、玩家数据或凭证。不能将这个较小包覆盖旧 PC/H5 的整个素材目录。
- `asset-manifest.json` 提供逐文件字节、SHA-256、类型和缓存头。哈希文件一年缓存并标记 immutable；发布时保留旧哈希对象，禁止 CDN 改写图片字节或缓存错误页。
- 构建支持 `JIGSAW_SHARED_ASSET_BASE` 独立覆盖图库地址；微信与 TapTap/网页共用。`GameClient.asset` 只将公开 `/puzzles/` 文件映射到该地址，其他资源和 API 留在原服务。本地预览也保留显式 CDN 配置。
- 可选 `deploy/mobile-v3/nginx-public-artwork.conf.example` 已准备，但尚未部署。当前配置仍使用原图库地址；尚未因此减少线上源站的首次下载流量。

常用命令（在本项目目录运行）：

```powershell
node scripts/package-mobile-assets.mjs
node scripts/build-mobile-shared.mjs
```

未来确定 CDN 后，先上传 `objects/` 并验证所有对象及合法域名，再配置 `JIGSAW_SHARED_ASSET_BASE` 重新构建和发布。图库、客户端业务、房间及奖励后端继续共用，不拆分内容版本。

### 集中验证与交付

- 完整类型检查、82 张上架图片来源校验通过。
- 16 项微信缓存、4 项图库交付、24 项共享加载/网络/拼图测试通过，共 44 项；覆盖重启零下载（宿主模拟）、并发、取消、损坏、配额、慢缩略图队列与 CDN/私有路径分流。
- 官方微信开发工具中确认图片实际落盘。重启前后均有 13 个缓存文件，其中大厅 3 张访问时间更新而文件修改时间保持不变，证明这些图片复用了原文件。[实际重启复用记录](../outputs/shared-build/image-cache32/wechat-reuse-check.json)。此证据不代替手机真机验证。
- 微信和共享网页已重新构建。已生成[新版微信预览二维码](../outputs/shared-build/image-cache32/wechat-image-cache32.png)，[官方回执](../outputs/shared-build/image-cache32/preview-receipt.json)确认成功：主包 3,272,013 字节，总包 6,995,901 字节。
- 本轮未调用 upload、提交审核或正式发布；微信手机需扫描新二维码，旧预览不包含本轮缓存。TapTap/抖音线上未因此自动升级，抖音独立宿主适配不在本轮范围内。
