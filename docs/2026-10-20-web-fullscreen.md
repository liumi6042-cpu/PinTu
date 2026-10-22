# 2026-10-20 网页拼图更多菜单恢复全屏

用户要求把此前全屏按钮放回拼图界面更多菜单，仅用于网页。

- 共享源代码通过Platform.fullscreen能力隔离浏览器Document API。仅web平台且fullscreenEnabled与进入/退出接口可用时显示；TapTap、微信和不支持的浏览器不显示。
- 更多菜单首项显示进入全屏/退出全屏，整个documentElement全屏以保留Canvas和菜单；使用浏览器原生Esc退出。权限拒绝显示简短提示，不改房间或存档。
- fullscreenchange接入现有尺寸事件监听并在解绑时清理。
- Web沿实际线上web-20261020-share-mute做最小运行修补并保持源代码相同语义；实际独立SQLite预检健康、JS、/play通过后部署web-20261020-fullscreen。新uiBase=/shared-client/76db13283e37b04d/，保留旧缓存资源。

验证：类型检查通过；原生能力状态/进入/退出/拒绝处理定向测试1项通过。三种Canvas尺寸中，Web显示进入全屏、TapTap隐藏的断言通过；已目测393×851更多菜单。公网JS哈希核对正常。未以浏览器自动化实际操作系统全屏，不将模拟API测试当作设备全屏验证。

切换前数据库在线备份位于/srv/sites/jigsaw/shared/operations/web-20261020-fullscreen/puzzle.sqlite；玩家数据、内容指针和服务器环境保留。无TapTap新包上传或审核操作。证据work/web-fullscreen-20261020/。回退时仅current和slots/3104切回web-20261020-share-mute/app并重启3104，不恢复旧玩家库。
