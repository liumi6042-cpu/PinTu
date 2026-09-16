# 上传入口重开与 500 片登录门槛收窄（2026-09-16）

用户要求两点：

1. 500 片登录限制只保留在「创建房间」，游玩不再有任何限制。
2. 之前隐藏的「上传图片生成拼图」重新开放，登录后可用。

本轮不改数据库迁移、不新增图片、不改四档片数与图库内容。

## 变更内容

服务端：

- `lib/room-piece-access.ts` 删除 `checkPieceAdmission`，只保留 `checkPieceCreation`。
- `app/api/rooms/[id]/join/route.ts` 移除两处入座校验与 `requiresPieceAccount` 依赖，不再按片数建立或校验账号身份；请求体里的 `accountId` 依旧不被当作登录状态。
- `lib/piece-access.ts` 提示语改为「创建 500 片及以上的房间需要登录……加入已有房间游玩不需要登录」。

客户端：

- `app/room-play.tsx` 加入失败不再跳登录页（只保留 solo 的登录跳转）。
- `app/public-lobby.tsx` 移除卡片上的「新玩家需登录」标签，大厅说明改为「任何片数都能直接加入；只有创建 500 片及以上房间需要登录」。
- `app/piece-picker.tsx` 新增 `roomCreation` 属性，只有创建场景才显示登录要求。
- `app/puzzle-app.tsx` 移除本机试玩的 500 片账号校验。
- 英文文案同步：`content/locales/en.json`、`app/search-introduction.tsx`、`app/service-document.tsx`。项目以中文原文为 key 查英文，只改中文会导致英文模式回落到中文。

上传功能：

- `lib/feature-visibility.ts` 新增 `USER_IMAGE_UPLOAD_VISIBLE = true`，与仍为 `false` 的 `PERSONAL_PLAY_VISIBLE`／`MEMBERSHIP_VISIBLE` 解耦。
- `app/personal/images/page.tsx` 守卫改用新开关，不再重定向到 `/personal`；`app/personal/personal-space.tsx` 入口同改。
- 未登录时页面只显示登录提示，选图、上传、开局按钮禁用；上传接口继续由 `requireAccount` 校验，不新增匿名路径。
- 会员入口未开放时隐藏「邀请朋友一起拼（私人房间）」选项，避免指向已隐藏的 `/membership` 死链；有效会员账号仍可见。

## 本地验收

在 `npm run local`（端口 3000，本地数据库，未接触生产）实测：

- 游客创建 500 / 1000 片 → 401（文案已是新版）；游客创建 108 片 → 201。
- 普通账号创建 500 片 → 201。
- 全新游客直接加入 500 片房间 → 200（旧行为 401），加入后可正常 claim 拼块。
- 请求体伪造 `accountId` → 只得到游客身份。
- `/personal/images` → 200 并渲染上传面板与登录提示（旧行为 307 跳回 `/personal`）；`/personal` 出现上传入口。
- `/lobby`、`/gallery` 文案更新且不再出现「新玩家需登录」；`/membership` 仍 307。
- `/api/user-images` 未登录 401，登录后 200。

静态校验：`tsc --noEmit` 0 错误；`npm run check:images` 通过；`npm run test:release` 2/2；`node --test` 24/24（含新增 `tests/piece-access.test.mjs`、`tests/public-entry.test.mjs` 用例）；`npm run build` exit 0。

## 构建机修复

本机 Node 的递归目录拷贝不可用：`fs.cpSync` 只要目标是目录就使进程以 `0xC0000409` fail-fast 退出（单文件拷贝正常，Node 22 与 24 均复现，三种目标路径一致）。因此 `scripts/build-server.mjs` 改为用 `readdirSync` + `mkdirSync` + `copyFileSync` 逐项拷贝源码树、`drizzle` 与 standalone 产物，输出布局不变。`scripts/deploy-warm-release.py` 的隔离测试同步更新：新游客加入高片数房间由期望 401 改为期望 200，并断言片数一致；500 片以上「创建」仍需账号的检查保持不变。

## 发布

运行包在最后一次提交上生成，哈希与体积以 `releases/latest.json`、`releases/latest.sha256` 为准，只上传运行文件。上传与切换按 `docs/runtime-releases.md` 与双端口预热流程执行，切换前核对服务器 `current`、槽位与在线连接。部署状态与最终回执见 `AGENTS.md` 顶部条目。
