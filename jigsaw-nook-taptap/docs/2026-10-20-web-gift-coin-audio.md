# 2026-10-20 Web礼包金币音效补发

用户反馈网页版开启礼包无金币声。线上核对确认：正式Web仍使用web-20261019-room-actions、shared-client/76dfb3c7ece12fef，其openGift方法尚无播放调用；金币音效此前只上传TapTap测试包，未同步Web。

已按线上实际运行版本制作最小修补，openGift收到opened.coins>0的成功回执后播放assets/audio/mobile-coin.wav。同步的源代码mobile/app.ts与构建音频资源已在前轮存在，本轮不把后来仅供TapTap的其他改动带入线上Web。新增声音遵循现有AudioPlayback音量、静音及后台规则。

已部署实际目录web-20261020-coin-audio-v3/app，新uiBase=/shared-client/89d1120db72a68dd/。关联静态模块使用新文件名防止浏览器缓存旧入口；旧资源保留。两次失败的隔离预检目录web-20261020-coin-audio、web-20261020-coin-audio-v2未切线上：首轮补齐独立启动代理/Host环境，第二轮补齐新增WAV在静态允许清单中的注册。第三轮独立SQLite启动健康、配置、JS哈希、WAV和/play检查通过后才切换。

玩家库切换前在线备份：/srv/sites/jigsaw/shared/operations/web-20261020-coin-audio/puzzle.sqlite。未写玩家库、未消费用户礼包；内容发布指针与环境保持不变。上线健康、配置与新资源回读通过。实际设备听感仍由用户确认。

操作、回执行为定向测试和公网验证：work/web-coin-audio-20261020/。回退时将current与slots/3104切回web-20261019-room-actions/app后重启3104，保留当前玩家数据库。
