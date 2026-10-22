# 微信社交组件接入记录

日期：2026-10-13。用户已开通微信社交组件，要求接入后测试加好友和发消息。继续共用微信 / TapTap 游戏内容，保留“公开房间只能发预设短句”的规则。

当前状态：微信组件已在真实开发工具初始化成功，新手机预览已生成；自建好友后端已升级到 `20261013-social34`。微信原生双手机好友/私聊仍待真机验证，未上传新开发版本或提交审核。下方连接阻塞与旧后端状态为执行过程中保留的历史记录。

## 已确认的官方接口

组件为 `MiniGameChat` 插件，不是 `wx.createMiniGameChat` 标准 API。官方代码使用 `requirePlugin('MiniGameChat', {enableRequireHostModule:true, customEnv:{wx}}).default` 获取构造器，创建后监听 `ready` / `error`。插件声明为 provider `wx2ea687f4258401a9`、version `latest`，使用 `isolatedContext`。

官方公开桥实现支持 `show`、`hide`、`open`、`close`、`setTabs` 和设置聊天签名。但桥中没有列出 tabs 合法键、只打开私聊的 key、好友事件结构或消息导出能力，不能据此猜测接口参数。

- [官方 JavaScript 桥](https://raw.githubusercontent.com/wechat-miniprogram/minigame-tuanjie-transform-sdk/main/Runtime/wechat-default/unity-sdk/chat.js)
- [官方插件配置](https://raw.githubusercontent.com/wechat-miniprogram/minigame-tuanjie-transform-sdk/main/Runtime/wechat-default/game.json)
- [官方接口 XML 说明](https://raw.githubusercontent.com/wechat-miniprogram/minigame-tuanjie-transform-sdk/main/Runtime/Plugins/wx-runtime.xml)
- [完整社交组件指南](https://developers.weixin.qq.com/minigame/dev/guide/open-ability/game-chat.html)

## 当前接入边界

使用隐藏初始化与状态诊断，`autoShow:false`。微信特有插件放在平台适配与构建配置中，TapTap 不增加插件声明；自有好友 / 私聊及任务逻辑继续共用。初始阶段只初始化，后续在真实已授权插件中核实了原生私聊入口，再加入可选“微信好友”按钮。

真实已授权组件的公开方法 `openPrivate()` 无参数，内部调用 `innerOpen('private','self')`；`setTabs` 会过滤允许值。已在同一真实插件中成功执行 `setTabs(['private'])` 并得到主游戏 `ready`。据此，入口只保留 `private` 白名单，调用 `openPrivate()`，绝不调用默认 `open('')` 或加入世界频道。原生窗口仅在实际 `open` 事件后记为打开成功；失败或超时给出提示，不阻止主游戏。

组件的真实实现明确拒绝开发者工具内打开原生面板，代码在 `platform='devtools'` 时提示手机测试。关闭面板后隐藏插件悬浮入口，避免拼图区遮挡。**真实手机的原生好友面板和发消息仍待用户双账号操作验证**，不能用初始化成功代替这个结论。

添加平台好友不直接发任务奖励；没有可信绑定与服务端验证时，不把客户端平台好友数据当奖励依据。

现有编号好友系统使用游客凭证，尚未绑定微信账号。组件好友关系、组件私聊记录与自有服务器数据不会自动合并；是否可同步需依据官方事件和身份接口确定。

## 环境核对

- 微信开发工具 0.3.11 skill 与工具版本一致，登录未过期，CLI 不要求令牌；项目为 `outputs/wechat-game`，AppID `wx8d8511fdd7dd5c7e`。
- 本机 Edge 已打开社交组件官方指南与微信能力后台；Browser Use 对两个站点页面都因安全策略拒绝访问。未通过桌面操作、其他浏览器、隐藏请求或账户凭证绕过。公开官方 GitHub 实现可读取。
- 2026-10-13 只读 SSH 核对：手机服务 `jigsaw-mobile-v3.service` 为 active，current 指向 `20261011-wechat01`，没有 `server/mobile-social.mjs`。因此上一轮本地新增好友功能尚未部署到手机服务。
- 完整双手机测试还需要更新独立手机后端、新微信测试包，以及两位有预览权限的测试账号。原 PC 服务与旧 H5 保持独立。

## 待补资料

已向用户询问社交组件后台的插件信息或接入示例。只需要官方配置 / 代码文本，不需要 AppSecret、密码或其他凭证。具体需要 `setTabs` 合法值、好友 / 私聊入口及相关事件说明，不能默认打开全部聊天页。

## 集中验证与实际阻塞

隐藏初始化及共享传输共 16 项检查、完整类型检查和 82 张图片来源校验通过；已构建微信与 TapTap 共享产物，微信主包 3,337,389 字节。声明启用插件后，真实微信开发工具返回：

> wx2ea687f4258401a9 插件未授权使用

错误附有“添加插件”操作入口；重新关闭并打开项目后仍然相同。同期模拟器自动化截图超时，没有取得可证明组件正常运行的截图，不能将其归因为好友功能测试通过。测试未添加任何平台好友，也未发送平台私聊。

未授权阶段曾把微信 `nativeSocialEnabled` 暂时恢复为 `false`，保留游戏可用构建。用户随后明确确认“我已经添加了，继续吧”，现已重新设为 `true` 并构建；真实主游戏日志返回 `[wechat-social] ready`，原插件未授权报错不再出现。此为当前状态，上述未授权为历史诊断记录。

微信后台被浏览器安全策略拦截，未尝试绕过或代替用户授予权限。实际授权由用户完成；后续接口核实使用已正常加载的官方组件公开方法定义，只记录方法与参数，不读取微信关系或消息。临时接口定义日志已从最终源码删除。

最终原生组件 12 项、社交入口 9 项、共享传输 10 项集中检查通过，共 31 项；类型检查通过。覆盖私聊白名单、开发工具限制、真实打开事件、失败与超时、关闭隐藏悬浮入口，以及不存在原生能力时保留原游戏好友 UI。

## 手机测试交付

已生成[微信手机预览二维码](../outputs/shared-build/wechat-social34/wechat-social34-preview.png)，官方工具返回成功。实际预览总包 7,264,258 字节、主包 3,540,370 字节、art 分包 3,723,888 字节；官方预览打包包含已授权插件，字节数大于本地普通构建。主包仍低于 4 MiB。本次仅生成预览，未上传开发版本、未提交审核或正式发布。

入口：扫码打开游戏 → 大厅“好友” → “微信好友”。该按钮调用微信官方组件的私聊入口；两位有测试权限的微信玩家需在手机上验证互加好友、双向发送文字、返回游戏后重新打开会话。原生社交与现有游戏 9 位编号好友分别保留，未自动导入微信关系、聊天记录或发放任务奖励。

官方模拟器已取得[大厅画面](../outputs/shared-build/wechat-social34/native-ready.png)，并在最终源码移除诊断后再次返回 `[wechat-social] ready`。自动点大厅“好友”未让画面发生变化，不能据此声称原生入口或游戏内好友操作已经在模拟器通过；手机原生面板本就需要真机测试。

## 手机后端更新过程与当前结果

升级已准备为 93,379 字节的 API 差量包，451 份资源逐项哈希相同，复用旧图片目录；在线备份、原子切换、仅重启手机服务及失败回退脚本已通过 7 项集中检查。[升级准备与命令](2026-10-13-mobile-social-upgrade-preparation.md)。

执行上传时，两次 scp 与后续 SSH 只读复核均被连接关闭。SSH 调试明确为 `kex_exchange_identification: Connection closed by remote host`：TCP 已连接，服务端在身份认证前关闭连接。不能将其归为密码错误，也未判断是防火墙、封禁或服务设置的哪一种。归档、脚本上传没有成功回执，未执行远端检查或升级，没有切换手机服务或改数据库。

因此当前二维码可用于验证已授权微信原生组件，**游戏内 9 位编号好友和自建私聊的手机联机测试仍依赖后端更新**，不能将本地成功当线上成功。已向用户询问当前 SSH 地址 / 端口，未索要密码。

以上为连接阻塞时的历史状态。用户把目标 IP 加入 Clash 绕过后，SSH 恢复；用户判断 Clash 是原因，未独立确认具体拦截点。目标一直为 `64.90.2.134:22`，没有使用另一个服务器或绕过主机校验。

后续独立手机服务升级成功：`20261011-wechat01` → `20261013-social34`，`active=true`、两库在线备份、shared 数据保留，原 PC / 旧 H5 保持保护。正式脚本 SHA 为 `8df8c63294c6c0cd17c700f3d1d16e46fc2466dc3b05441be8e530ce0f592e60`；最终检查和执行保护的 PC 服务为 `jigsaw-web@3104.service`。451 份资源完整校验并复用旧发布 `public`，旧资源目录必须保留。[执行记录](2026-10-13-mobile-social-upgrade-preparation.md) · [部署回执](../outputs/shared-build/wechat-social34/backend-deployment.json)。

当前线上已经包含游戏内 9 位编号好友、申请、自建私聊与举报后端；[双测试身份 12 项线上检查通过](../outputs/shared-build/wechat-social34/production-social-check.json)，包括编号查询、申请接收、接受后双方关系、多行与反向私聊、未读及阅读清除、删除好友、非好友 403 和匿名 401。烟测只创建 2 个自有测试身份及 2 条消息，最后移除测试好友；没有创建房间、发奖或生成举报，没有读取真实微信关系和私聊。举报后端包含在发布中，本次线上烟测没有提交举报。

上述为自建后端验证，微信原生面板仍需两个手机验证。本次包不含另一会话后续新增的任务奖励后台配置，其本地工作保留。当前二维码仍为预览交付，未 upload、提审或正式发布。

## 预览二维码刷新：2026-10-13 18:17

用户反馈原预览二维码失效后，通过官方 CLI 重新生成[最新手机测试二维码](../outputs/shared-build/wechat-social34/wechat-social34-20261013-181718.png)。生成前发现输出包是本地调试地址，已按共用构建脚本恢复线上 HTTPS 地址并核对：含 h5-mobile-v3、无本机 API、MiniGameChat/private 入口保留。没有修改源码或部署服务器。

官方 preview 成功，实际预览主包 3,542,934 字节、总包 7,266,822 字节。[预览大小回执](../outputs/shared-build/wechat-social34/wechat-social34-20261013-181718.json)。仍仅生成预览，未 upload、提审或发布；原生双手机好友与私聊结果待用户确认。请使用本节新二维码替代此前失效的预览码。

## 2026-10-13：停用微信原生好友入口（game-friends35）

用户在真实手机上发现该入口只有通知、无可用好友功能，随后明确要求处理该按钮。当前接入没有实现发现、导入或添加同游戏微信联系人，也没有与游戏内9位编号好友/私聊打通。已将 wechat.nativeSocialEnabled 设为 false，共用好友面板因此不再显示“微信好友”，构建 game.json 不再声明 MiniGameChat，也不会准备插件；可选适配代码保留但不启用。平台后台的插件授权未作修改。

游戏内编号搜索、申请/接受、私聊、房间邀请、举报/屏蔽及公开预设短句继续保留。用户确认两台设备改用同一网络后图片正常，本轮临时图片恢复修改已撤回，没有改变图片加载或缓存，也未清除玩家数据。

21项原生能力与好友面板集中检查、类型检查通过；共用微信/TapTap产物已构建。已通过官方CLI生成[本次新二维码](../outputs/shared-build/game-friends35/wechat-game-friends35-20261013-191842.png)，确认生产HTTPS地址、无本机API。主包3,336,275字节、总包7,060,163字节，[预览回执](../outputs/shared-build/game-friends35/wechat-game-friends35-20261013-191842.json)与[检查记录](../outputs/shared-build/game-friends35/check.json)已保存。扫码更新后按钮移除效果待用户手机确认。本次没有更新服务器、upload、提审或正式发布。
