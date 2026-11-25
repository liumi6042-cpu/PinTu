# jigsawnook.online 绕过 Cloudflare · 2026-10-21

状态：已完成。用户确认后，已将根域与 www 两条 A 记录由 Proxied 改成 DNS only，IP 保持 162.251.94.145，权威 DNS 仍保留 Cloudflare；未删除记录或切换 NS。完成时间：2026-10-21 01:15（北京时间）。

阿里云界面提示当前未接入，只有两条指向旧 IP 186.241.106.176 的非生效 A 记录。不能直接切回这些旧记录。已在已登录 Cloudflare 控制台核对本域仅两条记录，均为 162.251.94.145、Proxied、Auto。完整公开 DNS 基线见 preflight.json，控制台观察和拟变更见 prepared-change.json。

直连预检：严格保留证书主机名/信任链校验，指定当前源站 IP 后 /play 返回 200，www 返回 301 至根域。Windows 使用 ssl-revoke-best-effort 处理离线吊销查询，未关闭证书验证、未改系统网络。

用户已在保存前确认关闭两条记录的代理。保存后控制台两条均显示 DNS only，结果截图见 proxy-disabled.jpg；prepared-change.json 保留变更前的准备快照，当前结果以 result.json 为准。

公开 DNS-over-HTTPS 回读：根域与 www 的 A 均已返回 162.251.94.145，AAAA 均无记录。旧缓存 TTL 为 300 秒，其他网络可能需约 5 分钟或更久更新，已连接的客户端需重连。

本机对 /play 各做 3 次新 HTTPS 连接：指定源站返回 200，总耗时 0.289 / 1.342 / 1.256 秒；指定原 Cloudflare IP 返回 200，总耗时 1.435 / 1.559 / 2.808 秒。www 源站返回 301。证书校验开启。此处是包含连接及页面传输的请求耗时，不是游戏往返延迟，也不能代表其他地区；本机存在代理/Fake-IP 环境。直连减少一段代理链路，仍有线路波动，不能保证所有玩家始终低延迟。

原状态恢复：将同两条记录的 Proxy status 重新设为 Proxied，IP 不变；本流程无需回滚网站代码或数据库。未操作七牛 api.ymxc.top 或其他域名。
