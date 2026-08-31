import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  validateLiveServiceCatalogue,
  validateServiceActivationHandoff,
} from './service-activation-handoff.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(ROOT, 'SERVICE-ACTIVATION-HANDOFF.json'), 'utf8'));
const clone = (value) => structuredClone(value);

test('production service activation handoff is a complete fail-closed draft', () => {
  assert.deepEqual(validateServiceActivationHandoff(manifest, 'draft'), []);
  assert.equal(manifest.services.length, 16);
  assert(manifest.services.every((service) => service.approval === null));
  assert.equal(manifest.activationAuthorized, false);
});

test('draft validation rejects catalogue drift and premature approval', () => {
  const changed = clone(manifest);
  changed.services[0].currentBookingMode = 'walk_in';
  changed.services[1].approval = { decision: 'approve' };
  changed.activationAuthorized = true;
  changed.globalEvidence.finalApprover = 'Unreviewed';
  const errors = validateServiceActivationHandoff(changed, 'draft');
  assert(errors.some((error) => error.includes('current booking mode differs')));
  assert(errors.some((error) => error.includes('draft approval must be null')));
  assert(errors.some((error) => error.includes('activationAuthorized must be false')));
  assert(errors.some((error) => error.includes('globalEvidence.finalApprover must be null')));
});

test('approved validation rejects unsupported facts and incomplete evidence', () => {
  const changed = clone(manifest);
  changed.status = 'approved';
  changed.activationAuthorized = true;
  changed.services[0].approval = {
    decision: 'approve',
    approvedBy: 'Reviewer',
    approvedAt: 'not-a-date',
    evidenceRefs: [],
    bookingMode: 'appointment',
    priceType: 'fixed',
    currency: 'USD',
  };
  for (const service of changed.services.slice(1)) {
    service.approval = {
      decision: 'hold',
      holdReason: 'Evidence pending',
      approvedBy: 'Reviewer',
      approvedAt: '2026-08-29T08:50:00+02:00',
      evidenceRefs: ['controlled:evidence-pending'],
    };
  }
  const errors = validateServiceActivationHandoff(changed, 'approved');
  assert(errors.some((error) => error.includes('globalEvidence.legalEntityEvidenceRef is required')));
  assert(errors.some((error) => error.includes('approvedAt must be an ISO timestamp')));
  assert(errors.some((error) => error.includes('nonempty evidenceRefs are required')));
  assert(errors.some((error) => error.includes('appointmentDurationMinutes must be 5-480')));
  assert(errors.some((error) => error.includes('cashPriceCents is required')));
  assert(errors.some((error) => error.includes('currency must be ZAR')));
  assert(errors.some((error) => error.includes('availabilityPolicyRef is required')));
});

test('hold decisions still require named, dated evidence and a reason', () => {
  const changed = clone(manifest);
  changed.status = 'approved';
  changed.activationAuthorized = true;
  changed.services = changed.services.map((service) => ({
    ...service,
    approval: { decision: 'hold', approvedBy: '', approvedAt: '', evidenceRefs: [] },
  }));
  const errors = validateServiceActivationHandoff(changed, 'approved');
  assert(errors.some((error) => error.includes('holdReason is required')));
  assert(errors.some((error) => error.includes('approvedBy is required')));
  assert(errors.some((error) => error.includes('at least one service must be approved')));
});

test('live catalogue comparison detects service drift before approval', () => {
  const livePayload = {
    services: manifest.services.map((service) => ({
      slug: service.slug,
      name: service.name,
      audience: service.audience,
      booking_mode: service.currentBookingMode,
      price_type: service.currentPriceType,
      verification_status: service.currentVerificationStatus,
    })),
  };
  assert.deepEqual(validateLiveServiceCatalogue(manifest, livePayload), []);

  livePayload.services[0].verification_status = 'verified';
  livePayload.services[1].price_type = 'fixed';
  livePayload.services.push({ slug: 'unreviewed-service' });
  const errors = validateLiveServiceCatalogue(manifest, livePayload);
  assert(errors.some((error) => error.includes('live verification status differs')));
  assert(errors.some((error) => error.includes('live price type differs')));
  assert(errors.some((error) => error.includes('unexpected live service slug')));
  assert(errors.some((error) => error.includes('exactly 16 services')));
});

test('database evidence records the packet without opening any service gate', async () => {
  const [migration, ignored] = await Promise.all([
    readFile(path.join(ROOT, 'supabase', 'migrations', '20260829065000_record_service_activation_handoff.sql'), 'utf8'),
    readFile(path.join(ROOT, '.vercelignore'), 'utf8'),
  ]);
  assert.match(ignored, /^SERVICE-ACTIVATION-HANDOFF\.json$/m);
  assert.match(migration, /acdb5b227f30a87462a97f995058f3eebcfdad08db18dc2b4c5c106dd054cb8e/g);
  assert.match(migration, /v_claim_count is distinct from 5/);
  assert.match(migration, /v_open_dependencies is distinct from 5/);
  assert.match(migration, /v_unverified_services is distinct from 16/);
  for (const dependency of [
    'service-catalogue',
    'verified-credentials',
    'clinical-requirements',
    'booking-rules',
    'approved-prices',
  ]) {
    assert.match(migration, new RegExp(`where dependency_key = '${dependency}'`));
  }
  assert.match(migration, /No duration or availability approval is supplied/);
  assert.match(migration, /zero service price decisions are approved/);
  assert.doesNotMatch(migration, /update public\.services/i);
  assert.doesNotMatch(migration, /insert into public\.booking_slots/i);
});
