import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_SERVICES = new Map([
  ['dxa-bone-density', 'DXA Bone Density'],
  ['dxa-body-composition', 'DXA Body Composition'],
]);
const APPROVAL_FIELDS = [
  'clinicalAndEquipmentAvailabilityRef',
  'staffAndEquipmentRotaRef',
  'approvedBy',
  'peerReviewedBy',
  'approvedAt',
  'evidenceDocumentKey',
  'changeReference',
];
const OPERATIONS_FIELDS = [
  'scheduleOwner',
  'deputyScheduleOwner',
  'dailyMonitorOwner',
  'alertRecipient',
  'rollbackAuthority',
  'rehearsalEvidenceRef',
  'syntheticJourneyEvidenceRef',
  'initialMaterializationApprovedBy',
  'initialMaterializationApprovedAt',
];

const isNonemptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isIsoTimestamp = (value) => isNonemptyString(value) && Number.isFinite(Date.parse(value));
const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
const isTime = (value) => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const timeMinutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

function pushIf(errors, condition, message) {
  if (condition) errors.push(message);
}

function validateSnapshot(manifest, errors) {
  pushIf(errors, manifest.schemaVersion !== 1, 'schemaVersion must be 1');
  pushIf(errors, manifest.source?.timezone !== 'Africa/Johannesburg', 'source timezone must be Africa/Johannesburg');
  for (const field of [
    'observedPolicyCount',
    'observedRuleCount',
    'observedExceptionCount',
    'observedSlotCount',
    'observedConflictCount',
    'observedBookingCount',
  ]) pushIf(errors, manifest.source?.[field] !== 0, `${field} must remain zero in the prepared snapshot`);

  pushIf(errors, !Array.isArray(manifest.appointmentServices), 'appointmentServices must be an array');
  if (!Array.isArray(manifest.appointmentServices)) return;
  pushIf(errors, manifest.appointmentServices.length !== 2, 'exactly two DXA appointment services are required');
  const slugs = manifest.appointmentServices.map((service) => service?.slug);
  pushIf(errors, new Set(slugs).size !== slugs.length, 'appointment service slugs must be unique');
  for (const service of manifest.appointmentServices) {
    pushIf(errors, EXPECTED_SERVICES.get(service?.slug) !== service?.name, `${service?.slug ?? 'missing'}: service identity differs`);
    pushIf(errors, service?.currentBookingMode !== 'appointment', `${service?.slug}: current booking mode must be appointment`);
    pushIf(errors, service?.currentDurationMinutes !== null, `${service?.slug}: current duration snapshot must be null`);
    pushIf(errors, service?.currentVerificationStatus !== 'needs_confirmation', `${service?.slug}: current verification snapshot must be needs_confirmation`);
  }
  for (const slug of EXPECTED_SERVICES.keys()) pushIf(errors, !slugs.includes(slug), `missing appointment service: ${slug}`);
}

function validateDraft(manifest, errors) {
  pushIf(errors, manifest.status !== 'prepared-not-approved', 'draft status must be prepared-not-approved');
  pushIf(errors, manifest.activationAuthorized !== false, 'draft activationAuthorized must be false');
  for (const service of manifest.appointmentServices ?? []) pushIf(errors, service.approval !== null, `${service.slug}: draft approval must be null`);
  pushIf(errors, !Array.isArray(manifest.wholePracticeClosures) || manifest.wholePracticeClosures.length !== 0, 'draft wholePracticeClosures must be empty');
  pushIf(errors, manifest.wholePracticeClosureReview?.reviewed !== false, 'draft closure review must be false');
  for (const field of ['reviewedBy', 'reviewedAt', 'sourceRef']) pushIf(errors, manifest.wholePracticeClosureReview?.[field] !== null, `draft wholePracticeClosureReview.${field} must be null`);
  for (const [key, value] of Object.entries(manifest.operationsApproval ?? {})) pushIf(errors, value !== null, `draft operationsApproval.${key} must be null`);
  pushIf(errors, manifest.cronActivation?.authorized !== false, 'Cron must remain unauthorized');
  for (const [key, value] of Object.entries(manifest.cronActivation ?? {})) {
    if (key !== 'authorized') pushIf(errors, value !== null, `draft cronActivation.${key} must be null`);
  }
}

