# Jigsaw Nook Web（puzzle-play）工程规范

> 历史变更流水账（2026-09 至 2026-10）已归档至 `docs/history/agents-log-2026-09-to-10.md`。

## 1. 仓库定位与分支约定

- 本仓库为 **Web 端唯一代码主线**，默认分支 `main`（当前对应线上 `web-20261027-play-path` 基线 + 新图房间兼容修复 + 截至 2026-11-19 的完整 343 张已交付图库）。
- 未启用的可收录首页改版保留在独立分支 `feat/web-home-refresh`。
- 禁止在本目录外再创建长期存活的 dated worktree（如 `work/dual-managed-release-*`）；如用 worktree 隔离改动，合并后必须立即清理。

## 2. 核心不可破坏约束

- **双语路由与地址语言**：成对页面（`/`↔`/zh`、`/lobby`↔`/zh/lobby`、`/gallery`↔`/zh/gallery`、`/help`↔`/zh/help`、`/puzzle/[id]`↔`/zh/puzzle/[id]`）文案由 URL 地址决定（`useAddressCopy` / `addressCopy`），非成对页跟随访客偏好；语言跳转响应必须携带 `Vary: Cookie` 与 `Cache-Control: private, no-store`。
- **`content/locales/en.json` 安全编辑**：文件存在历史重复键，禁止做全文件 `JSON.parse` → `JSON.stringify` 回写，修改文案请做定点行替换。
- **图库与像素预算**：优化交付图规格定义在 `scripts/delivery-spec.mjs`（WebP Q70、总像素上限 6,553,600、缩略图 384），须与 `content-admin/contracts/delivery-spec.mjs` 保持一致；保留既有图片 `id` 与 `publishedAt`。
- **房间与存档兼容**：禁止破坏既有房间存档字段与 `publicRoomLifetime`（108/300 片 24h，500+ 片 36h；有进度房间隐藏保留 30 天）。
- **敏感文件隔离**：严禁提交 `.dev.vars`、`.env*`、SQLite 数据库、密钥与发布压缩包。

## 3. 常用验证命令

```bash
npm run check:images            # 校验图库来源、规格与交付文件
npm run check:content-release   # 校验内容发布包契约
npm run test:release            # 校验发布打包白名单
npm run lint                    # 代码检查（oxlint）
npm run build                   # 构建验证
```
