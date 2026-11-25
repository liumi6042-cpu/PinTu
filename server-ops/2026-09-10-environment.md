服务器环境检查与后续部署记录

检查对象：186.241.106.176。检查时间：2026-09-10 20:14（北京时间）。

结论：通用网页部署基础环境已具备，本次补齐辅助工具并安装已发现的 Python 安全更新。现有网站保持正常响应；拼图应用尚未部署。本记录不包含密码、私钥或应用密钥。

**服务器实测配置**

| 项目 | 结果 |
| --- | --- |
| 系统 | Ubuntu 24.04.3 LTS，x86_64 |
| 内核 | 6.8.0-139-generic |
| CPU | 2 个逻辑 CPU |
| 内存 | 3.8 GiB，总计约 4 GB；检查时可用 2.2 GiB |
| Swap | 2 GiB，检查时使用约 10 MiB |
| 根分区 | 29 GiB，已用 12 GiB，可用 17 GiB |
| 时钟 | UTC；NTP 已同步 |
| Node.js / npm | 24.20.0 / 11.19.0 |
| Nginx | 1.24.0，Ubuntu 包 1.24.0-2ubuntu7.17 |
| Docker / Compose | 29.8.0 / 5.5.1 |
| 数据库 | SQLite 3.45.1；已有 PostgreSQL 17 容器 |
| HTTPS | Certbot 2.9.0；续期定时器已启用 |
| 常用工具 | Git、curl、rsync、zip/unzip、jq、htop、Python venv、build-essential 已有 |

Node.js 使用 `/opt/nodejs/current`，`/usr/local/bin/node`、`npm`、`npx` 为符号链接。既有版本满足当前拼图项目 `node >=22.16.0` 的引擎要求。

**本次实际变更**

1. 成功刷新 APT 软件源索引。
2. 新装 `dnsutils`、`pkg-config`，以及依赖 `libpkgconf3`、`pkgconf`、`pkgconf-bin`，新增磁盘占用约 317 KB。
3. 将 `python3.12`、`python3.12-minimal`、`python3.12-venv`、`libpython3.12-minimal`、`libpython3.12-stdlib`、`libpython3.12t64` 更新至 Ubuntu 安全仓库版本 `3.12.3-1ubuntu0.17`。
4. 重启 `fail2ban` 和 `unattended-upgrades`，使相关进程加载已更新的 Python；检查确认二者运行正常，SSH 防护规则正常。
5. 对 `jigsawnook.online` 执行 Certbot 模拟续期，成功覆盖主域名及 www；现有正式证书未替换。

应用代码、应用数据库、Nginx 站点配置和 SSH 登录设置保持原状；没有重启整机、Nginx、Docker 或现有网站应用。

**实际验证**

| 检查 | 结果 |
| --- | --- |
| `nginx -t` | 通过 |
| `dpkg --audit` / `apt-get check` | 无包状态或依赖错误 |
| `needrestart -b -r l` | 无待重启服务；内核为预期版本 |
| `/var/run/reboot-required` | 不存在 |
| Nginx、Docker、SSH、Fail2Ban、现有 7 个应用服务 | active |
| PostgreSQL 容器 | healthy，已连续运行约 30 小时 |
| Keycloak 容器 | 正常运行，已连续运行约 30 小时 |
| `https://fusebeads.online/` | 公网及源站 HTTPS 200 |
| `https://tarotquill.online/` | 公网及源站 HTTPS 200 |
| `https://jigsawnook.online/healthz` | 公网 HTTPS 200 |
| `https://jigsawnook.online/` | 预期的 404 占位响应，应用尚未部署 |
| `https://www.jigsawnook.online/` | 308 跳转主域名 |
| 账号 / 反馈入口 | 源站分别返回预期的 302 / 307 跳转 |

UFW 已启用，默认拒绝入站，公网放行 TCP 22、80、443。现有应用端口和 PostgreSQL 的 5432 端口均绑定 127.0.0.1。Fail2Ban 的 sshd 防护已启用。自动安全更新每日运行，自动重启整机设置为 false。

**现有站点与拼图预留位置**

服务器已有 `/srv/sites/astrotarot`、`/srv/sites/fusebeads`、`/srv/sites/feedback-center` 及 `/opt/web4-platform` 等业务。后续应继续按站点隔离用户、配置和数据目录。

拼图已有以下准备：

