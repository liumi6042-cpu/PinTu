# Daily check-in and courtyard companion

Release 20260923-04; source e2bed4fa00b31380876f98598cee4bf555fb5e2b; active jigsaw-web@3104; rollback 20260923-03.

Added daily check-in dialog for guests and signed-in users; guests are invited to sign in, with no guest reward ledger or retroactive reward promise. Dismissal is remembered per identity/day. Signed-in completed check-ins suppress the automatic dialog. Root check-in updates courtyard iframe metadata without replacing unsaved furniture placements.

Added quiet cross-page egg with actual server progress, expandable details, first maple goal (5 fragments), and a guest completion invitation. Puzzle mode uses a compact bottom-right shortcut clear of chat; folding survives navigation/reload for the tab. The courtyard retains its own existing egg instead of showing a duplicate. Reward rules and initial empty inventory are unchanged.

Narrowed right fence foreground masks to stop repainting courtyard floor over plant bases. Verified the reported right-side maple placement visually in the isolated local account.

Validation: TypeScript; packaged HTTP tests (courtyard, authentication, rewards, assistance, room chat and images); local browser guest dismissal/reload, signed-in check-in, first plant goal, full-screen presence/folding and final placement. Linux isolated cross-version room moves/chat and 325 assets passed. Public courtyard/lobby and updated static scripts returned 200; internal health with required proxy headers returned 200. No schema changes or forced client refresh; old requests drained. 303 immutable assets reused (282,767,934 bytes). Uploaded archive checksum verified and archive removed.
