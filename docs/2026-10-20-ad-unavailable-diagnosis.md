# 2026-10-20 广告暂不可用诊断

用户在334339遇到广告暂不可用，随后提供平台Android接入指令与小游戏接入说明截图。

## 已核对

- 线上/h5/config仍返回1071218，adRewardEnabled=true，shareRewards=true，不能把失败归因于服务器未启用。
- 官方 https://ssp.dirichlet.cn/docs/mini-program-guide/ 明确小游戏也使用Dirichlet媒体后台，创建时应用类型设“小游戏”，调用小游戏宿主广告接口。
- https://developer.taptap.cn/minigameapidoc/dev/tutorial/open-capabilities/ad/rewarded-video-ad/ 明确tap.createRewardedVideoAd({adUnitId})及isEnded完播判断。Android初始化指令不能用于本H5工程，亦不能凭该指令认定媒体类型有误。实际媒体配置、测试设备条件和宿主错误码尚待核对。
- 用户提供的媒体密钥没有写入源码、文档、日志或H5包。

## 增量

在platform-web.ts保留创建/加载/展示/超时阶段和errCode/errno/errNo；过滤URL及凭证片段。失败后清理广告实例以便重试；监听清理异常不阻止流程结束。普通用户仍显示简短提示，只有服务器认定的TapTap专用测试账号可看到错误诊断弹窗。补给奖励条件不变。

类型检查及7项音频/广告适配检查通过，包括加载失败、展示失败、脱敏和失败后重试。最新122张缩略图、补给预加载、金币音效保留。未修改服务器、相册或玩家数据。实际广告错误原因尚未确认，不能宣称已修复。

证据与上传记录：work/taptap-ad-errors-20261020/；官方网页快照：work/taptap-ad-diagnosis-20261020/。

## 真机回报：1003（2026-10-20）

用户在诊断包中返回截图：推广位1071218，加载失败，errCode=1003，RewardedVideoAd:fail 内部错误，并附adnMsg追踪信息。说明已进入TapTap广告加载，尚未触发领奖。未从截图推断媒体审核、测试设备或广告位ID错误。

实时核对官方https://developer.taptap.cn/minigameapidoc/dev/api/ad/RewardedVideoAd.onError/：1003定义为内部错误，文档说明不是开发者异常情况，通常稍后可恢复；1002才是广告单元无效，1004为无适合广告，1005为审核中。若持续出现，应携带媒体1112148、推广位1071218、小游戏963283和原始截图中的追踪信息向平台排查。没有代用户发送工单。

排查结论：当前证据指向平台/SDK加载内部错误，不是游戏奖励发放失败；等待稍后重试或平台排查，尚未宣称解决。截图中完整内部追踪串不复制到普通日志。

## 当前送审包核对（2026-10-20）

官方只读查询：app get-app-version返回V-20261020状态reviewing，revision/version_id=1109864；app list-packages.current_bindings返回同一revision=1109864的main package_id=334339。因此当前送审为带广告领取+缩略图版本334339。334435诊断包不在当前main绑定。

list-h5-packages中的330481 is_releasing=true不是本次审核绑定证据，不能据此判断当前送审为旧分享包。未撤审、更换绑定或发布。

普通Web可用模拟广告回调及隔离后端验证发奖、取消、重试和上限，不能复现TapTap宿主原生SDK的真实广告请求/1003。真广告需TapTap设备环境。建议广告未真机稳定验证前采用分享领取保底或暂缓发布，但本轮仅咨询，未擅自修改审核/发布状态。

## 2026-10-21 隔离服复测准备

用户授权开始复测广告、定位原因。当前独立包338410使用/h5-tap-preview，原来此服务adRewardEnabled=false、广告位空、诊断账号0，所以显示“广告暂未开放”发生在请求SDK前，不能当作1003复现。

仅在隔离测试服务环境中启用H5_AD_ASSISTANCE_ENABLED=true、H5_REWARDED_AD_UNIT=1071218，并配置一个现有已绑定TapTap测试账号“老头”用于现有错误诊断。预检发现测试房owner是服务预建账号、未绑定TapTap，因此没有把它误设为诊断账号；预检断言在任何修改前停止，随后以用户此前截图中的真实测试账号唯一匹配并成功配置。未扩大到全部账号。

只更新/etc/webapps/jigsaw-tap-preview.env这三项，原环境备份仅保存在服务器受限目录/srv/sites/jigsaw-tap-preview/shared/operations/20261021-ad-retest/environment.before，未复制到本地。重启jigsaw-tap-preview.service，继续使用20261021-recovery-v1代码与原数据库；健康和公网/config回读广告已启用、广告位1071218、分享备用入口保留。正式Web及正式手机服务配置、发布路径保持一致，未改玩家、库存或房间记录。

