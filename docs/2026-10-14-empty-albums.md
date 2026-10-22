# 空相册自动隐藏

玩家端只显示至少有一张当前可收录图片的相册。每日图片尚未达到现有自动收录时间时，不计入显示数量；收录生效或新增有效图片后，相册自动恢复显示。手动关闭小程序展示的相册仍然隐藏。后台相册、平台勾选、成员配置、已购权益与已领奖励不变。

修改仅涉及 `server/mobile-collection.mjs` 中的玩家相册/图包展示过滤，同时涵盖管理后台配置与旧默认图库。管理模式中的空图包购买原本已被服务端拒绝。

`tests/album-content.test.mjs` 新增空册/恢复/购买权益与旧图库覆盖，并更新每日首发隐藏/次日收录场景。与 `tests/mobile-collection.test.mjs` 合计 13 项通过；已对冻结差量包再执行相同 13 项测试通过，语法检查通过。没有重新构建客户端或修改素材。

## 冻结 API 包

- 版本：`20261014-emptyalbums37`，仅可接在 `20261013-content36` 后。
- 文件：`releases/jigsaw-mobile-upgrade-20261014-emptyalbums37.tar.gz`，110,894 字节。
- SHA256：`df7a8f0a306e2bbcf7097fe26c5496545192968bba8a8730a7545a471a619dc4`。
- 基线 manifest SHA256：`1c07e37cf8c8afa1a364ceb42b5ef6006b898d40e824072e9b6bc19f7840d614`。
- 新 manifest SHA256：`3f4a3cb6284c73b7a8047bb7e6ba89cb51fd0232b7acb2c15e49a24203037100`。
- 修改代码 SHA256：`7c3b0f8c45f671b041cd6a9b48b6ed536d3a35c15d2b541431a90fe32e293ba9`。
- 包含 20 个代码/配置文件和 manifest；与冻结 content36 相比仅 `server/mobile-collection.mjs` 改变，其余字节相同，451 个素材继续复用。
- 构包记录：`work/package-empty-album-upgrade.py`；从已校验 content36 包复制，只允许本次两处过滤修改，不从脏工作区收集其他代码。重复运行拒绝覆盖。

本记录只证明本地准备完成，未部署、未发布后台内容。协调会话上传包后应先确认当前 Web 端口，再使用现有升级脚本执行 `--check-only`，通过后同参数去掉该项进行升级：

```text
/usr/bin/python3 /tmp/upgrade-mobile-backend.py --release 20261014-emptyalbums37 --sha256 df7a8f0a306e2bbcf7097fe26c5496545192968bba8a8730a7545a471a619dc4 --archive /tmp/jigsaw-mobile-upgrade-20261014-emptyalbums37.tar.gz --expect-current 20261013-content36 --pc-service jigsaw-web@3103.service --check-only
```

升级脚本继续按其既有保护策略备份手机数据库、保护 Web 及旧 H5 服务，不含客户端发布，不改内容 current.json。
