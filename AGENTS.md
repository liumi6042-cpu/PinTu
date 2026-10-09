# Jigsaw Nook TapTap H5 project

- This is the independent TapTap H5/小游戏 project. Keep the existing `D:\\chat\\拼图\\puzzle-play` project unchanged.
- Preserve puzzle IDs, image IDs, catalog metadata, account/session contracts, room protocol, and migration history unless the TapTap design explicitly adds a compatibility layer.
- Never copy or commit `.env*`, `.dev.vars`, private keys, runtime databases, player rooms, chat data, backups, or build caches.
- Development data must stay in this project’s own runtime directory.
- Phase 1 targets mobile H5/小游戏 adaptation. Android/iOS native clients, PC packages, payment, and DLC are later phases.
- TapTap credentials and platform secrets belong only in server-side configuration; client bundles may contain public identifiers only.
- Run type checking, image validation, and focused mobile/room tests before reporting a completed change.
