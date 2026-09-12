# 海外搜索引擎接入

## 网站验证

Google Search Console 与 Bing Webmaster Tools 使用同一个正式地址 `https://jigsawnook.online/`。根布局同时保留 Google 的 `google-site-verification` 与 Bing 的 `msvalidate.01`，普通版本发布不得移除。Bing 使用网站 HTML 标签独立验证，没有授予读取全部 Google Search Console 数据的导入权限，也没有安装 Clarity 或广告追踪。

两个站长后台提交同一份 `https://jigsawnook.online/sitemap.xml`。地图目前有 34 个公开页面，随发布的图库自动更新。

## IndexNow

根目录的 UTF-8 验证文本文件由 `config/search-engines.json` 指定，文件名与内容一致，并列入运行包白名单。它是此域名的 IndexNow 所有权证明，不是 Google/Bing 账号凭据。验证文件不加入站点地图。

`npm run search:notify` 默认仅显示待提交链接，不发请求。发布并确认地图与代码目录一致后，可执行 `npm run search:notify -- --submit` 首次提交当前 34 个公共链接；只有服务器能公开返回正确验证文件才会发送。后续公开内容有变化时，显式指定变更链接，例如：

```sh
npm run search:notify -- --submit https://jigsawnook.online/gallery https://jigsawnook.online/puzzle/mountain-lake-reflection
```

所有提交仍受公开路由与在架原创图片白名单限制，不接受账号、房间、私人上传、查询参数或其他域名。脚本不在玩家游玩、心跳或上传私人照片时运行；日志写入本机忽略目录 `work/indexnow/latest.json`，同一已接受批次不会直接重复发送。真实更新后确需重发同批链接，可显式使用 `--force`。错误不自动循环重试，429 必须遵守 Retry-After。

官方统一入口 `https://api.indexnow.org/indexnow` 会与参与的引擎共享通知，包括 Bing、Yandex、Naver、Seznam.cz、Yep 等。HTTP 200 代表已收到通知，202 表示已收到但仍待验证密钥；两者都不等于网址已收录。此接入不等于注册了每家引擎的独立站长后台。

## 其他引擎

- Yahoo 的网页搜索使用 Bing，提交路径依托 Bing Webmaster Tools。
- DuckDuckGo 的传统链接和图片大量来自 Bing，同时有自己的其他来源。
- Ecosia 使用 Bing、Google 和 EUSP；保持两大索引入口及标准可抓取页面，不宣称必然出现在所有来源中。
- Qwant 官方建议等待爬虫自然发现；未提供类似 Search Console 的自助站长提交后台。
- Brave 的 `/submit-url` 为重新抓取入口，页面接受请求不等于加入独立站长后台或保证新网站收录。它按 Googlebot 的可抓取规则处理，本站公开页面已允许 Googlebot，私人页保留 noindex。

## 官方依据（2026-09-12 核对）

- [Bing URL Submission](https://www.bing.com/webmasters/help/url-submission-62f2860b)
- [IndexNow 文档](https://www.indexnow.org/documentation)与[参与入口和响应含义](https://www.indexnow.org/faq)
- [Yahoo 提交说明](https://in.help.yahoo.com/kb/SLN2217.html)
- [DuckDuckGo 搜索来源](https://duckduckgo.com/duckduckgo-help-pages/results/sources)
- [Ecosia 搜索来源](https://support.ecosia.org/article/579-search-results-providers)
- [Qwant 索引说明](https://help.qwant.com/docs/search/divers/comment-referencer-mon-site-sur-qwant/)
- [Brave 爬虫说明](https://search.brave.com/help/brave-search-crawler)
