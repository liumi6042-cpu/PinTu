# 2026-10-20 TapTap手动横竖屏

用户要求在更多菜单加入横竖屏按钮。已在mobile/app.ts的tools菜单仅对TapTap显示：竖视口为切换横屏，横视口为切换竖屏。通过Platform.setOrientation隔离调用宿主tap.setDeviceOrientation，成功后关闭菜单并让现有resize/Canvas自适应处理布局。没有旋转Canvas坐标、修改拼图位置或玩家数据。

mobile/tap-orientation.ts提供有界8秒等待和成功/失败/同步异常/缺接口处理；TapTap原生onDeviceOrientationChange监听转交现有尺寸回调，随onResize解绑清理。Web仍使用原浏览器全屏入口，微信不新增按钮。启动方向保持竖屏，不启用传感器自动转屏。

验证：类型检查通过；2项定向测试覆盖横屏/竖屏参数、成功、重复回调、失败、同步异常、缺接口、超时及Web不调用；三种Canvas尺寸检查TapTap按钮随视口变化、Web全屏按钮隔离，已目测横屏更多菜单。此为接口模拟和本地布局验证，不宣称TapTap真机切屏通过。

包内保留分享体力包备用入口、广告1071218、金币音效、音效静音设置、补给预加载、122张主题缩略图；网页图库147张专属缩略图不打包。本轮无服务器部署、主包替换或送审操作。新测试包上传记录与二维码见work/taptap-orientation-20261020/和releases目录。

## 设置入口补充（2026-10-20）

用户要求设置页也提供横竖屏切换。已在TapTap“玩家与设置”内、外观选项之前增加同样按钮，复用toggleOrientation，不另建方向状态；按当前视口显示切换横屏/切换竖屏。更多菜单入口保留，Web与微信隐藏此项。

类型检查和三尺寸设置渲染检查通过：TapTap设置按钮随横/竖视口改变，Web设置不显示方向按钮；已目测393×851。当前小提示条、声音开关、分享备用入口和主题缩略图保持。无服务器、玩家数据或审核修改。包上传结果位于work/taptap-settings-orientation-20261020/upload.log。

## 首次大厅方向选择（2026-10-27，orientation-picker 工作树）

当前启动规则为读取 `jigsaw:orientation:v1`，没有有效偏好时请求横屏；上文启动方向描述保留为历史记录。入场邀请、新手自动开关卡及未完成章节的跳转决定结束后，首次回到大厅才提供横屏/竖屏选择。仅支持原生切屏的 TapTap 手机宿主提供弹窗，Windows/Mac/PC 宿主隐藏。点击选项立即请求切屏并保留弹窗，确认或返回键保存方向及 `jigsaw:orientation-picker:v1=1`；游戏内手动切屏成功也更新方向偏好。存储读取失败时本次会话跳过弹窗，写入失败不阻断操作。

验证：`tests/mobile-orientation-picker.test.mjs` 与关卡回归共 29 项、`npm run test:mobile`、`npm run test:h5`、图库校验（82 张已发布图片、813 个旧哈希衍生图）通过。`npx.cmd tsc --noEmit -p tsconfig.json` 仅报工作树缺少被忽略的 `./.openai/hosting.json`（`vite.config.ts:5`，TS2307，原有），本次文件无新增类型错误。本地截图用模拟 TapTap 宿主切屏（脚本在忽略目录 `work/orientation-shots/shots.mjs`），截图在 `D:\chat\拼图\ui-revamp-shots\orientation-picker`。尚未在 TapTap 真机验证，未部署或上传。
