# 2026-10-20 Web分享流程与音效静音

用户反馈网页版分享疑似挂载TapTap分享，要求设置内明确音效静音按钮。

核对：底层platform-web已按config.id区分navigator.share/clipboard与TapTap宿主，但共享任务页shareInvitation仍走TaskShareReward.complete等平台领奖流程。已为Web增加直接分享邀请分支，显示浏览器分享/复制/取消/不可用结果，避免平台领奖和TapTap提示。TapTap分享备用领取保持。

设置内新增音效静音/开启音效按钮，控制拼合、金币等音效，当前设备持久化；恢复上次非零音量。当前源代码使用AudioSettings；线上Web旧适配器无AudioPlayback/AudioSettings，运行修补通过同一jigsaw:shared:audio:v1存储键控制既有音频实例，立即暂停已播放声音、拦截后续播放并恢复音量。两种路径均有针对性行为检查。

源代码mobile/app.ts已更新。Web实际部署web-20261020-share-mute，新uiBase=/shared-client/369573bf871930b0/。以此前线上金币补发版为基线，保留其他线上功能；旧静态资源保留，新入口模块使用新地址避免旧缓存。线上备份/srv/sites/jigsaw/shared/operations/web-20261020-share-mute/puzzle.sqlite。未操作用户礼包、余额、存档或TapTap审核。

验证：类型检查通过，源码分享/音量2项与实际Web修补静音/播放1项行为测试通过；三尺寸Canvas设置渲染，已目测393×851设置按钮。实际独立SQLite启动、健康、配置、新JS、WAV、/play验证通过；公网新JS哈希与音频回读正常。

证据work/web-share-mute-20261020/。本轮未再次上传TapTap测试包，当前334515仍是前轮包。回退只将current、slots/3104切回web-20261020-coin-audio-v3/app并重启3104，不恢复旧玩家数据库。