338410客户端已有按创建/加载/展示阶段记录错误码并对测试账号显示诊断的逻辑，无需新包。14项现有音频/广告/补给相关检查通过，涵盖失败和提前关闭不发奖、库存限制、重试收据不重播广告、错误脱敏等。没有改源码，未重复整库或画面检查。

2026-10-21重新核对官方文档：RewardedVideoAd.onError仍将1003解释为内部错误，1002为广告单元无效，1004为无合适广告，1005为审核中。现有客户端调用tap.createRewardedVideoAd({adUnitId})、等待load后show，并以onClose.isEnded===true作为完播条件，与当前小游戏文档相符；这不能证明平台媒体归属或真机SDK无故障。

下一步：账号“老头”完全退出后扫描338410、进入补给站主动点看广告；失败时需真机完整诊断截图，包括阶段、错误码、说明。若库存已满3份，先正常使用一份已有体力包再测试，不人为改库存。当前尚未收到本轮原生广告调用结果，1003根因仍未确认，不能将开关恢复或模拟检查当作真广告已修复。证据目录work/taptap-ad-retest-20261021。

## 2026-10-21 原生复测结果与子错误码补全

用户提供338410真机诊断截图，推广位1071218、加载失败、errCode=1003，说明包含“RewardedVideoAd:fail 内部错误adn[已隐藏], adnMsg=…”追踪串。已确认恢复开关后仍可复现加载阶段1003；未进入展示或成功发奖。完整追踪串保留在用户原截图，没有复制进普通日志，也未代用户发工单。

诊断代码的凭证脱敏正则将任何末尾为code=的字段一并遮挡，因而误遮了adnCode；仅凭顶层1003无法继续区分平台子原因。本轮先从结构化adnCode或errMsg中的adnCode=提取限定长度的整数，单独显示在错误摘要中，随后对原说明沿用凭证脱敏。没有放开登录code、token或secret，也不递归输出任意错误字段。提取放在说明截断之前，避免长追踪串挤掉有用子码。

模拟检查涵盖字符串内adnCode及结构化adnCode提取、登录code和token仍脱敏、加载/展示阶段区分、失败后重试与完整观看。与补给和Web尺寸合并检查共17项通过，TypeScript通过，包内241图片解码及248文件ZIP校验通过。客户端仅增量修改诊断，不调整广告SDK调用顺序、媒体初始化或发奖条件；尚未确定1003根因。

诊断增强包产物和回执在work/taptap-ad-detail-20261021，继续使用已启用的隔离服与账号“老头”。下一步以新包重试一次，收集adnCode；再按子码核对平台媒体/广告位归属、审核或填充等具体方向。新增Web每日图问题已单独修复，见2026-10-21-web-daily-dimensions.md。

诊断增强包实际上传版本 **338457**，包ID **102767**；官方列表回读is_releasing=false，上传回执boundMainPackage=false。二维码releases/taptap-test-338457.png，ZIP SHA256为ed58a3d1eebbd382a03757ff86fc010516a6ad9aa00399bf4dc353bbdfc1b850。上传后源码摘要一致，未更换正式主包或发布；本轮子码真机截图待用户回传。

## 338457真机结果：1003 / adnCode 200001

用户新截图显示推广位1071218、加载失败、顶层1003、adnCode=200001。补全诊断已生效。200001在当前官方Android聚合文档中为广告加载失败的通用项，可包含请求、配置或流程异常；自研AD SDK错误表不直接列出该码，不同版本/端的错误码不能直接混用。因此此子码尚不能证明“无填充”、审核拦截或某个具体网络错误。保留原截图中的请求追踪信息供平台定位，未复制完整追踪串或代发工单。

本轮通过Edge现有已登录SSP页面只读核对：媒体1112148“拼图小窝”开关开启、应用类型“小游戏”、系统Android、媒体属性正式、状态审核中；推广位1071218开关开启、激励视频模板渲染、状态测试中、属性测试、列表“用于第三方聚合”为是。所属媒体ID与当前代码广告位对应，尚未证明聚合字段是否影响小游戏宿主，未擅自改成正式或调整该字段。

测试工具在无筛选状态下为0条设备。“新建测试设备”未提交表单显示Android、设备ID类型默认OAID，必填设备ID，说明完成新建后预计5分钟可预览。官方接入流程建议使用测试工具做预览与调试；未把未登记设备或媒体审核中直接断言为200001根因。

用户补充本次测试机为OPPO Reno 14 Pro，目前尚无OAID。下一步获取这台手机的OAID并完成测试设备登记，再比较是否仍报200001；登记前不进行重复刷广告或继续更换包。后台表单已打开但未保存。普通设置未必直接显示OAID，可先搜索“设备标识与广告”查看；没有明确OAID时不能将IMEI、Android ID或请求追踪串冒充OAID，也不要求重置设备标识或安装来源不明工具。若完成设备登记后仍失败，需就审核中媒体的测试资格和完整请求标识请平台确认。此轮未改源码、服务端环境、媒体或推广位配置。

