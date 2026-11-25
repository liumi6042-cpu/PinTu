# api.ymxc.top 七牛 CDN 与免费自动证书

更新：北京时间 2026-10-21 00:18。已完成 CDN、DNS、免费证书及自动续期配置。游戏客户端尚未切换，隔壁会话负责 TapTap 实时通信改造；本次未修改游戏源码或原网站。

## 接入地址与最终配置

- API 根地址：`https://api.ymxc.top/h5-mobile-v3`
- 图片根地址：`https://api.ymxc.top/h5-mobile-v3/assets`，仅映射已有 puzzles 静态目录。
- DNS：`api.ymxc.top CNAME api-ymxc-top-idvs5zh.qiniudns.com`，TTL 600 秒。无 api A 记录，原 Chrome 的未提交 A 记录草稿不应再提交。
- 七牛：普通 CDN、海外、IPv4、HTTPS、图片小文件；控制台最终状态“成功”。沿用用户选择，未核验用户购买的流量包是否适用该区域及 HTTPS 请求费用。
- IP 回源：`162.251.94.145`；HOST/SNI：`api.ymxc.top`；HTTPS；测试路径 `/cdn-health.txt`。
- 缓存遵循源站并保留全部参数；API 返回 `Cache-Control: no-store`。TLS 1.2/1.3，HTTP/2，保持原 forceHttps=false。
- 独立 Nginx：`/etc/nginx/sites-available/api.ymxc.top.conf`。只提供已有 API、指定图片路径及 ACME/健康检查；其他 HTTPS 路径404。源站直连IP，不依赖 Cloudflare。原有各站点配置的 SHA256 安装前后相同。

## 证书和自动化

- Let’s Encrypt RSA2048，SAN 仅 `api.ymxc.top`，当前到期：北京时间 **2027-01-18 22:51:05**。证书仍是短期有效，通过自动续期持续使用。
- 源站证书：`/etc/letsencrypt/live/api.ymxc.top/`。
- 七牛当前证书 ID：`6ad78ddcae9ad74a09811845`，备注 `api.ymxc.top-LE-20261020`。
- SHA256：`63e139ea4f786fbffae19df4bdfd3b86b0d2f891aa115a74f4cad49407193c95`。
- 续期方式已由首次手动 DNS 改为 **webroot HTTP-01**，验证文件经七牛 CDN 返回，目录 `/var/www/acme`。无需阿里云 API 密钥。请保留 CDN 对 HTTP80、验证路径及 no-store 的支持。
- `certbot reconfigure` staging 模拟续期成功，已经保存 `authenticator=webroot`、`pref_challs=http-01`。第一次尝试继承旧 DNS 参数失败；第二次 HTTP 验证成功但 staging order 短暂 pending；再次尝试完整成功，未重新签发生产证书。
- 原 `certbot.timer` 保持运行。现有部署钩子 `/etc/letsencrypt/renewal-hooks/deploy/30-web4-nginx-reload` 会重载 Nginx。
- 新 `jigsaw-cdn-cert.timer` 已启用并 active，每日 UTC03:40 加0至1小时随机延迟（北京时间11:40至12:40）；Persistent=true。
- `jigsaw-cdn-cert.service` 只尝试本域名续期，再检查并同步七牛证书；首次真实执行 Result=success、退出码0，已确认绑定当前。将来换证后的首次生产上传/绑定尚未自然发生，程序通过每日任务重试同步。
- 程序 `/opt/jigsaw-cdn-cert/certificate_ops.py`：验证域名、密钥配对、指纹，复用相同已上传证书，换证仅提交 certId，保存旧绑定，回读确认。不自动删除旧证书，不改 DNS、源站、缓存或 TLS 策略。
- 七牛密钥已按用户授权新建第二对，原第一对保留。七牛提供的是管理员 AK/SK，不能称为平台级单域名权限。仅存源站 `/etc/jigsaw-cdn-cert/credentials.json`，root0600，父目录0700；不在 Git 或聊天中存储。
- 阿里云 RAM 创建/授权过程中安全验证报错，未取得或使用阿里云长期凭据；创建结果页被关闭，不能断言未留下空用户/策略。旧候选策略仅归档在 `archive/`，当前方案不使用。

## 已验证及接续边界

- 权威DNS及公共DNS返回实际七牛 CNAME和边缘节点。
- CDN 公共 HTTPS 严格校验证书通过，边缘证书指纹与源站/七牛上传一致；不是仅关闭验证后访问成功。
- `/cdn-health.txt` HEAD200；`/h5-mobile-v3/config` GET200、no-store。
- 已用后台原先允许的 TapTap H5 来源 `https://ma-h5-al.tapimg.com` 验证：GET200并返回对应 CORS；OPTIONS204，允许 GET/POST/DELETE/PATCH/OPTIONS 和原认证请求头。任意未授权来源仍403，未扩大 CORS 白名单。
- ACME 自建探针经 CDN HTTP/HTTPS 均200，模拟续期真实成功。临时探针已移除。
- 4项针对性离线检查通过：两个鉴权签名、证书ID变更范围、拒绝HTTP域名同步；未运行无关游戏测试。
- 本次没有创建业务数据进行登录、写入、房间流程或真机验收；客户端 API/图片URL切换、TapTap域名配置、实际 POST/DELETE/PATCH、响应中旧域名及访问限制由游戏接入阶段检查。普通 CDN 不承载 WebSocket，实时通道由另一会话处理。
- 新域名可以把客户端API目标改成七牛域名；**不代表历史源站/IP已隐藏或禁止直访**。当前没有封锁旧域名/IP，也没有改变现有网站。

凭证：`cdn-configured.png`（控制台成功与新回源HOST）、`dns-configured.png`、`certificate-uploaded.png`；机器检查结果 `verification.json`。历史草稿/原计划在 `archive/README.before-activation.md`，以本页为准。

## 运维与回退

- 查看：`systemctl list-timers jigsaw-cdn-cert.timer`；`journalctl -u jigsaw-cdn-cert.service`。
- 手动同步：`python3 /opt/jigsaw-cdn-cert/certificate_ops.py sync`。不要打印 credentials.json 或 PEM 私钥。
- 停用新任务：`systemctl disable --now jigsaw-cdn-cert.timer`，保留有效证书；原 certbot.timer 仍独立运行。
- 续期配置备份：`/opt/jigsaw-cdn-cert/renewal.before-*.conf`（均为切换前手动DNS配置）；恢复后将失去无人值守续期能力。
- 原CDN完整读回：`/opt/jigsaw-cdn-cert/domain-before-origin.json`，仅供本域名回退；不覆盖其他域名。
- 原站点基线：`/opt/jigsaw-cdn-cert/nginx-baseline.json`。卸载新源站时只移除本域名新配置及链接，先 nginx -t 再重载；不要删除其他站点。
- 首次签发用的 `_acme-challenge.api` TXT及七牛 `verification` TXT仍保留，无需定期更新。未更改其他 DNS 记录。

官方接口依据：
- https://developer.qiniu.com/fusion/13360/fusion-api-auth-guide
- https://developer.qiniu.com/fusion/13368/fusion-api-cert-management
- https://developer.qiniu.com/fusion/13364/fusion-api-domain-config
