# Furniture requires redemption

Release 20260923-03; source a6a8c864ddfa63e67b3aa65d1e7f0aafb47b0882; active jigsaw-web@3103, rollback 20260923-02.

New profiles receive only the free wood courtyard. All furniture inventory starts empty. Existing profiles are upgraded once on access with optimistic version checking: inventory uses the cumulative redemption record, placements are retained up to purchased quantities, balance/progress/themes remain unchanged. Stale saves must reload. No SQL migration or puzzle changes.

Tests cover empty initial inventory, concurrent one-time conversion, preservation of purchased copies and positions, stale-version rejection, existing rewards and limits. Packaged HTTP and isolated Linux cross-version tests passed. Production HTML/script cache versions and health verified. No forced client refresh. Verified transfer archive removed.
