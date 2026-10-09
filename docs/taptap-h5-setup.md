# TapTap H5 接入与交付说明

## 当前版本（2026-10-09）

独立H5以原站线上20261006-05为基准，保留82张在架图片。原网站工程、机器人试错修改、原站SQL迁移及数据库没有改写。旧 `/taptap` SSR入口和 `__JIGSAW_H5_BRIDGE__` 占位不属于这个静态包的实际运行方式。

自托管入口：https://jigsawnook.online/taptap-play/#/zh/lobby 。服务器独立release为20261009-02。

平台游戏963283（一起拼拼拼），开发者485306；官方工具已校验归属并授权。竖屏H5开发版本280927、底层上传包76237已上传并绑定草稿主包，最小运行库2.4.0。官方查询确认草稿/未发布，is_releasing=false。本次未提交审核或发布。

官方试玩入口：https://www.taptap.cn/qrcode/miniapp?id=tapmcln4cmjeaus1ft&type=develop&version_id=280927 。使用TapTap手机App扫码进行真实运行测试。

平台ZIP：`releases/jigsaw-nook-taptap-h5.zip`，367500字节，SHA256 `bba74e0449c4622f9831edf42acc471e3e07ab96a346da2f07eafc64c54426fb`。仅一个顶层游戏目录jigsaw-nook，其内有index.html；相对路径JS/CSS，API固定指向 `https://jigsawnook.online/h5`，图片经网关连接原站资源。正式数据库、密钥与服务器运行包不放入平台ZIP。

服务器包：`releases/jigsaw-nook-h5-server.tar.gz`，382251字节，SHA256 `68126ef06a05dd901f41a562d23f1516c5d8ac7fd2ba9d576bddcb757d1fba30`。只包含当前网关与静态构建。

## 两端同房与待验证来源

普通Web和H5经原HTTP增量轮询协议连接原后端。原账号可在两端分别登录；不同来源游客身份分别生成。两端同房不等于自动绑定TapTap账号。无需WebSocket、无需复制正式数据库。

H5连接凭证存于浏览器localStorage，原站Cookie仅在服务端保存。CORS使用精确来源，不允许通配符或null。当前允许自托管域名 `https://jigsawnook.online`；TapTap实际Origin还未收到和验证。平台扫码测试后，检查独立服务日志中 `h5_origin_denied`，核对真实请求来源，再将确定的精确Origin加入 `H5_ALLOWED_ORIGINS` 并仅重启H5服务。若平台使用null来源，需要另行设计经过验证的受限接入方式，不能直接放开。

临时诊断 `H5_LOG_BLOCKED_ORIGINS=true` 只记录被拒的规范Origin，按来源10分钟去重，最多64项；不记录IP、房间、账号、凭证或请求正文。确认平台来源后关闭该诊断。

## 广告接入

官方H5 MCP已确认广告服务生效并自动匹配竖屏激励视频广告位 **1054324**。独立服务器已设置 `H5_REWARDED_AD_UNIT=1054324` 与 `H5_AD_ASSISTANCE_ENABLED=true`，公网 `/h5/config` 已核对。

每次提示或底图须完整看一条广告，解锁对应功能一次30秒使用。广告本身时长由平台决定，不使用网页倒计时替代广告。

按官方返回的集成指南使用宿主 `tap.createRewardedVideoAd({adUnitId})`：每个运行环境/广告位保持一个实例，启动预加载不展示广告；用户操作后show，失败时load并最多重试一次。完整结束回调 `isEnded===true` 才申请帮助；提前关闭、加载失败、播放失败、重复点击不会解锁。普通浏览器缺少TapTap宿主SDK，保持帮助锁定。真实手机广告播放尚未验证。

服务端独立表绑定会话、房间、功能、票据与请求ID，原子消耗一次票据，重试不重复授权、不延长30秒。当前完成事件由客户端报告，属于SDK回调，并不是平台签名SSV证明；不能直接用于付费商品或可交易权益。

