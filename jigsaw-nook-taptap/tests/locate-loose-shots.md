# 「定位」未拼块：手机模拟截图与短视频

仅供手动、本地运行；开发交付时只执行 `node --check tests/locate-loose-shots.mjs`。环境要求和隔离方式同 `tests/placed-piece-blend-shots.md`：服务端和 TapTap Canvas 客户端都构建在 `work/locate-shots-tmp/run-*`，网关只绑 127.0.0.1，浏览器拦截所有外部请求，房间通过本地 HTTP 新建。

```powershell
node tests/locate-loose-shots.mjs
```

108 片图（14×7=98 片）：除最后两行和倒数第二行右半边外全部拼好，一块散块压在拼好的湖面上，其余散块在开局散落位置。按钮用真实触摸点在画出来的「定位」图标上。

| 输出（`LOCATE_SHOTS_DIR`，默认 `D:/chat/拼图/ui-revamp-shots/locate-loose`） | 内容 |
|---|---|
| `1-landscape-before.png` / `2-landscape-glow.png` | 844×390 横屏、工具栏展开；点「定位」前后。散块在屏外时画面平移并缩小到刚好看全。 |
| `3-landscape-zoomed-before.png` / `4-landscape-zoomed-glow.png` | 放大在湖面上时点「定位」。 |
| `5-landscape-more.png` | 「更多」里仍有“适配完整桌面”。 |
| `6-portrait-tools.png` / `7-portrait-glow.png` | 390×844 竖屏工具面板（原「适配」位置换成「定位」）和点后效果。 |
| `8-landscape-guide.png` | 首局引导第②步文案。 |
| `9-near-end-glow.png` / `10-near-end-after.png` / `locate-loose.mp4` | 其余散块经 HTTP 拼好后只剩 2 块（一块压在湖面上），点「定位」时和 4 秒后；视频为这一段。 |
| `report.json` | 房间布局、相机、文件 SHA256、页面/控制台/网络错误。 |
