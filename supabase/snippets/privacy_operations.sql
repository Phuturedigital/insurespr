-- InsureSPR private privacy-operations templates.
-- Run only in the Supabase SQL editor as the database owner or an explicitly
-- approved operator role. These tables contain restricted personal and incident
-- information. Never export results to a personal device or paste them into chat,
-- tickets, analytics, email templates or public application logs.

-- 1. Active data-subject and PAIA request queue. Open the contact locator only
-- when handling the request.
select
  request.id,
  request.reference,
  request.request_type,
  request.received_channel,
  request.status,
  request.identity_status,
  request.response_outcome,
  request.assigned_to,
  request.received_at,
  request.acknowledged_at,
  request.responded_at,
  request.updated_at
from private.privacy_request_register as request
where request.status not in ('closed', 'withdrawn')
order by request.received_at;

-- 2. One privacy request's immutable, data-minimised history.
-- Replace REQUEST_UUID; the event snapshots omit requester contact and decision
-- narrative by design.
-- select event.*
-- from private.privacy_request_events as event
-- where event.request_id = 'REQUEST_UUID'
-- order by event.created_at, event.id;

-- 3. Active security-incident queue.
select
  incident.id,
  incident.reference,
  incident.source,
  incident.status,
  incident.determination,
  incident.regulator_notification_status,
  incident.data_subject_notification_status,
  incident.affected_data_subject_count,
  incident.assigned_to,
  incident.discovered_at,
  incident.contained_at,
  incident.updated_at
from private.security_incident_register as incident
where incident.status not in ('closed', 'false_positive')
order by incident.discovered_at;

-- 4. One incident's immutable, data-minimised history.
-- Replace INCIDENT_UUID; the event snapshots omit the incident narrative and
-- affected-person details by design.
-- select event.*
-- from private.security_incident_events as event
-- where event.incident_id = 'INCIDENT_UUID'
-- order by event.created_at, event.id;

-- 5. Count-only compliance retention review. This never authorises deletion.
select * from private.privacy_operations_inventory();

-- 6. Open a privacy request. Keep requester_contact to the minimum locator
-- needed to handle the request. Do not store an identity-document image, medical
-- history or a full mailbox message in this register.
-- insert into private.privacy_request_register(
--   request_type,
--   received_channel,
--   requester_contact,
--   assigned_to,
--   last_changed_by,
--   change_reason
-- ) values (
--   'access', -- access/correction/deletion/restriction/objection/other
--   'email',
--   'REQUESTER CONTACT LOCATOR',
--   'NAMED APPROVED OWNER',
--   'NAMED APPROVED OPERATOR',
--   'Request received through the approved privacy mailbox'
-- )
-- returning id, reference, status, received_at;

-- 7. Record acknowledgement and start proportional identity verification.
-- update private.privacy_request_register
-- set
--   status = 'identity_check',
--   acknowledged_at = statement_timestamp(),
--   last_changed_by = 'NAMED APPROVED OPERATOR',
--   change_reason = 'Acknowledged request and began proportional identity verification'
-- where id = 'REQUEST_UUID'
-- returning reference, status, acknowledged_at;

-- 8. Record identity verification by reference to evidence held in controlled
-- custody. Store only the controlled evidence reference here, never the document.
-- update private.privacy_request_register
-- set
--   status = 'under_review',
--   identity_status = 'verified',
--   identity_verified_at = statement_timestamp(),
--   identity_evidence_reference = 'CONTROLLED-EVIDENCE-REFERENCE',
--   last_changed_by = 'NAMED APPROVED OPERATOR',
--   change_reason = 'Identity verified using evidence retained in controlled custody'
-- where id = 'REQUEST_UUID'
-- returning reference, status, identity_status;

-- 9. Record the response. Use only the approved outcome and a defensible basis;
-- do not paste disclosed records into decision_basis.
-- update private.privacy_request_register
-- set
--   status = 'responded',
--   response_outcome = 'fulfilled', -- fulfilled/partially_fulfilled/refused
--   decision_basis = 'APPROVED DECISION BASIS OR CONTROLLED RECORD REFERENCE',
--   responded_at = statement_timestamp(),
--   last_changed_by = 'NAMED APPROVED OPERATOR',
--   change_reason = 'Approved response delivered through the verified contact channel'
-- where id = 'REQUEST_UUID'
-- returning reference, status, response_outcome, responded_at;

