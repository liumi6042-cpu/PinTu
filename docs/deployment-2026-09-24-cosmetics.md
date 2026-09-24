# Chat bubbles and object cursors

Release 20260924-03, source 61cb412bb308490814357a7a29d3c76701491aa0. Active jigsaw-web@3104; rollback 20260924-02.

Twelve user-approved themes each provide a chat bubble and an object-only cursor. The wardrobe previews, independently equips and resets the two slots. Server-side account authentication and ownership checks reject guest, suspended, forged and locked equipment requests. Server-projected room messages and teammate cursors use only owned equipment. Native 32px cursors are generated once per selected style, with no new per-frame pointer work or cursor polling interval.

Egg rewards use 70% furniture, 15% bubble and 15% cursor. Cosmetics prefer unowned variants and permanently unlock; a completed category falls back to furniture. Existing costs, daily limits, balances, furniture inventory and puzzle progress are retained. Existing JSON state and atomic version/idempotency checks are reused; no migration.

Validation: TypeScript, cosmetic distribution unit tests, isolated HTTP authorization/ownership/equipment/chat/cursor/concurrent hatch regression tests and full release suite passed. Local browser QA confirmed guest login gate, twelve themed previews, separate saved bubble/cursor equipment, courtyard module and hatch description, native flower cursor on the puzzle canvas, and multiline moon bubble without text overlap. Linux cross-version rooms/moves/chat and all 329 assets passed before warm swap. Old requests drained; no forced client refresh. 303 immutable assets reused and old hashed assets retained.
