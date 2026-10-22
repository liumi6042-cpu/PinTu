# Web 每日拼图新增图片尺寸兼容修复

用户反馈Web点击每日拼图提示“这张图片暂不支持该片数，请选择较少片数或其他图片”，小程序正常。2026-10-21每日出场记录为album-floating-breakfast-shop-05-20261020，交付尺寸1024×1536。

## 原因与修复

线上Web内容服务使用最新交付目录选每日图，但服务端编译的图片尺寸模块仅有199个旧图片，既无今日图片目录项也无其guidance。建房允许图片来自托管内容，后续supportsPieceCount仍查旧guidance，于是错误返回不支持片数。小程序以当前交付后的图片尺寸计算网格，因此正常。

新增server/delivered-guidance.mjs，合并已验证交付图片的正整数尺寸与旧guidance，保留既有复杂度、建议片数与文字说明。小图仍须通过原有像素下限和片数偏差校验，不通过跳过清晰度检查解决。只影响新建房的尺寸查询，不改变任何已存房间网格、图片ID或进度。

独立TapTap源码树没有线上完整Web源工程，沿用既有Web维护方式：读取线上不可变产物，在新版本中让服务端guidance模块调用此辅助模块；导入已有managedPhotos，使用与内容服务相同的交付尺寸来源。变更文件为server/delivered-guidance.mjs和dist/server/_next/static/puzzle-guidance-C_pYxwRv.js。原Web项目puzzle-play未修改；浏览器资源保持原样。后续重新构建完整Web时，需要将同样合并逻辑接入其服务端play-guidance入口，不能只复制旧静态尺寸表。

## 验证与上线

三项尺寸合并测试通过：新增每日图可以通过原片数策略、无效尺寸和微小图片不能绕过检查、尺寸更新保留原编辑说明且不改输入对象。连同广告相关17项检查通过，源码范围TypeScript通过。

在服务器新建隔离SQLite数据库，复制当天公开出场事实用于固定测试图片，使用真实编译Web服务和HTTP共享API复现：修前POST每日建房400且提示与截图一致，修后201、相同imageId、网格8×12共96片（108档按既有适配策略选择，未修改网格算法）。没有在正式数据库创建测试房。

新版本/srv/sites/jigsaw/releases/web-20261021-daily-dimensions/app，上一版本web-20261020-room-history-grid/app保留可回滚。正式数据库备份仅在服务器受限目录；3104服务已切换并通过健康检查。环境和内容发布指针未变，手机版和联机隔离服版本未变，shared-client资源仍为31d12aea1e22cda3。

来源快照、补丁、隔离验证与上线回执：work/web-daily-dimensions-20261021。用户线上点击复测待反馈。
