# 原创动漫图库：2026-09-14

用户要求新增二次元动漫/漫画拼图。本批新增5张，既有30张保留，合计35张在架、43张归档。新图归入「动漫 / Anime」，排在图库前面，支持原有双语搜索、全部四档片数与随机开局。首屏、公开大厅预设桌、旧进度、聊天和会员开关不改。

## 图片与提示词

以下均由内置 `image_gen` 分别生成，未使用网络图片、外部参考图、指定作品角色或特定艺术家风格。保存实际完整提示词、工具返回原件路径、日期、尺寸和SHA；没有工具返回的具体模型名，记录为null。

| 名称 | 原件 | 完整提示词 | 优化游玩图 |
| --- | --- | --- | ---: |
| 海风车站 / Seaside Platform | [PNG](../public/puzzles/anime-seaside-platform-v1.png) | [Prompt](../content/image-prompts/anime-seaside-platform-v1.txt) | 226,230 B |
| 猫咪小店 / Cat and Bread Shop | [PNG](../public/puzzles/anime-cat-shop-v1.png) | [Prompt](../content/image-prompts/anime-cat-shop-v1.txt) | 201,702 B |
| 云海送信员 / Courier above the Clouds | [PNG](../public/puzzles/anime-cloud-courier-v1.png) | [Prompt](../content/image-prompts/anime-cloud-courier-v1.txt) | 372,624 B |
| 雨夜街角 / Rainy Street Corner | [PNG](../public/puzzles/anime-rainy-corner-v1.png) | [Prompt](../content/image-prompts/anime-rainy-corner-v1.txt) | 425,350 B |
| 星光小魔女 / Starlight Witch | [PNG](../public/puzzles/anime-starlight-witch-v1.png) | [Prompt](../content/image-prompts/anime-starlight-witch-v1.txt) | 289,874 B |

生成记录：`content/artwork/anime-20260914/*.generation.json`；原件/派生图来源记录：`content/image-provenance/anime-*.json`。人物脸、手、肢体、雨伞、猫和主要道具均检查；角色和主色块清楚，无可见文字、水印或拼接。部分背景比提示要求更丰富，但主体仍易辨认。

## 尺寸与资源

五张均为原生1536×1024、3:2单幅画面，无拼接或插值放大。1000片为40×25，中心等比裁切后的每片主体约38.4像素，满足当前最低30像素门槛。新建仍仅支持108/300/500/1000，默认300；高清自动升级继续暂停。

网页开局使用同尺寸quality84有损WebP，五张总计1,515,780字节（约1.45MiB），不把压缩称为无损。列表使用480×320预览，约34–54KB。构建机完成编码，生产不新增图片处理任务。原始PNG与提示词不上传，运行包沿用已验证白名单，旧哈希资源继续保留供在线玩家与回退使用。

## 验证和发布

图片检查及22项来源/片数/随机/双语/运行包测试通过，TypeScript通过。发布包还会在独立临时数据库实际创建五张新图的108或1000片房间、读取完整拼块、验证英文介绍页与SSR优化图预加载。全部运行资源逐一验证哈希；线上仅只读验收，不在玩家房间做测试。

计划按现有3103/3104槽位预热发布，无数据库迁移、不强制刷新旧客户端。实际发布回执完成后追加。
