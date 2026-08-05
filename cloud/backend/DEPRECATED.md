# DEPRECATED — Do Not Review

This subtree (`cloud/backend/`) contains an **older Spring Boot spike** for the Digiflash cloud service. It is preserved in git history for traceability but is **not** the production cloud codebase.

The active cloud codebase lives at the sibling path `cloud/src/` (entry point `com.petc.PetcApplication`, Flyway migrations under `cloud/src/main/resources/db/migration/V{1,2,3}__*.sql`).

## How to tell which is which

| Concern | `cloud/backend/` (this dir) | `cloud/src/` (active) |
|---|---|---|
| Spring Boot entry point | `com.petc.PetcCloudApplication` | `com.petc.PetcApplication` |
| Database migrations | `V1__initial_schema.sql`, `V2__mirror_tables.sql`, `V3__mirror_phase3.sql` | `V1__init.sql`, `V2__submissions.sql`, `V3__submission_cec_fields.sql` |
| Gradle build files | `cloud/backend/build.gradle.kts` (orphan; not referenced from any settings file) | `cloud/build.gradle.kts` (the one the production build uses) |
| LTMS submission code | none — predates the cloud-mediated submission path | full implementation under `com.petc.submissions` |

## Note to accreditation reviewers

If you are reviewing this repository for DOTr IT-Provider accreditation, please **disregard everything under `cloud/backend/`**. The deliverable bundle in `docs/accreditation/` points exclusively to `cloud/src/` and `desktop/sidecar/`.

This subtree will be removed in a follow-up housekeeping commit; it is left in place at the time of the accreditation submission so DOTr's read-only snapshot of the repository matches one-for-one what was on `develop` at the moment of the submission tag.
