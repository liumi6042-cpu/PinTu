# 一起拼图 · 可玩原型

保留胶片转轮选图方向，重点验证单人拼图过程。图片均在本站提供，游玩无需第三方图片服务。

## 已实现

- 四张图片、搜索与分类，12 / 48 / 108 片。
- 不规则拼块；互补边形；桌面外相邻拼块吸附成组；整组拖动与归位。
- 桌面缩放/平移、双指缩放、原图、边缘组筛选、淡底图、位置提示、整理散片。
- 暂停计时、可选吸附音效、完成反馈。每张图每种片数分别保存在本浏览器，刷新续玩。
- 键盘：桌面获得焦点后 N 选下一块，方向键移动，Shift 微调，Enter 吸附，0 适应桌面。

当前是单人原型，不含账号、联机、上传、云端同步或广告。

## 运行与验证

`npm install`、`npm run dev`；部署构建为 `npm run build`。

`node --experimental-strip-types --test tests/puzzle-engine.test.mjs` 验证互补边形、初始布局、正确/错误吸附、整组移动与归位、边缘显示、整理、存档校验，以及三种难度全部完成。

`node node_modules/typescript/bin/tsc --noEmit` 检查类型。

WebMCP 通过特性检测注册 `read_puzzle_session` / `start_puzzle_session`。本环境未提供可验证 WebMCP 调用的上下文，此集成未做运行验证；不影响普通浏览器游玩。本轮按环境规则未执行浏览器操作测试。

## 图片来源

- `seaside.png`：为本项目生成的 4:3 海边村落插画，使用内置 ImageGen，原图位于上级 design/playable-assets。
- `skate.jpg`：Codrops GammaGallery 示例图片，固定版本 775f1a7ccae89b31f6105ca98c48c398bb6b638f，images/xlarge/3.jpg。
- `gold.jpg` / `red.jpg`：Codrops SlideshowAnimations 示例，固定版本 8f9ee4001e0c786ec617f7f729272c4d5a0830a2，img/16.jpg / img/2.jpg。项目说明为 Midjourney 图像。

后续正式内容库需另行整理图片来源与使用许可。
