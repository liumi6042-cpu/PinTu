# Gallery courtyard navigation repair

Release 20260923-05; source 7d2464107d514b6c44eec959d6f32c48ba44dd80; active jigsaw-web@3103, rollback 20260923-04.

HomeNavigation (used by the gallery and picture entry pages) was missing the courtyard link present in CommunityShell. Added the shared /courtyard link immediately after the lobby with existing translated label and icon. No account, inventory, layout, or puzzle changes.

TypeScript, packaged runtime HTTP checks, isolated Linux cross-version checks and all 325 assets passed. Both public /gallery and /zh/gallery HTML verified to include the correctly translated courtyard link. Warm switch drained old requests without forcing refresh. Verified temporary upload archive removed.
