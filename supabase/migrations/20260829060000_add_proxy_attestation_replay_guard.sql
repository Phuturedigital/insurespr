-- A same-origin Vercel function verifies Cloudflare Turnstile and signs the
-- exact protected request with an Ed25519 key. The public edge function claims
-- each signed nonce once here, preventing a captured attestation from being
-- replayed within its short validity window.

create table if not exists private.proxy_attestation_nonces (
  nonce_hash text primary key check (nonce_hash ~ '^[0-9a-f]{64}$'),
  claimed_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  constraint proxy_attestation_nonce_expiry_check
    check (expires_at > claimed_at - interval '2 minutes')
);

alter table private.proxy_attestation_nonces enable row level security;

create index if not exists proxy_attestation_nonces_expiry_idx
  on private.proxy_attestation_nonces (expires_at);

create or replace function public.claim_proxy_attestation_nonce(
  p_nonce_hash text,
  p_expires_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_inserted integer := 0;
begin
  if p_nonce_hash is null or p_nonce_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid proxy attestation nonce hash' using errcode = '22023';
  end if;
  if p_expires_at is null
     or p_expires_at < clock_timestamp() - interval '15 seconds'
     or p_expires_at > clock_timestamp() + interval '3 minutes' then
    raise exception 'invalid proxy attestation expiry' using errcode = '22023';
  end if;

  delete from private.proxy_attestation_nonces
  where expires_at < clock_timestamp() - interval '5 minutes';

  insert into private.proxy_attestation_nonces (nonce_hash, expires_at)
  values (p_nonce_hash, p_expires_at)
  on conflict (nonce_hash) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

comment on table private.proxy_attestation_nonces is
  'Single-use hashes for short-lived Vercel-to-Edge request attestations. No client IP or form data is stored.';
comment on function public.claim_proxy_attestation_nonce(text, timestamptz) is
  'Claims one signed proxy nonce exactly once and opportunistically removes expired claims.';

revoke all on private.proxy_attestation_nonces from public, anon, authenticated, service_role;
revoke all on function public.claim_proxy_attestation_nonce(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_proxy_attestation_nonce(text, timestamptz)
  to service_role;

do $$
begin
  if has_table_privilege('anon', 'private.proxy_attestation_nonces', 'SELECT')
     or has_table_privilege('authenticated', 'private.proxy_attestation_nonces', 'SELECT')
     or has_function_privilege(
       'anon',
       'public.claim_proxy_attestation_nonce(text,timestamp with time zone)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.claim_proxy_attestation_nonce(text,timestamp with time zone)',
       'EXECUTE'
     ) then
    raise exception 'proxy attestation replay guard privileges are too broad';
  end if;
end;
$$;

