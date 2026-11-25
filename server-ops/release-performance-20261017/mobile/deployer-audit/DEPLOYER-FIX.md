# code-delta 素材复用修正

根代理反馈：原部署器只读预检通过，实际准备新 release 时被严格 `check-artwork-revisions` 拒绝，原因是 `public` 目录符号链接。失败发生在 current 切换与数据库备份之前，根代理核实线上仍为 41；失败的 42 目录由根代理隔离后重试。

本修正仅改 `jigsaw-nook-taptap/scripts/upgrade-mobile-backend.py` 并同步移动发布目录副本，旧版有限备份为 `upgrade-mobile-backend.before.py`，精确 diff 为 `upgrade-mobile-backend.diff`。四文件服务归档不变，也没有重编 engine、素材或重打包。

新部署器 SHA-256：`ba0c6609222fa61dedf666192da2e586e230e14c428ae6be18d5d5555b1ddb45`。

新逻辑先核对来源素材的 manifest 尺寸/SHA，再创建普通 `public` 目录，仅硬链接公开不可变素材。每一层来源路径拒绝 symlink、junction/reparse point、特殊文件，限制在已验证 canonical resource_tree；目标限制在新 release/public，逐层核对目录，硬链接后复核 inode、尺寸和 SHA。随后仍完整执行原 manifest 校验和严格 artwork 检查。代码、配置和玩家数据库均不硬链接，也不 chmod 或写入共用素材 inode。

`--check-only` 同样执行新增来源路径检查，不创建目标目录。共享数据库在线备份、current 切换、健康验证、正式 Web/H5 指纹保护与失败回滚逻辑不变。

本地验证：既有 Python upgrade safety 8 项全过；新增硬链接专项 5 项中 3 项通过，Windows 无符号链接权限及无 FIFO 接口使两项跳过，具体日志在同目录。Linux 可通过下面命令跑完 5 项，随后由根代理验证真实素材与 artwork：

```sh
MOBILE_UPGRADE_SCRIPT=/tmp/upgrade-mobile-backend-20261017.py python3 /tmp/test-hardlink-resources.py
```

测试脚本只在部署器所在目录创建并清理临时测试目录，不连接服务、不接触生产路径或玩家数据库。归档 SHA-256 仍为 `bc6c63fa3f41d5b20f71222b40ccc1fc990fb2f0b9b76720eba2efc0ad3270b7`。
