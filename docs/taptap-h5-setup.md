# TapTap H5 接入与交付说明

## 当前版本

独立H5以原站线上20261006-05为基准，保留82张在架图片。原网站工程、机器人试错修改、原站SQL迁移及数据库没有改写。旧`/taptap`SSR入口和`__JIGSAW_H5_BRIDGE__`占位不属于这次静态ZIP的实际运行方式。

自托管入口为`https://jigsawnook.online/taptap-play/#/zh/lobby`。平台ZIP为`releases/jigsaw-nook-taptap-h5.zip`，根目录含index.html，静态JS/CSS使用相对地址；API固定指向`https://jigsawnook.online/h5`，图片通过同一网关连接原站资源。只有游戏客户端放入TapTap包，服务器运行包不能上传到H5包体入口。

## 两端同房

普通Web和H5经原HTTP增量轮询协议连接原后端。原账号可在两端分别登录；不同来源的游客身份分别生成。两端同房不等于自动绑定TapTap账号。本次无需WebSocket、无需复制正式数据库。

H5网关的连接凭证存入浏览器localStorage，原站Cookie只保存在服务端。限定精确来源，不使用`*`。平台测试时从真实请求核对TapTap Origin，将它加入`H5_ALLOWED_ORIGINS`后重启独立服务；不凭猜测填写域名，不允许null来源。

## 广告

用户规则：每次提示/底图先完整观看一条广告，获得对应功能的一次30秒使用。广告时长由平台决定；不存在网页自行计时30秒即可跳过广告的逻辑。

官方API是`tap.createRewardedVideoAd({adUnitId})`，宿主提供全局tap。普通浏览器没有宿主广告SDK，按钮明确显示广告暂未开放。只有`isEnded===true`才申请帮助；失败/提前关闭不解锁。

服务端独立表保证会话、房间、功能、票据和请求ID绑定，以及一次性消耗、重试幂等。当前完成事件由客户端报告，并不是平台签名的SSV证明；因此只能用于这次非付费帮助，不能直接扩展为付费商品或可交易权益。

正式开启步骤：
1. 提供自己游戏的后台网址或应用编号。AppID不是版本号，765478合集编号也不是本游戏AppID。
2. 在该游戏“商店 → 小游戏广告”确认已开通，并取得激励视频广告位ID。
3. 服务器环境设置`H5_REWARDED_AD_UNIT`及`H5_AD_ASSISTANCE_ENABLED=true`。
4. TapTap测试环境验证实际广告播放、完整观看、提前关闭、失败、重试、横竖屏和网络来源；普通网页不能替代此测试。

正式开通前应补齐经营者、客服、广告及相关隐私资料。目前保留原站草稿提示，不虚构已审核状态。上传或工具上传可能进入审核，制作包体不代表已提交审核。

官方依据：[广告接入指南](https://developer.taptap.cn/minigameapidoc/quick-start/mcp-guide/ad-integration-guide/)、[激励视频与完成回调](https://developer.taptap.cn/minigameapidoc/dev/tutorial/open-capabilities/ad/rewarded-video-ad/)、[TapTap隐私政策](https://www.taptap.cn/doc/privacy-policy)。

## 自托管部署

独立运行目录`/srv/sites/jigsaw-h5/current`，独立会话数据`/srv/sites/jigsaw-h5/shared/h5-sessions.sqlite`，服务`jigsaw-h5.service`监听127.0.0.1:3291。配置样例位于`deploy/h5/`，服务仅新增对应路径，原站应用未重启。当前正式服务器为64.90.2.134；旧SSH别名webhosting-main仍指向186.241.106.176，部署时必须显式核对目标。旧服务器上本次新增的H5服务已停止，代理配置已恢复。

服务器使用Node24原生SQLite，无第三方运行依赖。H5_UPSTREAM目前指向原站监听口127.0.0.1:3104，H5_UPSTREAM_ORIGIN固定为原域名HTTPS。原站将来切换应用监听口时，应同步这个配置并重启H5服务；图库更新也应重新生成H5目录与白名单。

nginx覆写`X-Jigsaw-Client-IP`，网关仅信任loopback代理，按真实来源限流。原站Cookie和H5会话数据库必须保持服务器私有，不加入ZIP或源码。

回退：恢复独立release中`nginx.before.conf`到原站nginx配置，`nginx -t`通过后reload，再停止`jigsaw-h5.service`。不回滚原站数据库，不覆盖原站current，不删除玩家房间。

## 已验证

- TypeScript通过，82张在架图片校验通过。
- 网关/广告自动测试6项通过。
- 隔离真实HTTP15项通过：双端同步、鉴权、聊天、指针、账号、私房和上传图片。
- 隔离浏览器13项通过：子目录导航、图库、跨域Canvas、同房、刷新、390px手机、广告模拟完成/关闭/失败以及原Web帮助规则。
- 新增H5代码定向oxlint通过。全量原源码仍有沿用基准版本的lint错误，本次未趁机重构这些文件。
- 公网5项验收通过：独立入口、手机显示、广告说明、拒绝未授权来源，且原Web与H5大厅房间ID一致；没有创建正式测试房间或账号。
- 真实TapTap环境、真实广告位与提审尚未验证。

详细证据在本机`work/h5-http-test/results.json`、`work/h5-browser/results.json`及截图。测试只使用隔离数据；线上验收使用只读接口。

## 重跑隔离验收

先执行`npm run build:server`生成独立测试后端，再运行`npm run test:h5:acceptance`。验收脚本在同一次运行中管理后端与网关，结束后自动停止，不依赖聊天工具的后台进程存活。端口3211/3220必须空闲。运行数据仅保存在本项目work/h5-http-test。
