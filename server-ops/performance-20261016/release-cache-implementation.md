# 统一发布配置读取缓存

本地实现完成，未构建部署包、未上传。源码备份位于 `baseline/release-cache/`。

- 两个服务各持有单版本 reader，缓存 releaseId + manifestSha256 对应的原始公开文档、类型校验结果及冻结对象。
- 热读只检查发布根目录、指针、版本目录、manifest、4–5 份配置与素材父目录的文件身份/大小/mtime/ctime 签名。当前素材都是 `puzzles` 目录，无逐张图片 stat、realpath 或重复 JSON 解析。
- 切版、回退或签名变化立即重新完整校验；坏指针、错误摘要、无效规则或缺图时清空缓存并失败，不返回之前的版本。最长 30 秒重新完整摘要及图片路径/存在性校验。
- `readManagedRelease`、Web `readNodeManagedContent` 及发布只读预检保留原来的完整即时校验语义；仅运行服务构造注入有界 reader。
- 每日出场收据、日期、随机选择和相册自动收录仍按调用实时计算，不缓存选择结果；不读写用户数据库或管理员设置。
- mini 网关沿用 `MOBILE_ASSET_DIR || public` 并传入服务；Web 使用已有预检的 `dist/client/puzzles` / `public` 路径规则，依赖服务既有的应用根 WorkingDirectory。未设置 managed directory 时继续原有内容读取逻辑。
- 运行模块没有增加，mini `package-h5-server.mjs` 与 Web `SERVER_RUNTIME_HELPERS` 已包含全部修改模块。

验证：mini 缓存与原 managed 内容/运行测试 18/18；Web 缓存 8/8，以及原 managed 内容相关 4/4。最后的 Web 快照冻结收敛变更再次跑 4/4。语法检查、正式 Web diff 空白检查通过。

微基准：40 次读取、190 张实际本地素材引用、默认合成公开配置，旧版中位数 80.14 ms、缓存热读中位数 0.273 ms；这是同步配置读取微基准，不代表完整 HTTP 请求加速比例。数据见 `release-cache-verification.json`。
