# IP 自动语言

2026-09-11，按用户要求为现有中文/英文界面加入 IP 地区识别，发布至 `20260911-07/app`。

## 用户体验

- 首次访问默认为自动；IP 国家或地区为 CN / HK / MO / TW 时选择中文，其他已识别地区选择英文。
- 「自动 / 中文 / EN」三个入口，手动选择优先。原 `puzzle:language` 的 zh/en 记录保留，老用户可以主动切回自动；自动模式存储 auto，不把本次识别结果永久当作手动选择。
- 无地区、XX / T1 等未知标记、局域网、接口失败或超过 2.5 秒时，选择浏览器语言列表中最优先的中文或英文；均不支持则英文。自动检测每次页面加载或从手动改回自动只调用一次；不持续轮询，不阻塞游玩。IP / VPN 出口位置有可能与玩家偏好不同，手动切换始终可用。
- 手动切换与其他标签页的偏好优先于尚未返回的检测请求；同步 storage 不回写。自动结果只更新界面，不更换网址、标题、图片 ID、游戏进度、桌面实例或房间连接。

## 数据流

使用现有 Cloudflare 请求自带的 CF-IPCountry，无额外第三方 IP 查询服务。[Cloudflare 官方国家/地区请求头说明](https://developers.cloudflare.com/network/ip-geolocation/)。

nginx 的 `jigsaw-geo.conf` 使用真实 TCP 对端 `$realip_remote_addr` 检查已有可信 Cloudflare 网段，构建部署时与 `tarotquill-realip.conf` 的网段逐项核对。只有可信对端和严格二位大写地区码才进入 `X-Puzzle-Country`；反向代理覆写来访同名头并清空原始 CF-IPCountry。直接访问源站不能伪造地区。本地入口同样删除两个地区头，应用在本地模式不采用地区数据。

`GET /api/locale` 只返回 `{language: 'zh' | 'en' | null, source: 'ip' | 'browser'}`。不返回或单独保存 IP、国家、城市、坐标；无数据库写入和 Cookie。响应 `private, no-store`，两个 CDN 缓存头均为 no-store，且 noindex；浏览器省略凭证。隐私说明已补中英文介绍。

英文服务端 HTML、逐页 canonical、站点地图和所有既有收录规则保留；未按地区重定向，也未为不同机器人伪装内容。[Google 关于地区自适应页面的说明](https://developers.google.com/search/docs/specialty/international/locale-adaptive-pages)。

## 验收

- 12 项单元与现有基础测试通过，涵盖中文/英文地区、未知地区、浏览器语言列表、旧偏好、手动覆盖异步结果、自动结果不持久化、HTTP 失败、无效 JSON、接口不返回额外字段以及现有语言/拼图状态不变；TypeScript 无错误。
- 本地 Worker 与 Ubuntu standalone 构建成功。本地及隔离 HTTP 验证地区组合与本地忽略伪造头；三处环境的全部 34 个公开页面 SEO 检查通过。
- 公网 /api/locale 确实返回 source=ip；来访者伪造 X-Puzzle-Country / CF-IPCountry 不改变结果。直接访问源站并伪造地区/真实 IP 头时仍返回 browser 回退。
- 浏览器验证手动中文刷新后保留，改为自动后实际识别为英文；无脚本错误。本地未知地区回退中文，自动按钮保持选中；手机 390×844 英文图库无横向溢出，三个语言按钮完整可见。临时视口已恢复。
- 发布前完成数据库备份，保留上一版 20260911-06/app 和旧哈希资源。nginx -t、正式健康检查通过；未新增迁移或修改玩家数据。预发布服务关闭，本地服务继续运行。

## 运维

新增 nginx snippet `jigsaw-geo.conf`，主站 HTTP 配置顶部 include；只修改拼图自己的 proxy 和站点配置。旧配置备份位于 `20260911-07/rollback-language`。若回退此功能，应同时恢复代码和两个 nginx 配置，并做 nginx -t 后重载。其他网站与共享反馈服务不变。

构建前仅清除经全 releases 软链接核查无引用的 `20260911-04/source/dist` 与 `20260911-06/source/dist` 重复构建产物；各自 app、依赖、图片原件和数据全部保留。新 standalone 仍采用移动到 app 的方式，避免额外复制安装包。
