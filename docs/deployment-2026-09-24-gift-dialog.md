# Centered welcome gift dialog

Release 20260924-04, source 409a65274f4ee96189cd56d7545b25a661f7e312. Active jigsaw-web@3103; rollback 20260924-03.

Pending first-puzzle gifts automatically open in a centered native modal with the daily check-in visual treatment. Check-in takes priority; gift presentation waits for it and other open dialogs to close. Background documents wait until visible. Each account/guest and gift is auto-presented once per tab session, so dismissal/navigation/reload does not repeatedly interrupt play. The side badge remains for manual claiming. Successful server-confirmed claim removes both modal and badge. Reloaded claimed accounts remain hidden according to the permanent server receipt. Original real-snap eligibility, login requirement and once-per-account reward transaction remain unchanged.

Validation: TypeScript and complete packaged HTTP regression passed; local browser confirmed centered artwork/dialog, no horizontal overflow, dismissal followed by reload retained only the badge, manual reopening worked, claim added exactly one fern, and subsequent reload had no gift element or open dialog. Linux isolated old-room/cross-version compatibility and all 329 assets passed. Warm switch drained existing requests with no forced refresh or migrations; production gift endpoint and health checks passed.
