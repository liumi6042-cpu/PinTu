# TapTap H5 接入与交付说明

## 当前版本（2026-10-09）

独立H5以原站线上20261006-05为基准，保留82张在架图片。原网站工程、机器人试错修改、原站SQL迁移及数据库没有改写。旧 `/taptap` SSR入口和 `__JIGSAW_H5_BRIDGE__` 占位不属于这个静态包的实际运行方式。

自托管入口：https://jigsawnook.online/taptap-play/#/zh/lobby 。服务器独立release为20261009-04。

平台游戏963283（一起拼拼拼），开发者485306；官方工具已校验归属并授权。竖屏H5开发版本281145、底层上传包76338已上传并绑定草稿主包，最小运行库2.4.0。官方查询确认草稿/未发布，is_releasing=false。本次未提交审核或发布。

官方试玩入口：https://www.taptap.cn/qrcode/miniapp?id=tapmcln4cmjeaus1ft&type=develop&version_id=281145 。使用TapTap手机App扫码进行真实运行测试。

平台ZIP：`releases/jigsaw-nook-taptap-h5.zip`，6994671字节，SHA256 `0ff8c791432e6373bdbdfd3dc1a1f43399c66b00ba977327c7e09a1876c5b38b`。仅一个顶层游戏目录jigsaw-nook，其内有index.html；相对路径JS/CSS，API固定指向 `https://jigsawnook.online/h5`，134张公共缩略预览图随包发布，拼图大图经网关连接原站资源。正式数据库、密钥与服务器运行包不放入平台ZIP。

服务器包：`releases/jigsaw-nook-h5-server.tar.gz`，7003210字节，SHA256 `bd003f8f55ca09c20b4f0e91e0d148b94bfe28ceb2d00423698517c487ad3bc5`。只包含当前网关与静态构建。

## 两端同房与待验证来源

普通Web和H5经原HTTP增量轮询协议连接原后端。原账号可在两端分别登录；不同来源游客身份分别生成。两端同房不等于自动绑定TapTap账号。无需WebSocket、无需复制正式数据库。

H5连接凭证存于浏览器localStorage，原站Cookie仅在服务端保存。CORS使用精确来源，不允许通配符或null。当前允许自托管域名 `https://jigsawnook.online` 与实际TapTap测试来源 `https://ma-h5-al.tapimg.com`。用户首次真机测试发现图片和房间无法加载；14:21:11 UTC的独立网关日志确认该TapTap来源被拒。已将这个精确来源加入配置并仅重启H5服务，无需更换测试包或二维码。其他测试/正式平台来源须继续从真实请求核对后再追加。若平台使用null来源，需要另行设计经过验证的受限接入方式，不能直接放开。

临时诊断 `H5_LOG_BLOCKED_ORIGINS=true` 只记录被拒的规范Origin，按来源10分钟去重，最多64项；不记录IP、房间、账号、凭证或请求正文。手机复测确认连接后关闭该诊断。

## 广告接入

官方H5 MCP已确认广告服务生效并自动匹配竖屏激励视频广告位 **1054324**。独立服务器已设置 `H5_REWARDED_AD_UNIT=1054324` 与 `H5_AD_ASSISTANCE_ENABLED=true`，公网 `/h5/config` 已核对。

每次提示或底图须完整看一条广告，解锁对应功能一次30秒使用。广告本身时长由平台决定，不使用网页倒计时替代广告。

按官方返回的集成指南使用宿主 `tap.createRewardedVideoAd({adUnitId})`：每个运行环境/广告位保持一个实例，启动预加载不展示广告；用户操作后show，失败时load并最多重试一次。完整结束回调 `isEnded===true` 才申请帮助；提前关闭、加载失败、播放失败、重复点击不会解锁。普通浏览器缺少TapTap宿主SDK，保持帮助锁定。用户已确认真实手机广告播放及进房成功；完整观看发奖和提前关闭未明确反馈。

服务端独立表绑定会话、房间、功能、票据与请求ID，原子消耗一次票据，重试不重复授权、不延长30秒。当前完成事件由客户端报告，属于SDK回调，并不是平台签名SSV证明；不能直接用于付费商品或可交易权益。

手机验收顺序：
1. TapTap App扫码进入版本281145；若大厅报连接错误，先核对真实Origin。
2. 与原Web进入同一公开房间，确认双方成员、拼块移动及聊天同步。
3. 完整观看激励视频，核对提示/底图仅解锁一次且30秒后结束。
4. 提前关闭、播放失败及连续点击均不发奖励；再次完整观看可再用一次。

用户确认广告播放和进房后，`realDevicePlaybackVerified` 与 `platformNetworkOriginVerified` 已为true；奖励发放和提前关闭分别由独立字段记录，尚未标为通过。包体预检、自动测试及广告开通都不等于审核通过。

