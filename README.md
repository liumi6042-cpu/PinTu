# 独立 TapTap H5 版本

本工程保存在 `D:\chat\拼图\jigsaw-nook-taptap`，以线上正式版 `20261006-05`、提交 `15dbd5670a1d1947003d15d39f095005bdaf41b5` 为基准，包含82张在架图片。原工程和本地机器人试错改动未修改。

- 独立入口：https://jigsawnook.online/taptap-play/#/zh/lobby
- 原网页：https://jigsawnook.online/zh/lobby
- 平台包：`releases/jigsaw-nook-taptap-h5.zip`，最外层为 `jigsaw-nook/`，其内含 `index.html`。
- 自托管运行包：`releases/jigsaw-nook-h5-server.tar.gz`，只含网关与当前静态构建。
- TapTap 游戏963283，竖屏开发版本281092已上传并绑定主包，保持未发布。
- 官方试玩二维码：https://www.taptap.cn/qrcode/miniapp?id=tapmcln4cmjeaus1ft&type=develop&version_id=281092

两个前端使用原有HTTP增量同步协议连接同一后端、账号服务和房间数据。网关只保存H5连接凭证与帮助记录，不复制原站房间数据库。图库由网关从原站获取；客户端包不含运行数据库、账号、聊天或密钥。

激励广告位1054324已由官方H5工具自动匹配并部署启用。H5每次使用提示或底图必须完整观看一条激励广告，解锁对应功能一次30秒使用；广告播放时长由平台决定。SDK缺失、失败或提前关闭不会解锁。原网站沿用原有帮助规则。

用户已确认TapTap手机端广告播放和进房成功。大厅/今日拼图预览图已改为匿名跨域加载，并通过严格隔离环境回归；版本281092还需手机确认预览显示，广告完整观看发奖和提前关闭也需明确验收。普通浏览器缺少TapTap广告运行环境，不能播放此广告；真实平台测试尚未通过，不代表审核通过。自有账号可分别在两端登录；TapTap账号自动绑定与付费图片包不在本次实现范围。

```powershell
npm ci
npm run build:h5
npm run test:h5
npm run release:h5-server
npm run h5:serve
```

本地预览默认 `http://127.0.0.1:3211/#/zh/lobby`；房间服务取决于 `H5_UPSTREAM`。不得对正式后端运行隔离测试脚本。

配置、验收、回退与平台测试见[接入说明](docs/taptap-h5-setup.md)。
