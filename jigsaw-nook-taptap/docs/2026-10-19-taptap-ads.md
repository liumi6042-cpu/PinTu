# TapTap 激励视频衔接（2026-10-19）

## 当前状态

用户要求接入TapTap广告，并授权查看Edge已登录后台。已查看游戏963283广告变现页，实际加载完成后为“已开启 / 已完成”；没有申请新账户、创建广告位、签署协议或操作提现。官方H5激励视频指南确认使用tap.createRewardedVideoAd与onClose.isEnded；旧H5公开配置仍启用同游戏竖屏广告位1054324。

新版共享Canvas包已有广告播放适配、补给和工具奖励流程。此前新版API `/h5-mobile-v3/config` 为adRewardEnabled=false、空广告位，因此玩家看不到可用广告。这与旧 `/h5/config` 已开启是两个独立服务的状态。

已启用新版服务既有广告配置：

```
H5_AD_ASSISTANCE_ENABLED=true
H5_REWARDED_AD_UNIT=1054324
```

环境文件 `/etc/webapps/jigsaw-mobile-v3.env` 仅这两行变更，原文件在服务器受限目录备份。重启jigsaw-mobile-v3.service后，3292健康检查正常，代码仍为20261019-taptap-login6，内容仍为release-20261018T155732151Z-26a50198；Web与旧H5服务保持active，旧广告配置保持一致。未写玩家档案、奖励、房间、后台配置或图库发布指针。公网配置HTTP200、adRewardEnabled=true、广告位1054324，实际TapTap来源https://ma-h5-al.tapimg.com的CORS匹配。

首次启用的预检从服务器请求公网旧H5配置时被边缘返回403，发生在任何环境修改前；随后读取实际旧H5环境端口3291，改用本机接口比对后启用成功。没有通过更改代理、安全或访问规则绕过限制。

## 沿用的规则

- 由玩家主动点击触发；不自动弹广告，不新增Banner或插屏。
- 完整观看一次后按所选入口领取1份体力包或1张建房券，库存各最多3份；或在已有免费工具次数用完后取得对应提示/底图30秒机会。体力包存入库存，按原规则使用。
- 登录并加载玩家资料后即可主动请求广告补给，不再要求完成首局或等待账号满60秒。首局游戏的免费体验规则不变。
- SDK明确isEnded===true才向服务器申请奖励；提前关闭、播放/加载失败不发奖。请求绑定玩家、奖励种类、房间/功能与票据，幂等重试不重复发放。
- 完播证据仍是客户端SDK回调，未接入或宣称存在平台签名SSV；本轮不增加现金、付费或可交易权益奖励。
- Web客户端仍关闭广告；微信仍需其自己的广告位，不能复用TapTap广告位。

## 客户端与验证

更新服务说明，去掉“当前移动服务广告关闭”的过时表述，说明TapTap可选激励视频、主动点击、对应奖励、平台处理边界及游戏服务器发奖记录。保留原有同意记录与处理流程，不增加弹窗。

本机8项共享TapTap SDK检查通过：空广告位、加载顺序、重复点击、完播、提前关闭、失败、回调缺失和Web隔离；不会实际请求广告。4项现有移动服务检查通过，包含跨玩家拒绝、completed=false拒绝、取消票据、并发/幂等、库存限制与工具奖励。源码类型检查通过。另运行2项隐私申请审核CLI检查通过；它们不代表广告实际播放或隐私合规认证。

全库图片检查仍存在既有cel-coastal-family-v1衍生记录错误。本次复用上一自测ZIP所有资源，只替换game.js；未改图、重压缩或发布素材。

自测版 **327614**，上传包体 **97815**；平台列表is_releasing=false，boundMainPackage=false，未绑定主包、未提审或发布。

- 包：releases/jigsaw-nook-taptap-20261019-ads-ready.zip
- SHA256：c8a9da440d8632a46c5c13840a235f422ad254c114c0a39c23c5a63f08c18aaf
- 二维码：releases/taptap-test-327614.png
- 对比基线327590，仅jigsaw-nook/game.js变化，HTML、图片、字体、音效字节一致，已验证不卡的背景优化和隐藏测试入口都保留。
- 检查/发布收据：work/taptap-ads-20261019/；服务器环境备份只保留在 `/srv/sites/jigsaw-mobile-v3/shared/operations/20261019-taptap-ads/environment.before`，目录700/文件600，没有下载到本机。

