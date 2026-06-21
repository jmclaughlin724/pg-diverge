---
"supaschema": minor
---

Narrow the public library API. Internal-grade helpers that were never part of the documented public API are no longer re-exported from `supaschema` and have no published entry point: from `src/db-admin.ts` (disposable-database lifecycle, raw apply, catalog fingerprinting), `src/contract-registry.ts` (`toContract`, `contractDrift`), `src/migration-runners.ts` (`buildSupabaseCliCommand`, `groupMigrationUnits`), `src/migrations-status.ts` (`migrationFileVersion`), and `src/pipeline-services.ts` (`applyDeploySafetyPolicy`, `buildSchemaDiffPlan`, `deployBlockingRlsDiagnosticCodes`, `evaluateTypeContract`, `refreshGeneratedOutputs`, `scanSchemaSafety`). They are compiled into the package for internal CLI use but may change or be removed in any release. Use the documented pipeline exports (`verifyMigration`, `syncMigrations`, `migrationsStatus`) instead.
