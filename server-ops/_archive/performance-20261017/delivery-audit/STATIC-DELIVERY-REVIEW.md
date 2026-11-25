# 静态交付只读审查（2026-10-17）

> 最终状态由主会话更新：后续用户授权下已完成 Nginx 静态缓存修正，源站/公网边界验证通过；未切换游戏代码、内容指针或 CDN 提供商。下文“只读/候选”描述子任务审查阶段。最终结果见 `cache-apply-result.json`、`public-delivery-after.json`；实际部署 helper 的 Linux 5 项检查（含真实符号链接）见 `retention-linux-result.json`。完整当前说明沿用项目 `docs/plans/2026-10-16-performance-experience-review.md`，不另建一套实施文档。

范围：只读检查正式 Web 源目录 `D:/chat/拼图/work/dual-managed-release-20261014` 的 Nginx 模板、共享客户端生成、发布白名单和暖切换脚本，并读取主会话保存的线上证据。随后按主会话授权，仅在本地修正 `scripts/deploy-warm-release.py` 的旧共享静态文件保留。此子任务没有直接访问生产服务器，没有改变运行配置或内容指针。Nginx 片段仍是候选。

## 主会话线上证据修正了推测

`server-before.json`、`public-delivery-before.json` 已证实：前端经过 Cloudflare，当前 `game.js` 原始 402,672 字节，gzip 为 104,953 字节、Brotli 为 103,753 字节且出现 HIT；图片已经一年 immutable 且 HIT；共享脚本/字体是 14,400 秒（4 小时）缓存。全局 Nginx 已 `gzip on`，未设置文本类型；没有 Brotli 模块。

因此不能向用户说目前 JS 没压缩，也没有购买第二家 CDN 或安装 Brotli 的必要证据。本轮最小价值是共享 hash 目录长期浏览器缓存，以及源站文本 gzip 兜底（不承诺 Cloudflare 压缩流量在此基础上再少 70%）。不改 Cloudflare 缓存规则，不清全站缓存。

## 已从当前文件确认

- `server/jigsawnook.online.conf:71-88`：已有 `/_next/static/`、带 12 位内容哈希的拼图 WebP、首页 WebP 的一年 `immutable`。未配置 `/shared-client/` 专用静态规则；模板没有 gzip 指令，但不能据此断言线上全局未开启。
- `scripts/prepare-shared-client.mjs:10`：共享游戏脚本已经 `minify:true`，无需重复做代码缩小。
- 同文件 `:13-21`：9 个共享文件，16 位目录 hash 同时覆盖 `game.js` 和全部字体/图集/音频的字节；任何输入字节变化会生成新目录。当前本地生成目录是 `c70abf569b573db3`。由此可将该目录内的明确静态文件设为一年缓存，避免每次打开重新下载。
- `scripts/release-files.mjs` 和 `scripts/build-server.mjs`：共享文件通过 `config/runtime-assets.json` 明确白名单进入运行包。当前只列原文件，没有 `.br`/`.gz`/`.zst` 压缩旁车；不能直接假定构建时预压缩会被打进部署包。
- `scripts/deploy-warm-release.py:134-136,603-606`：部署保留线上现有 Nginx 内容，只替换活动 upstream/旧图片正则；不会自动把仓库 Nginx 模板完整安装到线上。仅修改模板不能证明线上改变。
- 模板 `access_log off` 是有意避免记录房间邀请、反馈令牌和账号参数，不能为统计流量无差别重新打开请求日志。

补充实现线索：相邻共享项目已安装的 `vinext@1.0.0-beta.5` 与正式 Web 声明的版本一致，其 `dist/server/static-file-cache.js:96-100` 只把 `_next/static` 判为 hash，其余静态文件默认 `public,max-age=3600`；`prod-server.js:444-451` 的缓存快路径只选择已有压缩旁车。这提示共享客户端可能只有一小时缓存且未压缩。**这不是线上运行包证据**；需以线上带 `Accept-Encoding:gzip` 的 GET 和 `nginx -T` 为准。

## 最小修正候选

`static-delivery-candidate.conf` 提供一个严格匹配 9 个已生成共享文件的 location。它直接读取当前运行目录，成功响应才设置一年 `immutable`，只对文本启用轻量 gzip，保持原 WebP Q70、PNG 和字体字节不变。无需增加 Node 服务、购买 CDN 或引入模块。

