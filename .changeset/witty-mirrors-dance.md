---
"supaschema": minor
---

Publish immutable `X.Y.(Z+1)-dev.<sha>` snapshot builds to the npm `next` dist-tag on every protected `main` push via a new `snapshot.yml` workflow (OIDC trusted publishing, provenance attestation, post-publish registry smoke). Stable releases on `latest` are unchanged. Consumers can now dogfood the current main build as an exact version pin instead of linking a local checkout. Requires a one-time npm trusted publisher entry for `snapshot.yml`; see the release docs.
