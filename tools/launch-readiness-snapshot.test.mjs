import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260829083836_add_private_launch_readiness_snapshot.sql",
  import.meta.url,
);
const snippetUrl = new URL(
  "../supabase/snippets/launch_readiness.sql",
  import.meta.url,
);

const migration = await readFile(migrationUrl, "utf8");
const snippet = await readFile(snippetUrl, "utf8");

test("launch snapshot is private, aggregate-only and fail-closed", () => {
  assert.match(
    migration,
    /create or replace function private\.launch_readiness_snapshot\(\)/i,
  );
  assert.match(migration, /security definer\s+set search_path = ''/i);
  assert.match(
    migration,
    /'ready_for_public_intake', public\.public_intake_activation_ready\(\)/i,
  );
  assert.match(
    migration,
    /'ready', private\.recovery_activation_ready\(\)/i,
  );
  assert.doesNotMatch(
    migration,
    /jsonb_build_object\([\s\S]{0,120}'(first_name|last_name|surname|mobile_number|email_address|booking_notes|additional_notes|evidence_url|secret|fingerprint)'/i,
  );
});

test("all API roles are denied execution", () => {
  assert.match(
    migration,
    /revoke all on function private\.launch_readiness_snapshot\(\)\s+from public, anon, authenticated, service_role;/i,
  );
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.match(
      migration,
      new RegExp(
        `has_function_privilege\\('${role}', 'private\\.launch_readiness_snapshot\\(\\)', 'EXECUTE'\\)`,
        "i",
      ),
    );
  }
});

test("snapshot covers each launch-control domain", () => {
  for (const key of [
    "privacy",
    "dependencies",
    "services",
    "availability",
    "notifications",
    "recovery",
    "operations",
  ]) {
    assert.match(migration, new RegExp(`'${key}'`, "i"));
  }
});

test("operator snippet calls only the private snapshot", () => {
  assert.match(
    snippet,
    /^--[\s\S]*select jsonb_pretty\(private\.launch_readiness_snapshot\(\)\);\s*$/i,
  );
  assert.doesNotMatch(snippet, /select\s+\*\s+from/i);
});