### IMEI类型对照登记

用户提供Reno 14 Pro状态页，显示IMEI及序列号而非OAID，询问能否使用。本轮实际展开后台设备标识下拉，确认有OAID和IMEI两个独立选项；此前只看到默认OAID，不能据此断言只支持OAID。

沿用本轮广告复测和设备登记范围，用截图中的IMEI 1按明确的IMEI类型登记，媒体1112148、推广位1071218、Android、随机测试预算，备注为OPPO Reno 14 Pro广告自测IMEI对照。提交后回读列表为1条、开关开启，平台显示失效时间2026-10-23 02:53:42。没有把IMEI冒充OAID，也没有改广告位、媒体审核状态或正式发布设置。完整设备号不复制到文档或普通记录。

这只证明平台接受并启用了测试登记，不证明手机广告请求可携带IMEI并匹配该记录。新版Android/SDK存在读不到或不使用IMEI的情况，因此仍需等待平台说明的约5分钟后，用338457完全退出重进复测一次；若仍200001，不能将此结果当作已经排除设备测试匹配问题。OAID路线和平台追踪排查仍保留。登记截图仅截取媒体、推广位、系统和备注等列，不含设备号：work/taptap-ad-retest-20261021/imei-test-device.png。

### IMEI登记后错误未变：复核结果与平台排查资料

用户再次反馈“错误没变化”，按前次338457结果延续记录为加载失败1003/adnCode 200001；本次没有收到新的完整错误截图，不能断言请求追踪ID相同。

本轮只读打开媒体编辑表单，等待异步数据完成后确认：媒体1112148为正式媒体，应用类型“小游戏”，系统明确是“Tap 小游戏”，关联“拼图小窝 963283”；媒体列表状态仍“审核中”。初始未加载完的表单默认值不作为判断依据。已取消编辑，没有提交变更。推广位沿用此前已核实的1071218、开启、测试属性。

TapTap开发者中心“开放能力→广告变现”实际加载后进入“小游戏广告”页面，显示余额、每日预估及接入文档，没有显示待申请开通按钮。导航过程中短暂显示的“敬请期待”是过渡页面，不能当成广告功能未开放的证据；有收益页面也不能证明某次原生请求已获准或配置已下发。

重新阅读官方资料：
- https://developer.taptap.cn/minigameapidoc/quick-start/monetization/IAA-game/ 建议测试工具保障测试展示，正式广告位需审核；没有明确解释“正式媒体审核中+测试推广位”是否可出测试广告。
- https://ssp.dirichlet.cn/docs/faq/ 指出第三方聚合的Android设备ID回传使用OAID，未回传设备ID不参竞。该说明不直接证明本次Tap宿主请求缺OAID。
- https://ssp.dirichlet.cn/docs/dirichlet-sdk/sdk-guide/ 当前版本说明ADN不采集或转发IMEI；TapTap宿主实际版本未确认，因此IMEI登记不能证明匹配成功。
- https://developer.taptap.cn/minigameapidoc/dev/api/ad/tap.createRewardedVideoAd/ 仍要求adUnitId；现有小游戏接口路径有官方依据，未注入Android原生初始化代码或媒体密钥。

现阶段没有确定的代码修复依据。保留338457及分享备用入口，不盲目换包、转正式或重复登记设备。下一步需要平台根据原截图内请求标识核对服务端链路，或获得实际OAID后验证测试设备匹配。未代发工单。

可供平台排查的摘要（尚未发送）：小游戏拼图小窝963283；媒体1112148，Tap小游戏，正式媒体审核中；激励视频测试推广位1071218，开关开启；自测包338457；设备OPPO Reno 14 Pro；tap.createRewardedVideoAd({adUnitId:'1071218'})加载失败，errCode=1003、adnCode=200001；IMEI类型测试登记已启用，约5分钟后用户反馈错误未变。请协助核对：(1)该媒体审核状态是否允许测试流量；(2)原截图请求是否命中测试设备、实际使用何种设备标识；(3)推广位用于第三方聚合的设置与Tap小游戏宿主是否兼容；(4)请求对应的底层失败原因。请求追踪串见用户原始错误截图，需要提交时单独附图；本文件不含完整设备号、密钥或追踪串。

### 用户决定搁置广告并准备正常审核包

后续用户明确搁置排障。正式手机版服务在20261021-review-platform-v1版本将H5_AD_ASSISTANCE_ENABLED关闭，正常新包体力包主入口改为分享；独立广告诊断服不变。广告根因未解决，没有向平台发送工单。正式包及后端交付见2026-10-21-taptap-review-release.md。


## 2026-10-21 媒体运行中后恢复指定账号观看测试

