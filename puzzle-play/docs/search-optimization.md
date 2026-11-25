# Jigsaw Nook 搜索优化维护

正式地址：https://jigsawnook.online/
站点地图：https://jigsawnook.online/sitemap.xml
抓取规则：https://jigsawnook.online/robots.txt

公开页面由 lib/seo.ts 的白名单和 published 公共图库共同决定。新增/下架图片后介绍页与 sitemap 自动保持一致；不能将私人上传或玩家房间加入其中。每个公开页面需具有真实可见内容、独立标题与规范 URL，不通过隐藏关键词或虚假评价优化排名。

后续可以用经营者自己的 Google 账号在 Search Console 添加域名，通过 Google 给出的 DNS TXT 或 HTML 验证方式确认所有权，再提交 sitemap.xml。用户本次选择先做站内优化，未提供验证标签，尚未进行站长平台操作。Google 抓取、收录和排名由其系统决定；提交地图不保证收录。

上线检查：用 tests/seo-http.py 检查真实 HTTP 响应，tests/search-indexing.test.mjs 检查白名单、元信息与结构化数据转义。私密页面继续保留身份验证；noindex 只是搜索指令，不是访问控制。

依据：[Google 标题链接说明](https://developers.google.com/search/docs/appearance/title-link)、[JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)、[站点地图](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)、[noindex](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag)。
