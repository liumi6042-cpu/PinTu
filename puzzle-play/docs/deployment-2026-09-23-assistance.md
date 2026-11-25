# Piece-count assistance allowances

Deployed 20260923-02, source commit 3fbb0486096cffcd04d27b0caa59568b3e255219. Active service jigsaw-web@3104; rollback 20260923-01. No database migration.

Per player per puzzle, underlay/hint: 108=2/3, 300=3/5, 500=4/8, 1000+=6/12. Fitted grids use existing pieceBand. Each use remains 30 seconds; hints highlight up to 3 pieces. Existing grants are retained and deducted from the new limits. Old tabs retain old UI until ordinary reload; no forced refresh.

Validated local quota persistence, fitted grids, concurrent insertion, retries and independent player counts; packaged HTTP checks exhaust the 500 and 1000 allowances. Release tests and isolated Linux old/new room movement/chat tests passed. Production English/Chinese help, lobby and health returned 200 with new rules. All 325 assets checked; old requests drained. Transfer archive removed after launch.
