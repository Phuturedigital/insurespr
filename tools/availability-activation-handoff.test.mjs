import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  validateAvailabilityActivationHandoff,
  validateLiveAvailabilityState,
} from './availability-activation-handoff.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(ROOT, 'AVAILABILITY-ACTIVATION-HANDOFF.json'), 'utf8'));
const clone = (value) => structuredClone(value);

test('availability activation handoff is a complete zero-state draft', () => {
  assert.deepEqual(validateAvailabilityActivationHandoff(manifest, 'draft'), []);
  assert.equal(manifest.appointmentServices.length, 2);
  assert(manifest.appointmentServices.every((service) => service.approval === null));
  assert.equal(manifest.activationAuthorized, false);
  assert.equal(manifest.cronActivation.authorized, false);
});

test('draft validation rejects invented duration, policy, closures and Cron', () => {
  const changed = clone(manifest);
  changed.activationAuthorized = true;
  changed.source.observedSlotCount = 1;
  changed.appointmentServices[0].currentDurationMinutes = 45;
  changed.appointmentServices[1].approval = { decision: 'approve' };
  changed.wholePracticeClosures.push({ date: '2026-12-25' });
  changed.cronActivation.authorized = true;
  const errors = validateAvailabilityActivationHandoff(changed, 'draft');
  assert(errors.some((error) => error.includes('activationAuthorized must be false')));
  assert(errors.some((error) => error.includes('observedSlotCount must remain zero')));
  assert(errors.some((error) => error.includes('current duration snapshot must be null')));
  assert(errors.some((error) => error.includes('draft approval must be null')));
  assert(errors.some((error) => error.includes('wholePracticeClosures must be empty')));
  assert(errors.some((error) => error.includes('Cron must remain unauthorized')));
});

test('approved validation rejects unsafe policy values and overlapping rules', () => {
  const changed = clone(manifest);
  changed.status = 'approved-policy-not-materialized';
  changed.activationAuthorized = true;
  changed.wholePracticeClosureReview = {
    reviewed: true,
    reviewedBy: 'Reviewer',
    reviewedAt: '2026-08-29T09:20:00+02:00',
    sourceRef: 'controlled:closure-review',
  };
  changed.appointmentServices[0].approval = {
    decision: 'approve',
    appointmentDurationMinutes: 0,
    horizonDays: 5,
    minimumNoticeMinutes: 9000,
    bufferMinutes: 2000,
    slotCapacity: 2,
    timezone: 'UTC',
    weeklyRules: [
      { weekday: 1, startsAt: '08:00', endsAt: '12:00', validFrom: null, validUntil: null },
      { weekday: 1, startsAt: '11:00', endsAt: '13:00', validFrom: null, validUntil: null },
    ],
    serviceExceptions: [],
    approvedBy: 'Same Person',
    peerReviewedBy: 'Same Person',
    approvedAt: 'not-a-date',
    evidenceDocumentKey: '',
    changeReference: 'short',
  };
  changed.appointmentServices[1].approval = {
    decision: 'hold',
    holdReason: 'Evidence pending',
    approvedBy: 'Approver',
    peerReviewedBy: 'Peer',
    approvedAt: '2026-08-29T09:20:00+02:00',
    evidenceDocumentKey: 'controlled:availability-evidence',
    changeReference: 'AVAIL-001',
  };
  const errors = validateAvailabilityActivationHandoff(changed, 'approved');
  assert(errors.some((error) => error.includes('appointmentDurationMinutes must be 5-480')));
  assert(errors.some((error) => error.includes('minimum notice cannot exceed horizon')));
  assert(errors.some((error) => error.includes('bufferMinutes must be 0-1440')));
  assert(errors.some((error) => error.includes('slotCapacity must equal 1')));
  assert(errors.some((error) => error.includes('timezone must be Africa/Johannesburg')));
  assert(errors.some((error) => error.includes('weekly rules overlap')));
  assert(errors.some((error) => error.includes('peer reviewer must differ')));
  assert(errors.some((error) => error.includes('initialMaterializationDays must be 1-14')));
});

test('live comparison detects durations, verification and slot drift', () => {
  const servicesPayload = {
    services: manifest.appointmentServices.map((service, index) => ({
      id: `service-${index}`,
      slug: service.slug,
      name: service.name,
      booking_mode: 'appointment',
      appointment_duration_minutes: null,
      verification_status: 'needs_confirmation',
    })),
  };
  const availability = {
    'dxa-bone-density': { slots: [] },
    'dxa-body-composition': { slots: [] },
  };
  assert.deepEqual(validateLiveAvailabilityState(manifest, servicesPayload, availability), []);
  servicesPayload.services[0].appointment_duration_minutes = 45;
  servicesPayload.services[1].verification_status = 'verified';
  availability['dxa-bone-density'].slots.push({ id: 'unexpected-slot' });
  const errors = validateLiveAvailabilityState(manifest, servicesPayload, availability);
  assert(errors.some((error) => error.includes('live duration is no longer null')));
  assert(errors.some((error) => error.includes('live verification status differs')));
  assert(errors.some((error) => error.includes('live slots exist')));
});

test('database provenance and evidence migrations fail closed', async () => {
  const [provenance, evidence, ignored] = await Promise.all([
    readFile(path.join(ROOT, 'supabase', 'migrations', '20260829071000_harden_availability_approval_provenance.sql'), 'utf8'),
    readFile(path.join(ROOT, 'supabase', 'migrations', '20260829072000_record_availability_activation_handoff.sql'), 'utf8'),
    readFile(path.join(ROOT, '.vercelignore'), 'utf8'),
  ]);
  assert.match(ignored, /^AVAILABILITY-ACTIVATION-HANDOFF\.json$/m);
  assert.match(provenance, /approved_config_revision = config_revision/);
  assert.match(provenance, /approval_evidence_document_id uuid/);
  assert.match(provenance, /approved_by <> peer_reviewed_by/);
  assert.match(provenance, /unapprove the availability policy before changing approved controls/);
  assert.match(provenance, /is_approved = false/);
  assert.match(provenance, /ROLLBACK_AVAILABILITY_APPROVAL_PROVENANCE_PROBE/);
  assert.match(provenance, /Availability rule change did not invalidate approval provenance/);
  assert.doesNotMatch(provenance, /cron\.schedule|insert into cron\./i);

  assert.match(evidence, /107122a6462b95fe766893d19be1f732d2704020184fce55445c2fa1d3b3592e/g);
  assert.match(evidence, /v_claim_count is distinct from 3/);
  assert.match(evidence, /Cron remains explicitly unauthorised/);
  assert.match(evidence, /appointment_duration_minutes is null/);
  assert.match(evidence, /exists \(select 1 from public\.booking_slots\)/);
  assert.doesNotMatch(evidence, /insert into public\.booking_slots/i);
  assert.doesNotMatch(evidence, /insert into private\.booking_availability_policies/i);
});