手机验收顺序：
1. TapTap App扫码进入版本280927；若大厅报连接错误，先核对真实Origin。
2. 与原Web进入同一公开房间，确认双方成员、拼块移动及聊天同步。
3. 完整观看激励视频，核对提示/底图仅解锁一次且30秒后结束。
4. 提前关闭、播放失败及连续点击均不发奖励；再次完整观看可再用一次。

只有上述真实测试通过，才能将 `realDevicePlaybackVerified` 与 `platformNetworkOriginVerified` 标为true。包体预检、自动测试及广告开通都不等于审核通过。

官方参考：[广告接入指南](https://developer.taptap.cn/minigameapidoc/quick-start/mcp-guide/ad-integration-guide/)、[激励视频与完成回调](https://developer.taptap.cn/minigameapidoc/dev/tutorial/open-capabilities/ad/rewarded-video-ad/)。具体实例生命周期依据本次已授权官方MCP返回的指南。

## 部署与回退

实际生产主机64.90.2.134。SSH别名webhosting-main仍指向旧服务器186.241.106.176，必须显式指定HostName并核对原站current。旧服务器本次新增的H5服务已停止，代理配置已恢复。

独立目录 `/srv/sites/jigsaw-h5/current` 指向release20261009-02；数据保存在 `/srv/sites/jigsaw-h5/shared/h5-sessions.sqlite`，配置 `/etc/webapps/jigsaw-h5.env`。`jigsaw-h5.service` 监听127.0.0.1:3291，使用Node24原生SQLite，无第三方运行依赖。

H5_UPSTREAM指向原站127.0.0.1:3104，H5_UPSTREAM_ORIGIN为原域名HTTPS。原站仍运行20261006-05，未重启，原nginx和原服务定义哈希已核对未变化。原站切换监听口时应同步H5配置；图库更新应重建目录白名单。

更新回退：恢复20261009-02内root可读的 `h5-env.before` 到独立环境文件，将独立current原子切回20261009-01，并只重启jigsaw-h5.service。原站current、数据库和玩家房间不用回滚。平台主包若需回退，可用官方CLI CAS将280927替换回280802，操作前查询当前槽位。初次代理部署回退才需要使用20261009-01内nginx.before.conf；普通H5更新不改nginx。

## 已验证

- TypeScript与新增代码定向oxlint通过；82张在架图片校验通过。
- 网关/帮助测试3项、广告SDK生命周期测试6项，共9项通过。
- 隔离HTTP15项通过：双端同步、碰撞、鉴权、聊天、指针、账号、私房与上传图片权限。
- 隔离浏览器13项通过：图库、跨域Canvas、同房、刷新、390px手机、模拟广告完成/关闭/失败及原Web帮助规则。
- 官方ZIP预检无违规项或警告；上传、主包绑定、竖屏版本和未发布状态已验证。
- 公网广告配置已验证。公网手机页面与房间列表只读验收证据存于 `work/h5-production/results.json`。
- TapTap真实Origin与真实广告播放仍待手机测试。全量原源码沿用基准版本lint错误，本次未重构无关文件。

重跑隔离验收：先 `npm run build:server`，再 `npm run test:h5:acceptance`。脚本管理并关闭隔离后端/网关，测试数据仅在本项目work目录；3211/3220端口须空闲。不得将隔离测试指向正式后端。

## 官方工具风险记录

官方CLI网页登录与H5 MCP手机扫码为两套已完成授权。不要打印或复制凭证。

此前H5 MCP的 `update_app_info` 仅传竖屏字段却实际调用 `/level/v1/submit`，意外触发reviewing且未保存方向。已立即通过官方CLI撤回并验证draft。本次通过新版CLI上传竖屏开发包、绑定草稿主包，成功使官方广告查询读到方向1并匹配真实广告位。

不要使用 `update_app_info` 做普通草稿方向设置，也不要用会自动提审的旧 `upload_h5_game` 替代仅上传开发版本。未经明确授权不调用审核、发布或经营协议确认操作。
