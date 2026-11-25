# 2026-10-20 TapTap测试账号金币发放

用户要求为当前截图测试账号增加10000金币。通过截图测试房间归属与TapTap绑定记录核对账号「老头」。

- 金币：55 → 10055，增加10000。
- 碎片、装备字段不变；未修改房间或其他账号。
- 使用BEGIN IMMEDIATE事务，写入幂等账本：admin:test-grant:20261020:taptap-screenshot:coins10000。
- 提交后新数据库连接只读回查，余额一致。
- 修改前快照仅保存在服务器受限目录：/srv/sites/jigsaw-mobile-v3/shared/operations/20261020-taptap-coins10000/before.json。
- 无代码发布或服务重启。刷新或重新进入游戏显示新余额。
