# 收藏入口与六张原创作品

用户确认两张「哲风壁纸」没有公开使用授权，改为重新生成。没有上传这两张壁纸，也没有把它们输入生图工具。仅从家庭团圆和雨天相伴两个主题出发，内置 image_gen 分别生成原创角色与场景「庭院团圆」「雨中同行」。真实提示词和工具输出记录在 content/artwork/original-family-rain-20260914；两张均1536×1024，无放大或拼接。

用户同时批准此前的4张厚涂预览：深蓝来客、雪径归人、温室来信、林间约定。完整记录转入 content/artwork/painted-scenes-20260914。网络研究只用于文字描述灵感，没有网络图片像素输入。6张使用独立ID，新增中英文标题和描述，放在图库前面、进入原随机集合。在架39张、归档52张，厚涂6、平涂3；原有33张和旧局均保留。

新图原PNG留本地/Git；480×320预览与原尺寸quality84优化WebP离线编码，继续通过哈希URL长期缓存。不修改片数选择、游戏/聊天/权限和数据库迁移。六张实际游玩文件合计2,254,708字节。

收藏按钮在现有导航中显示，点击打开纸艺说明框：Windows为Ctrl+D，Mac为Command+D，手机引导到浏览器菜单。可以复制首页地址，复制失败时选择地址手动复制；只有用户自行完成书签后才点击「已收藏，不再提醒」，不伪造保存成功。

自动提醒仅在图库/大厅至少3个不同UTC日访问后、页面可见停留15秒时出现，关闭后冷却30天，也可永久不提醒。提醒不自动聚焦，不在游玩页出现，后台标签取消计时；localStorage不可用时停止自动提醒。没有新增网络请求、访客追踪或服务端存储。

浏览器操作依据：[Chrome书签](https://support.google.com/chrome/answer/188842?co=GENIE.Platform%3DDesktop&hl=en)、[Chrome快捷键](https://support.google.com/chrome/answer/157179?hl=en)、[iPhone Safari书签](https://support.apple.com/guide/iphone/bookmark-a-website-iph42ab2f3a7/ios)。

## 原件与提示词

本次使用内置 image_gen，未使用收费API或壁纸像素。项目最终文件：

- [庭院团圆原图](D:/chat/拼图/puzzle-play/public/puzzles/cel-coastal-family-v1.png)、[完整提示词](D:/chat/拼图/puzzle-play/content/image-prompts/cel-coastal-family-v1.txt)
- [雨中同行原图](D:/chat/拼图/puzzle-play/public/puzzles/cel-rainy-bridge-v1.png)、[完整提示词](D:/chat/拼图/puzzle-play/content/image-prompts/cel-rainy-bridge-v1.txt)
- [深蓝来客](D:/chat/拼图/puzzle-play/public/puzzles/painted-tidal-encounter-v1.png)、[提示词](D:/chat/拼图/puzzle-play/content/image-prompts/painted-tidal-encounter-v1.txt)
- [雪径归人](D:/chat/拼图/puzzle-play/public/puzzles/painted-snow-parasol-v1.png)、[提示词](D:/chat/拼图/puzzle-play/content/image-prompts/painted-snow-parasol-v1.txt)
- [温室来信](D:/chat/拼图/puzzle-play/public/puzzles/painted-glasshouse-workbench-v1.png)、[提示词](D:/chat/拼图/puzzle-play/content/image-prompts/painted-glasshouse-workbench-v1.txt)
- [林间约定](D:/chat/拼图/puzzle-play/public/puzzles/painted-wolf-oath-v1.png)、[提示词](D:/chat/拼图/puzzle-play/content/image-prompts/painted-wolf-oath-v1.txt)

## 验收与发布

31项来源/图库/随机/片数/语言/历史进度/收藏偏好/运行包测试通过，TypeScript通过。浏览器检查中文桌面、390×844英文窄屏图库及大厅、弹窗、复制成功提示、Esc关闭与焦点返回。移动端平台识别（含桌面UA的iPad）通过单元测试；未冒充真机验收。提醒的三日计数、重复访问不递增、30天冷却与首次访问前永久关闭均通过单元测试。

完整独立包验收39张卡、285项资源、2910文件通过；临时数据库中旧撤回图拒绝新建而旧局仍可加入、9张在架插画开局与原图预加载、多人聊天隔离与跨版本操作均通过。未在生产创建测试房间。

上线版本20260914-12，应用Git a01d097be3dd1575207b16f1c73c0534ec38de90；上传包266126051字节，SHA256 b8b0a4a0fae205eefa8169af398788ad70a0c2b545ba2956a9be2edf590dfaf7。仅上传最新验证运行包。Linux再次隔离验证后预热3104、平滑切流，旧3103排空停止，无迁移变更、无强制刷新。261项相同资源复用243196374字节，保留311项旧哈希资源。

公网只读核对39卡、6个新介绍页200、12个预览/优化图片哈希正确且一年immutable缓存，4个撤回介绍页仍404，健康检查200。站点地图43个URL。浏览器确认新6图、39计数与收藏弹窗实际可用；8个变化规范URL通知IndexNow返回200，仅代表接收，不代表已收录。

服务器清理10旧版本及本次临时上传包，保留12当前/11回退；项目目录416014336降至378605568字节，另移除266126051字节上传包，共享数据、上传图片和备份未改动。本机 work/bookmark-preview-20260914 临时预览目录清理被自动审批策略拒绝，原因为blocked by policy；保留文件、不上传、不换手段删除，已停止3140测试进程。