待真机：从TapTap打开下文最新自测版，无需完成首局，可直接到补给页检查一次完播后库存+1、一次提前关闭库存不变，并验证回到房间可继续拖动。还未将新版真实播放、真实奖励到账、提前关闭或平台广告收益记为通过。

## 取消首局与60秒资格限制

用户在补给站遇到“请先完成新手首局体验”，要求取消。客户端claimSupply去掉newcomer/adEligible阻拦；服务端profileView与challenge不再按首局/账号年龄限制广告资格，仍检查身份、广告开关、库存、票据、频率与幂等。

移动后端已更新为20261019-ads-unrestricted，仅替换server/mobile-service.mjs，其余源文件取自线上原版本；没有部署本地尚未发布的mobile-economy.mjs改动。创建两份SQLite备份并保留共享玩家数据，代码原子切换；保留线上全部1,216个公开文件，Web和旧H5未变。健康检查正常，内容版本仍为release-20261018T155732151Z-26a50198，广告启用且广告位1054324。

4项移动服务测试及3项客户端补给测试通过，覆盖新账号首局前立即领取、旧资格缓存不再阻挡、提前关闭/失败、跨身份与未完播拒绝、库存和并发幂等；源码类型检查通过。真实手机广告播放和到账仍待用户确认。本轮证据保存在work/taptap-ads-unrestricted-20261019/。

最新自测版 **327781**，上传包体 **97889**，平台回读is_releasing=false，上传结果boundMainPackage=false，未提审、发布或绑定主包。

- ZIP：releases/jigsaw-nook-taptap-20261019-ads-unrestricted.zip（6,382,189字节）
- SHA256：745cad03d36fab2f6033630e3d4d96c59baad857c428b0dded210f10fd019c2b
- 二维码：releases/taptap-test-327781.png
- 与327614逐项比较，仅jigsaw-nook/game.js变化；背景性能缓存、隐藏测试入口和原资源均保留。
- 后端包SHA256：1a04337a4fbdc2dccb843fe322e64c63c18a13daae9f786137cb6d9b601c827d；服务源文件线上/本地SHA256一致。

体力耗尽现有行为：体力降至0时不会立即弹窗；下一次需要扣体力的有效拼合才检查。设置“体力耗尽自动使用库存包”默认关闭；开启且有库存体力包时自动补满并继续，否则提示“体力不足，请使用礼包或补给”并跳转补给站，该次拼合不记成功。不自动播放广告。本轮未改这套体力行为。

## 官方资料

### 广告内容控制核对（2026-10-19）

用户反馈广告内容不符合需求。本次只读查看该游戏新版“广告变现”页：服务已开启、准备已完成，页面展示收益总览与趋势，没有看到广告类别筛选、素材选择或屏蔽入口。官方tap.createRewardedVideoAd参数仅adUnitId与multiton，没有指定广告内容、类别或时长的参数；教程说明由组件自动拉取素材、关闭后自动加载下一份。不能通过游戏代码指定只展示治愈/拼图类广告，也不能据此断言平台运营侧完全不提供屏蔽服务。若需排除某类广告或具体素材，应携截图、出现时间和广告名称向TapTap工单确认是否支持类别或广告主屏蔽。本次未发送工单、未改广告设置。

- 参数依据：https://developer.taptap.cn/minigameapidoc/dev/api/ad/tap.createRewardedVideoAd/

此前查看通用小游戏总览及ADN指南后，把本项目广告管理归到Dirichlet，结论已纠正，不能据此要求用户在Dirichlet配置本游戏。ADN指南与本项目H5托管接入有适用范围差别，SDK接口名也不能单独证明后台或广告网络归属。

### H5与Tap小游戏广告通道纠正（2026-10-19）

