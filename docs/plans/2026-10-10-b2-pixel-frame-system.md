# B2 像素边框系统

日期：2026-10-10。用户已确认：以首版 B2（classic10）为视觉基准，制作可复用像素边框系统。

## 目标与范围
首版参考 work/b2-review/final-lobby.png、final-gallery.png、final-tasks.png。保留当前玩法、账号、收藏、任务与房间数据，只重建独立TapTap UI资产层。原PC项目不动。
不重新生成概念介绍网页。生成插画（头像/礼盒/店铺）独立使用，不塞进可伸缩边框。

## 资产规格
- 原生SVG整数网格源，确定性生成器 scripts/build-pixel-ui.mjs；无AI生成边框。
- 按钮20×20，四角4×4；面板24×24，角6×6；小加号12×12，角3×3。
- 奶油、莓红、金色；按钮正常、按下、选中、禁用。面板奶油、金色。
- 原生1倍；可选择2倍整数倍。四角固定尺寸、四条边repeat平铺、中间由纯色填充；不使用round平铺的自动缩放。
- SVG图集、独立素材及JSON清单共同保存；manifest记录每块位置、切片、颜色与状态。

## 组件
PixelFrame / PixelButton 保留原生HTML、事件、ref与无障碍属性。通过data-pixel-frame、data-pixel-tone、data-pixel-scale提供复用接口。
CSS组件层统一切片厚度，旧页面选择器作为迁移桥接；清理旧的4/5/6px搭配8源像素切片、1.1倍描边等缩放规则。
图片与装饰位于内容/角饰层，不随边框拉伸。像素风叶饰独立，不嵌入边区。

## 验证与交付
验证素材整数坐标、颜色数、切片边缘相容、normal/pressed/selected/disabled齐全；页面只检查本轮边框与交互：窄/宽按钮、图库、任务、收藏、游戏工具，横竖屏及320px。沿用必要的类型检查、图库与画布测试，不运行无关完整业务套件。
不承诺任意浏览器缩放下每个逻辑像素都对应整数物理像素；通过固定角尺寸和重复边段避免UI被整体拉扯。

## 技术依据
- [MDN：九宫格切片](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/border-image-slice)
- [MDN：repeat重复与stretch/round区别](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/border-image-repeat)


## 已实现（pixel17）

- 核心：`h5/pixel-frame.tsx` 的 PixelButton / PixelFrame；`h5/pixel-ui.css` 是唯一切片规则层。
- 26 张网格素材、`atlas.svg`、`manifest.json` 和 `tokens.css` 位于 `public/pixel-ui/`。按钮与小加号为三色四态，面板为奶油/金色。PixelFrame 类型只接受面板实际支持的两种颜色。
- 清除六个旧页面样式中的 61 处旧 border-image 声明，取消不一致的源切片/边宽。新系统覆盖大厅、图库、任务、补给、收藏、结算及游戏工具/弹层。
- 首版 B2 原头像、礼盒、店铺、建房券等插画重新优先使用；新边框与插画分层。大厅首屏采用首版更宽松的双行操作区，卡片保留对角角饰。
- 边框与中心色来自同一生成器；改色后不会因两处色值不一致产生接缝。按压状态即时切换，移除旧背景色过渡造成的短暂色差。
- 拼片渲染、后端、任务奖励、房间协议和原 PC 项目未改动。当前为本地预览，未提交或上传 TapTap。

### 使用

```tsx
import {PixelButton, PixelFrame} from './pixel-frame';

<PixelButton tone="berry" onClick={joinRoom}>快速加入</PixelButton>
<PixelButton tone="cream" aria-pressed={selected}>选项</PixelButton>
<PixelButton tone="gold" disabled={busy}>每日拼图</PixelButton>
<PixelFrame tone="cream" frameScale={1}>面板内容</PixelFrame>
```

保持原生 button 的 disabled、aria、ref 和事件。常规使用 1 倍：按钮边宽4px、面板6px、小加号3px；需要更粗的完整像素时用 frameScale={2}，不要改 border-image-width 为小数。不要对控件做 scaleX/scaleY 拉伸；通过 width/height 调整空间，边框自动重复。

```text
npm run ui:pixels          # 从整数网格源生成
npm run check:ui-pixels    # 只检查，不写文件
npm run build:h5           # 构建前自动执行一致性检查
```

