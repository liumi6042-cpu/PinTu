# 超现实拼贴开场素材记录

生成日期：2026-09-08。工具：OpenAI 内置 `image_gen`，纯文字从零生成，未提供外部参考图。工具未返回独立模型标识，因此不猜测具体模型版本。

用途：首屏可分别位移的远景、左前景与右前景。三张是独立原生 PNG，未裁切、重采样或抠图。复制进项目后 SHA-256 与工具原文件一致；原文件保留于 `.codex/generated_images`。

## 文件与检查结果

| 文件 | 用途 | 原生尺寸 | PNG 模式 | 透明度 | 字节数 |
| --- | --- | --- | --- | --- | --- |
| `public/intro/dream-horizon.png` | 中央石拱门、海天、珍珠月亮远景 | 1672 × 941 | RGB | 完全不透明 | 2042823 |
| `public/intro/floating-garden.png` | 左侧漂浮花园前景 | 1448 × 1086 | RGBA | 真实 alpha；1003799 个全透明像素 | 1585839 |
| `public/intro/paper-crane.png` | 右侧纸鹤与晶石前景 | 1448 × 1086 | RGBA | 真实 alpha；1140000 个全透明像素 | 1035353 |

两张前景的 alpha 范围均为 0–255。前景主体多数像素的 alpha 为约 252，边缘有更低透明度，保留生成工具的原始结果。花园含 568581 个部分透明像素及 148 个完全不透明像素；纸鹤含 432040 个部分透明像素及 488 个完全不透明像素。这里的“有透明背景”基于实际像素读取，不是依据预览底色。

逐张查看生成结果及本地原文件：远景中心拱门清楚，前景分别偏左、偏右，均无明显文字、界面、Logo、水印或可辨识现有角色。两张前景边缘有少量半透明的金色颗粒感，作为实体拼贴的悬浮细节保留。此为视觉验收，不是排他权或无侵权法律保证。商业使用依据与本站生成图库相同，见 `docs/图片库来源与扩充规范.md`；本站不将 AI 生成自动等同于无任何权利风险。

## 原文件、校验值与实际提示词

### dream-horizon.png

原文件：`C:/Users/Administrator/.codex/generated_images/01a07fa2-bbaf-7493-828f-28a00ce908d2/exec-4d4c758d-1546-4db7-8b4d-041ccde0a503.png`

SHA-256：`45c9629ba9bda16d6d5cc8aedf33bea92df155b687f2e677f824d38af437cfb5`

实际发送的完整提示词：

```text
Use case: stylized-concept. Create a brand-new original raster asset for a surreal multilayer parallax entrance of a jigsaw website. Visual language: exquisite tactile physical paper collage and sculptural miniature art, dreamlike but refined, luminous ice blue, warm ivory, emerald teal, tiny gold accents. Soft diffused upper-left light and realistic paper edges, calm luxury, strong spatial depth. No text, no UI, no logos, no watermark, no signatures, no identifiable IP, no imitation of a named artist, no reference images. Highest available native resolution.
Asset type: opaque panoramic distant landscape backdrop, landscape 16:9. A tranquil impossible blue sea with tiny distant floating islands, atmospheric cloud layers, an enormous pearl-like moon in the upper right, and one tall glowing pale stone arch exactly in the center, inviting the camera to fly through it. Invent all shapes. The middle opening is simple luminous pale sky, with sufficient uncluttered negative space for later website title and button. Foreground mostly empty calm water; reserve large foreground plants and birds for separate layers, do not add them here. The arch is centered near 50% x, 56% y and large enough to remain visible in portrait cropping. Cohesive single scene, full bleed, not a website screenshot, not multiple panels.
```

### floating-garden.png

原文件：`C:/Users/Administrator/.codex/generated_images/01a07fa2-bbaf-7493-828f-28a00ce908d2/exec-a872f9c4-55b3-4142-9bd7-95c3c3835a55.png`

SHA-256：`3eaf2b2474c05f6af5d56f86b108c137ef9b90d5a137a5d81e85277509b9f2a0`

实际发送的完整提示词：

```text
Use case: stylized-concept. Create a brand-new original raster asset for a surreal multilayer parallax entrance of a jigsaw website. Visual language: exquisite tactile physical paper collage and sculptural miniature art, dreamlike but refined, luminous ice blue, warm ivory, emerald teal, tiny gold accents. Soft diffused upper-left light and realistic paper edges, calm luxury, strong spatial depth. No text, no UI, no logos, no watermark, no signatures, no identifiable IP, no imitation of a named artist, no reference images. Highest available native resolution.
Asset type: isolated foreground cutout for the LEFT side of a composited website hero. Genuinely transparent PNG background with preserved alpha, not a white or checkerboard painted backdrop. One floating rocky island with a jagged pale stone underside, an abundant miniature garden of emerald monstera-like leaves, delicate ferns and a few ivory and soft golden blossoms. Tactile sculpted paper and stone collage. Island occupies the left-middle and lower-left part of a landscape 4:3 canvas, extends slightly toward center, with generous fully transparent empty space to the right. Entire object visible with clean edge detail and no clipping. No horizon, no sky, no sea, no framing, no floor, no ground-plane shadow; only the independent floating garden and a few tiny near-island floating rocks.
```

### paper-crane.png

原文件：`C:/Users/Administrator/.codex/generated_images/01a07fa2-bbaf-7493-828f-28a00ce908d2/exec-45431776-978f-4163-a20b-711bd6612627.png`

SHA-256：`45a52abf18ee6bf249e2b12ffa905a3b924cd7fd8c4ba5d15545c9a4bf116dc8`

实际发送的完整提示词：

```text
Use case: stylized-concept. Create a brand-new original raster asset for a surreal multilayer parallax entrance of a jigsaw website. Visual language: exquisite tactile physical paper collage and sculptural miniature art, dreamlike but refined, luminous ice blue, warm ivory, emerald teal, tiny gold accents. Soft diffused upper-left light and realistic paper edges, calm luxury, strong spatial depth. No text, no UI, no logos, no watermark, no signatures, no identifiable IP, no imitation of a named artist, no reference images. Highest available native resolution.
Asset type: isolated foreground cutout for the RIGHT side of a composited website hero. Genuinely transparent PNG background with preserved alpha, not a white or checkerboard painted backdrop. One oversized elegant ivory origami crane in flight, crisp sculptural folded fine paper, delicately gold-edged wings with soft ice-blue shadows, beak pointing toward the left and center of the scene. A few separate translucent emerald faceted crystals and pale gold flower petals float around its lower edge. The crane and accents occupy the right-middle part of a landscape 4:3 canvas with generous fully transparent empty space on the left. Entire silhouette visible, no cropping. Refined physical collage, consistent soft upper-left daylight. No horizon, no scenery, no floor, no rectangle behind the object, no ground-plane shadow.
```
