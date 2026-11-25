# 服务器 IP 更换：2026-10-21

用户将服务器公网 IP 更换为 162.251.94.92，授权同步相关域名；后续要求七牛部分暂缓，先继续 TapTap 房间。

已保存并回读：Cloudflare jigsawnook.online 根域/www（DNS only）；fusebeads.online 根域/www/accounts/feedback（保留 Proxied）；tarotquill.online 根域/www（保留 Proxied）；阿里云 sjzbp.online、gtainfo.online、zeverland.online 各根域/www；ymxc.top 的 dy/gold 两条 A。阿里云未生效的 jigsawnook.online 根域/www 也已同步新 IP，未改 NS。合计16条生效区 A、2条备用区 A。控制台修改前后快照及截图在同目录。

新 IP 的上述主站及 dy/gold/accounts/feedback HTTPS 指定 Host/SNI 验证通过；ymxc.top 根域属于其他旧服务，不在本服务器证书内，未迁移其独立服务记录。公开 DNS 缓存全量验收未完成。

七牛 api.ymxc.top：网页源站测试失败但本机严格证书健康检查返回200/ok；通过服务器原有专用 API 授权已提交 sourceIPs 从 162.251.94.145 改为 162.251.94.92，API code200，回读 processing 且新IP已保存。回源Host/api.ymxc.top、HTTPS保持原样，服务端完整变更前配置保存于 /opt/jigsaw-cdn-cert/domain-before-ip-20261021.json。尚未确认下发完成，用户已要求暂缓；不声称CDN验收通过。七牛 CNAME未改。

SSH 新IP已以旧服务器已知主机密钥 HostKeyAlias=162.251.94.145 严格验证并成功连接。后续部署脚本/后台保存的旧IP未统一更新，历史记录保留。未改玩家数据、未重启服务。
