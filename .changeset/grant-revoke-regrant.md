---
"supaschema": patch
---

Fix grant diffing for revoke-all + re-grant privilege hardening: a covering REVOKE with GRANT statements on both sides of it (multi-privilege or column-scoped re-grants) no longer nets the re-grants away in the source model, migration replay now treats a GRANT following a covering REVOKE on the same target and grantee as the new privilege state instead of merging it into the revoked one, and a REVOKE that overlaps none of the granted privileges on its target is suppressed as the no-op it is instead of surviving to render phantom restore-GRANTs. Declarative `revoke all … ; grant …` blocks now plan a non-destructive grant replace (revoke the previous privilege state, then grant the target state) rather than a destructive standalone grant drop.
