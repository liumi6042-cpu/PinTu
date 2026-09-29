# Cursor hit area and drop confirmation — 2026-09-29

Custom pattern cursors now use a forgiving hit region around each visible piece. The native arrow keeps the previous precise outline hit behavior. A group remains reserved until its network drop or release response is acknowledged; the same group cannot be picked up during that window, preventing an older authoritative response from overwriting a newer local drag and causing a visible snap-back.

Validation: TypeScript and release package checks passed; full standalone HTTP smoke, cosmetics synchronization, room drag/drop, cross-version and asset checks passed. Production release `20260929-02`, commit `747e1e4269fb38faa13c029797e5540ac87e8ab2`, active on `jigsaw-web@3103.service`; previous `20260929-01` retained for rollback. Health endpoint returned OK.