用户反馈Dirichlet审核完成并要求给“老头”账号广告观看按钮。本轮只读后台确认媒体1112148“拼图小窝”为运行中、正式媒体、开启；推广位1071218仍为开启、激励视频、测试属性、测试中。没有转正式或改媒体/推广位设置，不能仅凭媒体过审判定此前1003/adnCode200001已消失。

只读正式服务器当前版本20261021-review-platform-v1，唯一绑定昵称“老头”已在MOBILE_DIAGNOSTIC_ACCOUNT_IDS白名单中，名单1个；广告全局仍关闭，配置广告位1071218。因此不修改后端或全局开关，直接复用服务端返回的taptap.bound=true和diagnostics=true显示“大厅头像→设置→广告观看测试”。入口和动作均检查平台为TapTap且为服务端白名单账号；不以可改昵称授权，不开放给普通玩家。

测试按钮调用已有tap.createRewardedVideoAd加载/展示/关闭/清理链路，采用服务配置的1071218，不受补给库存和全局发奖开关影响；不申请奖励凭证、不发金币或体力、不调用玩家写接口。结果提示区分完整观看、提前关闭、失败，保留安全的阶段/错误码/adnCode诊断。分享领体力入口继续保留。

验证：42项聚焦检查通过，覆盖满库存+全局广告关闭仍可测试、普通账号/未绑定/其他平台被拒绝、完整观看和提前关闭/失败均不发奖、实际设置按钮调用。浏览器使用模拟广告对象验证加载、展示、完整观看回调和结果提示，不能当成真实广告展示。截图work/taptap-consent-ad-20261021/ad-entry-synthetic.png。同包修复授权色块问题；需用户扫码点击真实测试入口，记录是否仍1003/adnCode200001。


公开正式配置再次实读adRewardEnabled=false、rewardedAdUnitId为空、shareRewards=true：网关暂停广告时会隐藏广告位，不是环境内没有配置。诊断按钮在服务未下发编号时明确使用用户指定的公开测试推广位1071218；全局广告仍关闭。42项检查包含该空编号情况，实际设置点击与四种观看结果均不调用奖励接口。构建中间版本341650尚未包含空编号兜底，不作为本轮最终交付。

最终实际game.js额外通过模拟原生广告对象：公开配置广告关闭且推广位编号空时仍调用1071218，完成load/show/onClose流程，只显示测试结果；玩家资料和API请求数均保持不变。此检查验证打包代码路径，不代表真实广告可用。

最终独立自测包 **341682**，上传包ID **104156**；boundMainPackage=false、列表is_releasing=false，草稿主包回读仍338539/revision1109864。归档releases/jigsaw-nook-taptap-20261021-consent-ad-retest-v2.zip，88,989,488字节，SHA256 c521f03e55a4fe9a960d6fff9c724fe920a4c1507317b433a4c927feef3d4481，二维码releases/taptap-test-341682.png。上传后59个构建输入及ZIP摘要一致。只上传自测包，未提审或发布。手机透明原生按钮与真实广告结果待用户复测。


## 2026-10-21 推广位是否应转正式：官方规则核对

用户反馈341682广告仍报之前的错误，并提供1071218仍为测试中/测试属性截图，询问是否要转正式；本轮没有收到新的完整错误弹窗，不将当前截图当作新1003/200001追踪记录。

当日重新读取TapTap IAA指南：https://developer.taptap.cn/minigameapidoc/quick-start/monetization/IAA-game/ ，开发测试建议配置测试工具保障测试推广位展示；正式广告位需单独提交Dirichlet审核，通过后正常展示。Dirichlet接入流程 https://ssp.dirichlet.cn/docs/ssp-guide/ 明确推广位从测试转正式时会审核，上线前媒体及推广位都应为正式且开启，否则无收益。因此媒体运行中不等于推广位已过正式审核，正式投放确实还需将推广位转正式并审核。

测试推广位本来可通过测试工具预览，故“测试中”本身不能证明是本次失败根因。此前仅IMEI对照登记成功，未证实宿主匹配到测试设备；FAQ对第三方聚合明确使用Android OAID，Android SDK文档说明当前不采集/转发IMEI，依然不能把该登记当作OAID匹配证据。转正式是正常投放的下一步及可做的对照，不保证解决加载失败；审核后再用老头专用入口真机复测，若仍失败需平台按新请求标识定位。

本轮只核对规则并给建议，没有改媒体、推广位或测试设备，没有提审、发布、改游戏代码或全局广告开关。若原推广位转正式后编号仍1071218，现有341682诊断入口无需因属性变化重打包；若新建得到不同编号，必须同步更新测试入口/配置。


## 2026-10-21 对照用户指定的小游戏激励视频教程

