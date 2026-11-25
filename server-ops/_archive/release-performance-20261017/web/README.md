# 2026-10-17 Web 性能版本发布准备

本目录为主会话授权上传前的本地审查包。子代理只构建和检查，没有 SSH、上传或切换服务器。CDN 保持预案，没有域名、资源地址、解析或套餐变更。后续实际部署结果由主会话另记。

- 正式源码工作树：`D:/chat/拼图/work/dual-managed-release-20261014`，干净提交 `2575fd29b927e0612148842c2943ffc7b57172c1`。
- 共享客户端从当前 `D:/chat/拼图/jigsaw-nook-taptap` 导出，9 个静态文件位于 `/shared-client/42fc30f0bcb8fcdf/`；game.js 426,009 B。`work/shared-client-export.json` 保存每个实际输入 SHA256。
- 包含此前本地验证的按需绘制、图片 LRU、分批准备、返回位置与请求去重、拖动静态缓存、省电选项、Web 无建房券按钮修正；正式后端只更改统一内容读取缓存的三个辅助模块。会员、购买、奖励、身份规则没有源更改。
- 完整 runtime 为 3,448 文件、733 静态资源、逻辑 1,089,190,352 B。素材白名单由既有 `runtimeAssets()` 决定；本轮编译源和最终临时 runtime 的大素材使用既有硬链接，不复制/压缩 1 GB 图片全量包。部署仍须由 Linux 重建器验证每个复用文件并重建完整归档。

## 冻结的上传材料

| 文件 | SHA256 | 大小 |
| --- | --- | --- |
| `web-performance-sparse.tar.gz` | `5536f0a20793831513f8dfca4220b0921780065bf9b3826335d215ae895a0254` | 7,798,643 B |
| `target-manifest.json` | `ad756085142081a774874d933da81af7b96800a41c73a0e2d6b016c98c6c9b6c` | 完整清单 |
| `rebuild-web-full-from-sparse.py` | `23dc8135f2c4ad25908833d03c744a591583da4837ff0ae072593a201fd082ef` | 只重建，不切服务 |
| `deploy-warm-release.py` | `6515826e4ca0c8cd656543283c87388ae20613ba87f76c312126e068dc6f3f0d` | 冻结暖发布器 |

182 文件传输，3,266 文件精确复用。基线为主会话只读取得的真实线上 `20261016-04` 原始 `release.json`，提交 `dcada7fc16fa6dc6dab81ab3bcaf0d7c224eff89`，原始清单 SHA256 `5d516f91d0cfcf7a2ea613792b72b77bc28e0980c44a0fdcd391e87842dcc1b2`。重新部署前仍须确认 current 未变化。不要上传或使用工作树 `releases/latest.tar.gz`，那是旧版本包。

重建参数为 `--expect-current 20261016-04 --expect-base-commit dcada7fc16fa6dc6dab81ab3bcaf0d7c224eff89 --baseline-manifest-sha256 5d516f91d0cfcf7a2ea613792b72b77bc28e0980c44a0fdcd391e87842dcc1b2`，archive/sha256 使用上表。随后暖部署器使用重建器回传的**真实完整归档 SHA256**，不能用稀疏包 SHA256。主会话选定未占用的新发布名，并再次核对旧服务/端口；准备时线上为 `jigsaw-web@3103.service`，目标槽候选为 3104。

已有线上 Nginx 长缓存单独修正必须保留；配置文件没有打入应用包。暖部署器读取实际站点后仅切换回源端口并保留当前缓存规则，同时保留旧 `_next` 和合法旧共享 hash 目录供已开网页继续读取。冻结脚本与先前部署收据摘要不同，不能复用旧脚本凭证。

## 实际检查

- 正式工作树 TypeScript 通过。
- 22 项内容缓存及共享 API 测试、6 项构建/旧房间画面保护测试、3 项 Python 部署 QA helper 测试通过。初次测试因迁移后正式工作树无依赖目录而失败，建立指向主项目现有依赖的忽略 junction 后重跑通过；没有重新安装依赖。
- 隔离正式编译后启动 loopback 服务，独立 SQLite 和 appearance 目录。以本地当前发布配置副本验证 `/play`、无体力/无建房券能力、旧入口转到新 UI、账号与协议页，以及 profile/图库/收藏/任务/大厅读取。
- 3,448 个实际运行文件完整哈希通过；733 个静态资源全部经真实 HTTP 读取并比对字节通过。原图/私密文件入口为 404。
- 内容版本为 `release-20261015T183552824Z-baf6e1d6`，manifest SHA256 `c467d23ce54e47c5506dc9154069fc9be8dcb99e11b439233e40ba86008391a6`。隔离读取副本不会发布新内容、改后台设置或真实每日出现记录。
- `prepare-sparse.py` 冻结前后均要求相同 clean HEAD，逐个检查全部编译源文件和运行文件 SHA256，再重新解读稀疏归档的所有成员字节；没有把 dirty 工作区标成 clean。

证据：`runtime-preparation.json`、`runtime-smoke.json`、`source-boundaries.json`、`preparation-report.json`，以及 `build.log`。这不是生产验收；服务器重建、隔离跨版本验收、备份、暖切换、回退准备和公网检查仍由主会话完成。原图、后台库、玩家库、生产环境配置均未打包或恢复。