用户指出Dirichlet账户没有游戏信息。本轮只读实查该账户首页显示“资质审核中，目前只能创建测试媒体”，媒体管理为0条；菜单虽有“屏蔽规则”，并未发现本项目媒体或广告位。TapTap游戏广告页仍显示“已开启 / 已完成”。未创建媒体、改广告位、发送工单或修改账户设置。

关键依据为本项目原先引用的官方H5/MCP广告接入指南：https://developer.taptap.cn/minigameapidoc/quick-start/mcp-guide/ad-integration-guide/ 。其适用范围明确写明：当前广告变现能力支持“星火，H5小游戏和TapTap制造的游戏”；“Tap小游戏和APK游戏请接入Dirichlet广告联盟”。同时说明该H5通道在TapTap开发者中心开通、查看收入和提现，无需其他平台。本项目上传的是H5 ZIP，使用此H5平台托管通道，不能与需要单独创建媒体的Tap小游戏/APK通道混淆。

调用链已核对mobile/client.ts及mobile/platform-web.ts：读取游戏服务器/config的rewardedAdUnitId，再调用宿主tap.createRewardedVideoAd({adUnitId})；加载并show，isEnded===true后向我们服务器申请补给。当前沿用的1054324根据docs/taptap-h5-setup.md为官方H5工具自动匹配的竖屏激励广告位，没有接入用户当前新建的Dirichlet媒体。宿主平台负责加载展示广告，我们服务器负责库存与领奖校验。尚不能确认具体曝光的底层广告网络；60秒/试玩素材是否可屏蔽，需针对H5托管通道询问TapTap，不能用TapADN原生SDK支持可玩广告直接归因。此通道指南明确列出激励视频、插屏、Banner；原生模板不能承诺本H5通道可用。

