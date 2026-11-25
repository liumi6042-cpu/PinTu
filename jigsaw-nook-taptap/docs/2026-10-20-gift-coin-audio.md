# 任务礼包金币音效（2026-10-20）

用户要求任务礼包打开时播放金币音效。项目原有拼块吸附音，无金币音。本轮新增原创程序合成680ms单声道48kHz PCM16金币叮当声，来源与哈希记录在content/sound-effects/coin-reward，未使用第三方采样。

共享客户端mobile/app.ts在礼包接口成功且opened.coins>0后播放assets/audio/mobile-coin.wav；失败或无金币不播放，刷新失败不重放领取。沿用AudioPlayback音量、静音、后台及广告暂停规则，声音错误不影响领取。音频生成与共享平台打包已接入现有脚本。

验证：新增礼包行为测试1项通过，现有音频播放测试6项通过；TapTap隔离构建work/coin-audio-20261020/shared-web成功并包含音频。未发布/上传客户端、未重启服务器、未操作玩家数据。未完成TapTap真机试听。

完整task-coins-ui测试首次运行有既有界面夹具不兼容失败，本轮仅对新增音效行为定向验证通过；不宣称完整UI回归通过。
