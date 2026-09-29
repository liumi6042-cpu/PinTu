# Empty-room retention — 2026-09-29

Public rooms with no valid puzzle progress now receive a one-hour grace period from `createdAt`. The maintenance sweep deletes them only after that hour and only when no member is currently online. Rooms with a snapped or connected group retain the existing idle-month behavior; completed and active-progress rooms are unchanged.

Validation: focused public-room retention tests 5/5; full standalone release smoke, cosmetics, courtyard, lobby-chat, cross-version and asset checks passed. Production release `20260929-01`, commit `3a4f5c52930c683a45b7309867dbd85f3476c446`, active on `jigsaw-web@3104.service`; previous `20260927-01` retained for rollback. First deployment attempt ran out of disk while extracting and was removed before retry; no partial release was activated and no user data was deleted.
