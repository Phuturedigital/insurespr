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
