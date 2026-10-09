# Direct furniture hatching

Release 20260923-07, source c0040cc586e32d2edeeb4de7bfc6037952bb76d8; active jigsaw-web@3103, rollback 20260923-06.

Each hatch now grants one server-selected furniture/decor item. Unowned types have equal priority; after owning all types, duplicates add inventory. House styles are excluded. Only owned count changes, not redeemed count or fragment balance. Existing balances/progress, 50/100-percent hatch costs and daily two-hatch cap remain. Reward, progress spending, receipt and ledger are persisted atomically under the existing operation id and version checks. No migration.

UI displays the actual awarded item's sprite and name, confirms storage in My items and leaves placement manual. Reward history distinguishes furniture from historical fragment payouts. UI cache version g.

Verified: TypeScript, six focused tests including preference pool, duplicate-at-redemption-cap, concurrent identical hatch requests, retry idempotency and balance preservation; packaged HTTP checks; browser hatched a paper lantern and retained it after reload with balance unchanged; Linux cross-version room move/chat checks and 326 assets. Public script and internal health returned 200. Warm release drained old requests without forced refresh; verified temporary upload removed.