官方参考：[广告接入指南](https://developer.taptap.cn/minigameapidoc/quick-start/mcp-guide/ad-integration-guide/)、[激励视频与完成回调](https://developer.taptap.cn/minigameapidoc/dev/tutorial/open-capabilities/ad/rewarded-video-ad/)。具体实例生命周期依据本次已授权官方MCP返回的指南。

## 部署与回退

实际生产主机64.90.2.134。SSH别名webhosting-main仍指向旧服务器186.241.106.176，必须显式指定HostName并核对原站current。旧服务器本次新增的H5服务已停止，代理配置已恢复。

独立目录 `/srv/sites/jigsaw-h5/current` 指向release20261009-04；数据保存在 `/srv/sites/jigsaw-h5/shared/h5-sessions.sqlite`，配置 `/etc/webapps/jigsaw-h5.env`。`jigsaw-h5.service` 监听127.0.0.1:3291，使用Node24原生SQLite，无第三方运行依赖。

H5_UPSTREAM指向原站127.0.0.1:3104，H5_UPSTREAM_ORIGIN为原域名HTTPS。原站仍运行20261006-05，未重启，原nginx和原服务定义哈希已核对未变化。原站切换监听口时应同步H5配置；图库更新应重建目录白名单。

更新回退：恢复20261009-04内root可读的 `h5-env.before` 到独立环境文件，将独立current原子切回20261009-03，并只重启jigsaw-h5.service。原站current、数据库和玩家房间不用回滚。平台主包若需回退，可用官方CLI CAS将281145替换回281092，操作前查询当前槽位。初次代理部署回退才需要使用20261009-01内nginx.before.conf；普通H5更新不改nginx。

## 已验证

- TypeScript与新增代码定向oxlint通过；82张在架图片校验通过。
- 网关/帮助测试3项、广告SDK生命周期测试6项，共9项通过。
- 隔离HTTP15项通过：双端同步、碰撞、鉴权、聊天、指针、账号、私房与上传图片权限。
- 隔离浏览器14项通过：图库、跨域Canvas、同房、刷新、390px手机、模拟广告完成/关闭/失败及原Web帮助规则。
- 官方ZIP预检无违规项或警告；上传、主包绑定、竖屏版本和未发布状态已验证。
- 公网广告配置已验证。公网手机页面与房间列表只读验收证据存于 `work/h5-production/results.json`。`https://ma-h5-al.tapimg.com` 来源下会话、大厅同房列表、房间POST预检、82张图库缩略图及2张拼图图片读取均已通过；保留精确来源限制。
- 已观察并放行真实TapTap测试Origin；用户已确认连接与真实广告播放；预览图新包真机复测及奖励发放/提前关闭仍待明确反馈。全量原源码沿用基准版本lint错误，本次未重构无关文件。

重跑隔离验收：先 `npm run build:server`，再 `npm run test:h5:acceptance`。脚本管理并关闭隔离后端/网关，测试数据仅在本项目work目录；3211/3220端口须空闲。不得将隔离测试指向正式后端。

## 官方工具风险记录

官方CLI网页登录与H5 MCP手机扫码为两套已完成授权。不要打印或复制凭证。

此前H5 MCP的 `update_app_info` 仅传竖屏字段却实际调用 `/level/v1/submit`，意外触发reviewing且未保存方向。已立即通过官方CLI撤回并验证draft。本次通过新版CLI上传竖屏开发包、绑定草稿主包，成功使官方广告查询读到方向1并匹配真实广告位。

不要使用 `update_app_info` 做普通草稿方向设置，也不要用会自动提审的旧 `upload_h5_game` 替代仅上传开发版本。未经明确授权不调用审核、发布或经营协议确认操作。

## 预览图二次修复（版本281092）

用户确认广告及进房成功后，反馈大厅选图与今日拼图预览仍破图。拼图Canvas原有匿名跨域加载，JSX预览img默认使用no-cors。在COEP require-corp、COOP same-origin隔离环境下，同一图片普通img被拦，anonymous img成功加载，已用浏览器重现并保存 `work/h5-image-policy-probe.json`。这证明加载方式可导致同样故障；未直接读取手机宿主的响应策略。

H5 Vite适配器为所有预览img加入crossOrigin="anonymous"，只改变独立H5构建，原站源码不改。严格隔离的15项HTTP与13项浏览器回归通过；公网相同TapTap来源下今日拼图和图库预览、Canvas检查通过，证据 `work/h5-taptap-origin/results.json`。新增包281092已上传、绑定并导出二维码。需使用新二维码进入，旧280927二维码仍指向旧前端。

标准依据：[MDN COEP说明](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy)。

## 预览图随包发布（版本281145，当前方案）

用户复测281092仍破图，说明匿名CORS修复不足以覆盖实际手机环境；电脑COEP模拟成功不能当作真机成功，准确宿主原因尚未得到手机请求证据。

当前构建复制既有134张公共缩略图（含82张在架图及保留历史房间缩略图）到jigsaw-nook/puzzles目录，不改图片字节。通过模块import.meta.url解析同源地址，避免宿主document.baseURI影响；API/房间/拼图大图及上传图片权限仍经同一后端网关。平台ZIP与独立服务器包均包含这些预览文件。

包体约7MB，143个ZIP条目，官方预检无错误或警告。开发版本281145已上传绑定，游戏未发布。15项HTTP、14项浏览器验收通过；测试主动阻断所有远程缩略图请求，图库与今日拼图仍显示。相同TapTap来源的严格隔离浏览器检查通过，证据work/h5-packaged-previews/results.json；这仍不是手机宿主验证，需用户使用新二维码确认。
