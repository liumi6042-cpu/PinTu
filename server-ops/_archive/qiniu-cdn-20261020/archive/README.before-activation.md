# 七牛 CDN 与自动证书 · 2026-10-20

## 当前状态

- 用户已授权 Let’s Encrypt 免费证书、自动续期和自动同步七牛；实时同步改由 TapTap 承担的工作正在另一个会话进行。本目录不修改那部分源码。
- **首次证书已签发并上传七牛**。证书仅覆盖 `api.ymxc.top`，RSA 2048；有效期截至北京时间 **2027-01-18 22:51:05**。
- 七牛证书 ID：`6ad78ddcae9ad74a09811845`，备注 `api.ymxc.top-LE-20261020`。控制台已回读该条记录；截图 `certificate-uploaded.png`。
- 证书 SHA-256：`63e139ea4f786fbffae19df4bdfd3b86b0d2f891aa115a74f4cad49407193c95`。
- 源站当前为已验证 SSH 的 `162.251.94.145`；使用已有 Certbot 及现有 Let’s Encrypt 账号完成首次 DNS 验证，没有新注册账号或替换既有网站证书。证书保留在 `/etc/letsencrypt/live/api.ymxc.top/`。
- 新增 DNS TXT：`_acme-challenge.api.ymxc.top`，验证已完成，记录暂保留。没有更改现有 A/CNAME 记录；原 Chrome 中未提交的 `api` A 记录草稿保留。
- **自动化已准备、未启用**：程序和服务模板位于服务器 `/opt/jigsaw-cdn-cert/`（root 专用）。未安装新定时任务，未改现有 certbot.timer、续期配置或 Nginx。缺少 API 凭据及七牛 HTTPS 域名的初次配置，尚不能声称自动续期或 CDN 接入完成。
- 7 项针对性检查在本地与目标 Linux 通过；验证了签名、拒绝其他证书域名、仅清理自身 TXT、拒绝清理被改变的 TXT、同步仅更换证书 ID。真实证书的域名、密钥配对、指纹通过检查；服务模板与激活脚本语法检查通过。**尚未运行真实自动 DNS 验证、续期演练及七牛 API 同步**。

## 接续与授权边界

1. 阿里云：需要专用 RAM API 凭据，写权限限制到 `ymxc.top`，仅添加/删除解析记录及所需查询。阿里云公开规则只能细分到整个域名；程序另行限制为 `_acme-challenge.api`，不应把程序限制说成平台级单记录权限。创建账号、密钥和授权须先获得当次确认。
2. 七牛：当前密钥管理页提供管理员 AK/SK，已有一对启用，最多两对。新增专用一对仍具有管理员权限，不能声称它天然只允许改一个域名。需要用户当次确认后才创建并将其保存在服务器。
3. 凭据仅放 `/etc/jigsaw-cdn-cert/credentials.json`，root 所有、0600、父目录0700，不经聊天或Git。模板 `credentials.example.json` 为空，当前没有写入任何 API 密钥。
4. 七牛 CDN 域名仍需创建、绑定本证书并取得真实 CNAME，然后进行 DNS 切换。用户选择 IP 回源；如 HOST 使用 `jigsawnook.online`，IP 回源会直接连接服务器，不经该域名的 Cloudflare DNS 代理。换别的 HOST 需要源站 Nginx 与 TLS 配置实际支持。原表单只是草稿，未创建。
5. 域名与凭据就绪后先运行 `certificate_ops.py preflight`。然后执行 `activate.sh`：保留本域名原续期配置，Certbot reconfigure 会先进行 staging 续期验证，成功才写入 DNS 钩子；同步与回读成功后才安装并启用日任务。脚本不创建 CDN 域名、不改变缓存、源站或现有 TLS 选项。
6. 每日任务会尝试本域名续期并再次同步，补偿续期已成功但七牛同步失败的情况。七牛控制面更新和边缘实际证书生效分别验证；不能把 API 接受更新当作所有节点已切换。当前没有后台运行任务。
7. 停用：`systemctl disable --now jigsaw-cdn-cert.timer`，不删除有效证书；如需撤销本域名 DNS 续期钩子，使用 `/opt/jigsaw-cdn-cert/renewal.before-*.conf` 的对应备份。程序保存换证前的 HTTPS 信息，旧证书不自动删除。不要覆盖其他域名配置。

凭据缺失前的原始签发命令使用手动 DNS 验证，因此当前 Certbot 提示本证书不能无人值守续期，这是已知待完成状态，不能忽略。

## 原始 CDN 草稿记录

状态：已在用户 Chrome 的普通 CDN 添加域名页填写，未点击创建、未改 DNS、未改游戏配置或线上服务。截图：form-filled.png。

| 参数 | 当前填写 |
| --- | --- |
| 加速域名 | api.ymxc.top，沿用用户输入 |
| 通信协议 | HTTPS；证书列表为空，尚未配置 |
| 覆盖范围 | 海外，保留原选择，未验证本次资源包适用区域或备案状态 |
| 使用场景 | 图片小文件 |
| IP 协议 | IPv4 |
| 源站类型 | 源站域名 |
| 源站 | jigsawnook.online，不带协议和路径 |
| 回源 HOST | 源站域名，即 jigsawnook.online |
| 回源协议 | HTTPS |
| 测试资源 | h5-mobile-v3/config |
| 缓存时间 | 遵循源站 |
| 缓存参数 | 保留所有参数 |

七牛控制台源站测试显示“测试通过”。独立只读 GET https://jigsawnook.online/h5-mobile-v3/config 返回 200、Cache-Control: no-store，无重定向。此测试仅证明该公共资源可 HTTPS 回源，不代表完整业务或 CDN 接入已验收。

该草稿检查时，独立 TapTap 项目 config/mobile-platforms.json 使用上述 /h5-mobile-v3 API 与 /h5-mobile-v3/assets 图片根地址；mobile/client.ts 从同一 API 根地址生成 /realtime WebSocket。用户随后说明实时同步正由另一会话改交 TapTap，故 WebSocket 不支持不能据此推断 HTTP API 也不支持。普通 CDN 对本项目的 HTTP 方法、认证头与不缓存策略仍需接入后实测。未擅自升级产品。

尚需：适配 api.ymxc.top 的有效证书、确定 API/实时连接中继方案、七牛生成实际 CNAME 后再填写 DNS、客户端所有请求与响应 URL 检查，以及在不影响现有网页业务前提下规划源站访问限制。仅添加 CDN 不会阻止公开源站被直接访问，也不会消除历史域名/IP记录。

公开依据：
- https://developer.qiniu.com/fusion/kb/6389/function-of-consulting-the-faq?category=kb
- https://developer.qiniu.com/fusion/4939/the-domain-name-to-access
- https://developer.qiniu.com/dcdn/10767/dcdn-guide-to-the-console
- https://developer.qiniu.com/fusion/13360/fusion-api-auth-guide
- https://developer.qiniu.com/fusion/13368/fusion-api-cert-management
- https://developer.qiniu.com/fusion/13364/fusion-api-domain-config
- https://help.aliyun.com/zh/dns/alibaba-cloud-dns-custom-permission-policy-reference-dns

证书管理页当时显示“暂无数据”；全站加速管理页还显示“尚未进行实名认证”。这两项均只记录界面观察，未操作认证、购买、证书上传或服务开通。
