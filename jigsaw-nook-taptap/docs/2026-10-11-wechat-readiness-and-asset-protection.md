# 微信小游戏接入准备与素材保护核查

核查日期：2026-10-11，接入实施前基线。范围：当时独立手机项目 jigsaw-nook-taptap 的源码、素材来源记录、交付图片及公开官方资料。该次核查没有提交备案、上传代码、修改游戏或给图片加水印；原 PC 项目没有改动。

后续已开始共享 Canvas / 微信接入并部署独立手机后端，最新运行、截图和上传状态统一见[微信小游戏接入状态](./2026-10-11-wechat-integration-status.md)。本文保留核查时的事实和素材待办；“没有微信入口”等实施前描述不代表后续接入状态。

这是接入准备核查，不代表平台审核结论或完成全项目法律清权。本次未进行全面安全测试、全部图片逐张复审或线上容量验收。

## 1. 备案顺序：后台页面仍需截图核对

已在 Edge 标签列表找到微信小游戏前置备案页面，但浏览器安全策略禁止读取该页面。没有通过其他浏览器、接口或命令绕过。此文不保存后台登录 token。

微信公开接入指南和运营规范本次未能取得可读正文，因此“必须先上传并通过版本审核，再备案”不能作为本轮已核实结论。若用户后台明确要求选择已上传的游戏版本，下一步就是先准备可运行的微信开发版本并按提示上传；这不等同于先公开上线，也不等于已经获准运营。是否还需通过某项版本审核，应以该账号页面原文为准。

需要用户提供：当前备案页的步骤、游戏版本选择栏和提示文字截图；身份证号、电话、AppSecret等无需提供。

## 2. 实施前包体基线

当前是 TapTap H5 工程，依赖 React DOM、HTML/CSS 和浏览器接口。构建输出 index.html 与 H5 ZIP。已检查的入口和构建目录没有发现微信 game.js/game.json/project.config.json 或微信平台适配。

- h5/main.tsx:3、48：React DOM 页面入口。
- scripts/build-h5.mjs:33：H5 打包。
- h5/ads.ts:19：TapTap 激励视频广告接口。

现有 ZIP 不能直接当作微信小游戏包提交。需要增加微信端的运行入口、界面/渲染适配、平台身份、网络与资源加载、分享及广告适配；不是换个 AppID 就完成。

