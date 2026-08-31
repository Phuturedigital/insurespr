# Provider activation checklist

Provider choices are approved; credentials are not yet present. Perform these
steps only in the named provider accounts and never paste secret values into
git, HTML, browser JavaScript, screenshots or issue comments.

## Cloudflare Turnstile

1. Validate `TURNSTILE-ACTIVATION-HANDOFF.json`, confirm that no equivalent
   widget already exists, and create at most one managed Turnstile widget for
   exactly `www.insuresprhealth.co.za`. The apex permanently redirects to the
   canonical `www` hostname and is not a widget hostname.
2. Store `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` together as sensitive,
   server-only Vercel variables for Production only. Preview and localhost are
   deliberately excluded from the production packet. A partial pair is a
   deployment failure. Never use a `NEXT_PUBLIC_` or browser-exposed variable.
3. Keep `INSURESPR_PROXY_PRIVATE_KEY_B64` in the same Vercel environments. Its
   matching Ed25519 public key is committed in the Supabase verifier; the
   private value must never enter Supabase, Git, HTML, logs or screenshots.
4. Redeploy Vercel; confirm the official-domain
   `/api/insurespr?route=services` returns the site key and
   `Cache-Control: no-store` without exposing either secret. The direct
   Supabase `/services` response may keep a null site key in this architecture.
5. Test booking, contact and employer routes for missing, expired, wrong-action,
   wrong-hostname, replayed and valid tokens. Confirm every rejection writes
   zero business, consent and notification rows.
6. Confirm that Vercel verifies Siteverify first, Supabase accepts only an exact
   signed body no more than 90 seconds old, and a repeated nonce is rejected by
   `private.proxy_attestation_nonces` without storing a raw IP or form value.
7. Record the Cloudflare account owner, widget ID, key-rotation owner and date in
   the private release evidence.

## Resend and domain mail

As checked through both Cloudflare and Google public DNS on 29 August 2026,
`insuresprhealth.co.za` has no inbound MX; the default Resend
Return-Path `send.insuresprhealth.co.za` has neither its required MX nor SPF TXT
record; and `resend._domainkey.insuresprhealth.co.za` has no DKIM record. The
approved Reply-To domain `bonevc.co.za` has an MX route on both resolvers. Do not
schedule the worker or use `@insuresprhealth.co.za` as a receiving/reply-to
address until the mailbox exists and can receive replies.

`_dmarc.insuresprhealth.co.za` now publishes `v=DMARC1; p=none`, observed
through both public resolvers on 29 August. This is a non-enforcing monitoring
policy, not evidence that outbound or inbound email works.

1. Create/confirm the receiving mailbox for `motselisi@bonevc.co.za`.
2. Verify the sending domain in Resend and publish its exact DKIM record plus
   the provider-issued SPF TXT and MX records on the exact Return-Path host.
3. Keep the published DMARC monitoring policy under review and tighten it only
   after legitimate mail is aligned and the reporting/ownership decision is
   approved.
4. Confirm MX, SPF, DKIM and DMARC from two public resolvers and send a test to
   an external mailbox. Verify From, Reply-To, SPF, DKIM and DMARC results in the
   received headers.
5. Create an independent random `NOTIFICATION_WORKER_SECRET`; do not reuse a
   Supabase key, API key or password.
6. Store `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`,
   `NOTIFICATION_WORKER_SECRET`, `NOTIFICATION_CONFIG_SHA256`,
   `NOTIFICATION_WORKER_SOURCE_SHA256` and `NOTIFICATION_ACTIVATION_MODE` in
   Supabase Edge Function secrets. Keep all values out of Git and evidence.
7. Insert the exact reviewed configuration in the database's short-lived
   `rehearsal` state, deploy the matching worker source, and run a controlled
   synthetic queued test. Verify success, mailbox receipt, provider duplicate
   suppression, retry, ordering, failure-alert and dead-letter behavior.
8. Attach the controlled test evidence and promote that same immutable
   configuration to `active`. Any sender, secret-generation, source, schedule
   or owner change requires revocation and a new revision.
9. Only then install the documented scheduler with the worker secret in
   Supabase Vault, resolve both notification dependencies and record the Cron
   owner and alert recipient. See `NOTIFICATION-ACTIVATION.md` for the exact
   rehearsal, promotion and rollback contract.

Run the non-mutating provider checks before and after every DNS/provider change:

```powershell
node tools/release-audit.mjs --mode preview
node tools/release-audit.mjs --mode release
```

The audit checks SPF and MX on the provider Return-Path, the exact configured
DKIM hostname, DMARC and the approved Reply-To domain's MX route through both
Cloudflare (`1.1.1.1`) and Google (`8.8.8.8`). Use `--return-path-host` or
`--dkim-host` when Resend supplies values other than the documented defaults;
do not guess or duplicate provider DNS. Use `--email-reply-to` only for a
separately approved receiving mailbox.

## Phone and WhatsApp

Approved booking contact: Motselisi R. Mosiana

Approved phone and WhatsApp: `083 450 7861` (`+27834507861`)

Approved receiving email: `motselisi@bonevc.co.za`

These direct channels may be published. Public business evidence links the
number and email to Motselisi/QSIGHT, and the email domain had a receiving MX
record on 21 August 2026. A controlled handset/WhatsApp receipt check and an
out-of-hours escalation decision should still be logged before claiming a
response-time service level.

The database and website must retain the exact E.164 values above. Any future
change requires a new owner instruction, a forward-only migration and the full
page/contact audit; do not silently replace the number in static markup alone.

## Supabase backup and recovery

The Supabase Management API verified on 29 August 2026 that the production
organization is on the Free plan. Current Supabase documentation does not
include managed daily backups or PITR for that plan. No encrypted off-site
logical backup, RPO, RTO, recovery owner or successful restore drill is on file.

1. The practice must approve either a paid managed-backup route or a controlled,
   scheduled encrypted logical-export route.
2. Name the recovery owner and deputy, approve RPO/RTO, record the backup
   custodian and failure-alert recipient, and document access restrictions.
3. Verify an actual managed restore point or encrypted export. Never commit a
   database URL, password, dump, patient export or encryption private key.
4. Restore into an isolated authorized target, keep external notifications and
   intake disabled, run the database/application contracts, and record achieved
   RPO/RTO.
5. Complete `RECOVERY-ACTIVATION-HANDOFF.json` with evidence and peer review,
   insert the exact configuration in rehearsal, append the five required
   execution-evidence classes, and promote only while the 72-hour rehearsal
   window is open. Promotion resolves `backup-recovery`; stale backup evidence
   automatically makes the public mutation gate false.
6. Only after the drill succeeds may `RECOVERY-READINESS.json` and the private
   platform observation be superseded by a new forward migration.

Follow `RECOVERY-RESTORE-DRILL.md`, `RECOVERY-ACTIVATION.md` and the official
Supabase backup guide:
<https://supabase.com/docs/guides/platform/backups>.