- 域名：`jigsawnook.online`、`www.jigsawnook.online`；本次公网 DNS 已返回 Cloudflare 地址，NS 为 `annabel.ns.cloudflare.com` 和 `cody.ns.cloudflare.com`。
- Nginx 配置：`/etc/nginx/sites-available/jigsawnook.online.conf`，已有启用链接。目前为域名占位，响应含 `noindex`。
- 证书：`/etc/letsencrypt/live/jigsawnook.online/`，到期时间 2026-12-09 10:18:59 UTC。模拟续期成功。
- 续期定时器：`certbot.timer`。现有 deploy hook 为 `/etc/letsencrypt/renewal-hooks/deploy/30-web4-nginx-reload`，先检查配置再 reload Nginx；本次模拟续期未执行 deploy hook。
- 独立运行用户：`web-jigsaw`，禁止交互登录。
- 版本目录：`/srv/sites/jigsaw/releases`，当前为空。
- 持久数据目录：`/srv/sites/jigsaw/shared`，当前为空，权限为 `web-jigsaw:web-jigsaw`、0700。
- 预留应用端口：`127.0.0.1:3102`，本次确认空闲；该端口来自既有模板，目前没有启用应用服务。
- 旧模板：`/srv/hosting/templates/jigsaw.nginx.conf.example`。其中仍为保留示例域名，不能直接启用。

**后续部署衔接**

当前工作区的 `puzzle-play` 使用 React、vinext、Cloudflare D1 绑定；`npm start` 实际运行 Wrangler 开发服务器，本地启动脚本也使用 Wrangler/Miniflare。本次只准备服务器，没有将该开发启动方式配置为公网生产服务。正式部署需要完成 Linux 生产运行适配、数据库初始化与持久化、可信代理处理、站点独立备份和健康检查，再接入现有域名入口。

新增普通静态网站可由 Nginx 提供构建产物；新增 Node.js 网站可使用独立系统用户、systemd 服务及只监听 127.0.0.1 的端口；容器应用可沿用现有 Docker Compose。每个网站使用 `/srv/sites/<站点>/releases` 保存版本、`shared` 保存数据与私密配置，再由域名对应的 Nginx 配置转发。部署前复查目录与端口占用，验收后切换入口并保留可回滚版本。

2 CPU / 4 GB 已运行多个服务。当前资源有余量，但未做新增拼图站点的公网并发测试；不能将这一快照作为承载人数承诺。建议在开发机完成构建，服务器运行已验证产物。

**运维现状与保留事项**

- 现有 `astrotarot-backup`、`fusebeads-backup`、`web4-platform-backup` 每日任务最近一次均成功，确认有本机备份文件。此次没有读取备份中的业务数据，也没有执行恢复演练或验证异地副本；拼图未来需单独接入备份。
- 四组现有证书均有效，分别覆盖 fusebeads、tarotquill、web4 账号/反馈入口和 jigsawnook，剩余约 87–89 天。本次只对 jigsawnook 做真实 ACME 模拟续期。
- 保留 5 项尚未安装的更新：`base-files`、`motd-news-config`、`python3-distupgrade`、`ubuntu-release-upgrader-core`、`containerd.io`。其中 containerd 是现有数据库及登录容器的底层运行组件，安排维护时段升级并验证容器服务。
- `systemctl --failed` 有一条 2026-09-09 遗留的独立测试单元 `fusebeads-lifecycle-network-qa-1387bab.service`，日志记录测试 `fetch failed`；生产 `fusebeads.service` 正常。此次保留该测试证据，没有将清除失败标记当作修复。
- 本机已有 SSH 密钥可连接该服务器，本次未使用或保存用户提供的密码。服务器 ED25519 主机指纹：`SHA256:Xdxzk4cSyS2g7d4Gn+ogT7Ez6zUohkn8epO8uSaLGZI`。

后续连接命令：`ssh root@186.241.106.176`。本记录为检查时点的实测快照，下次操作前应重新核对运行状态。

技术依据：[Node.js 官方发布周期](https://nodejs.org/en/about/previous-releases)、[Ubuntu 自动更新说明](https://ubuntu.com/server/docs/how-to/software/automatic-updates/)、[Docker 端口与防火墙说明](https://docs.docker.com/engine/network/packet-filtering-firewalls/)。服务、版本、资源和验证结果均来自此次服务器实测。
