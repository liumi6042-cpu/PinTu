# 小程序独立 API 性能增量包

已准备并验证，未上传、未连接生产服务器、未切换线上。发布号 `20261017-perf42`，严格基于本次只读取得的线上 `20261016-blossom41`。

## 包与校验

- 归档：`jigsaw-mobile-upgrade-20261017-perf42.tar.gz`，300,837 字节。
- 归档 SHA-256：`bc6c63fa3f41d5b20f71222b40ccc1fc990fb2f0b9b76720eba2efc0ad3270b7`。
- 新清单 SHA-256：`fde07727e4bb1939822223c2d8025ed73bb12f2c9d28e9763706ad6f559387bb`。
- 线上 41 清单 SHA-256：`34903275b94774f088f9bffe9a1a2d49fc62258073c22de8057b68caabebebff`。
- 随附既有部署器：`upgrade-mobile-backend.py`，SHA-256 `ba0c6609222fa61dedf666192da2e586e230e14c428ae6be18d5d5555b1ddb45`。

包内 214 个非 public 文件及 release.json，合计 215 项。210 个非 public 文件与线上 41 字节一致；687 项现有 public 素材（1,041,986,545 字节）清单完全不变，由既有 code-delta 部署器逐项校验后复用。未编译 engine/artwork，未改图库、图片版本、默认或后台运营数值、经济、任务、金币、礼包、光标或协议，未包含共享前端或正式 Web 文件。

## 仅有的四份差异

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| server/mobile-service.mjs | 39856 | 52dfb511b0b5bbac553fb1d339f7cee2a5bf000ca042db95d8d919990db41a31 |
| server/mobile-social.mjs | 18782 | d5dcd2881d401dcf3981816c60c5a0b19bc72e7ebb86b05905e20898bb919d28 |
| server/content-release.mjs | 11814 | 51c6907842cb68d81f795ff256fb206ecbe7198eac64a314e1d199a26395e495 |
| server/mobile-managed-content.mjs | 3854 | 066e922b7f6acff3b9c5ba962c16705fb63fb0205c9418a1afe2c1217848aaaf |

逐文件 diff 在 `validation/*.diff`。mobile-service 从线上 41 手术应用档案持久化字节去重、事务开始建映射、finally 清空三处差异；反向替换断言证明其他服务行与 41 相同。工作树中的 runtimeProfile/energy、Web 专属 capability 和旧光标改动均未带入移动包；正式 Web 现有修复由独立 Web 发布保留。

内容缓存只复用已经完整校验的不可变公开配置，签名变化和损坏立即失效、最多 30 秒重新哈希验证；不缓存每日选图/出场事实。档案每个请求仍读 SQLite，自然恢复和满体力 energyAt 语义原样保留。社交在线写入最多每 10 秒一次，90 秒在线边界保持。

## 验证

通过 52 个受影响检查：48 个内容缓存/内容契约、社交、任务、礼包、金币幂等、经济设置/恢复/回滚检查，3 个档案/在线专项，1 个直接引用包内服务的跨实例档案与恢复检查。日志保存在 `validation/`，模块重定向确保测试引用包内 engine、配置和服务字节。既有 `upgrade-mobile-backend.py` 的 `package_inventory` 已完整验证归档路径、清单、尺寸与 SHA，返回 215 项及 687 素材。

另有 1 个既有夹具差异独立保留：`collection ledger` 用例期望初始装饰为 null，而线上 41 默认为“莓色星光”。同一用例在未修改的 live41 和新包均产生相同断言，分别见 `live41-unchanged-legacy-collection-fixture.log`、`staged-unchanged-legacy-collection-fixture.log`。未为过测改变配置。该夹具从通过计数中排除，其余 collection HTTP/结算/幂等检查通过。

## 交由根代理执行的部署命令

先把本目录归档上传为 `/tmp/jigsaw-mobile-upgrade-20261017-perf42.tar.gz`，把随附部署器上传为 `/tmp/upgrade-mobile-backend-20261017.py`。本任务未执行上传。必须先移动 42，后 Web 3104，以便以下保护端口仍是当前 Web 3103。

只读预检：

```sh
python3 /tmp/upgrade-mobile-backend-20261017.py --release 20261017-perf42 --sha256 bc6c63fa3f41d5b20f71222b40ccc1fc990fb2f0b9b76720eba2efc0ad3270b7 --archive /tmp/jigsaw-mobile-upgrade-20261017-perf42.tar.gz --expect-current 20261016-blossom41 --pc-service jigsaw-web@3103.service --check-only
```

预检通过后发布：

```sh
python3 /tmp/upgrade-mobile-backend-20261017.py --release 20261017-perf42 --sha256 bc6c63fa3f41d5b20f71222b40ccc1fc990fb2f0b9b76720eba2efc0ad3270b7 --archive /tmp/jigsaw-mobile-upgrade-20261017-perf42.tar.gz --expect-current 20261016-blossom41 --pc-service jigsaw-web@3103.service
```

既有部署器在切换前以 SQLite 在线备份保护当前共享数据，只切换移动 current 并重启移动服务，验证 health/config/样例素材及正式 Web/H5/配置指纹。失败自动切回 41，保持最新共享数据，不用旧数据库覆盖玩家进度。若预检时线上 current 或保护 Web 端口已变化，需重新读取核对后执行，不能删掉校验绕过。

部署器的 code-delta 素材复用已修正为普通目录与不可变素材硬链接，严格校验完整保留。详见 deployer-audit/DEPLOYER-FIX.md。
