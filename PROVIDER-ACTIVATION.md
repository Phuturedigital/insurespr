# Provider activation checklist

Provider choices are approved; credentials are not yet present. Perform these
steps only in the named provider accounts and never paste secret values into
git, HTML, browser JavaScript, screenshots or issue comments.

## Cloudflare Turnstile

1. Create one managed Turnstile widget for exactly
   `insuresprhealth.co.za` and `www.insuresprhealth.co.za`.
2. Store `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` together in Supabase
   Edge Function secrets. A partial pair is a deployment failure.
3. Redeploy `insurespr-api`; confirm `/services` returns the site key and
   `Cache-Control: no-store` without exposing the secret.
4. Test booking, contact and employer routes for missing, expired, wrong-action,
   wrong-hostname, replayed and valid tokens. Confirm every rejection writes
   zero business, consent and notification rows.
5. Record the Cloudflare account owner, widget ID, key-rotation owner and date in
   the private release evidence.

## Resend and domain mail

Current public DNS has no MX, SPF or DMARC record. Do not schedule the worker or
use `@insuresprhealth.co.za` as a reply-to address until the mailbox exists and
can receive replies.

1. Create/confirm the receiving mailbox for `health@insuresprhealth.co.za`.
2. Verify the sending domain in Resend and publish its exact SPF and DKIM records.
3. Publish a deliberate DMARC policy at `_dmarc.insuresprhealth.co.za`; begin
   with monitored reporting and tighten only after legitimate mail is aligned.
4. Confirm MX, SPF, DKIM and DMARC from two public resolvers and send a test to
   an external mailbox. Verify From, Reply-To, SPF, DKIM and DMARC results in the
   received headers.
5. Create an independent random `NOTIFICATION_WORKER_SECRET`; do not reuse a
   Supabase key, API key or password.
6. Store `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` and
   `NOTIFICATION_WORKER_SECRET` in Supabase Edge Function secrets.
7. Deploy the notification worker, run a controlled queued test, and verify
   success, provider rejection, retry, ordering and dead-letter behavior.
8. Only then install the documented once-per-minute scheduler with the worker
   secret in Supabase Vault and record the Cron owner and alert recipient.

## Phone and WhatsApp

These channels remain intentionally absent. To restore either channel, obtain a
number controlled by the practice, verify a live incoming call/message, name the
person responsible for monitoring it, approve response hours, update the
database in a forward-only migration, and rerun every page/contact audit.
