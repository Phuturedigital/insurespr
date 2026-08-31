# Recovery activation procedure

Status: **prepared, not approved, not active**

This procedure turns the existing encrypted backup/restore tooling into a controlled production capability. It does not create a production backup, choose a paid Supabase plan, approve an off-site storage provider or authorize access to production data.

The current project is on the Supabase Free plan. Supabase documents that managed daily backups are included on Pro, Team and Enterprise and recommends regular off-site logical exports for Free projects. A plan upgrade is not, by itself, proof of recoverability. Every route below requires a real recovery point and an isolated restore test.

## Choose and approve one route

1. **Off-site logical backup** - approve an access-controlled runner, versioned encrypted off-site storage, a separately controlled AES-256 key, a schedule, retention, failure alerting and named custodians. Use `tools/recovery-backup.mjs` without writing a plaintext dump.
2. **Supabase managed daily backup** - upgrade the project, verify a real Dashboard restore point, name owners and complete an isolated restore/clone drill.
3. **Supabase PITR** - upgrade the project and compute add-on, verify the real recovery window, name owners and complete an isolated restore/clone drill.

Record only controlled references, timestamps, hashes and secret fingerprints in the handoff and database. Keep database URLs, passwords, keys, backup archives and row-level evidence out of Git, Vercel, tickets and ordinary email.

## Approve the operating model

Before rehearsal, complete and peer-review `RECOVERY-ACTIVATION-HANDOFF.json` in approved mode with:

- maximum recovery-point age (RPO) and recovery-time objective (RTO);
- retention period and restore-drill interval;
- recovery owner and a different deputy;
- backup, key, schedule, alert and rollback ownership;
- scheduler, runner and storage references;
- secret names, storage locations and SHA-256 fingerprints only;
- an accepted controlled evidence document and change reference.

The configuration must first be inserted as `rehearsal`. The database computes its SHA-256 from the exact non-secret controls. It rejects a direct active insert and rejects later edits; revise by revoking and inserting a new revision.

## Run the short-lived rehearsal

The rehearsal window is at most 72 hours. Use an approved runner and production source only for the encrypted backup step. Restore only to an empty, isolated target. Notifications, Cron, callbacks and public traffic must remain disabled in that target.

Record append-only execution evidence for all five checks:

1. a successful backup with recovery-point time, encrypted artifact SHA-256 and manifest SHA-256;
2. authenticated artifact verification for the same hashes;
3. a successful isolated restore for the same hashes, external delivery disabled and the target subsequently deleted under the approved procedure;
4. a controlled failure-alert test; and
5. scheduler health evidence.

The database will not promote the configuration unless every check is current and linked. The source artifact and secret values remain outside the database; it stores only hashes and controlled references.

## Promote and monitor

Promotion to `active` resolves only the `backup-recovery` dependency. Public forms still remain closed until every other launch dependency and the approved privacy version are complete.

`public.public_intake_activation_ready()` is called by the form API before Turnstile, rate-limit or mutation work. It fails closed when:

- privacy is pending;
- any launch dependency is open or blocking;
- there is no active recovery configuration;
- the newest recovery point is older than the approved RPO;
- its artifact verification is missing;
- the restore drill or alert test is stale;
- scheduler health is stale; or
- a later backup, verification or scheduler failure is recorded.

Every scheduled run must append its backup, verification and health evidence. A failed run must also be recorded; do not hide a failure by recording only successes.

## Rollback

Revoke the configuration with a timestamp and controlled reason. Revocation reopens `backup-recovery`, and the runtime intake gate returns false. Rotate or revoke the affected database credential and encryption-key version in their actual secret stores, stop the named scheduler, preserve incident evidence, and create a new peer-reviewed configuration rather than editing the old one.

Official references:

- <https://supabase.com/docs/guides/platform/backups>
- <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore>
- <https://supabase.com/docs/guides/platform/clone-project>
