# off-02 离线素材与打包交付

范围：仅 `work/offline-play`。未提交、未部署；14 个共享核心文件及原网页项目均未修改。

## 实现

- `scripts/bundle-taptap-artwork.mjs`：默认完整图仅选择免费移动相册和关卡章节相册；显式 `fullAlbumIds`（含空数组）仍优先。保留所有主题相册缩略图，新增 `paidAlbumsExcluded`、`bytesByKind`。
- `scripts/offline-catalog.mjs`：使用内存 SQLite、实时相册读取 stub、`createMobileLevels(...).view(...)` 生成关卡；仅去掉关卡 `status`，其余服务端字段完整透传，再添加网格。
- `lib/offline-catalog-types.ts`：目录类型及不抛异常的 `readOfflineCatalog`。验证基本结构、标识符、图片路径、正整数、引用和重复项；未知关卡字段仅检查 JSON 安全性。限制深度 16、节点 12000、完整目录小于 50 KiB，保留未知字段。
- `scripts/build-mobile-shared.mjs`、`mobile/ports.ts`：仅向 TapTap 配置注入 `offlineCatalog`，类型为可选字段。
- `scripts/package-taptap.mjs`：读取章节相册、生成目录、注入包配置；压缩包超过 55 MiB 失败；报告包含要求的五项统计与分类字节数。
- `tests/taptap-offline-package.test.mjs`、`package.json`：新增 9 项测试，加入 `test:mobile` 的 plain-node 阶段。故事夹具模拟服务端未来视图，验证 `timeLabel`、`intro`、带裁剪/文字/气泡的 `comic` 及任意 JSON 扩展通过 build/read 后不变；没有猜测未来配置位置，也没有增加漫画图片。

## 服务端逻辑复用

- 关卡：`server/mobile-levels.mjs` 的 `createMobileLevels(...).view(...)`，保留相册顺序、关卡编号、文案及后续新增字段。
- 网格：`server/mobile-service.mjs` 的 `mobileGridForPhoto({...photo,...artwork}, pieces, mode)`；关卡 `level`，免费图片 `gallery`（48/108）。
- 画作：构建后的 `outputs/mobile/engine.mjs` 中 `currentRoomArtwork`、`RESTORABLE_PHOTOS`。严格复现房间 `creationArtwork`：优先匹配 RESTORABLE_PHOTOS，再调用 `currentRoomArtwork(photo,pieces,false)`：TapTap 客户端每个请求都带 `X-Jigsaw-Artwork-Snapshot: 1`（mobile/client.ts），所以线上房间用当前版本而不是 legacy 版本（审阅时由操作者改正，卡片原文写的是“不带请求头”）。
- 包装计划新增可选 `roomArtwork` 输入：完整图使用上述线上房间版本；若与 active 修订不同，则保留 active 在线缩略图并另外生成对应 legacy 房间缩略图，每张图仍只打包一个完整版本。

## 验证（2026-10-27）

- 已先运行 `node scripts/build-mobile-server.mjs`；两份 h5 清单在每次构建后均无差异，无需执行恢复。
- `npm.cmd run test:mobile`：162/162 通过（含新增 9 项）。
- 离线打包及原有缩略图测试：12/12 通过；其中新增 9 项已计入上面的 162 项。
- 关卡、关卡房间、移动画作定向测试：30/30 通过。合计 195 个不同测试通过。
- `npm.cmd run check:images`：82 张已发布图片、813 个旧哈希衍生图校验通过。
- `npx.cmd tsc --noEmit -p .`：未完全通过；唯一错误为原有 `vite.config.ts:5` 找不到已忽略且本工作树缺失的 `.openai/hosting.json`（TS2307）。HEAD 原文件已有该导入；本次文件无 TS 报错。没有创建虚构的站点配置。
- PowerShell 禁用 `.ps1` 启动器，因此 npm/npx 使用 `.cmd`；未调整执行策略。

## 指定干包

命令：

```powershell
node scripts/package-taptap.mjs 20261027-offline-dry1 --albums 'D:\chat\拼图\content-admin\work\content-releases\releases\release-20261027T103623768Z-0250800c\albums.json'
```

`--catalog`、`--revisions` 均使用 `content/` 默认文件。产物：

- `releases/jigsaw-nook-taptap-20261027-offline-dry1.zip`
- `releases/jigsaw-nook-taptap-20261027-offline-dry1.zip.json`
- `work/taptap-package-20261027-offline-dry1/`：隔离构建及记录。

| 项目 | 数值 |
| --- | --- |
| zipBytes | 18,791,514（17.92 MiB；18.79 MB） |
| bundledFullImages | 12 |
| paidAlbumsExcluded | 16 个 ID，完整列表见 zip.json |
| offlineLevels | 6 |
| offlinePictures | 6 |
| 完整图字节数 | 5,434,650 |
| 缩略图字节数 | 6,449,186 |
| 目录 JSON 字节数 | 8,868 |
| 包内文件数 | 159 |
| SHA256 | `327d347aebdecce841ac500c9a2f10f4f1a858d796fabc9aa201f9b85010b215` |

打包脚本已解包并逐文件比对长度和 SHA256。完整图仅来自 `album-4a197d4e` 和 `shiguang-ch1`。

## 与任务卡的差异

没有功能范围偏离。增加了可选 `roomArtwork` 包装输入：完整图取线上 TapTap 房间实际使用的版本（带 snapshot 请求头），与 active 修订不同时另外保留在线缩略图。未来故事字段通过服务端视图测试接口模拟，因为当前服务端尚未提供这些字段。唯一未满足的检查是完整 tsc 绿灯：受上述原有站点配置缺失阻挡，未修改任务范围外的配置。
