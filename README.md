# 独立 TapTap H5 版本

本工程独立保存在 `D:\chat\拼图\jigsaw-nook-taptap`。基准为线上正式版 `20261006-05`，提交 `15dbd5670a1d1947003d15d39f095005bdaf41b5`，包含82张在架图片；原工程和本地机器人试错改动未修改。

- 独立入口：https://jigsawnook.online/taptap-play/#/zh/lobby
- 原网页：https://jigsawnook.online/zh/lobby
- 平台包：`releases/jigsaw-nook-taptap-h5.zip`，ZIP根目录有`index.html`。
- 自托管运行包：`releases/jigsaw-nook-h5-server.tar.gz`，只含网关和当前静态构建。

两个前端经原有HTTP增量同步协议使用同一后端、账号服务和房间数据。网关仅保存H5连接凭证与帮助记录，不复制原站房间数据库。图库资源由网关从原站获取；客户端包不包含运行数据库、账号、聊天或密钥。

TapTap H5 每次使用提示或底图必须完整观看一条激励广告；一次使用持续30秒，用完可以再次观看。广告时长由平台决定。广告未开通、SDK不可用、播放失败或提前关闭不会解锁，其他拼图操作正常。原网站沿用原有帮助规则。暂未提供真实广告位，正式广告保持关闭。

自有网站账号可分别在两端登录；TapTap账号自动绑定与付费图片包未包含在本次交付中。

```powershell
npm ci
npm run build:h5
npm run test:h5
npm run release:h5-server
npm run h5:serve
```

本地预览默认为`http://127.0.0.1:3211/#/zh/lobby`；房间服务取决于`H5_UPSTREAM`配置。不得对正式后端运行隔离测试脚本。

配置、验收和后续平台测试见[接入说明](docs/taptap-h5-setup.md)。
