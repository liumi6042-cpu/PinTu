# 本地旧文件清理记录

2026-09-11：服务器由用户朋友整理，本次没有连接服务器、上传、部署或清理服务器文件。

已移除 `server/deploy-existing-server.py` 与 `server/deploy-public-rooms.py` 两个硬编码旧版本目录的一次性部署脚本。它们不适用于当前发布方式。

下列 14 个本地旧上传包已经检查，合计约 37 MiB，均不是网站源码、原图或数据库，可清理。自动审批检查拒绝了删除命令（`blocked by policy`），所以仍保留在磁盘；不要将清单理解为已经删除。

```text
outputs/puzzle-lag-fix.tar.gz
outputs/puzzle-multiplayer.tar.gz
outputs/puzzle-play.tar.gz
work/compact-room-hud/update.tar
work/deploy/jigsaw-code.tar.gz
work/ip-language/update.tar
work/member-uploads/source-final.tar
work/member-uploads/source.tar
work/multiplayer-organize/source.tar
work/nature-expansion-20260911/update.tar
work/personal-delete/update.tar
work/public-rooms/code.tar.gz
work/search-optimization/update.tar
work/solo-login/source.tar
```

项目内 `dist`、`.next`、`.vinext` 属于可重建缓存，已加入忽略规则；旧构建清理未完成，需要使用 `npm run local` 重新构建后才能本地试玩。上一级 `.imagegen-venv` 是旧生成环境，本次也未删除。

图片原件、来源与提示词、设计参考、两级 `.git`、`.wrangler/state`、`work/backups`、私有配置和运行依赖均保留。上一级 `.git` 中有 Codex 检查点，不能因为它没有普通提交就当成空仓库删除。

今后只使用 [最小运行包流程](runtime-releases.md)，每次生成并替换 `releases/latest.tar.gz`，不再积累或上传旧 source 包。
