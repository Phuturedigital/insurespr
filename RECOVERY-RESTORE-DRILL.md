# Recovery and restore drill

This runbook defines the technical recovery sequence without inventing the
practice's legal retention period, recovery objective, access list or incident
authority. It does not authorize a production restore. Complete and approve the
fields below before public intake opens.

## Required ownership decisions

| Decision | Approved value | Named approver | Review date |
|---|---|---|---|
| Incident lead and deputy | Pending | Pending | Pending |
| Recovery point objective (RPO) | Pending | Pending | Pending |
| Recovery time objective (RTO) | Pending | Pending | Pending |
| Supabase backup/PITR plan | Free plan verified; no managed daily backup or PITR | Pending | 29 August 2026 |
| Encrypted evidence and export custodian | Pending | Pending | Pending |
| Patient-data access during a drill | Pending | Pending | Pending |
| DNS/Vercel rollback authority | Pending | Pending | Pending |
| POPIA retention and deletion rules | Website schedule `2026-08-21.1` | Motselisi R. Mosiana | 21 August 2026 |

Until these values are approved, forms remain fail-closed and no production
patient data may be copied into a local, personal or unapproved test system.

## Verified production state

The Supabase Management API was checked on 29 August 2026 and reported project
`ffdmmxffzewqiacsuvhr` as `ACTIVE_HEALTHY`, in `eu-central-1`, on PostgreSQL
`17.6.1.155`. The owning organization is on the `free` plan. The official
Supabase backup documentation currently includes managed daily backups for Pro,
Team and Enterprise projects and recommends regular off-site logical exports
for Free projects.

No managed restore point, PITR window, encrypted off-site logical backup,
approved RPO/RTO, recovery owner or completed restore drill has been verified
for this project. `RECOVERY-READINESS.json` records that fail-closed state, and
the database launch dependency `backup-recovery` blocks public intake.

Close the dependency through one approved route:

1. Upgrade to a plan with managed daily backups, verify the actual restore
   points in the Dashboard, approve RPO/RTO and complete an isolated restore
   drill; or
2. Implement a scheduled, encrypted off-site logical export with a controlled
   custodian, success/failure monitoring, documented retention, approved
   RPO/RTO and a successful isolated restore drill.

A subscription change alone is not evidence of recoverability. A dump file
that has never been restored is also insufficient. Do not place a plaintext
production dump, database URL or password in this repository, Vercel, a ticket,
or a personal device.

## Implemented encrypted logical-backup tooling

`tools/recovery-backup.mjs` now implements the technical portion of the Free-plan
off-site route, but it is deliberately inactive. It streams PostgreSQL's custom
archive directly through AES-256-GCM, writes only an authenticated encrypted
artifact, creates it through a restrictive `.partial` file and atomic rename,
and records its byte count and SHA-256 digest in a sidecar manifest. It refuses
to overwrite an artifact or manifest. The database URL, password, encryption
key and restore confirmation are passed through process environment only; the
tool removes the recovery secrets before starting `pg_dump` or `pg_restore`.

The companion verification command checks the manifest, size, SHA-256 digest,
GCM authentication tag and `pg_restore --list` readability without writing a
plaintext dump. The restore command decrypts directly into `pg_restore`,
requires the exact confirmation `RESTORE APPROVED ISOLATED TARGET`, refuses a
target host or pooler username identifying production project reference
`ffdmmxffzewqiacsuvhr`, refuses the same source and target database endpoint,
and writes
evidence with application checks, delivery isolation and target deletion still
explicitly pending. It cannot change `RECOVERY-READINESS.json` or authorize
production recovery.

Use only a trusted, access-controlled operator runner with a compatible
PostgreSQL 17 client. Load these values from the approved secret manager without
printing them or saving them in shell history:

- `INSURESPR_BACKUP_KEY_B64`: canonical base64 for exactly 32 random bytes;
- `INSURESPR_BACKUP_DATABASE_URL`: the controlled read-capable production
  connection;
- `INSURESPR_RESTORE_DATABASE_URL`: an approved isolated target only;
- `INSURESPR_RESTORE_CONFIRMATION`: required only for an authorized restore;
- optional `INSURESPR_PG_DUMP_COMMAND`, `INSURESPR_PG_RESTORE_COMMAND` and JSON
  command prefixes for an approved containerized client.

Create and immediately authenticate an encrypted artifact:

```powershell
node tools/recovery-backup.mjs backup --output <controlled-path>.isprbackup --project-ref ffdmmxffzewqiacsuvhr --key-id <vault-key-version>
node tools/recovery-backup.mjs verify --input <controlled-path>.isprbackup
```

After written drill authorization, load the isolated target URL and exact
confirmation, then restore while creating a new evidence record:

```powershell
node tools/recovery-backup.mjs restore --input <controlled-path>.isprbackup --target-label <isolated-target-label> --evidence-output <controlled-evidence-path>.restore-evidence.json
```

The artifact, manifest and restore evidence are ignored by Git and must be moved
to approved encrypted off-site storage. Configure retention/versioning only
after its period is approved. Alert the named owner on every missed run,
non-zero exit, verification failure, upload failure or stale last-success time.
Keep the encryption key in a separately controlled vault and test recovery of
that key. Never use Vercel's public-site runtime or an unapproved personal
machine as the backup runner.