用户确认仍使用测试推广位、尚未用正式推广位，询问当前方法是否对应 https://developer.taptap.cn/minigameapidoc/dev/tutorial/open-capabilities/ad/rewarded-video-ad/ 。本轮实际重读该教程及createRewardedVideoAd/load/show/onLoad API，核对341682构建回执：mobile/platform-web.ts与当时构建输入摘要相同，ZIP也与上传回执一致，不把其他分支实现当作用户包代码。

一致部分：tap.createRewardedVideoAd({adUnitId:'1071218'})、load/show Promise、onError/onClose监听、仅isEnded严格为true才视为完整观看；小游戏使用宿主tap广告接口，不需要客户端接Android AAR或嵌入媒体密钥。

区别：教程说明创建后自动拉取、注册onLoad，完整示例先show，失败后load再show；341682在用户点击后创建或复用实例、注册onClose/onError，主动先load再show，没有onLoad就绪状态，失败清理后销毁重建，并附180秒回调保护。load→show本身有官方API依据，不能单凭不同顺序断言错误；但创建自动加载与主动load、错误后重建等封装差异尚未通过真机对照排除，不能声称已经完全照抄官方示例，也不能把1003/200001确定归给平台。

开发测试位仍可通过测试工具预览；转正式是正式投放步骤，不是已经证实能修复当前错误的方法。更有价值的下一步是采用教程相同的最小生命周期作对照，保留单例、onLoad/onError/onClose、show失败后load/show，核对实际阶段与宿主返回。该项是建议，本轮没有改代码、再打包、改推广位或提审。


## 2026-10-21 新增指定账号插屏测试1071588

用户新增插屏测试推广位1071588，要求提供测试按钮。新增“大厅头像→设置→插屏广告测试”，与原激励视频测试并列，仅服务端返回taptap.bound=true且diagnostics=true的TapTap账号可见和调用，延续已核实的“老头”唯一诊断账号范围。没有增加自动插屏触发、没有修改全局广告开关或后端、没有发放金币/体力或调用奖励接口，原激励视频实现保留。

读取官方插屏教程 https://developer.taptap.cn/minigameapidoc/dev/tutorial/open-capabilities/ad/interstitial-ad/ 和创建API https://developer.taptap.cn/minigameapidoc/dev/api/ad/tap.createInterstitialAd/ ：创建后自动拉取、onLoad完成后show、onError区分加载/展示阶段、onClose恢复界面；每次创建新实例，用完后destroy。新增mobile/tap-interstitial.ts封装手动创建、加载回调、展示确认与关闭、超时、监听移除和释放；与激励视频共享并发互斥及广告期间音效暂停，安全诊断复用现有脱敏规则。成功必须实际show成功并收到close，不将创建或加载成功当作广告显示成功。

27项聚焦检查通过，TypeScript通过。最终game.js使用模拟SDK验证1071588、只在手动动作创建、加载完成才展示、关闭后清理，错误1003/adnCode200001保留且token说明脱敏，所有场景不更改玩家数据或API请求数；激励测试及一次点击协议授权烟测保留。浏览器393×851模拟宿主实际查看设置两个按钮，截图work/taptap-interstitial-20261021/settings-synthetic.png。242张图片解码、249个文件ZIP校验通过，保留122缩略图/115拼图图片。模拟结果不等于手机真实广告填充成功。

构建标记20261021-INTERSTITIAL-TEST，正式API /h5-mobile-v3，development=false，无自动入测试房。只上传独立自测包；当前正式主包338539/revision1109864保持不动。真实手机应点击新按钮一次，核对是否展示或把阶段/错误码截图反馈；不要求先把推广位切正式。

实际上传独立自测版本 **341833**，上传包ID **104224**。归档releases/jigsaw-nook-taptap-20261021-interstitial-test.zip，88,990,046字节，SHA256 6b54633e9ecb89505d43cce28c0a8c4a02cec0433b72952edf3d62436d8f4411。二维码releases/taptap-test-341833.png。官方boundMainPackage=false、is_releasing=false，主包仍338539；上传后60个构建输入及ZIP摘要一致。未提审、未发布，等待真机插屏测试结果。


## 2026-10-21 插屏真机返回100：jsapi not supported

用户反馈341833真机截图：推广位1071588，插屏自动加载失败，错误码100，完整关键说明“InterstitialAd:fail jsapi not supported”。本次不同于此前激励视频1071218的1003/adnCode200001，应分开定位。错误来自宿主对该插屏调用的不支持；客户端JS方法存在并不能证明底层原生接口可用，也不能当成普通无填充或归因于测试推广位。将推广位改为正式不是该错误已有证据支持的修复。

本轮重读官方createInterstitialAd及InterstitialAd API：文档列出创建、加载、展示和回调接口，但页面没有最低TapTap版本/基础库要求；对精确错误的官方检索未找到可靠对应说明。当前可确认“本次宿主返回不支持”，不能进一步断言TapTap所有客户端均不支持、明确某版本升级可修复，或激励视频同样不支持。后续需测试手机TapTap客户端版本与基础库/运行入口，由平台确认该组合是否实现或开放H5插屏API。已询问测试手机TapTap版本；尚未收到。

