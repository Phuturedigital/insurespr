import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const EXPECTED_SERVICES = new Map([
  ['primary-healthcare-x-ray', ['Primary Healthcare X-Ray', 'individual', 'request', 'unpublished']],
  ['musculoskeletal-x-ray', ['Musculoskeletal X-Ray', 'individual', 'request', 'unpublished']],
  ['chest-x-ray', ['Chest X-Ray', 'individual', 'request', 'unpublished']],
  ['orthopaedic-follow-up-x-ray', ['Orthopaedic Follow-Up X-Ray', 'individual', 'request', 'unpublished']],
  ['visa-chest-x-ray', ['Administrative & Foreign-Programme Chest X-Ray', 'individual', 'request', 'unpublished']],
  ['workplace-medicals', ['Workplace Medicals', 'workforce', 'quote', 'quote']],
  ['workplace-chest-x-ray', ['Workplace Chest X-Ray', 'workforce', 'quote', 'quote']],
  ['dxa-bone-density', ['DXA Bone Density', 'scanning', 'appointment', 'unpublished']],
  ['dxa-body-composition', ['DXA Body Composition', 'scanning', 'appointment', 'unpublished']],
  ['osteoporosis-care', ['Nurse-led Osteoporosis Care', 'scanning', 'request', 'unpublished']],
  ['runner-athlete-bone-health', ['Runner & Athlete Bone Health', 'scanning', 'request', 'unpublished']],
  ['menopause-bone-health', ['Menopause & Bone Health', 'scanning', 'request', 'unpublished']],
  ['treatment-related-bone-health', ['Treatment-Related Bone Health', 'scanning', 'request', 'unpublished']],
  ['post-fracture-bone-health', ['Post-Fracture Bone Health', 'scanning', 'request', 'unpublished']],
  ['body-composition-progress', ['Body Composition Progress', 'scanning', 'request', 'unpublished']],
  ['long-term-condition-bone-health', ['Long-Term Condition Bone Health', 'scanning', 'request', 'unpublished']],
]);

const GLOBAL_APPROVAL_FIELDS = [
  'legalEntityEvidenceRef',
  'licenceAndEquipmentEvidenceRef',
  'responsiblePractitionerRosterRef',
  'writtenClinicalRequestPolicyRef',
  'reportingAndResultsWorkflowRef',
  'medicalAidAndPaymentPolicyRef',
  'approvedPriceScheduleRef',
  'privacyApprovalRef',
  'finalApprover',
  'finalApprovalAt',
];

const SERVICE_APPROVAL_FIELDS = [
  'capabilityEvidenceRef',
  'responsiblePractitionerRef',
  'bookingMode',
  'confirmationMode',
  'referralRequirement',
  'appointmentRequirement',
  'priceType',
  'currency',
  'medicalAidStatus',
  'whatToBring',
  'expectedDuration',
  'resultsProcess',
  'preparationInstructions',
  'approvedBy',
  'approvedAt',
];

const isNonemptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isIsoTimestamp = (value) => isNonemptyString(value) && Number.isFinite(Date.parse(value));

function pushIf(errors, condition, message) {
  if (condition) errors.push(message);
}

function validateCatalogueShape(manifest, errors) {
  pushIf(errors, manifest.schemaVersion !== 1, 'schemaVersion must be 1');
  pushIf(errors, !Array.isArray(manifest.services), 'services must be an array');
  if (!Array.isArray(manifest.services)) return;
  pushIf(errors, manifest.services.length !== EXPECTED_SERVICES.size, 'exactly 16 services are required');

  const slugs = manifest.services.map((service) => service?.slug);
  pushIf(errors, new Set(slugs).size !== slugs.length, 'service slugs must be unique');

  for (const service of manifest.services) {
    const expected = EXPECTED_SERVICES.get(service?.slug);
    if (!expected) {
      errors.push(`unexpected service slug: ${service?.slug ?? 'missing'}`);
      continue;
    }
    const [name, audience, bookingMode, priceType] = expected;
    pushIf(errors, service.name !== name, `${service.slug}: name differs from the observed catalogue`);
    pushIf(errors, service.audience !== audience, `${service.slug}: audience differs from the observed catalogue`);
    pushIf(errors, service.currentBookingMode !== bookingMode, `${service.slug}: current booking mode differs from the observed catalogue`);
    pushIf(errors, service.currentPriceType !== priceType, `${service.slug}: current price type differs from the observed catalogue`);
    pushIf(errors, service.currentVerificationStatus !== 'needs_confirmation', `${service.slug}: snapshot must remain needs_confirmation`);
  }

  for (const slug of EXPECTED_SERVICES.keys()) {
    pushIf(errors, !slugs.includes(slug), `missing service slug: ${slug}`);
  }
}