function validateWeeklyRules(slug, rules, errors) {
  if (!Array.isArray(rules) || rules.length === 0) {
    errors.push(`${slug}: weeklyRules must be a nonempty array`);
    return;
  }
  const byWeekday = new Map();
  for (const [index, rule] of rules.entries()) {
    const prefix = `${slug}: weeklyRules[${index}]`;
    pushIf(errors, !Number.isInteger(rule?.weekday) || rule.weekday < 0 || rule.weekday > 6, `${prefix}.weekday must be 0-6`);
    pushIf(errors, !isTime(rule?.startsAt), `${prefix}.startsAt must use HH:MM`);
    pushIf(errors, !isTime(rule?.endsAt), `${prefix}.endsAt must use HH:MM`);
    if (isTime(rule?.startsAt) && isTime(rule?.endsAt)) pushIf(errors, timeMinutes(rule.endsAt) <= timeMinutes(rule.startsAt), `${prefix} must end after it starts`);
    pushIf(errors, rule?.validFrom !== null && rule?.validFrom !== undefined && !isDate(rule.validFrom), `${prefix}.validFrom must be null or YYYY-MM-DD`);
    pushIf(errors, rule?.validUntil !== null && rule?.validUntil !== undefined && !isDate(rule.validUntil), `${prefix}.validUntil must be null or YYYY-MM-DD`);
    if (isDate(rule?.validFrom) && isDate(rule?.validUntil)) pushIf(errors, rule.validUntil < rule.validFrom, `${prefix}.validUntil must not precede validFrom`);
    if (Number.isInteger(rule?.weekday) && isTime(rule?.startsAt) && isTime(rule?.endsAt)) {
      const list = byWeekday.get(rule.weekday) ?? [];
      list.push([timeMinutes(rule.startsAt), timeMinutes(rule.endsAt), index]);
      byWeekday.set(rule.weekday, list);
    }
  }
  for (const [weekday, ranges] of byWeekday) {
    ranges.sort((a, b) => a[0] - b[0]);
    for (let index = 1; index < ranges.length; index += 1) {
      pushIf(errors, ranges[index][0] < ranges[index - 1][1], `${slug}: weekly rules overlap on weekday ${weekday}`);
    }
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
  pushIf(errors, !isNonemptyString(approval.peerReviewedBy), `${service.slug}: peerReviewedBy is required`);
  pushIf(errors, isNonemptyString(approval.approvedBy) && approval.approvedBy === approval.peerReviewedBy, `${service.slug}: peer reviewer must differ from approver`);
  pushIf(errors, !isIsoTimestamp(approval.approvedAt), `${service.slug}: approvedAt must be an ISO timestamp`);
  pushIf(errors, !isNonemptyString(approval.evidenceDocumentKey), `${service.slug}: evidenceDocumentKey is required`);
  pushIf(errors, !isNonemptyString(approval.changeReference) || approval.changeReference.length < 8, `${service.slug}: changeReference must be at least 8 characters`);
  if (approval.decision === 'hold') {
    pushIf(errors, !isNonemptyString(approval.holdReason), `${service.slug}: holdReason is required`);
    return;
  }
  for (const field of APPROVAL_FIELDS) pushIf(errors, !isNonemptyString(approval[field]), `${service.slug}: ${field} is required for approval`);
  pushIf(errors, !Number.isInteger(approval.appointmentDurationMinutes) || approval.appointmentDurationMinutes < 5 || approval.appointmentDurationMinutes > 480, `${service.slug}: appointmentDurationMinutes must be 5-480`);
  pushIf(errors, !Number.isInteger(approval.horizonDays) || approval.horizonDays < 1 || approval.horizonDays > 90, `${service.slug}: horizonDays must be 1-90`);
  pushIf(errors, !Number.isInteger(approval.minimumNoticeMinutes) || approval.minimumNoticeMinutes < 0 || approval.minimumNoticeMinutes > 129600, `${service.slug}: minimumNoticeMinutes must be 0-129600`);
  if (Number.isInteger(approval.horizonDays) && Number.isInteger(approval.minimumNoticeMinutes)) pushIf(errors, approval.minimumNoticeMinutes > approval.horizonDays * 1440, `${service.slug}: minimum notice cannot exceed horizon`);
  pushIf(errors, !Number.isInteger(approval.bufferMinutes) || approval.bufferMinutes < 0 || approval.bufferMinutes > 1440, `${service.slug}: bufferMinutes must be 0-1440`);
  pushIf(errors, approval.slotCapacity !== 1, `${service.slug}: slotCapacity must equal 1`);
  pushIf(errors, approval.timezone !== 'Africa/Johannesburg', `${service.slug}: timezone must be Africa/Johannesburg`);
  validateWeeklyRules(service.slug, approval.weeklyRules, errors);
  pushIf(errors, !Array.isArray(approval.serviceExceptions), `${service.slug}: serviceExceptions must be a reviewed array`);
}

function validateClosures(manifest, errors) {
  const review = manifest.wholePracticeClosureReview ?? {};
  pushIf(errors, review.reviewed !== true, 'whole-practice closure review must be complete');
  pushIf(errors, !isNonemptyString(review.reviewedBy), 'wholePracticeClosureReview.reviewedBy is required');
  pushIf(errors, !isIsoTimestamp(review.reviewedAt), 'wholePracticeClosureReview.reviewedAt must be an ISO timestamp');
  pushIf(errors, !isNonemptyString(review.sourceRef), 'wholePracticeClosureReview.sourceRef is required');
  pushIf(errors, !Array.isArray(manifest.wholePracticeClosures), 'wholePracticeClosures must be a reviewed array');
  for (const [index, closure] of (manifest.wholePracticeClosures ?? []).entries()) {
    const prefix = `wholePracticeClosures[${index}]`;
    pushIf(errors, !isDate(closure?.date), `${prefix}.date must be YYYY-MM-DD`);
    const hasStart = closure?.startsAt !== null && closure?.startsAt !== undefined;
    const hasEnd = closure?.endsAt !== null && closure?.endsAt !== undefined;
    pushIf(errors, hasStart !== hasEnd, `${prefix} must specify both startsAt and endsAt or neither`);
    if (hasStart && hasEnd) {
      pushIf(errors, !isTime(closure.startsAt) || !isTime(closure.endsAt), `${prefix} times must use HH:MM`);
      if (isTime(closure.startsAt) && isTime(closure.endsAt)) pushIf(errors, timeMinutes(closure.endsAt) <= timeMinutes(closure.startsAt), `${prefix} must end after it starts`);
    }
    pushIf(errors, !isNonemptyString(closure?.reason), `${prefix}.reason is required`);
  }
}

function validateApproved(manifest, errors) {
  pushIf(errors, manifest.status !== 'approved-policy-not-materialized', 'approved status must be approved-policy-not-materialized');
  pushIf(errors, manifest.activationAuthorized !== true, 'approved activationAuthorized must be true');
  for (const service of manifest.appointmentServices ?? []) validateApprovedService(service, errors);
  pushIf(errors, !(manifest.appointmentServices ?? []).some((service) => service.approval?.decision === 'approve'), 'at least one appointment service must be approved');
  validateClosures(manifest, errors);
  const operations = manifest.operationsApproval ?? {};
  for (const field of OPERATIONS_FIELDS) {
    const value = operations[field];
    pushIf(errors, field === 'initialMaterializationApprovedAt' ? !isIsoTimestamp(value) : !isNonemptyString(value), `operationsApproval.${field} is required`);
  }
  pushIf(errors, !Number.isInteger(operations.initialMaterializationDays) || operations.initialMaterializationDays < 1 || operations.initialMaterializationDays > 14, 'operationsApproval.initialMaterializationDays must be 1-14');
  pushIf(errors, manifest.cronActivation?.authorized !== false, 'Cron must remain unauthorized until post-materialization proof');
  for (const [key, value] of Object.entries(manifest.cronActivation ?? {})) if (key !== 'authorized') pushIf(errors, value !== null, `cronActivation.${key} must remain null before post-materialization proof`);
}

export function validateAvailabilityActivationHandoff(manifest, mode = 'draft') {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['handoff must be a JSON object'];
  validateSnapshot(manifest, errors);
  if (mode === 'draft') validateDraft(manifest, errors);
  else if (mode === 'approved') validateApproved(manifest, errors);
  else errors.push('mode must be draft or approved');
  return errors;
}

export function validateLiveAvailabilityState(manifest, servicesPayload, availabilityBySlug) {
  const errors = [];
  const liveBySlug = new Map((servicesPayload?.services ?? []).map((service) => [service.slug, service]));
  for (const expected of manifest.appointmentServices ?? []) {
    const live = liveBySlug.get(expected.slug);
    if (!live) {
      errors.push(`${expected.slug}: missing from live services response`);
      continue;
    }
    pushIf(errors, live.name !== expected.name, `${expected.slug}: live name differs`);
    pushIf(errors, live.booking_mode !== 'appointment', `${expected.slug}: live booking mode differs`);
    pushIf(errors, live.appointment_duration_minutes !== null, `${expected.slug}: live duration is no longer null`);
    pushIf(errors, live.verification_status !== 'needs_confirmation', `${expected.slug}: live verification status differs`);
    const availability = availabilityBySlug?.[expected.slug];
    pushIf(errors, !availability || !Array.isArray(availability.slots), `${expected.slug}: availability response has no slots array`);
    pushIf(errors, Array.isArray(availability?.slots) && availability.slots.length !== 0, `${expected.slug}: live slots exist but the prepared snapshot records zero`);
  }
  return errors;
}

async function main() {
  const args = process.argv.slice(2);
  const modeIndex = args.indexOf('--mode');
  const mode = modeIndex >= 0 ? args[modeIndex + 1] : 'draft';
  const fileIndex = args.indexOf('--file');
  const filename = fileIndex >= 0 ? args[fileIndex + 1] : path.join(ROOT, 'AVAILABILITY-ACTIVATION-HANDOFF.json');
  const manifest = JSON.parse(await readFile(path.resolve(filename), 'utf8'));
  const errors = validateAvailabilityActivationHandoff(manifest, mode);

  const servicesIndex = args.indexOf('--live-services-url');
  const availabilityIndex = args.indexOf('--availability-base-url');
  if (servicesIndex >= 0 || availabilityIndex >= 0) {
    const servicesUrl = args[servicesIndex + 1];
    const availabilityBaseUrl = args[availabilityIndex + 1];
    for (const [label, value] of [['--live-services-url', servicesUrl], ['--availability-base-url', availabilityBaseUrl]]) {
      if (!isNonemptyString(value) || new URL(value).protocol !== 'https:') throw new Error(`${label} requires an HTTPS URL`);
    }
    const servicesResponse = await fetch(servicesUrl, { headers: { accept: 'application/json' } });
    if (!servicesResponse.ok) throw new Error(`live services request returned HTTP ${servicesResponse.status}`);
    const servicesPayload = await servicesResponse.json();
    const liveBySlug = new Map((servicesPayload?.services ?? []).map((service) => [service.slug, service]));
    const from = new Date();
    const until = new Date(from.getTime() + 44 * 24 * 60 * 60 * 1000);
    const availabilityBySlug = {};
    await Promise.all((manifest.appointmentServices ?? []).map(async ({ slug }) => {
      const service = liveBySlug.get(slug);
      if (!service?.id) return;
      const url = new URL(availabilityBaseUrl);
      url.searchParams.set('route', 'availability');
      url.searchParams.set('service_id', service.id);
      url.searchParams.set('from', from.toISOString());
      url.searchParams.set('until', until.toISOString());
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`${slug} availability request returned HTTP ${response.status}`);
      availabilityBySlug[slug] = await response.json();
    }));
    errors.push(...validateLiveAvailabilityState(manifest, servicesPayload, availabilityBySlug));
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Availability activation handoff ${mode} validation passed.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