本轮没有改代码、推广位、后端或再次上传包，不以更换广告位代替宿主能力确认；没有代发平台消息。保留现有341833独立测试包。


补充核对：官方InterstitialAd.onError页列出1000后端失败、1002广告位无效、1003内部错误、1004无合适广告、1005审核中等，没有列出当前码100；判断应优先依据宿主明确的jsapi not supported说明。新官方广告接入指南 https://developer.taptap.cn/minigameapidoc/quick-start/mcp-guide/ad-integration-guide/ 将“星火/H5小游戏/TapTap制造”放在开发者中心广告变现路径，将“Tap小游戏/APK”指向Dirichlet；与此前通用IAA指南/Dirichlet小游戏指南的表述需要区分适用范围。项目当前上传的是H5包，因此还需核对当前H5宿主支持及对应广告接入路径，不能仅凭Dirichlet媒体运行中判定接入路径正确或直接迁移配置。官方CLI当前app命令未提供广告状态查询，未绕过限制调用未公布接口。本轮只读取官方文档/CLI帮助，不更改任何后台或包体。


## 2026-10-21 管理后台账号是否必须作为广告测试玩家

用户称TapTap已是最新版（未给具体客户端/基础库版本字符串），提出改用登录Dirichlet后台的TapTap账号做测试。所给号码按用户明确描述视为TapTap用户ID，不擅自当成游戏内玩家编号、OAID或IMEI，也不据此更改诊断白名单。

本轮实际另开临时页面只读核对测试工具：当前共有4条启用记录（3条OAID、1条IMEI），均关联媒体1112148的激励推广位1071218；未见插屏1071588登记。新建测试信息表单的Android设备ID下拉只有OAID、IMEI，没有TapTap用户ID选项；表单未填写或提交，临时页面关闭，原用户操作页面保持原处。不要继续沿用此前“只有IMEI登记”的旧快照，也不把新增OAID登记直接当作手机真实请求已匹配的证明。本文件不保存设备号。

重读Dirichlet接入流程/FAQ，只找到管理后台主体与游戏开发主体对应、以及测试工具预览/设备识别要求，未找到要求观看广告的玩家必须是后台管理员同一TapTap账号的规定。因此换该账号可作为同机同包对照，不能据此认定会修复激励加载失败或插屏jsapi not supported。现有广告按钮仅对“老头”的服务端诊断身份开放；若用户决定换号测试，应先由该号进入游戏并提供设置里的游戏玩家ID，再明确开放该账号的广告测试入口，不将TapTap用户ID直接写入账号白名单。

本轮没有更改测试设备、推广位、游戏账号权限、服务或包体，没有对外发送消息。


## 2026-10-21 用户纠正848455066为游戏玩家ID并开放同账号测试入口

用户明确纠正848455066为游戏内看到的玩家ID，撤回前节将其直接理解为TapTap用户ID的假设。只读查询正式服未找到该编号，随后在旧独立测试服/h5-tap-preview的mobile_social_players中唯一找到该编号；通过现有mobile_taptap_sessions解析别名及mobile_taptap_accounts的provider_key匹配，确认同一已绑定TapTap账号在当前/h5-mobile-v3服务的玩家编号为369587920，昵称“大狗 叫”。按绑定身份精确匹配，没有按昵称猜测身份或复制旧测试服的存档。

用户沿用换此账号测试广告的请求，本轮仅向当前手机版服务的既有诊断账号名单追加对应canonical identity，原老头身份保留，名单从1个变为2个。只修改/etc/webapps/jigsaw-mobile-v3.env的MOBILE_DIAGNOSTIC_ACCOUNT_IDS，其他配置逐行一致；原环境只备份在服务器受限目录/srv/sites/jigsaw-mobile-v3/shared/operations/20261021-ad-account-848455066/environment.before，未下载。重启jigsaw-mobile-v3.service并检查健康、公开配置与当前release均保持；运行进程环境回读确认已加载两账号名单。无玩家数据库写入、无包体变更、全服广告仍关闭。

现有341833自测包重新进入/刷新账号资料后，可在该账号“头像→设置”看到激励观看及插屏测试入口。旧测试服编号848455066未迁移或重写，当前服编号369587920亦未改变；不要因两套服务编号不同清空或合并账号。广告能否展示仍待用户同机同包换号对照，不把开通入口当作广告故障已修复。证据work/taptap-account-848455066-20261021/enable.json，仅保存安全结果，未保存平台身份摘要或完整环境。


## 2026-10-21 游戏内能否读取IMEI/OAID用于测试设备核对

