# Owner account administration — 2026-09-26

Production display name `11111`, login username `1111`, account ID `2077fe7113654f03ad835a587d891896` was explicitly authorized by owner.

- Added account to existing server-only `PUZZLE_ADMIN_IDS`, preserving any other IDs.
- Granted all current 12 bubble and 12 cursor styles through the stored inventory. Existing equipment and other state preserved; courtyard version advanced in a transaction; admin audit recorded.
- Account/config snapshots kept privately on server in `/srv/sites/jigsaw/shared/admin-grant-20260926`.
- No code release or migration. Runtime remains `20260926-09`; warm configuration activation switched traffic from 3103 to 3104.
- Verified account admin API 200, anonymous 401, all 24 cosmetics in inventory. Temporary verification session removed.
- Existing destructive/admin operations still require password and reason. Hidden courtyard, retired solo play, membership rollout, quotas, and game reward rules were not changed. This is existing admin authorization plus current cosmetic ownership, not a blanket bypass of all game rules or future cosmetic auto-grant.
- Admin entry: https://jigsawnook.online/admin . Wardrobe: https://jigsawnook.online/wardrobe .