`tokens.css` 与 SVG 均为生成物；修改 `scripts/build-pixel-ui.mjs` 中的规则再生成。manifest 保留九块切片、单像素边条与图集坐标，后续可给 Canvas / 游戏引擎复用。SVG 由整数矩形组成、透明度只有0/1，不含模糊滤镜或半像素描边。

### 本轮验证

- TypeScript 类型检查、素材一致性检查、图库检查与 H5 构建通过。
- 手机画布相关3项原有测试通过；未扩展运行无关后端/完整业务测试。
- 390竖屏、844横屏、320窄屏共16个当前页面状态，无横向溢出、坏图或JS异常。
- 80/160/280px控件宽度下固定切角保持相同；独立组件普通/选中/禁用/按住与1倍/2倍尺寸均定向检查。
- 页面截图及边框尺寸预览统一保存于 `docs/verification/2026-10-10-b2-pixel17/`。

预览：http://127.0.0.1:3211/?v=b2-pixel17#/zh/lobby

## 2026-10-10 按钮上下沿细光影（highlight18）

按用户要求，在按钮内容内沿增加顶部1px高光、底部1px淡色阴影，无模糊。按下时光影反转，禁用时减弱；小体力加号、选中筛选项与游戏工具沿用相同规则。保持像素九宫格素材、角尺寸、按钮宽高和页面布局；卡片面板与拼片渲染不变。

仅修改 h5/pixel-ui.css 的按钮装饰层。快速加入按钮前后均为178×44px，边宽4px、slice4、repeat；390px页面无溢出、JS错误。类型检查、素材/图库检查、构建和3项画布测试通过。

预览：http://127.0.0.1:3211/?v=b2-highlight18#/zh/lobby

## 2026-10-11 仅调整按钮框体（button19）

用户明确保留按钮比例、文字和图标，仅优化框体。常规按钮仍为20×20源、slice4、4px布局边框；四角改为2px阶梯，上/左保留2px描边并提亮内沿，下/右增加一行分层深色边缘（3px深边＋1px浅阴影）。按钮原生素材负责高光，去掉18版常规按钮重复内阴影；追加1px无模糊淡投影，跟随透明阶梯轮廓。按下与禁用状态同步保留。

加号/面板14张SVG与颜色变量文件哈希均未变化。未修改按钮宽高、padding、字体、文字、图标、间距或业务逻辑。大厅4个按钮修改前后的边界、内部文字Range及图标坐标完全一致；快速加入仍为178×44px。横竖屏无溢出、JS错误，按下/禁用帧切换正常。类型检查、素材/图库检查、H5构建及3项画布测试通过。

前后截图保存于 docs/verification/2026-10-10-b2-pixel17/button19-before.png 与 button19-after.png。

预览：http://127.0.0.1:3211/?v=b2-button19#/zh/lobby

## 2026-10-11 浅色次要边框（concept20）

新增linen浅桃描边按钮四态，surface与cream一致。生成素材从26增至30张，颜色变量增至16项。保留20×20、slice4、整数切角与repeat拼接；共享按钮支持可选轻微面渐变。面板切角不改，恢复四角叶饰并给大厅/图库卡片添加原生像素底角标记。游戏结算不再套额外的整页面板框。详情见 [concept20记录](../verification/2026-10-11-b2-concept20/README.md)。

## 2026-10-11 分段选中态（controls21）

新增segment-berry四态：12×12整数源、slice3、3px固定切角、同色轮廓配细高光。素材共34张，按钮组用绝对定位装饰层绘制，不增加布局边框；只有方向标签做1px字体重心校正。进度条另用自适应原生圆角与渐变，尺寸和值仍由页面控制。核对截图统一见 [concept20记录中的controls21](../verification/2026-10-11-b2-concept20/README.md)。

## 2026-10-11 平面方向选择器（picker22）

用户更正方向选择器应为内外无明暗的平面像素样式。segment四态取消高光和暗边，增加rail-cream-normal（20×20/slice4，四边均匀2px描边），总素材35张。仅方向选择器使用，不改变通用按钮。去掉controls21的文字1px下移。截图和核对结果见concept20核对记录的picker22章节。
