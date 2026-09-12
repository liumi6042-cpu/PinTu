# Google Search Console

本站使用正式 HTTPS 地址的 URL-prefix 资源：`https://jigsawnook.online/`。所有公开页面都规范到这个域名和协议，HTTP 与 www 由服务器重定向。

所有权使用 Google 提供的 HTML meta 标签验证，位于根布局 `app/layout.tsx` 的 `metadata.verification.google`。这是公开的站点验证标识，不是登录凭据。验证成功后仍须保留，后续构建和发布不得移除；不添加其他账号的标识，也不删除其他所有者的验证方式。

提交的站点地图为 `https://jigsawnook.online/sitemap.xml`，由已发布公共图库自动生成，目前包含首页、大厅、图库、帮助和 30 张图片介绍页，共 34 个规范 URL。房间、私人图片、账号、个人空间与查询参数页不进入地图。

公开发布后运行 `python tests/seo-http.py https://jigsawnook.online`，检查页面可访问、英文服务端内容、独立标题、canonical、图片分享信息、内部链接、公开/私有收录规则及地图。Google 的实际验证与地图状态仍需在 Search Console 内确认，HTTP 检查不等于已收录。

建议每周查看 Search Console 的页面索引报告和搜索效果报告，关注无法收录的原因、搜索词、展示次数与点击量。新资源的数据可能需要数天累积。地图随图库更新，不需为每张新图片手动重复提交；仅对关键新增或修复页面使用网址检查，避免批量反复请求索引。
