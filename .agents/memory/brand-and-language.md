---
name: Brand and language
description: Product brand and localization rule for the public monitoring site.
---

The public product brand is “Monitoring by Firych.” Keep user-facing website content in Ukrainian; preserve game projects' official published names. Clerk's Ukrainian locale can leave common email/password placeholders blank and use the tenant's old app name in sign-in copy, so explicitly override those strings.

**Why:** The user requested this brand and a Ukrainian-language website. The built-in Clerk locale displayed an English email placeholder and stale product name in Preview.

**How to apply:** Use the brand in site metadata and top-level identity. Localize navigation, empty and error states, admin controls, accessibility labels, and authentication UI; explicitly set Clerk's common sign-in/sign-up placeholders and subtitles. Keep official project names and technical identifiers unchanged.
