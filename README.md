# 一起拼图 · 可玩原型

保留胶片转轮选图方向，重点验证单人拼图过程。图片均在本站提供，游玩无需第三方图片服务。

## 已实现

- 四张图片、搜索与分类，12 / 48 / 108 片。
- 不规则拼块；互补边形；桌面外相邻拼块吸附成组；整组拖动与归位。
- 桌面缩放/平移、双指缩放、原图、边缘组筛选、淡底图、位置提示、整理散片。
- 暂停计时、可选吸附音效、完成反馈。每张图每种片数分别保存在本浏览器，刷新续玩。
- 键盘：桌面获得焦点后 N 选下一块，方向键移动，Shift 微调，Enter 吸附，0 适应桌面。

现已加入多人合作试玩：最多 8 人、创建与邀请房间、共享拼块与进度、抢块保护、刷新重连；房间有效期 24 小时。单人存档仍独立保存在本浏览器。暂不含账号系统、上传或广告。

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

## 多人合作实现与验证

- 从选图页「和朋友一起拼」创建房间，输入昵称后进入；游玩中的单人桌面底栏也有同一入口。
- 使用本项目 D1 绑定 PUZZLE_DB；版本条件更新防止并发覆盖；拖动租约 10 秒，移动及持有心跳续期，未持有的连接心跳不会延长失去的租约。
- 客户端约每 300 ms 拉取共享状态，移动每 140 ms 合并发送，保留本人的即时拖动位置。此版用于测试合作流程；网络延迟会影响其他玩家看到移动的速度。
- 各玩家持有独立的房间令牌，服务器只存摘要；邀请地址含随机房间 ID，已知邀请地址可申请加入；房间快照不含令牌或摘要。
- 局部工具（原图、筛选、提示、缩放、暂停）各自独立；多人暂停只暂停自己的操作。多人桌面不提供整体重新整理或重开，避免覆盖其他玩家的工作。
- `node --import ./tests/ts-register.mjs --test tests/*.test.mjs` 包含引擎、真实 HTTP 双客户端、实际轮询客户端测试。HTTP 测试默认使用 localhost:3001，可通过 PUZZLE_TEST_URL 指定测试入口。
- 本地数据库初始化：`node node_modules/wrangler/bin/wrangler.js d1 execute PUZZLE_DB --local --config wrangler.local.json --file drizzle/0000_puzzle_rooms.sql`。正式部署由 Sites 应用归档中的迁移。
- 网站整体访问权限仍由 Sites 控制；网站私有时，同账号两个窗口可测试，多账号朋友需先获得网站访问权限。
