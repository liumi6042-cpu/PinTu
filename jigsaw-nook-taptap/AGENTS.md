# Jigsaw Nook 移动端 / TapTap / 微信小游戏（jigsaw-nook-taptap）工程规范

## 1. 仓库定位与分支约定

- 本仓库为 **移动端后端 + TapTap H5 + 微信小游戏统一主线仓库**，默认分支 `main`。
- 渠道差异（如微信隐藏改名、私信对话及分享/邀请奖励任务）通过平台配置（`platform.config.id === 'wechat'`）控制，**禁止为微信或前后端再拉长期分叉分支**。
- 大版本预览特性「团子去旅行 v54」保留在独立特性分支 `feat/tuanzi-v54`。
- 禁止在外部盘（如 `E:` / `G:`）或本仓库 `work/` 下遗留长期 worktree；临时隔离工作树合并后必须立即 `git worktree remove`。

## 2. 核心不可破坏约束

- 保留既有图片 ID、图库元数据、账号/会话契约、房间协议与数据库迁移历史。
- 严禁提交 `.env*`、`.dev.vars`、私钥、运行期 SQLite 数据库、玩家房间数据、备份与构建缓存。
- TapTap / 微信凭据与服务端密钥只能存在于服务端配置，客户端构建包只能包含公开标识符。
- 正式发布升级包脚本 `scripts/upgrade-mobile-backend.py` 支持对全量包复用相同 SHA-256 公共素材的硬链接，防止线上根分区爆盘。

## 3. 常用验证命令

```bash
npm run test:mobile   # 移动端后端 + 客户端核心测试
npm run test:h5       # H5 网关、广告、传输与横竖屏测试
npm run check:images  # 图库与衍生交付文件校验
npm run check:ui-pixels
```
