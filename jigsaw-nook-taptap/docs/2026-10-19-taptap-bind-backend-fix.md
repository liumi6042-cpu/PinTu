# TapTap 绑定接口上线修复（2026-10-19）

## 问题

TapTap 自测包进入后调用 `/h5-mobile-v3/api/taptap/bind`，线上后端仍是旧版本，因此返回 `404 {"error":"接口不存在"}`。前端包和 TapTap MiniApp 凭据已经准备好，缺的是移动后端路由。

## 处理

- 以线上 `20261019-newcomer-ticket47` 为基线部署代码增量 `20261019-taptap-login6`。
- 使用临时保留版升级校验器，在代码增量部署时硬链接线上旧 `public` 目录的全部常规文件，而不是只复用旧 `release.json` 中登记的 717 项；线上实际 1216 个公开文件（包括管理员后续追加图片）均保留。
- 未下载、删除或重编码图片；未修改 SQLite、玩家进度、已购权益、Web/旧 H5 服务或环境密钥。
- 仍使用原有在线 SQLite 备份、原子 current 切换、健康检查和失败自动回滚流程。

## 证据

| 项目 | 结果 |
|---|---|
| 部署包 | `releases/jigsaw-mobile-upgrade-20261019-taptap-login6.tar.gz` |
| 包 SHA-256 | `2014b863eafd7fc88f1672d301fde4a3e3bdfd6bc0f8d0cce0eeefba5cf0f4cf` |
| 线上 current | `/srv/sites/jigsaw-mobile-v3/releases/20261019-taptap-login6` |
| 只读预检 | 通过；223 个代码文件，旧基线 `20261019-newcomer-ticket47` |
| 正式切换 | 通过；服务 active，在线备份 2 份，数据保留 |
| 资源保留 | 新旧运行目录均为 1216 个公开文件 |
| 健康接口 | `3292/healthz` 返回 `ok=true`，`contentReleaseId=release-20261018T155732151Z-26a50198` |
| 配置接口 | `3292/h5/config` 返回 `mobile-v3-isolated` |
| 绑定接口 | 公网空请求已从原来的 404 变为 401“连接凭证已过期”；说明路由已命中，未带 TapTap 会话时按预期拒绝 |

本次只修复服务器接口，不提审、不发布、不绑定正式主包。使用已有 `326496` 自测包重新扫码即可验证 TapTap 身份和公开昵称；成功后才进入大厅，失败会停留连接页并显示原因。
