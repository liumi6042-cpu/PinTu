# Public room entry navigation

The user reported that public-lobby room cards stopped opening after the recent
release. Diagnostics against an existing public 108-piece room confirmed HTTP
200 for its HTML, RSC response, guest initialization, join, and leave. The room
still had 38 placed pieces. No puzzle actions or resets were performed. Browser
control continued to time out, so a specific client exception was not observed.

Public room cards now use native anchors instead of framework Link navigation.
This lets the browser open the verified room URL without depending on the SPA
transition. The existing full-room guard, original-image preload and accessible
link label remain. It does not prefetch all rooms. Creation still uses the compact
creation response and fresh in-memory ticket; server admission is unchanged.

This is a targeted recovery for the reported click failure, not a claim that an
unobserved browser exception was identified. Verify existing-room HTTP admission
and assets after deployment and retain one rollback release.