用户怀疑设备标识填写不准确，并询问能否在游戏加入获取IMEI和OAID功能。本轮查阅公开TapTap小游戏设备API：getDeviceInfo返回品牌、型号、系统、平台、ABI、内存等；getSystemInfoSync还提供TapTap版本与tapSDKVersion，但都没有IMEI或OAID字段。站内针对OAID/IMEI检索未发现可供当前H5游戏调用的公开读取接口。TapTap小游戏行为规范第三章明确禁止小游戏收集IMEI、MAC地址。因此当前H5不能直接实现有可靠公开接口依据的两项读取功能，不能把Android原生AAR的能力当成H5可调用能力。

来源：https://developer.taptap.cn/minigameapidoc/dev/api/base/system/tap.getDeviceInfo/ 、 https://developer.taptap.cn/minigameapidoc/dev/api/base/system/tap.getSystemInfoSync/ 、 https://developer.taptap.cn/minigameapidoc/tap-operation/operation-standards/behavior-standards/ 。本轮Dirichlet原生SDK指南访问超时，未将本轮超时页面当作新增SDK能力证据。

设备登记不匹配可能导致测试流量未命中，但未证实实际请求收到的OAID以及匹配情况；广告SDK可能持有设备标识不等于会暴露给H5。应由平台结合失败请求核对实际收到的OAID与后台测试记录，不能仅靠数值外观、游戏玩家ID或另一个设备标识证明匹配。插屏100/jsapi not supported与设备号是否正确仍需分开处理。

本轮仅作能力核对并记录结论，没有添加虚构读取API、额外设备标识采集、修改隐私/权限、设备登记或再次打包。可供后续完善的诊断仅限真实公开设备信息、TapTap/基础库版本与接口结果；这些不代替OAID。


## 2026-10-21 真机调试准备

用户提供官方真机调试指南 https://developer.taptap.cn/minigameapidoc/dev/dev-support/debugging/ 并要求尝试。本轮读取全文确认两条路径：VS Code插件需打开代码包根目录并填写端口/小游戏ID/名称，同局域网扫码；也可直接用现有上传测试包，通过Android USB+Chrome DevTools调试，无须先安装插件。Android插件扫码要求TapTap 2.83.2+；测试包扫码要求2.83.0+。开发者账号默认具有小游戏测试权限，其他账号需后台设置自测用户，此权限不同于Dirichlet设备广告测试资格。

当前电脑已有Google Chrome及Android SDK platform-tools 37.0.0，adb.exe位置%LOCALAPPDATA%/Android/Sdk/platform-tools/adb.exe；adb不在PATH，使用绝对路径。已启动本机ADB服务并执行devices，目前没有连接设备，未与任何手机建立调试连接。没有安装VS Code插件或改全局PATH，没有开放局域网调试服务/防火墙。

准备脚本scripts/taptap-device-debug.ps1：只在找到唯一已授权设备或显式指定设备时建立adb forward tcp:9229 tcp:9229；保留其他已有转发，可用-Disconnect移除本次端口。已通过PowerShell语法及无设备分支检查，真实端口建立和DevTools连接尚未验证。

连接步骤：
1. 手机通过可传数据的USB线连接电脑，在开发者选项开启USB调试，并由用户在手机允许电脑调试；当前等待用户完成。
2. 运行scripts/taptap-device-debug.ps1，确认9229转发。
3. TapTap打开341833测试包，右上角菜单→开发调试→打开调试；重新进入游戏。
4. Chrome进入chrome://inspect/#devices，找到游戏容器并点inspect；如只有设备没有目标，先确认手机已开调试并重进，不直接断言H5不适用。
5. 只复现一次激励/插屏按钮，核对当前TapTap/基础库版本、对应API及脱敏错误阶段；不把完整localStorage、code/token、IMEI/OAID或原始含凭证网络请求导出为普通日志。
6. 完成后移除9229转发，在手机关闭游戏开发调试；USB授权由用户按需撤销。

该方式可读取真实运行上下文，但不保证获取OAID/IMEI，也不代表平台会开放原本不支持的插屏API。本轮尚未接通手机，不标记“真机调试完成”。


### 手机已连接：USB转发就绪，等待人工打开Chrome内部调试页

用户开启USB与WLAN调试后，ADB实际检测到一台已授权PKZ110设备，USB状态device；按官方建立并回读9229→9229转发。读取TapTap包信息确认versionName=2.96.14-rel#100300、versionCode=296141003；没有配对或新增WLAN连接，未读取设备标识。设备已有WebView调试socket，但未据此宣称已连接到游戏页面。

尝试用浏览器工具打开chrome://inspect/#devices时，被浏览器安全策略拒绝：仅允许http/https，明确禁止改走间接打开、其他浏览器表面或原始CDP绕过。因此没有用shell启动Chrome、改代理或直接连调试端点规避策略。已请用户手动打开此内部页面，并在手机341833菜单开启开发调试后重新进入，反馈是否出现游戏与inspect按钮。当前只有USB链路和端口转发已验证，DevTools游戏连接与广告调试仍待完成。调试期间保留9229转发，结束后用脚本-Disconnect移除。


