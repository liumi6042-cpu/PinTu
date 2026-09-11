# Jigsaw Nook · 一起拼图

面向海外玩家的中英文拼图网站，使用 React、Vinext、Canvas 和 Node.js / SQLite。正式地址为 https://jigsawnook.online。

## 当前功能

- 纸艺首屏、30 张原创图库、分类/双语搜索与随机开局。
- 新开局支持 108、300、500、1000、1500、2000 片；旧档位兼容已有进度。
- 免费公开多人房间，每桌最多 8 人，共享进度、拖动保护与队友鼠标。
- 个人单人局需要普通账号；会员私人房间与私人图片上传由服务器校验权益。付费订阅和广告仍未接入。
- 续玩、记录删除与撤销、成就、用时榜、米色/暗色桌面和完成庆祝。
- 中英文手动切换及 IP 自动选择，手动偏好优先；账号安全与共享反馈已接入。

## 本地运行

建议使用 Node.js 24。首次检出执行 `npm ci`，然后 `npm run local`，或使用 `启动本地拼图.cmd`。本机访问 http://localhost:3000，局域网朋友使用启动日志里的本机 IP 地址。

本地数据位于 `.wrangler/state`，备份位于 `work/backups`，它们不进入 Git 或上传包。私有参数使用被 Git 忽略的 `.env.beta` / `.env.feedback` / `.dev.vars`。新机器不要复制其他人的凭据和测试数据。

```sh
npm run check:images
npm run test:release
node node_modules/typescript/bin/tsc --noEmit
node --import ./tests/ts-register.mjs --test tests/language-detection.test.mjs tests/image-library.test.mjs tests/random-photo.test.mjs
```

数据库 HTTP 测试需按测试文件说明使用隔离夹具；不要对正式玩家房间运行压力测试。

## Git 与发布

本目录是网站的 Git 仓库，沿用已有历史。源码、迁移、测试、图片原件和来源记录进入版本管理；运行数据、密钥、开发依赖、构建目录和上传包已忽略。

```sh
# 完成检查并提交 Git 后构建唯一的最新运行包
npm run release
# 查看上传目标，不连接服务器
npm run release:upload -- --host webhosting-main --dry-run
# 经协调后仅上传运行包，不自动切换服务或清理服务器
npm run release:upload -- --host webhosting-main
```

输出为 `releases/latest.tar.gz` 及校验资料。包内仅包含编译产物、运行依赖、必要 WebP/静态资源、SQL 迁移和运行辅助文件。禁止再上传整个工作区、源码、原始 PNG、测试/备份数据或历史 release；不在正式服务器重新构建。安装位置和旧版本清理由负责服务器的人员统一处理。详见[最小运行包流程](docs/runtime-releases.md)。

## 图片与数据

`content/puzzle-catalog.json` 是图库来源。`published` 用于新开局，`archived` 只恢复已有存档。原 PNG、真实尺寸、SHA-256、提示词和生成来源保留在 Git；网页使用原生尺寸无损 WebP 和最长 480 像素预览，不通过插值放大冒充高清。

`python scripts/prepare-image-delivery.py` 需要 Pillow，用于离线生成衍生图并验证逐像素无损。首屏资源清单在 `config/runtime-assets.json`，拼图衍生图自动取自目录。新增静态资源必须同步登记；原件不进入服务器日常上传。

生产数据库与配置独立于代码 release，发布不能覆盖它们；SQL 迁移不可改写。旧邀请、进度、图片 ID 和浏览器存储键须保持兼容。

## 文档

- [项目维护约定](AGENTS.md)
- [Git 和最小运行包](docs/runtime-releases.md)
- [服务器部署历史](docs/server-deployment.md)
- [图片来源与扩充规范](docs/图片库来源与扩充规范.md)
- [最新自然风景](docs/nature-expansion-20260911.md)
- [IP 自动语言](docs/ip-language.md)
- [搜索优化](docs/search-optimization.md)

较早的日期文档保留为历史参考；当前行为以代码、AGENTS.md 和最小运行包流程为准。
