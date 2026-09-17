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

## 发布与上线

运行包在最后一次提交上生成，哈希与体积以 `releases/latest.json`、`releases/latest.sha256` 为准，只上传运行文件。上传与切换按 `docs/runtime-releases.md` 与双端口预热流程执行，切换前核对服务器 `current`、槽位与在线连接。

线上结果：

- `releases/20260916-15/app`，应用 Git `befdd7b579ff95900866323a8becf8dda4a3e358`，运行包 sha256 `f2cbfe3d16695360fc4dfba204f55834d74ff3bbf0a2ffaa027b8b8850d223dd`（266,126,561 字节、2910 文件），`jigsaw-web@3103.service` 活跃，3104 请求排空后停止，回退保留 `20260916-14`（cedc8a7）。`migrationChanges: false`，隔离跨版本测试通过，EXIT_CODE=0。
- 首版（`20260916-14`）上线后复核发现 `/lobby` 的搜索描述仍是旧文案「500 pieces and above require a free account」，与新版规则矛盾；单独提交 `befdd7b` 修订 `lib/seo.ts` 后重新出包并第二次预热切换，线上已无旧描述。
- 上线后线上核对（HTTPS）：`/`、`/lobby`、`/gallery`、`/help`、`/personal`、`/personal/images`、`/sitemap.xml` 均 200，`/membership` 307（未开放，符合预期）；`/lobby` HTML 含「Any piece count can be joined」「Join a table of any piece count」。
- 仅向 IndexNow 补交变化的公开页 `/lobby`：2026-09-16T13:17:41Z，status 200。私人页与接口一律未提交。

## 发布收尾注意事项

`npm run release` 会在运行包已生成且 `verified: true` 之后，于 `scripts/package-release.mjs` 的 `finally` 中删除 `releases/staging`；本机 safe-delete 保护对单轮超过 50 个文件的操作会直接抛错（本次 2959 个文件），所以命令以 EXITCODE=1 结束，但运行包本身有效，**不要因此重跑构建**。残留目录用 `robocopy <空目录> releases\staging /MIR` 清空即可（已验证清空后 `releases/latest.tar.gz` 哈希不变）。

服务器旧版本清理（13、12）本轮未执行。

---

# 动态网格与上传图公开房间（2026-09-17）

## 用户决定

1. 棋盘不再把图片裁进固定 4:3／2:1 画幅，改为按图片自身比例生成**贴合网格**，让 2:1 风景图保住左右、竖版照片保住上下。
2. 用户选 300 片时，实际片数允许落在附近（如 288／306），以求画面完整；因此榜单需要**片数档位**，避免一桌成绩被拆到多个近乎空的榜单上。
3. 用户自己上传的图片：**不进入公开图库，但可以开公开房间一起玩，成绩不计入用时榜**。

## 实现要点

- `lib/piece-policy.ts`：`gridForDimensions(width,height,count)` 按 `片数偏差×1 + 裁切比例×2.6 + 像素紧张×0.5` 打分选最优网格，保证拼块正方形、每片不低于像素下限、片数落在目标 ±35% 内。`pieceBand(count)` 把任意片数归到最近档位（分界取中点，正中间归低档）。
- `lib/puzzle-engine.ts`：`createFittedPuzzle` 走新建，`createPuzzle` 仍只接受固定档位；`restartPuzzle`／`shuffleLoose`／`restorePuzzle` 接受「已知或贴合」网格，所以老存档与老房间不受影响。
- 榜单与目录写入统一改记档位；因为固定档位等于它自己，**历史成绩与历史链接无需迁移**。
- `app/api/rooms/route.ts`：自定义图片允许 `visibility:'public'`；**公开上传图房间走免费路径**，不再被 `insertMemberRoom` 的会员校验拦成 403。
- `lib/lobby-store.ts`：上传图房间可在大厅列出，卡片只带标题与进度、不带图片字节；`directoryInsert` 不再对不在图库的 id 做非空断言。
- 上传图可见性：房主本人，或该房间已入座者；公开房间对访客视为已授权 —— 与上传页新增的披露文案一致。

## 画面保真度实测（图库 39 张 × 4 档位）

旧行为下 39 张图**全部**都被裁切：2:1 的图在 108／300／500 档只保住 62.5–66.7%，3:2 的保住 75–93.8%（默认 300 片画幅是 4:3，而画作多为 2:1）。改用贴合网格后，156 个组合**全部提升**，平均保留率由 **73.5% 提升到 100%**。

真实接口实测（`npm run local`）：

| 图片 | 原尺寸（比例） | 300 片档得到 | 棋盘比例 |
| --- | --- | --- | --- |
| `mountain-lake-reflection-hd-v3` | 3144×1572（2.000） | 24×12 = 288 | 2.000 |
| `cel-coastal-family-v1` | 1536×1024（1.500） | 21×14 = 294 | 1.500 |

竖版上传图 1122×1402：108→9×11=99、300→16×20=320、500→20×25=500（正好）、1000→28×35=980。

档位实测：288／306／312→300；204→108（正中间归低档）；205→300。

## 验证

`tsc --noEmit` 干净；`npm run check:images` 39 张通过；`npm run test:release` 2/2；`npm run build` 完整跑通（208 个 JS、`dist/server/index.js`、`dist/.openai/` 齐全，新字符串进入客户端与服务端产物）。

`node --test` 215 用例 190 通过，失败数与改动前基线**完全相同**：基线 5 个既有噪声（free assistance、生产迁移、drag/drop 轮询、两客户端共享、sitemap 提交），另有 backup／retention／release-allowlist 3 项**只在全量并行下**因资源争用偶发失败，单独运行均通过。新增 4 组断言（贴合网格保住竖版画面、贴合网格与固定网格互不串用、片数档位不拆散榜单、39 张已发布图在贴合网格下都不裁切）。

## 状态

**未出包、未上传、未部署。** 待用户确认后再走发布流程。服务器旧版本 13、12 的清理仍待办。
