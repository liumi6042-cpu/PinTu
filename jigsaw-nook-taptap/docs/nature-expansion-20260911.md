# 自然风景图库扩充

根据用户圈出的山湖、草坡和海湾风格，新增五张构图简洁、主体清楚的写实自然风景。使用内置 image_gen，每张单独生成，无外部参考素材。原件、真实尺寸、实际提示词、来源与 SHA-256 保留；游玩图为原生尺寸无损 WebP，列表为最长 480 像素预览图。

| ID | 中文名称 | English title |
| --- | --- | --- |
| emerald-river-valley | 碧水山谷 | Emerald River Valley |
| sunlit-coastal-headland | 晴空海岬 | Sunlit Coastal Headland |
| golden-sand-dunes | 金色沙丘 | Golden Sand Dunes |
| autumn-lakeshore | 秋日湖岸 | Autumn Lakeshore |
| rainbow-grassland | 雨后草原 | Rainbow over the Meadow |

原有画面和玩家进度保留。通过审核的新画面排在图库前面，并进入随机池、独立介绍页与站点地图。

## 原件与提示词

五张均为实际原生 **1402 × 1122**，未插值放大；不是 4K 图片。原 PNG 保留，游玩图在同一尺寸无损编码。预览图为 480 × 384、单张约 20–57 KB；只有开局加载完整图片。

| 图片原件 | 完整生成提示词 | 推荐片数 |
| --- | --- | --- |
| [碧水山谷](../public/puzzles/emerald-river-valley.png) | [提示词](../content/image-prompts/emerald-river-valley.txt) | 300 |
| [晴空海岬](../public/puzzles/sunlit-coastal-headland.png) | [提示词](../content/image-prompts/sunlit-coastal-headland.txt) | 300 |
| [金色沙丘](../public/puzzles/golden-sand-dunes.png) | [提示词](../content/image-prompts/golden-sand-dunes.txt) | 108 |
| [秋日湖岸](../public/puzzles/autumn-lakeshore.png) | [提示词](../content/image-prompts/autumn-lakeshore.txt) | 300 |
| [雨后草原](../public/puzzles/rainbow-grassland.png) | [提示词](../content/image-prompts/rainbow-grassland.txt) | 108 |

生成工具为内置 `image_gen`，模型未由工具返回，来源中记为 null；无外部参考图。完整真实尺寸、SHA-256、编码参数和目视检查见 `content/image-provenance/<id>.json` 与 [本批资产清单](nature-expansion-20260911-assets.json)。

## 验收与发布

- 图片库、随机、语言和搜索索引共 13 项测试通过，TypeScript 检查及本地 Worker / Ubuntu standalone 构建通过。
- 原有目录条目、图片文件和存档 ID 保持；新增后的公开数量为 30，随机池覆盖全部 30 张。原生 WebP 解码像素与 PNG 一致。
- 本地和隔离 HTTP 检查通过全部 34 个公开页面；正式环境同样检查站点地图、30 个图库链接、英文服务端标题、canonical、分享图片及私人页面 noindex。
- 隔离及公网 15 个新增 PNG / WebP 文件均返回成功并与登记 SHA-256 相符，公网 10 个哈希 WebP 使用 immutable 长缓存。
- 浏览器确认图库 30 张、新图排在最前，风景分类包含五张新图；中文界面英文搜索和英文界面中文搜索都能匹配，新图标题与推荐说明完整。公网五张缩略图实际加载为 480 × 384，开局按钮可用。
- 2026-09-11 发布至 `20260911-06/app`，上线前数据库在线备份，保留上一版 `20260911-05/app` 与旧哈希代码资源。未迁移数据库或修改游戏规则、生产房间和用户进度。独立预发布服务验收后停止，本地服务器继续运行。
- 发布时发现磁盘仅余约 714 MB；删除已确认不被任何软链接引用的 `20260911-05/source/dist` 重复构建产物，保留其独立线上安装包。新版本把 standalone 移入 app，避免再次复制。旧版本、依赖、图片原件及数据库均保留；磁盘余量仍需后续维护。

线上入口：[Jigsaw Nook 图库](https://jigsawnook.online/gallery)。