-- 10. Close only after the response and any approved action are complete.
-- update private.privacy_request_register
-- set
--   status = 'closed',
--   closed_at = statement_timestamp(),
--   last_changed_by = 'NAMED APPROVED OPERATOR',
--   change_reason = 'Request response and approved follow-up actions completed'
-- where id = 'REQUEST_UUID'
-- returning reference, status, closed_at;

-- 11. Open a reasonably suspected security incident immediately. The summary is
-- a restricted index, not a forensic evidence store: omit names, contact details,
-- credentials, raw logs and compromised record contents.
-- insert into private.security_incident_register(
--   source,
--   summary,
--   assigned_to,
--   last_changed_by,
--   change_reason
-- ) values (
--   'processor', -- internal/processor/data_subject/third_party/other
--   'RESTRICTED NON-PII INCIDENT SUMMARY AND CONTROLLED EVIDENCE REFERENCE',
--   'NAMED INFORMATION OFFICER OR INCIDENT OWNER',
--   'NAMED APPROVED OPERATOR',
--   'Opened incident register entry after the suspected compromise was escalated'
-- )
-- returning id, reference, status, discovered_at;

-- 12. Record the assessment when unauthorised access or acquisition is
-- reasonably believed. Do not delay escalation while waiting for perfect facts.
-- update private.security_incident_register
-- set
--   status = 'investigating',
--   determination = 'reasonably_believed',
--   affected_record_classes = array['WEBSITE RECORD CLASS'],
--   affected_data_subject_count = null, -- retain null while genuinely unknown
--   regulator_notification_status = 'pending',
--   data_subject_notification_status = 'pending',
--   last_changed_by = 'NAMED APPROVED OPERATOR',
--   change_reason = 'Assessment found reasonable grounds to believe unauthorised access occurred'
-- where id = 'INCIDENT_UUID'
-- returning reference, status, determination;

-- 13. Record containment without overwriting discovery evidence.
-- update private.security_incident_register
-- set
--   status = 'contained',
--   contained_at = statement_timestamp(),
--   last_changed_by = 'NAMED APPROVED OPERATOR',
--   change_reason = 'Approved containment actions completed and evidence preserved'
-- where id = 'INCIDENT_UUID'
-- returning reference, status, contained_at;

-- 14. Record the Information Regulator eServices submission. Store only the
-- portal reference, not the submitted form or its attachments.
-- update private.security_incident_register
-- set
--   status = 'notifications_in_progress',
--   regulator_notification_status = 'completed',
--   regulator_notified_at = statement_timestamp(),
--   regulator_reference = 'ESERVICES-SUBMISSION-REFERENCE',
--   last_changed_by = 'NAMED APPROVED OPERATOR',
--   change_reason = 'Section 22 notification submitted through the Regulator eServices portal'
-- where id = 'INCIDENT_UUID'
-- returning reference, regulator_notification_status, regulator_notified_at;

-- 15. Record affected-person notification after it is actually delivered.
-- update private.security_incident_register
-- set
--   data_subject_notification_status = 'completed',
--   data_subjects_notified_at = statement_timestamp(),
--   last_changed_by = 'NAMED APPROVED OPERATOR',
--   change_reason = 'Affected data subjects notified through the approved written channel'
-- where id = 'INCIDENT_UUID'
-- returning reference, data_subject_notification_status, data_subjects_notified_at;

-- 16. Close a confirmed compromise only after regulator and affected-person
-- notification evidence is complete. If notification is impossible, record the
-- approved explanation before closure; do not mark it completed.
-- update private.security_incident_register
-- set
--   status = 'closed',
--   closed_at = statement_timestamp(),
--   last_changed_by = 'NAMED APPROVED OPERATOR',
--   change_reason = 'Investigation, notifications, mitigation and controlled evidence review completed'
-- where id = 'INCIDENT_UUID'
-- returning reference, status, closed_at;