function validateDraft(manifest, errors) {
  pushIf(errors, manifest.status !== 'prepared-not-approved', 'draft status must be prepared-not-approved');
  pushIf(errors, manifest.activationAuthorized !== false, 'draft activationAuthorized must be false');
  pushIf(errors, manifest.source?.observedServiceCount !== 16, 'observed service count must be 16');
  pushIf(errors, manifest.source?.observedVerificationStatus !== 'needs_confirmation', 'observed verification state must be needs_confirmation');

  for (const [key, value] of Object.entries(manifest.globalEvidence ?? {})) {
    pushIf(errors, value !== null, `draft globalEvidence.${key} must be null`);
  }
  for (const service of manifest.services ?? []) {
    pushIf(errors, service.approval !== null, `${service.slug}: draft approval must be null`);
  }
}

function validateApprovedService(service, errors) {
  const approval = service.approval;
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)) {
    errors.push(`${service.slug}: approval object is required`);
    return;
  }
  pushIf(errors, !['approve', 'hold'].includes(approval.decision), `${service.slug}: decision must be approve or hold`);
  pushIf(errors, !isNonemptyString(approval.approvedBy), `${service.slug}: approvedBy is required`);
  pushIf(errors, !isIsoTimestamp(approval.approvedAt), `${service.slug}: approvedAt must be an ISO timestamp`);
  pushIf(errors, !Array.isArray(approval.evidenceRefs) || approval.evidenceRefs.length === 0 || approval.evidenceRefs.some((ref) => !isNonemptyString(ref)), `${service.slug}: nonempty evidenceRefs are required`);

  if (approval.decision === 'hold') {
    pushIf(errors, !isNonemptyString(approval.holdReason), `${service.slug}: holdReason is required for a hold`);
    return;
  }

  for (const field of SERVICE_APPROVAL_FIELDS) {
    pushIf(errors, !isNonemptyString(approval[field]), `${service.slug}: ${field} is required for approval`);
  }
  pushIf(errors, !isNonemptyString(approval.licenceAndEquipmentApplicabilityRef), `${service.slug}: licence/equipment applicability evidence is required`);
  pushIf(errors, !['walk_in', 'appointment', 'request', 'quote'].includes(approval.bookingMode), `${service.slug}: invalid bookingMode`);
  pushIf(errors, !['instant', 'staff'].includes(approval.confirmationMode), `${service.slug}: invalid confirmationMode`);
  pushIf(errors, !['fixed', 'from', 'range', 'quote', 'unpublished'].includes(approval.priceType), `${service.slug}: invalid priceType`);
  pushIf(errors, approval.currency !== 'ZAR', `${service.slug}: currency must be ZAR`);

  if (approval.bookingMode === 'appointment') {
    pushIf(errors, !Number.isInteger(approval.appointmentDurationMinutes) || approval.appointmentDurationMinutes < 5 || approval.appointmentDurationMinutes > 480, `${service.slug}: appointmentDurationMinutes must be 5-480`);
    pushIf(errors, !isNonemptyString(approval.availabilityPolicyRef), `${service.slug}: availabilityPolicyRef is required for appointment booking`);
  }
  if (['fixed', 'from', 'range'].includes(approval.priceType)) {
    pushIf(errors, !Number.isInteger(approval.cashPriceCents) || approval.cashPriceCents < 0, `${service.slug}: cashPriceCents is required for ${approval.priceType}`);
  }
  if (approval.priceType === 'range') {
    pushIf(errors, !Number.isInteger(approval.cashPriceMaxCents) || approval.cashPriceMaxCents < approval.cashPriceCents, `${service.slug}: cashPriceMaxCents must be at least cashPriceCents`);
  }
}