若线上已压缩，不再重复调整 gzip；如果只有 shared-client 缺长期缓存，只补该路径的缓存策略。`/_next/static` 若缺 gzip，应在已有 location 内增加对应指令，不要创建重复 location。

候选尚未经过线上 Nginx 语法检查。应用前应保留当前单站点配置，核对真实文件根目录与 `nginx -T` 的继承设置；`nginx -t` 成功后再平滑 reload。用真实 GET 验证 gzip、`Vary:Accept-Encoding`、解压后 SHA 与 identity 字节一致、ETag/304、随机不存在的 hash 文件不带一年缓存。配置回滚只还原本次单站点配置，不重启游戏、不触碰数据库。

## 不能误缓存的边界

| 路径/内容 | 策略 |
|---|---|
| 明确生成的 `/shared-client/<16位hash>/...`、`/_next/static/...`、已带内容 hash 的公开图片 | 适合一年 `public,immutable`，只缓存成功资源 |
| `/play`、`/`、语言/旧入口跳转、账号/房间 HTML | 不套全站长期缓存，保留应用的 Cookie/Vary/no-store 语义；入口跳转不可缓存后发给其他访客 |
| `/api/shared/config` | 现有 `json()` 给 `Cache-Control:no-store`；包含当前 uiBase、能力和同源地址，部署后必须新鲜 |
| 档案、金币、任务、奖励、购买、房间、光标、聊天、好友、认证、健康接口 | 不启用 CDN 缓存或代理缓存；尊重 private/no-store、Set-Cookie 与 Authorization |
| `/api/user-images/[id]` | 保留现有权限及 public-preview 短缓存；不能按 `.webp` 后缀统一改公开永久缓存 |
| 后台配置和内容指针 | 不公开打包，不长缓存；公开配置接口也不要因“JSON”后缀统一设置 immutable |
| 无 hash 的图标、脚本、映射、原始素材 | 不直接套一年 immutable；先采用现有短缓存/条件请求或改成内容版本地址 |
| 404、403、429、503 | 不设一年缓存，避免缺图、权限和临时故障被固定 |

将来试接图片 CDN 时仍使用以上静态白名单，先单独图片域名/少量图片试点；不把整个站点或 `/api/` 设置“缓存所有内容”。付费相册权益检查仍在现有接口，CDN 不改变其账本或图片 ID。

## 发现的发布保留缺口

`deploy-warm-release.py:520` 注释称保留所有旧客户端 hash，实际 `:532-538` 只保留旧 `dist/client/_next/static`；共享导出又在生成时从运行资产白名单移除旧 `/shared-client/`。线上切换后，未刷新玩家可能后续才请求旧 hash 的字体/图集/音效，因此仍有 404 风险。长期浏览器缓存能降低重复下载，不能代替旧版本文件保留。

本地已修正：在现有暖部署“保留旧静态 hash”循环后，调用 `retain_shared_client_hashes(old, app)`，把 `dist/client/shared-client` 的合法 16 位 hash 子目录同样保留到新 app；只允许目前导出的 9 类普通文件，拒绝链接、额外路径，目标已存在时要求字节一致。沿用原硬链接方式节省存储，不复制数据库/配置/账号。有限修改前基线见 `deploy-warm-release.before.py`。保留计数沿用既有 `retainedHashedAssets`，没有改变发布清单、端口、数据库或线上配置。

聚焦合成目录验证见 `retain-shared-client-candidate.py` 和 `retain-shared-client-fixture-results.json`：脚本用 AST 仅提取实际产品 helper，绝不执行部署顶层代码；保留旧脚本/字体与新 hash 不变、硬链接、幂等、同 hash 不同字节拒绝、白名单外文件拒绝通过。Windows 账户不能创建真实符号链接（WinError 1314），因此符号链接拒绝分支使用明确标注的 `Path.is_symlink` 返回值模拟；不能把这一项描述为 Linux 真实符号链接验证。

这项缺口不要求本轮立即部署游戏版本；应随下一次正式静态交付修正一起解决，并明确旧 hash 的保留/清理规则，避免又积累为无限历史素材。

## 本轮检查程度

仅源码定位、路径/白名单核对，以及本地静态字节压缩潜力测量（见 `shared-client-size-estimate.json`）。未跑全量构建或游戏回归，未声称 CDN 命中率、实际流量费用或线上缓存已改善。