Deterministic tests cover wrong keys, tampering, overwrite refusal, secret/URL
argument leakage, production-host refusal and evidence state. The opt-in local
integration drill uses disposable synthetic PostgreSQL databases and deletes
its exact temporary container and files:

```powershell
npm run test:recovery
npm run test:recovery:docker
```

These passing tests prove the repository tooling, not operational recovery.
The `backup-recovery` dependency remains open until the practice approves the
owner, runner, off-site location, key custody, retention, RPO and RTO; a real
scheduled encrypted backup is monitored; and an authorized isolated restore
drill completes every evidence item below.

## Recovery inventory

- GitHub is the source of truth for the static site, migrations, Edge Function
  source, operational SQL and non-secret configuration.
- Supabase project `ffdmmxffzewqiacsuvhr` contains the PostgreSQL schemas and
  operational records. Its Free plan is verified and provides no managed daily
  backup/PITR route; do not rely on any recovery point until one of the approved
  closure routes above is implemented and tested.
- Supabase database backups do not restore Edge Function deployments, project
  API keys, Auth configuration, function secrets or Storage objects. Inventory
  and reconfigure those separately; never export secret values into this repo.
- Vercel owns the static deployment configuration and official-domain routing.
  Record project owners, primary domain and last known-good deployment outside
  the repository.
- DNS registrar access, the legacy WordPress export/media archive and the
  X-Ray-domain redirect state require named custodians and encrypted storage.
- The current application does not use Supabase Storage for patient documents.
  Reassess this inventory before introducing any Storage bucket or new vendor.

## Safe quarterly drill

1. Obtain written drill authorization and record the incident lead, observers,
   target environment, approved recovery point and expected RPO/RTO.
2. Use an empty local database or an approved isolated Supabase branch for the
   migration rehearsal. Do not point the public site or notification worker at
   the drill environment.
3. Apply every committed migration in version order. Verify the local and
   production migration filename sets are auditable and that all migration
   assertions pass.
4. Deploy the API and notification functions only to the isolated target.
   Leave notification provider credentials, Cron and external callbacks
   disabled. If a provider must be tested, use an approved sandbox recipient.
5. Run the deterministic Node/Deno suites and the read-only SQL checks in
   `supabase/snippets/daily_operations.sql`. Confirm RLS, function ACLs,
   constraints, indexes and Security Advisor findings.
6. If the approved Supabase plan supports restoring a backup to a new project,
   use that isolated clone for the restore drill. A clone includes database
   records and therefore requires the same access controls as production.
   Immediately disable any copied Cron, network or external-operation feature
   before inspecting data.
7. Reconfigure non-database components from the inventory without revealing
   their values in tickets or screenshots. Confirm Storage objects separately
   if Storage is ever introduced.
8. Record start/end time, selected restore point, achieved data point, failed
   checks, corrective actions and evidence locations. Delete the isolated copy
   only under the approved retention/deletion procedure.

## Production incident sequence

1. Declare the incident and name the authorized lead. Preserve logs and audit
   evidence; do not improvise destructive cleanup.
2. Close intake before recovery. The approved operator may set the privacy
   version to a clearly pending value, verify all mutation routes fail closed,
   pause notification scheduling and protect the public deployment if needed.
3. Identify the last trustworthy point and compare it with the approved RPO.
   Select the closest available backup or PITR point before the incident.
4. Announce and plan downtime. A Supabase in-place restore makes the project
   inaccessible while it runs. Use the Dashboard confirmation flow; never run
   an unreviewed raw restore command from a personal machine.
5. After the database restore, reconcile committed migrations, Edge Functions,
   secrets/configuration, Auth settings, network restrictions, DNS and the
   Vercel deployment. Reset custom-role passwords if the chosen backup method
   does not preserve them.
6. Keep delivery and intake closed while verifying:
   - migration history and schema objects;
   - business-table and queue counts at the selected recovery point;
   - RLS, grants and Security Advisor results;
   - one authorized synthetic booking lifecycle without external delivery;
   - availability revisions/conflicts and notification leases;
   - official-domain redirects, security headers and read-only API health.
7. Re-enable components in order: database/API health, static site, approved
   availability, Turnstile, then notification scheduling. Reopen forms last and
   only with the approved privacy version.
8. Document lost/replayed work, patient or employer follow-up, notification
   reconciliation and the post-incident review under the approved POPIA and
   clinical escalation procedures.

## Drill evidence checklist

- authorization and named participants;
- source and target project identifiers (never secret keys);
- backup/restore point and observed RPO;
- start, service-unavailable and completion timestamps;
- migration-list comparison and test results;
- data-count reconciliation with no row contents in the report;
- RLS/ACL/advisor results;
- notification/Cron disabled-state proof;
- DNS/Vercel rollback verification;
- issues, owner, due date and next drill date.

Current Supabase references:

- [Database backups](https://supabase.com/docs/guides/platform/backups)
- [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)
- [Production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