function validateApproved(manifest, errors) {
  pushIf(errors, manifest.status !== 'approved', 'approved status must be approved');
  pushIf(errors, manifest.activationAuthorized !== true, 'approved activationAuthorized must be true');
  for (const field of GLOBAL_APPROVAL_FIELDS) {
    const value = manifest.globalEvidence?.[field];
    pushIf(errors, field === 'finalApprovalAt' ? !isIsoTimestamp(value) : !isNonemptyString(value), `globalEvidence.${field} is required`);
  }
  for (const service of manifest.services ?? []) validateApprovedService(service, errors);

  const approvedServices = (manifest.services ?? []).filter((service) => service.approval?.decision === 'approve');
  pushIf(errors, approvedServices.length === 0, 'at least one service must be approved');
  if (approvedServices.some((service) => service.approval?.bookingMode === 'appointment')) {
    pushIf(errors, !isNonemptyString(manifest.globalEvidence?.availabilityPolicyRef), 'globalEvidence.availabilityPolicyRef is required when appointment booking is approved');
  }
}

export function validateServiceActivationHandoff(manifest, mode = 'draft') {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['handoff must be a JSON object'];
  }
  validateCatalogueShape(manifest, errors);
  if (mode === 'draft') validateDraft(manifest, errors);
  else if (mode === 'approved') validateApproved(manifest, errors);
  else errors.push('mode must be draft or approved');
  return errors;
}

export function validateLiveServiceCatalogue(manifest, payload) {
  const errors = [];
  const liveServices = Array.isArray(payload?.services) ? payload.services : [];
  pushIf(errors, liveServices.length !== 16, 'live services response must contain exactly 16 services');
  const liveBySlug = new Map(liveServices.map((service) => [service?.slug, service]));

  for (const service of manifest.services ?? []) {
    const live = liveBySlug.get(service.slug);
    if (!live) {
      errors.push(`${service.slug}: missing from live services response`);
      continue;
    }
    pushIf(errors, live.name !== service.name, `${service.slug}: live name differs from the handoff`);
    pushIf(errors, live.audience !== service.audience, `${service.slug}: live audience differs from the handoff`);
    pushIf(errors, live.booking_mode !== service.currentBookingMode, `${service.slug}: live booking mode differs from the handoff`);
    pushIf(errors, live.price_type !== service.currentPriceType, `${service.slug}: live price type differs from the handoff`);
    pushIf(errors, live.verification_status !== service.currentVerificationStatus, `${service.slug}: live verification status differs from the handoff`);
  }
  for (const live of liveServices) {
    pushIf(errors, !EXPECTED_SERVICES.has(live?.slug), `unexpected live service slug: ${live?.slug ?? 'missing'}`);
  }
  return errors;
}

async function main() {
  const args = process.argv.slice(2);
  const modeIndex = args.indexOf('--mode');
  const mode = modeIndex >= 0 ? args[modeIndex + 1] : 'draft';
  const fileIndex = args.indexOf('--file');
  const filename = fileIndex >= 0 ? args[fileIndex + 1] : path.join(ROOT, 'SERVICE-ACTIVATION-HANDOFF.json');
  const manifest = JSON.parse(await readFile(path.resolve(filename), 'utf8'));
  const errors = validateServiceActivationHandoff(manifest, mode);
  const liveIndex = args.indexOf('--live-url');
  if (liveIndex >= 0) {
    const liveUrl = args[liveIndex + 1];
    if (!isNonemptyString(liveUrl)) throw new Error('--live-url requires an HTTPS URL');
    const parsedUrl = new URL(liveUrl);
    if (parsedUrl.protocol !== 'https:') throw new Error('--live-url must use HTTPS');
    const response = await fetch(parsedUrl, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`live services request returned HTTP ${response.status}`);
    errors.push(...validateLiveServiceCatalogue(manifest, await response.json()));
  }
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Service activation handoff ${mode} validation passed for ${manifest.services.length} services.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
