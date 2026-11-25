# Public lobby chat retired

Release 20260924-01, source a8307fb5030d37afda18f9dee426ba20743d2251. Active jigsaw-web@3104; rollback 20260923-07.

Removed the shared public lobby chat component and its client code, and updated bilingual help/privacy text. Room chat remains available. The compatibility endpoint returns 410 with no messages and Retry-After: 86400, without database reads/writes. Historical rows are retained but no longer publicly served. No schema migration.

Verified TypeScript and full packaged release HTTP checks, including courtyard and room chat. Linux cross-version room moves/chat and 326 assets passed. Both language lobby pages return 200 from the production application without the chat component; retired endpoint returns 410 with a one-day retry interval. Public lobby returns 200 using browser user agent (Python default agent is blocked by edge error 1010). Internal health is healthy. Warm swap drained old requests, with no forced client refresh. Temporary archive checksum verified and archive removed; immutable assets reused.

The first-puzzle welcome gift is still a confirmed design, not implemented or deployed by this release.
