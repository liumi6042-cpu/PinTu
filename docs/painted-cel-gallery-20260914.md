# 厚涂与平涂图库：2026-09-14

> 最新用户修改：本批「暮色归途、绯月蔷薇、琥珀听风、天台听风」已要求撤回，目录改为archived；在架33张、归档52张，保留「雨后月光、青羽来信、雨窗书店」。以下7张首次发布记录为历史。新生成作品只供预览，待用户选择后才可上架。下架验收见 [四图撤回记录](art-withdrawal-20260914.md)。

用户确认将前2张与新增5张共7张作品加入网站，分成「厚涂 / Painterly」4张、「平涂 / Cel Shading」3张，排在图库前面。原30张不变，共37张在架、48张归档；此前撤回的5张动漫继续归档。随机开局覆盖全部37张，片数仍为108/300/500/1000，默认300，未恢复高清自动生成队列。

## 图片与生成记录

| 名称 | 风格 | 原图 | 完整提示词 | 优化游玩图 |
| --- | --- | --- | --- | ---: |
| 雨后月光 | 厚涂 | [PNG](../public/puzzles/painted-moonlit-portrait-v1.png) | [Prompt](../content/image-prompts/painted-moonlit-portrait-v1.txt) | 255020 B |
| 暮色归途 | 平涂 | [PNG](../public/puzzles/cel-sunset-train-v1.png) | [Prompt](../content/image-prompts/cel-sunset-train-v1.txt) | 169010 B |
| 绯月蔷薇 | 厚涂 | [PNG](../public/puzzles/painted-crimson-rose-v1.png) | [Prompt](../content/image-prompts/painted-crimson-rose-v1.txt) | 230632 B |
| 青羽来信 | 厚涂 | [PNG](../public/puzzles/painted-jade-feather-v1.png) | [Prompt](../content/image-prompts/painted-jade-feather-v1.txt) | 310418 B |
| 琥珀听风 | 厚涂 | [PNG](../public/puzzles/painted-amber-autumn-v1.png) | [Prompt](../content/image-prompts/painted-amber-autumn-v1.txt) | 288914 B |
| 雨窗书店 | 平涂 | [PNG](../public/puzzles/cel-rainy-bookshop-v1.png) | [Prompt](../content/image-prompts/cel-rainy-bookshop-v1.txt) | 239846 B |
| 天台听风 | 平涂 | [PNG](../public/puzzles/cel-rooftop-breeze-v1.png) | [Prompt](../content/image-prompts/cel-rooftop-breeze-v1.txt) | 252044 B |

以上均为内置image_gen生成的原生1536×1024单图，无拼接、无插值放大。原件、提示词、实际尺寸、SHA及逐张审核保存在content/image-provenance与content/artwork/painted-cel-20260914。用户原始参考图仅用于前两图的画法参考，不作为可玩素材、不称为项目生成；后5图参考用户认可的前2张生成图。两张用户参考在本地/Git保存，仅对指定ID及用途登记校验；不上传网站。用户已明确认可生成结果并要求上架。生成记录与人工观察不构成版权或独占性的保证。

## 交付和兼容

列表使用480×320预览；开局使用同原尺寸quality84有损WebP、哈希URL和一年缓存。没有将压缩称为无损或增加原生细节。7张优化图共1745884字节，全部兼容派生图共14654862字节（含无损play版本及预览），不能把优化下载量等同于服务器总储存增量。服务器不做图片生成、解码或转码；原始PNG、用户参考及开发源码不随运行包上传。旧房间、拼块、图片和客户端哈希资源保留。

23项图片来源/参考登记/随机/片数/语言/运行包相关测试及TypeScript通过。新增隔离HTTP验收覆盖7图真实开局、完整快照与优化图SSR预加载；同时保留被撤回图片不可新建而旧局能继续的验收。发布使用现有3103/3104双槽预热流程，无数据库迁移、无强制刷新；生产验收仅只读。

## 上线回执

2026-09-14 已发布 `releases/20260914-10/app`，应用提交 `1187e2fe56fcbcaee8da355e90aaee442ad24075`。验证通过的运行包为250478693字节，SHA-256为 `bc5aa99a56ee04a8a4b2181315ea837c65db4a6df7ae711733ced2c1a69918bb`，共2901文件、267项运行资源。源码PNG、风格参考和开发源码未上传。

新实例 `jigsaw-web@3104.service` 预热后经nginx平滑切换；旧3103实例确认请求排空后停止。迁移无变化，隔离跨版本验证涵盖旧1500–5000片局、聊天和权限；没有强制刷新正在游玩的客户端。部署复用240项不可变资源、共228541512字节，并保留228项旧哈希资源。回退目录保留09；新图已被玩家使用后优先向前修复，不能假定09旧目录可识别新图ID。

线上HTTP验收确认：图库37张、站点地图41个规范URL，7个新介绍页及14张优化图/预览图均返回200，图片哈希与本地一致；图片使用一年immutable缓存，重复读取命中Cloudflare缓存。原始PNG和用户参考路径返回404，旧5张撤回动漫不在图库与地图中，健康检查200。浏览器实测厚涂4张、平涂3张，中文「青羽」与英文「Rooftop」均只找到对应1张，恢复中文/全部后37张且保持原1000片偏好；两排新图显示正常。

仅向IndexNow通知首页、图库和7个新介绍页，共9个变化URL，返回200表示已接收，不代表搜索引擎已收录。本次没有创建生产测试房间。

确认上线后删除已不使用的08版本及本次临时上传包，保留09回退/10当前；项目目录从396816384降到359448576字节，另删除250478693字节临时包。共享数据库、玩家上传和备份未改动。部署与清理回执分别位于服务器新版本目录的 `deployment.json` 和 `cleanup.json`；本地HTTP记录在 `work/style-previews/seven-live-check.json`。
