# TapTap 登录与篝火模式核对（2026-10-20）

官方来源：
- https://developer.taptap.cn/docs/sdk/taptap-login/features/
- https://developer.taptap.cn/docs/sdk/taptap-login/guide/
- https://developer.taptap.cn/docs/store/operation/test/test-skills/gameplaytest/

篝火为早期封闭玩法测试，要求TapTap登录及“仅有测试资格可登录游戏”，需先创建封闭测试计划。新篝火由登录SDK进行资格校验，SDK与计划须同一游戏唯一ID。测试服和预约服唯一ID不同。篝火不允许其他渠道登录；开放预约后篝火失效。领取流量包后关闭需联系运营或工单。官方目前写明2000元专属流量包，领取后有效期3个月，实际资格以后台为准。

截图“快速通行”是下载时预授权配置，不是篝火资格开关。当前项目代码此前核对为tap.login/getUserInfo及MiniApp jscode2session链路，不应直接认定已具备TDS篝火资格校验。当前官方指南列出Android/iOS/Unity/UE5及API接入方式，未在此次阅读中确认创意工坊H5小游戏可沿用现有登录参与篝火。若继续开放测试，不建议仅为昵称获取改换体系；若转篝火，先核实小游戏资格和账号绑定迁移，不直接修改后台或现有登录。

本轮仅查阅官方文档，未修改后台、开通服务或创建测试计划。
