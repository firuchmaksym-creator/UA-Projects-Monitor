---
name: Official project online sources
description: Source-access constraints for the UA Projects Monitor player counts.
---

As of 2026-11-07, the official VERBA ONLINE and UKRAINE GTA pages visibly render live per-server counts, but ordinary server requests from this project return HTTP 403. Keep them UNKNOWN until a documented public server-facing endpoint or owner-authorized access works; do not evade the block or use web-search/fetch snapshots as runtime data. The UA ONLINE and TRIDENT MOBILE official homepages are HTML, not JSON APIs, and do not expose in-game counts. UA ONLINE's public site bundle only showed payment/referral endpoints; no verified live-count API was found for either project.

**Why:** the user requires verified live counts and explicitly forbids invented values or circumventing access controls.

**How to apply:** confirm source availability using the monitor's normal server-side fetch path before marking a provider as live; only persist counts returned by that source. Do not configure a normal HTML homepage as a JSON API.
