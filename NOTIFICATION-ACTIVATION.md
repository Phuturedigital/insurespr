# Notification activation and rehearsal

Status: prepared, not approved, not scheduled

The production notification worker is deployed but deliberately reports
`ready:false`. Resend is the approved adapter and
`motselisi@bonevc.co.za` is the approved practice recipient and Reply-To. Those
decisions do not prove a provider account, sending identity, DNS alignment,
secret custody, scheduler or mailbox delivery.

The canonical non-secret packet is `NOTIFICATION-ACTIVATION-HANDOFF.json`.
Validate the current draft with:

```powershell
node tools/notification-activation-handoff.mjs --mode draft --live-worker-url `
  "https://ffdmmxffzewqiacsuvhr.supabase.co/functions/v1/insurespr-notifications"
```

## Current verified zero state

- Worker readiness: `not_ready`.
- Notification attempts: zero.
- Notification delivery configurations: zero.
- Notification Cron jobs: zero.
- Notification/Resend Vault secret names: zero.
- `pg_cron`: not installed.
- `pg_net`: not installed.
- DMARC: `v=DMARC1; p=none` observed at the official domain through Cloudflare
  and Google public resolvers.
- Approved Reply-To domain: `bonevc.co.za`, with an observed MX route.
- Resend-compatible SPF, Return-Path MX and DKIM: absent.
- Official-domain inbound mailbox: not verified and not published.

## Non-secret approval packet

Never put an API key, worker secret, service-role key or Vault secret value in
the JSON packet, Git, a migration, an evidence reference, a screenshot or an
email. The approved packet contains only:

1. Provider account and domain references that reveal no credential.
2. Exact sender domain, Return-Path host, DKIM host, From and Reply-To.
3. Independent two-resolver SPF, Return-Path MX, DKIM and DMARC observations.
4. SHA-256 fingerprints of the provider-key and worker-secret generations.
   A fingerprint binds approval to a rotation generation but cannot send mail.
5. Exact worker-source SHA-256 and database-computed configuration SHA-256.
6. Named Supabase Edge Function secret keys and Vault secret names, never
   values.
7. Schedule name, expression, Johannesburg timezone, schedule owner, failure
   alert owner/recipient and rollback authority.
8. Approver, a different peer reviewer, timestamps, change reference and
   controlled evidence references.

## Secret placement

Set these only in Supabase Edge Function secrets:

- `RESEND_API_KEY`
- `EMAIL_FROM`
- `EMAIL_REPLY_TO`
- `NOTIFICATION_WORKER_SECRET`
- `NOTIFICATION_CONFIG_SHA256`
- `NOTIFICATION_WORKER_SOURCE_SHA256`
- `NOTIFICATION_ACTIVATION_MODE`

Use `rehearsal` for the controlled test window and `active` only after the
rehearsal is reviewed and the configuration row has been promoted. The worker
also uses the platform-supplied `SUPABASE_URL` and secret-key map. Modern
`sb_secret_...` keys are sent as `apikey` only; legacy service-role JWTs retain
the Bearer header required by the legacy gateway path.

Store the scheduler's project URL, publishable key and independent worker
secret in Supabase Vault under the exact approved names. Do not store the
Resend API key in Vault merely to schedule the worker; it belongs in Edge
Function secrets and never in the Cron command.

## Controlled rehearsal

An activation configuration must enter the database in `rehearsal`, never
directly in `active`.

1. Verify the provider domain and DNS through two resolvers.
2. Store the Edge Function secrets and Vault scheduler values through the
   controlled account. Record names, fingerprints, owners and timestamps, not
   secret values.
3. Insert one reviewed configuration with an authorization window no longer
   than 24 hours, a non-patient rehearsal mailbox, and the exact worker/config
   SHA-256 values.
4. Set `NOTIFICATION_ACTIVATION_MODE=rehearsal` and deploy the exact reviewed
   worker source.
5. Queue a synthetic, clearly labelled non-patient notification. Do not use a
   real public form submission or clinical information.
6. Invoke the worker with the independent scheduler secret. Verify the provider
   message ID, mailbox receipt and headers; repeat the same attempt identifier
   to prove provider duplicate suppression; exercise one retryable failure and
   one terminal failure path without sending patient data.
7. Record the delivery and failure-alert evidence. If anything differs, revoke
   the row, rotate both secrets and remove the synthetic records.

The public `GET` readiness endpoint continues to report `ready:false` throughout
rehearsal. Rehearsal never resolves a launch dependency, installs Cron or opens
public intake.

## Promotion to active

After the rehearsal evidence is reviewed:

1. Promote the same immutable configuration from `rehearsal` to `active` by
   attaching controlled-delivery evidence, failure-alert evidence and the
   activation timestamp. Changing a sender, secret generation, worker source,
   schedule or owner requires revocation and a new configuration revision.
2. Enable `pg_cron` and `pg_net` without pinning extension versions.
3. Create one named Cron job through `cron.schedule`. The command must call
   `insurespr-notifications` and retrieve the worker secret from the approved
   Vault name. Never write directly to `cron.job`.
4. Change `NOTIFICATION_ACTIVATION_MODE=active`.
5. Resolve `email-delivery` and `notification-operations` in the same reviewed
   release only when their exact evidence is present.
6. Confirm the worker reports `ready:true`, inspect `cron.job_run_details`, and
   prove the failure alert reaches its named recipient.

The service-role-only database function
`public.notification_delivery_activation_ready` returns one boolean. Active
mode returns true only when the exact configuration/source hashes match, both
launch dependencies are resolved, both scheduler extensions exist, and the
named active Cron job matches the approved schedule and Vault secret name.

## Rollback

1. Unschedule the exact named Cron job with `cron.unschedule`.
2. Move the configuration from `active` or `rehearsal` to `revoked` with a
   timestamp and reviewed reason.
3. Change or remove `NOTIFICATION_ACTIVATION_MODE` so the worker fails closed.
4. Rotate the provider API key and worker secret if either may be exposed or if
   the approved fingerprint no longer matches.
5. Reopen both launch dependencies and verify public readiness returns false.
6. Preserve provider message IDs and operational audit evidence, but do not
   retain message bodies beyond the approved privacy schedule.

## Authoritative references

- Supabase Edge Function secrets:
  https://supabase.com/docs/guides/functions/secrets
- Supabase scheduled Edge Functions and Vault:
  https://supabase.com/docs/guides/functions/schedule-functions
- Supabase Cron:
  https://supabase.com/docs/guides/cron/quickstart
- Resend domain verification:
  https://resend.com/docs/dashboard/domains/introduction
- Resend idempotency keys:
  https://resend.com/docs/dashboard/emails/idempotency-keys
