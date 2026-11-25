# 拼图小窝（Jigsaw Nook）工程工作区

> 整理日期：2026-11-25  
> 本工作区已完成**代码、Git 历史与大图片资产彻底解耦**：三个 Git 仓库均为几十 MB 级纯代码仓，Web 端、移动端与内容管理台共用唯一一份非 Git `media-store/` 图库（全尺寸 WebP Q90 母版 + 线上 Q70/Q82 交付图），可直接整包拷贝到新电脑继续开发、测试与发布。

## 一、目录结构总览

```text
拼图/
├── puzzle-play/         # Web 端唯一主线 Git 仓库（纯代码 + 小资源，.git ~39 MB）
├── jigsaw-nook-taptap/  # 移动端后端 + TapTap/微信主线 Git 仓库（纯代码 + 小资源，.git ~114 MB）
├── content-admin/       # 本地内容管理工作台独立 Git 仓库（.git ~1.8 MB；work/ 含数据库与待整理原件）
├── media-store/         # 非 Git 双端唯一共享图库（Web/移动端/管理台统一读取，无重复副本）
│   ├── puzzles/            # 343 张线上 Q70/Q82 WebP + 343 张原分辨率 Q90 母版 + 兼容/漫画/团子卡
│   └── artwork/            # 参考原画与拼接分区素材（全分辨率 WebP Q90）
├── assets/              # 非 Git 待用资产与宣发成品（已去重与 Q90 压缩）
│   ├── artwork-unimported/ # 尚未入库的 4K 候选原图（全分辨率 WebP Q90）
│   ├── tuanzi-travel/      # 「团子去旅行」独立 IP 素材包
│   ├── brand-kit/          # 拼图小窝 Logo、图标与品牌基础视觉
│   ├── audio-video/        # 背景音乐与各版本宣传片成品（含 1080p60/1080p30）
│   └── marketing-shots/    # TapTap/摩点宣传成品、故事封面与角色设定表
├── server-ops/          # 线上运维手册、域名 DNS 导出、Nginx 配置与部署脚本
├── docs/                # 产品需求文档、架构方案与核心 UI 规范稿
├── _private/            # 私有部署凭据与版权证据（严禁提交至 Git 或公开发布）
│   ├── ssh/                # 正式服 SSH 密钥、固定主机指纹与一键迁移脚本
│   ├── taptap-cli/         # TapTap CLI 应用作用域说明（Developer/App ID）
│   └── copyright/          # 版权证据文件
├── README.md            # 本说明文档
└── AGENTS.md            # 全工作区工程与协作铁律
```

## 二、三大核心代码仓库状态（均已剥离大图片历史）

| 仓库 | 默认主线 | 保留特性分支 | 里程碑标签 (`archive/*`) | 说明 |
|---|---|---|---|---|
| `puzzle-play` | `main` | `feat/web-home-refresh` | 7 个历史标签 | 线上 10-27 拾光物语基线 + 11-19 新图房间修复 + 共享 `media-store` 适配（`scripts/media-paths.mjs`） |
| `jigsaw-nook-taptap` | `main` | `feat/tuanzi-v54` | 7 个历史标签 | 移动端线上后端 + 11-23 防爆盘脚本 + 老 WebView HTTP 降级 + TapTap v53.22 + 微信 0.53.20 开关 + 共享 `media-store` 适配 |
| `content-admin` | `main` | — | — | 独立内容管理后台，统一读写 `media-store/` 与 `work/`，支持 PNG 与全分辨率 WebP Q90 母版 |

> **图资解析机制**：三个仓库通过 `scripts/media-paths.mjs` / `project-layout.mjs` 解析图库——若仓库内存在本地 `public/puzzles`（如线上正式发布包或单元测试临时夹具），优先读本地；本地开发时自动读取共享的 `../media-store/`，也支持通过环境变量 `JIGSAW_MEDIA_ROOT` 自定义路径。

## 三、迁移到新电脑的 3 步快速恢复指南

1. **安装基础环境**：安装 **Node.js 24+**、**Git**（如需跑发布脚本再装 Python 3 与 OpenSSH 客户端）。
2. **整包拷贝目录**：将整个 `拼图/` 文件夹拷贝到新电脑任意路径（路径中无任何盘符写死）。
   - *拷贝提速可选*：当前已保留 `node_modules` 以便开箱即用；若想再省 ~1.0 GB 拷贝体积，可跳过 `puzzle-play/node_modules` 与 `jigsaw-nook-taptap/node_modules`，到新电脑分别执行 `npm ci` 恢复。
3. **一键恢复正式服 SSH 与发布配置**（在项目根目录执行）：
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\_private\ssh\install-on-new-pc.ps1 -TestConnection
   ```
   该脚本会自动将正式服私钥与固定主机指纹安装到 `%USERPROFILE%\.ssh\`、配置权限与 `Host jigsaw-prod` 别名，并更新 `content-admin/work/publish-config*.json` 中的私钥路径（自动移除旧机专属 `bindAddress`）。
   - 如需上传 TapTap 小游戏包，参考 `_private/taptap-cli/README.md` 执行 `taptap login` 并绑定 `Developer ID: 485306` / `App ID: 963283`。

## 四、日常开发与验证命令

- **启动本地内容管理台（http://127.0.0.1:3214）**：
  ```powershell
  cd content-admin
  npm start        # 或双击 start-admin.cmd / 运行 start.ps1
  npm test         # 运行全部后台测试
  ```
- **Web 端（`puzzle-play`）**：
  ```powershell
  cd puzzle-play
  npm run local
  npm run check:images
  ```
- **移动端 / TapTap / 微信小游戏（`jigsaw-nook-taptap`）**：
  ```powershell
  cd jigsaw-nook-taptap
  npm run build:mobile-server
  npm run test:mobile
  npm run test:h5
  npm run check:images
  ```

## 五、后续可持续开发规范

1. **大图片严禁再进 Git**：`public/puzzles/` 与 `content/artwork/` 已写入 `.gitignore`，所有拼图原图与衍生图统一存放于 `media-store/`，待入库候选图放 `assets/artwork-unimported/`。
2. **母版采用全分辨率 WebP Q90 归档**：既保持原始 4K 像素分辨率与高画质余量（便于后续重压 Q70/Q75/Q80 或宣发裁剪），又将体积压缩至原 PNG 的 ~10%，同时在 `image-provenance/*.json` 中保留 `originalPngSha256` 溯源记录。
3. **单一主线 + 短命特性分支 + 发版打 Tag**：合并后立即清理临时 worktree 与分支；TapTap / 微信差异通过 `platform.config.id` 开关控制。
4. **随时推上私有 Git 远端**：三大代码库 `.git` 现均在数十 MB 内，建议尽快为它们各自绑定私有 GitHub/Gitee 远端并定期 `git push`。
