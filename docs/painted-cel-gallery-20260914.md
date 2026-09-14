# 厚涂与平涂图库：2026-09-14

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

23项图片来源/参考登记/随机/片数/语言/运行包相关测试及TypeScript通过。新增隔离HTTP验收覆盖7图真实开局、完整快照与优化图SSR预加载；同时保留被撤回图片不可新建而旧局能继续的验收。发布使用现有3103/3104双槽预热流程，无数据库迁移、无强制刷新；生产验收仅只读，实际结果完成后追加。
