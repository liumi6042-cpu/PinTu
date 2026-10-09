# Courtyard and lobby chat launch

Released 2026-09-23 as `20260923-01`, commit `0ed7528197db1ab4d43e63f7c267a90971da9521`.

- Active: `jigsaw-web@3103.service`; previous `20260922-03` remains the rollback release.
- Additive migration `0012_courtyard_lobby_chat.sql`; existing tables unchanged. Backup succeeded before migration.
- Account courtyard saves, server-validated check-ins/rewards/exchanges, 24 furniture items and 3 styles; no demo balances imported.
- Separate public lobby chat: public reading, signed-in sending, identity validation, rate limits, local mute, admin hiding.
- Unit tests, packaged HTTP tests and isolated Linux cross-version tests passed. Real browser checks covered desktop/mobile layout, placing/saving/reloading, check-in and lobby message display.
- 325 runtime assets verified. Existing client hashes retained; 303 identical picture files reused with hardlinks (282,767,934 bytes). Old requests drained; no forced refresh.
- Production health/lobby/courtyard assets returned 200; guest courtyard API correctly returned 401; public chat returned 200 with no test messages.
- Uploaded archive SHA256: `9cad864ca95f272f0d117b0571922e1af779da7f544c5d5353b080c2f6379a61`. Generated transfer archives removed after successful verification.

Future courtyard static changes must increment `index.html` and script query versions together because static responses can be cached for one hour.