微信[官方小游戏示例](https://github.com/wechat-miniprogram/minigame-demo)使用开发者工具和小游戏 AppID，示例入口包含 game.js / game.json。这里依据官方示例与本地工程差异判断，未冒称已经验证当前工程在微信可运行。

可以复用拼图规则、素材目录、服务端房间和奖励逻辑，不必推倒后端重写。微信端与 TapTap 是否共享玩家和房间尚未决定；此前“PC 与手机独立”的决定继续保留，不自动改回互通。

## 3. 实施前列出的上传及运营待办

下表是原始核查清单。运行入口、网络服务等实施进展见上方状态文档；素材、隐私及平台规则待办不能仅因代码已适配而标记完成。

| 优先级 | 代码中的事实 | 建议 |
| --- | --- | --- |
| 上传前 | 没有微信运行入口/平台适配 | 制作微信可运行包并完成真机核心流程检查，再进入上传流程 |
| 高优先级 | 发邀请或复制链接即奖20体力+10经验，每日3次 | 微信版不直接照搬；先核对当前微信对分享奖励的规则。保留自主邀请，同房协作任务改为依据实际游戏贡献，并核查其规则适用性 |
| 高优先级 | 35张提供图只有本站展示游玩的简略授权记录 | 补原作者/生成来源、提供者权利依据与微信/TapTap广告变现、修改及分发范围；记录缺失不直接等于侵权 |
| 上线前 | 隐私说明仍写TapTap；未发现资料删除入口 | 按微信版实际数据处理补运营主体、联系方式、处理目的/期限、第三方平台说明及删除渠道，实现相应服务端操作 |
| 上线前 | 玩家昵称只校验长度和控制字符 | 首发可用系统昵称；保留自定义时增加内容审核、举报和处置机制 |
| 上线前 | 未发现微信身份及未成年人相关适配 | 核对平台托管范围和本账号要求，接入必要能力；不能把游客模式视为当然豁免 |
| 广告接入前 | 只有TapTap广告；前端完播回调决定奖励申请 | 换用微信平台能力，按其隐私时序初始化；按可用平台校验机制补风控，不宣传已有平台签名验证 |
| 上线前 | 当前mobile-v3仍有开发预览边界 | 核对生产服务、HTTPS/网络域名配置、数据备份恢复、会话安全、资源交付与实际发布功能 |

证据：
- server/mobile-tasks.mjs:4、58；h5/mobile-share-reward.ts:22：邀请及复制奖励。
- server/mobile-service.mjs:129–135：profile仅GET/PATCH及昵称校验；166附近的auth/me与logout不等于完整平台登录/注销。
- h5/mobile-state.tsx:51 → h5/ads.ts:27：挂载时预加载广告，不是用户点击奖励后才初始化。
- server/mobile-service.mjs:92：已有一次性凭据、身份/场景绑定及防重复，但最终依赖 completed===true 的客户端声明。
- h5/mobile-api.ts:24、scripts/start-mobile.mjs:6：独立手机数据库与后端识别。
- server/mobile-service.mjs:228：聊天限制为预设短语/表情，服务端校验；当前手机路由没有开放用户图片上传。
- h5/main.tsx:32、h5/mobile-status.tsx:48：当前隐私内容。
- docs/mobile-v3-development.md:63：开发预览与部署边界。

已具备的较好基础：PC与手机服务隔离；拼合/扣体力/发奖有服务端事务和防重复；当前没有会员或现金支付入口，图包使用游戏金币。上述基础不能替代微信平台适配。

分享技术事实：微信[官方小游戏类型定义](https://github.com/wechat-miniprogram/minigame-api-typings/blob/master/types/wx/lib.wx.api.d.ts)中普通 wx.shareAppMessage 只表示拉起分享，没有“成功发送”的普通回调；不能将点击或返回游戏视为分享成功。这项技术事实本身不等于完成运营规则合规判断。

## 4. 图片、字体与声音核查

当前发布图库82张：
- 39张：project-ai-generated，有生成提示词、来源记录和交付文件哈希。
- 43张：user-provided；其中8张记录user-owned，35张记录user-requested-publication。
- 所有82张都有记录，但格式检查通过不是权利证明。AI生成也不自动保证独占权或不侵犯第三方权利。

来源依据：content/puzzle-catalog.json、content/image-provenance、content/image-prompts，以及[图片库来源与扩充规范](./图片库来源与扩充规范.md)。

字体：当前引用Noto Sans SC/Noto Serif SC，public/fonts保存OFL、来源与字体说明，H5交付目录保存相应许可证。

拼合音效：content/sound-effects/crisp-double-click/manifest.json记录本地程序合成，无外部采样，保留source.py及声音哈希。

旧资源待清理：h5/asset-manifest.json仍含旧庭院音效hatch-soft-b-13142e12cef2.wav；本次未查到独立来源/授权证明，也未在新手机界面发现播放引用。发布前移除不需要的旧资源或补证，不直接判定其侵权。

## 5. 水印建议：先证据，再轻量溯源，最后才考虑隐形像素水印

| 方式 | 作用 | 限制与推荐 |
| --- | --- | --- |
| 原件、生成过程/授权合同、版本与哈希归档 | 留存来源和制作链 | 优先级最高。哈希证明文件对应关系，单独不能证明创作时间或权属；重要作品可评估合适的登记/时间证据方式 |
| 文件元数据 | 记录资源ID、真实权利人或授权来源、版本、声明 | 成本低，可作为第一步。截图/重编码可能删除，不能承诺防盗；不能给不属于自己的图虚写“独占所有” |
| 嵌入像素的不可见数字水印 | 辅助识别传播副本 | 可选。先测试WebP压缩、缩放、裁切后的提取成功率与误判；只处理交付副本，密钥不放前端 |
| 可见小标识 | 宣传图和分享图提供品牌/作者线索 | 适合宣传素材，不建议在拼图画面反复铺暗纹影响辨色和体验 |
| 资源交付限制 | 降低批量采集成本 | CDN限速/签名等只能增加成本，玩家能看到的图仍可能被截图或复制；CORS不是防下载 |

实际状态：
- 82张源PNG中78张检出caBX/C2PA相关容器及签名标记。仅检测到结构，未验证签名；不能据此推断每张图的作者或权属。
- 82张optimized WebP仅有VP8图像块，没有EXIF/XMP/C2PA元数据。
- 未发现自有版权元数据写入或不可见像素水印实现。
- H5交付清单没有打包原PNG及来源/提示词记录；游戏用交付图可按白名单URL获取。
- scripts/prepare-optimized-delivery.mjs:94为编码相关位置；server/h5-gateway.mjs:165–173为图片公开交付。

推荐实施顺序：
1. 原件和已有内容凭证保持不变，补齐授权来源与跨平台使用依据。
2. 为交付副本建立资源ID和版本到原件的映射，适当添加真实版权/来源元数据。
3. 若要保留C2PA验证链，按规范产生新的衍生凭证；不要简单把原签名复制到重编码文件并宣称仍有效。
4. 对少量确认权利的图片试验不可见水印，确认质量和提取稳定后再决定是否批量应用。

最高法指导性案例224号说明，权属有争议时，水印或单方权利声明不能单独证明著作权归属。见[最高人民法院第39批指导性案例](https://www.court.gov.cn/zixun/xiangqing/421112.html)。水印不会补足缺失授权，也不是备案通过的替代材料。

## 6. AI来源标识与版权水印要分开

[《人工智能生成合成内容标识办法》](https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm)已于2025-09-01施行，其中对相应服务提供者的标识、用户发布时的声明及不得恶意删除标识作出规定。

本项目预制图库不应仅因使用AI图，就直接被判定为面向用户提供AI生成服务。具体义务仍须结合展示、上传、传播功能及微信当前要求判断。版权水印不能替代依法需要的AI来源标识；压缩图中未保留元数据值得整改评估，但本次不能由此直接认定违法。

建议如实保留和展示来源，在平台提供AI声明入口时正确填写；不得把全部用户提供素材改标为“本站原创生成”，不得伪造或覆盖原有来源凭证。

## 7. 后续衔接与素材清单

用户随后提供的后台截图明确要求至少3张真实微信游戏截图。共享入口实施方案、部署、模拟器验证、截图和开发版本上传的进度见[统一状态文档](./2026-10-11-wechat-integration-status.md)，不直接上传旧 TapTap H5 ZIP。素材权利记录仍需补齐；没有必要为了“备案”先批量加不可见水印。

以下清单仅列授权记录需补充的35张素材，不是侵权名单。


| 图片 | 来源记录 |
| --- | --- |
| 猫咪市集 | [cat-lantern-market-v1](../content/image-provenance/cat-lantern-market-v1.json) |
| 舞会 | [lantern-dance-v1](../content/image-provenance/lantern-dance-v1.json) |
| 魔法树屋 | [magic-treehouse-v1](../content/image-provenance/magic-treehouse-v1.json) |
| 河畔公园节日 | [riverside-park-festival-v1](../content/image-provenance/riverside-park-festival-v1.json) |
| 夏夜花火祭 | [summer-night-matsuri-v1](../content/image-provenance/summer-night-matsuri-v1.json) |
| 星际港口集市 | [orbital-market-v1](../content/image-provenance/orbital-market-v1.json) |
| 雪乡冬日集会 | [snow-village-fair-v1](../content/image-provenance/snow-village-fair-v1.json) |
| 海岛港湾嘉年华 | [tropical-harbor-carnival-v1](../content/image-provenance/tropical-harbor-carnival-v1.json) |
| 齿轮发明博览会 | [clockwork-invention-fair-v1](../content/image-provenance/clockwork-invention-fair-v1.json) |
| 秘境图书花园 | [enchanted-library-garden-v1](../content/image-provenance/enchanted-library-garden-v1.json) |
| 秋日农场丰收节 | [autumn-farm-festival-v1](../content/image-provenance/autumn-farm-festival-v1.json) |
| 海底城市游园会 | [underwater-city-fair-v1](../content/image-provenance/underwater-city-fair-v1.json) |
| 屋顶邻里派对 | [rooftop-neighborhood-festival-v1](../content/image-provenance/rooftop-neighborhood-festival-v1.json) |
| 金秋雪岭 | [golden-alpine-valley-v1](../content/image-provenance/golden-alpine-valley-v1.json) |
| 落日灯塔 | [sunset-cliff-lighthouse-v1](../content/image-provenance/sunset-cliff-lighthouse-v1.json) |
| 紫野晚风 | [lavender-evening-fields-v1](../content/image-provenance/lavender-evening-fields-v1.json) |
| 雪峰碧湖 | [alpine-turquoise-reflections-v1](../content/image-provenance/alpine-turquoise-reflections-v1.json) |
| 赤峡长河 | [red-canyon-river-v1](../content/image-provenance/red-canyon-river-v1.json) |
| 云上梯田 | [misty-terrace-dawn-v1](../content/image-provenance/misty-terrace-dawn-v1.json) |
| 花溪春桥 | [spring-stream-stone-bridge-v1](../content/image-provenance/spring-stream-stone-bridge-v1.json) |
| 暮雪暖屋 | [winter-lake-cabin-glow-v1](../content/image-provenance/winter-lake-cabin-glow-v1.json) |
| 芦汀霞影 | [reed-marsh-sunset-v1](../content/image-provenance/reed-marsh-sunset-v1.json) |
| 雨林飞瀑 | [rainforest-waterfall-haven-v1](../content/image-provenance/rainforest-waterfall-haven-v1.json) |
| 鲸游古城 | [whale-sunken-city-v1](../content/image-provenance/whale-sunken-city-v1.json) |
| 暮雪列车 | [snowy-sunset-train-v1](../content/image-provenance/snowy-sunset-train-v1.json) |
| 星河露营 | [starlit-lakeside-camp-v1](../content/image-provenance/starlit-lakeside-camp-v1.json) |
| 樱海电车 | [cherry-blossom-seaside-tram-v1](../content/image-provenance/cherry-blossom-seaside-tram-v1.json) |
| 云上龙城 | [cloud-dragon-ascension-v1](../content/image-provenance/cloud-dragon-ascension-v1.json) |
| 月灯九尾 | [moonlit-nine-tail-v1](../content/image-provenance/moonlit-nine-tail-v1.json) |
| 花灯狐影 | [lantern-fox-pair-v1](../content/image-provenance/lantern-fox-pair-v1.json) |
| 霓虹樱刃 | [neon-cherry-swordswoman-v1](../content/image-provenance/neon-cherry-swordswoman-v1.json) |
| 桃花扇影 | [peach-blossom-fan-v1](../content/image-provenance/peach-blossom-fan-v1.json) |
| 月下樱伞 | [daily-moonlit-cherry-umbrella-v1](../content/image-provenance/daily-moonlit-cherry-umbrella-v1.json) |
| 灯舟琴韵 | [daily-lantern-lake-violin-v1](../content/image-provenance/daily-lantern-lake-violin-v1.json) |
| 云海鲸歌 | [daily-sky-whale-islands-v1](../content/image-provenance/daily-sky-whale-islands-v1.json) |
