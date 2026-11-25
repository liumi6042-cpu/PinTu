# 拼图小窝工作区协作规范（AGENTS.md）

## 1. 工作区拓扑（单一真源）

- `puzzle-play/`：Web 端纯代码主线仓库（默认分支 `main`；首页改版留存 `feat/web-home-refresh`；不含大图片二进制）。
- `jigsaw-nook-taptap/`：移动端后端 + TapTap/微信小游戏纯代码主线仓库（默认分支 `main`；团子去旅行 v54 留存 `feat/tuanzi-v54`；不含大图片二进制）。
- `content-admin/`：本地内容管理台独立仓库（默认分支 `main`，运行时数据在 `content-admin/work/`，严禁提交进 Git）。
- `media-store/`：非 Git 托管的双端唯一共享图库（`puzzles/` 存放线上 WebP 与原分辨率 Q90 母版，`artwork/` 存放参考原画与分区素材），由三端通过 `scripts/media-paths.mjs` / `project-layout.mjs` 统一读取（支持 `JIGSAW_MEDIA_ROOT` 覆盖）。
- `assets/`：非 Git 托管的待入库 4K 候选图（`artwork-unimported/`，WebP Q90）、团子素材（`tuanzi-travel/`）、品牌视觉（`brand-kit/`）、音视频与宣传成品。
- `server-ops/`、`docs/`：线上运维手册/配置/DNS 导出与核心产品设计文档。
- `_private/`：正式服 SSH 密钥与一键迁移脚本（`ssh/`）、TapTap CLI 说明与版权证据（`copyright/`），严禁进入任何 Git 提交或发布包。

## 2. 不可违背的工程护栏

1. **严禁将大图片或二进制媒体提交进 Git**：`public/puzzles/` 与 `content/artwork/` 已忽略；所有拼图图库文件必须统一存放于 `media-store/`，母版归档推荐使用全分辨率 WebP Q90（并在 `image-provenance/*.json` 保留 `originalPngSha256`）。
2. **禁止留存废弃 worktree**：使用 `git worktree` 隔离改动后，合并验证完毕必须在同一任务结束前执行 `git worktree remove` 清理，严禁跨盘（E:/G:）堆积工作树。
3. **禁止硬编码本机盘符路径**：脚本中一律通过 `import.meta.url` / `__file__` 相对定位工作区根目录，或支持环境变量覆盖（`JIGSAW_MEDIA_ROOT`、`JIGSAW_WEB_TREE`、`JIGSAW_SSH_IDENTITY`）。
4. **禁止用长期分叉分支区分渠道或前后端**：TapTap 与微信小游戏的行为差异必须通过平台配置开关控制；移动端后端与客户端在 `jigsaw-nook-taptap/main` 保持同步。
5. **发版打不可变 Tag**：每次正式发版打 Git Tag，不保留一次性 `work/release-*` 工作树目录。
6. **严禁泄露凭据与运行数据**：绝不提交 `.env*`、`.dev.vars`、`secret.json`、`publish-config*.json`、`*.sqlite*`、SSH 私钥、玩家数据与发布压缩包。
7. **改动前必验、改动后必测**：
   - 修改 `content-admin` 后运行 `npm test`；
   - 修改 `jigsaw-nook-taptap` 后运行 `npm run test:mobile`、`npm run test:h5` 及 `npm run check:images`；
   - 修改 `puzzle-play` 后运行相关单元测试与 `npm run check:images`。
8. **保持 `AGENTS.md` 精炼**：只记录当前仍然有效的规则与坑点；历史变更流水账写入 `docs/`，不要无上限追加到 `AGENTS.md`。
