# 手机版字体及授权

本项目在共用内容的 TapTap／微信手机版中使用以下本地字体，PC 网站不引用它们。微信使用同一正文子集的 TTF 容器（`jigsaw-ui-sc.ttf`）；浏览器使用 WOFF2 容器，字形和版权声明一致。

- 正文、按钮、数字：Noto Sans SC，经字符子集化，内部字体名为 **Jigsaw UI SC**，可变字重 100–900。
- 大厅、创建房间、补给站及设置标题：Noto Serif SC，经子集化、静态化与分片合并，内部字体名为 **Jigsaw Display SC**，字重 700。

两者采用 **SIL Open Font License 1.1**，允许商业项目使用、修改、嵌入与随游戏再分发。字体本身不能单独出售；修改或再分发字体时须保留版权和 OFL 授权。OFL 不要求游戏代码开放源代码。子集版本采用本项目独立字体名，不沿用保留字体名称。

## 原始版权与授权文件

- `OFL-NotoSansSC.txt`：上游 Google Fonts 原始声明，Copyright 2014–2021 Adobe，Reserved Font Name “Source”。
- `OFL-NotoSerifSC.txt`：上游 Google Fonts 原始声明，Copyright 2012 Google Inc.
- 字体内部原有 copyright、license、license URL 字段均保留；具体原始字体版本与版权字段记录在 `manifest.json`。Noto Serif SC 字体内部还包含 Adobe 的版权声明，与上游 OFL 文件一同保留。
- Noto Serif SC 来自 Fontsource 分发包；随包 LICENSE 也是 SIL OFL 1.1，并标示 Google Inc.。原始包 LICENSE 的逐字副本见下方附录。

## 来源与处理

官方上游与授权：
- https://github.com/google/fonts/tree/main/ofl/notosanssc
- https://github.com/google/fonts/blob/main/ofl/notosanssc/OFL.txt
- https://github.com/google/fonts/tree/main/ofl/notoserifsc
- https://github.com/google/fonts/blob/main/ofl/notoserifsc/OFL.txt
- https://openfontlicense.org/how-to-use-ofl-fonts/

下载源：Noto Sans SC 从 jsDelivr 的 Google Fonts 仓库镜像获取；Noto Serif SC 来自 `@fontsource-variable/noto-serif-sc@5.3.0`，从 npm 官方注册表下载并核验 npm SHA-512 完整性。来源 URL、文件 SHA-256 和原始元数据记录在 `manifest.json`；npm 包的来源与完整性记录在开发缓存 `work/font-sources/noto-serif-sc/package-source.json`。

生成脚本：`scripts/build-mobile-fonts.py`，需要 fontTools 和 Brotli。源文件放在 `work/font-sources`，生成字体和版权文件保存在本目录。正文包含当前源代码、图库标题及服务器文案所需字符，标题包含固定界面标题。新增文案应重新生成子集；用户自定义生僻名字使用系统字体回退。

运行时通过游戏自身域名加载 WOFF2，使用 `font-display: swap`，不依赖 Google Fonts 或第三方字体 CDN。构建时字体随 Vite 资源打包，版权文件随 H5 ZIP 与服务器归档保存到 `licenses/fonts/`。

## Fontsource 原始 LICENSE 附录

```text
Google Inc.

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.

```