### 用户反馈H5自测菜单没有开发调试

用户实际341833右上菜单没有“开发调试”，因此纠正此前按通用指南承诺必有该菜单的说法。没有要求反复找菜单、重装TapTap或重新授权。官方开发者agents入口把Tap小游戏的真机调试指南与H5部署/SDK路径分开；不能由教程存在推定当前H5容器必有相同菜单。USB授权、TapTap实际版本和ADB转发已经确认，菜单缺失不等于这些步骤失败。

下一步先由用户在电脑手动打开chrome://inspect/#devices查看当前USB设备下是否已有游戏网页目标；此前只发现WebView调试socket，并未确认其所属就是游戏，故只能根据可见标题/URL判断。继续遵守此前浏览器内部地址策略拒绝，不直接连接调试socket或用原始CDP绕过。若Chrome仅显示设备而无游戏页面，则当前远程网页调试尚未打通，应另核对H5官方调试能力，不继续把USB状态当作DevTools已连通。


## 2026-10-21 远程Console读回激励错误与H5官方广告位复核

用户通过手动DevTools表达式返回1071218的“加载失败”，errCode1003、adnCode200001；说明未进入show，不将Console能读取诊断当作广告成功。adnMsg带平台追踪信息及编码片段，可能包含设备标识；不将完整字符串复制到文档、不当作OAID登记，也不解码后输出设备值。仍不能由此确定后台测试设备是否匹配。

重新定位当前项目官方历史回执work/taptap-connection/latest-check_ads_status.json及config/taptap-game.json：当时所选app963283的H5官方广告能力为已生效、匹配广告位1054324；现有诊断包测试的是手建Dirichlet位1071218。此为历史可核查差异，不是当前官方状态，不直接换位或改后端。

本轮尝试恢复官方H5 MCP只读查询：work/taptap-tools的依赖目录已缺失，按原package.json固定依赖恢复@taptap/instant-games-open-mcp 1.24.14，ignore-scripts，未修改游戏业务代码。官方get_current_app_info返回未选择应用，list_developers_and_apps返回缺少认证；CLI会话不能替代H5 MCP授权。启动独立本地官方工具通道work/taptap-h5-ad-recheck-20261021/channel.mjs，生成2分钟有效授权二维码，等待用户扫码后complete_oauth_authorization，再仅选择已明确的developer485306/app963283并读取check_ads_status/指南。没有提交、发布、修改媒体/推广位或全局广告配置。调试页访问继续由用户操作，不绕过Chrome内部页策略。

### 官方重新授权完成：当前H5匹配广告位仍为1054324

用户确认“已授权”后，官方complete_oauth_authorization成功；选择developer485306/app963283，并由get_current_app_info强制实时刷新确认当前为“拼图小窝”、miniapp tapmcln4cmjeaus1ft。check_ads_status实时返回广告“已生效”、竖屏、匹配广告位1054324；get_ad_integration_guide同样将1054324写入示例。这次不是沿用旧缓存，安全回执位于work/taptap-h5-ad-recheck-20261021/channel/result-a1000004.json、result-a1000005.json、result-a1000006.json。

当前341833测试按钮使用1071218，与官方H5匹配位不同；差异值得优先同机同包对照，但尚未证明它就是1003/adnCode200001的根因。现有适配器watchAd接受广告位参数，因此可在用户手动打开的真机Console执行 `await window.__JIGSAW_SHARED__.client.platform.watchAd('1054324')`，失败后读取 `window.__JIGSAW_SHARED__.client.platform.adDiagnostics()`。此调用只测试观看、不调用奖励接口，也不修改服务端配置；结果待用户反馈。不要收集或转存完整原始adnMsg。

官方指南建议启动预加载、show失败后load再重试一次；当前代码为load后show，两者生命周期尚不完全一致。先只改变广告位做对照，避免同时改生命周期而无法区分原因。本轮未更改游戏代码、全局广告开关、正式推广位或审核包，未提交审核或发布。插屏宿主不支持问题仍单独保留，不能由激励位匹配推定插屏已支持。

### 真机对照成功并按用户要求启用正式体力包广告

用户反馈1054324正常、可以打开。随后明确要求使用官方默认方式，在补满体力包位置增加广告领取、保留分享；正式服务已切到1054324并开启广告，分享和平台同步保持开启。当前341833双入口随重新进入加载配置生效，不需新包。源代码诊断备用位同步为1054324。完整操作、验证与剩余真机领奖边界见[广告体力包记录](2026-10-20-taptap-ad-energy.md#2026-10-21-改用官方h5广告位并恢复双入口)。这次未修改或测试插屏支持，不能将激励恢复推广为插屏恢复。
