---
"supaschema": minor
---

Stamp generated TypeScript and Zod contracts with a provenance header (generator version, schema model fingerprint, regeneration command; unreleased builds also record their commit) and add `supaschema types --check`, a no-write drift gate that compares regenerated contracts against on-disk outputs and fails with `SUPA_TYPES_CONTRACT_DRIFT` (exit 2) when a contract is missing or would change.