- [广告接入指南](https://developer.taptap.cn/minigameapidoc/quick-start/mcp-guide/ad-integration-guide/)
- [激励视频与完成回调](https://developer.taptap.cn/minigameapidoc/dev/tutorial/open-capabilities/ad/rewarded-video-ad/)
- [本游戏广告变现后台](https://developer.taptap.cn/v3/485306/app/963283/operation/ad-monetization)


## 分享替代广告与误发奖修复（2026-10-19）

旧测试包把复制链接也视为分享成功，可能不打开原生面板就完成邀请任务。本轮接入 tap.showShareboard 和独立 tap.onShareMessage 渠道回调；仅打开面板、复制、取消、失败、无宿主不发奖。已发放的历史奖励与任务不回滚。补给分享每次加1张建房券或1个体力包，上限3；提示及底图保留免费次数，用尽后分享开启30秒。每日拼图按钮删除108片字样，实际格数不变。取消后释放预留；领取重试复用同一请求，不重复分享或发奖。

后端已部署 20261019-share-rewards（前版20261019-ticket-refill），两份数据库备份完成，1216公开资源完全保留，内容指针未变，Web版本未变。默认广告领奖关闭，shareRewards开启。32项聚焦检查、类型检查和真实部署包合成数据库验证通过；未向生产玩家库写测试数据。既有全图库校验问题 cel-coastal-family-v1 未改动。

TapTap自测版本329937，包体98911，未绑定主包、未公开发布。最终ZIP为 releases/jigsaw-nook-taptap-20261019-share-rewards.zip，SHA256 14211ed3481bfed55d918ef432bb70bc667bdd1b790ccdd9123270d130e79398。152张缩略图和夏日青春手账6张用图保留包内，无背景音乐。

平台边界：开发后台说明无需模板可使用预设文案，但API文档仍将templateId标必填。本包采用后台预设文案，尚待用户扫码验证真机原生分享面板及独立回调；不得将本地模拟通过当成真机成功。渠道回调不能证明收件人收到或阅读，服务端保护身份、用途、过期、库存、限流及重放，不具备平台签名送达回执。

官方依据：
- https://developer.taptap.cn/minigameapidoc/dev/api/open-api/share/tap.showShareboard/
- https://developer.taptap.cn/minigameapidoc/dev/api/open-api/share/tap.onShareMessage/
- https://developer.taptap.cn/485306/app/963283/tap-mini-app-share-config

发布及校验证据：work/taptap-share-supply-20261019/ 中 deployment.log、deployment-verification.json、upload-result.json、after-list.json、qr-result.json。


### 原生分享真机失败后的官方核对（2026-10-19）

用户在自测包看到“当前环境无法分享，请使用邀请码”。该文案来自 mobile/app.ts 的 unavailable 分支，是游戏自身兜底，不能据此判定TapTap限制自测分享。当前适配器把SDK方法缺失、同步异常、非取消fail都折叠为unavailable，未向用户保留原始errno/errMsg，尚不能确定实际根因。

本轮实时查阅官方showShareboard：最低版本1.7.0，templateId标为必填；面板回调不等于分享成功。官方onShareMessage同样最低1.7.0，回调含channel和errMsg，但示例代码写onShareAppMessage，存在命名不一致。后台分享设置仍写预设文案无需模板，自定义模板0条；与API必填参数说明不一致。本轮所查页面没有“自测包禁止分享”条款，定向站内搜索亦未取得此说法，不等于证明所有自测环境均支持。

结论：不能归因于测试环境，也不能宣称接入已真机成功。下一步应保留并显示仅管理员可见的原始失败阶段/errno/errMsg和方法可用性，再按实际错误决定模板或宿主适配；不要先公开发布来试错。本轮只读检索，未改后台设置、代码或再上传包。


### 管理员分享诊断包（2026-10-19）

已上传TapTap自测330270，包体99086，未绑定主包、未公开发布。ZIP：releases/jigsaw-nook-taptap-20261019-share-diagnostics.zip，SHA256：1df7b4644765fc7e91dc3dead67a010cf06755d38fefbf27027a1f0b125f77f2。

原生分享适配器记录面板/监听接口可用性、失败阶段、errno/errNo、受限长度及脱敏的errMsg；只保留当前进程最后一次诊断，不包含分享scene参数、不上传日志。管理员资格使用服务端已返回的profile.taptap.diagnostics，沿用老头账号的诊断授权；普通玩家没有诊断弹窗或设置内容。邀请分享、补给与工具分享失败/超时时管理员弹窗显示诊断，设置页也可查看最近结果。不改变分享发奖判定，不把面板成功当成渠道成功，也不猜造模板ID。无需部署服务端。

新增聚焦诊断检查覆盖失败阶段/错误码、脱敏及管理员显示边界，连同现有分享检查共9项通过，完整源码类型检查和隔离构建通过；152缩略图与夏日青春手账6张用图仍打包。真机原始错误待用户新码反馈，再决定模板或SDK兼容修复，未宣称根因已解决。上传回执与二维码位于work/taptap-share-diagnostics-20261019及releases/taptap-test-330270.png。


### 真机确认模板必填并修复（2026-10-19）

用户提供330270真机弹窗：面板与监听均存在，面板调用失败，原始信息showShareboard:fail templateId cannot be empty。这证实本次失败是缺少模板参数，不能归因于自测环境限制。

已在游戏963283分享设置创建并提审通用模板，文案“来拼图小窝，一起拼出美好时光”，实际ID ST1792415349659O9SC25PR4；提交后后台显示“已审核”。截图与结构记录保存在work/taptap-share-template-20261019/template-approved.png、template-evidence.json。过程中出现新版开发者协议窗口，未接受新协议，关闭后已正常读取分享模板状态。

mobile/taptap-share.ts现给showShareboard传上述实际公开模板ID；保留独立渠道回调门禁、取消/复制不发奖与管理员诊断。9项聚焦检查及类型检查通过，测试断言实际传入模板ID，隔离构建完成。无需后端或玩家数据改动。

新自测版本330295，包体99096，未绑定主包、未公开发布。ZIP releases/jigsaw-nook-taptap-20261019-share-template.zip，SHA256 305badc9497423c1c74fe581a403cf719cb23720b2c61d5d78729399ef2ebfc1。保留158张包内图片。模板已审核与包上传成功，不等于真机分享已成功；新包需确认面板和渠道回调。


### 分享真机验收

用户确认自测330295原生分享可用，测试成功。该确认覆盖用户此次测试路径；其他分享渠道、取消及回调差异不据此推定全部完成真机验收。
