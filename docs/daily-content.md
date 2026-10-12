# 每日拼图公开配置接入

默认运行保持原静态每日轮换与图库。只有显式设置 `MOBILE_DAILY_CONFIG` 才启用新规则，不自动部署，也不接入待导入的新素材或原 PC 项目。

`MOBILE_DAILY_CONFIG` 指向后台生成的公开 `jigsaw-daily-content/v1` JSON，例如相邻后台的 `content-admin/work/daily-bridge/configuration.json`。`MOBILE_DAILY_APPEARANCES` 指向独立出场记录目录，默认本项目 `work/daily-appearances`。这两处仅交换公开图片 ID、日期、相册描述和服务实际生效记录，不包含管理员账号、密钥或数据库。

服务校验配置摘要和现有已发布素材。非法配置或出场记录不能写入时，启动或请求明确失败。服务启动与每 30 秒检查当前日期的可用每日图片；仅为实际当前日期创建出场记录，不推算或补造过去日期。未排期日期使用原每日轮换并记录 `planned: false`，不会据此自动收录。

每天按北京时间固定一张图，首次生效记录用独占文件创建并锁定日期、图片 ID 和预选相册。修改配置不能更换已经生效的当天图片。首次出场期间，图片可以从每日入口游玩，合格参与者当时即可保存完成事实；普通图库及图鉴在首发结束后的北京时间次日 00:00 放行。隐藏目标相册继续隐藏，完成事实保留。

新规则只覆盖排期图片的相册归属，基础普通图库、原购买包成员、价格及奖励收据保留。可新增免费目标相册；既有购买包可以增加每日图片，原购买者获得扩展权益。全新购买包尚需单独接入商店，不能由每日配置建立。

`GET /api/daily` 返回服务实际今日图片；`GET /api/mobile/gallery` 返回普通图库可选 ID 和购买图片 ID。前端仅显示本地已存在的素材，首发前与当天的排期图片不会提前进入选图列表。每日收录使用原图片 ID，保留各难度完成事实；重复完成收据不重复发放金币、碎片或图鉴奖励。

不读取或补写真实旧玩家记录。已经结算的旧每日房间仍保留原结算，历史图鉴事实补录需另行以有效完成证据实施。

聚焦验证：`node --test tests/daily-content.test.mjs tests/mobile-collection.test.mjs tests/mobile-service.test.mjs`；必需检查：`npx tsc --noEmit --incremental false`、`npm run check:images`。
