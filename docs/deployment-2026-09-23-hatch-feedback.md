# Hatching reward tuning and quiet feedback

Release 20260923-06, source 265b5d2814b06213a0d55582bc9176a560781339, active jigsaw-web@3104, rollback 20260923-05.

Base rewards: 108/300/500/1000 pieces -> 5/10/20/30 percent. Daily-first and new-picture bonuses each 5; teamwork bonus removed. Existing saved progress, hatch costs, contribution eligibility and redemption balances unchanged.

Cross-page warm breathing halo (0.8s), actual gain label and chosen soft B two-note WAV. Independent persistent sound toggle respects master sound enabled/volume. Audio loads/decodes once after gesture, has one voice and no autoplay queue. Background feedback suppressed. Cumulative earned progress includes spent hatch progress; first load/navigation/focus establish silent baseline. Cross-tab Web Locks + localStorage watermark deduplicate feedback. Existing visible-page refresh interval stays at 120 seconds; completion and courtyard actions trigger refresh.

Checks: TypeScript; reward/concurrency/hatch boundary/legacy balance tests; tier and deduplication tests; packaged HTTP tests; local browser cross-page off/on persistence and isolated progress update with visible gain element; no browser error logs. Linux old/new room move/chat compatibility and 326 assets passed. No migration or forced refresh; previous requests drained. Exact transfer archive checksum verified and removed.
