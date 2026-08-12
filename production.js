/* InsureSPR Precision Healthcare production integrations.
 *
 * The static site remains usable without this file: telephone, email, WhatsApp
 * and directions are ordinary links. JavaScript progressively adds structured
 * booking, quote, contact, management and measurement flows.
 */
(function () {
  'use strict';

  var API = 'https://ffdmmxffzewqiacsuvhr.supabase.co/functions/v1/insurespr-api';
  var WHATSAPP_NUMBER = '27834507861';
  var STORAGE_PREFIX = 'insurespr.';
  var configPromise;

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (char) {
      var value = Math.random() * 16 | 0;
      return (char === 'x' ? value : (value & 3 | 8)).toString(16);
    });
  }

  function safeStorage(storage, method, key, value) {
    try {
      return method === 'getItem' ? storage.getItem(key) : storage.setItem(key, value);
    } catch (_) {
      return null;
    }
  }

  function sessionId() {
    var key = STORAGE_PREFIX + 'session';
    var existing = safeStorage(sessionStorage, 'getItem', key);
    if (existing) return existing;
    var created = uuid();
    safeStorage(sessionStorage, 'setItem', key, created);
    return created;
  }

  function captureMarketing() {
    var key = STORAGE_PREFIX + 'marketing';
    var existing = safeStorage(sessionStorage, 'getItem', key);
    if (existing) {
      try { return JSON.parse(existing); } catch (_) { /* replace malformed local state */ }
    }

    var params = new URLSearchParams(window.location.search);
    var context = {
      utm_source: params.get('utm_source') || null,
      utm_medium: params.get('utm_medium') || null,
      utm_campaign: params.get('utm_campaign') || null,
      utm_term: params.get('utm_term') || null,
      utm_content: params.get('utm_content') || null,
      landing_path: window.location.pathname,
      referrer_host: null
    };
    if (document.referrer) {
      try { context.referrer_host = new URL(document.referrer).hostname; } catch (_) { /* ignore */ }
    }
    safeStorage(sessionStorage, 'setItem', key, JSON.stringify(context));
    return context;
  }

  var marketing = captureMarketing();

  function api(path, options) {
    var init = options || {};
    init.headers = Object.assign({ 'Content-Type': 'application/json' }, init.headers || {});
    return fetch(API + path, init).then(function (response) {
      if (response.status === 204) return null;
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) {
          var error = new Error(body.error && body.error.message || 'Something went wrong. Please try again.');
          error.code = body.error && body.error.code;
          error.status = response.status;
          throw error;
        }
        return body;
      });
    });
  }

  function getConfig() {
    if (!configPromise) {
      configPromise = api('/services').catch(function (error) {
        if (error.status !== 502 && error.status !== 503 && error.status !== 504) throw error;
        return new Promise(function (resolve) { window.setTimeout(resolve, 650); }).then(function () {
          return api('/services');
        });
      });
    }
    return configPromise;
  }

  function setStatus(form, message, kind) {
    var target = document.getElementById(form.id.replace('-form', '-status'));
    if (!target) return;
    target.hidden = false;
    target.classList.remove('note--warn', 'note--success');
    if (kind === 'error') target.classList.add('note--warn');
    if (kind === 'success') target.classList.add('note--success');
    target.textContent = message;
    target.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function clearStatus(form) {
    var target = document.getElementById(form.id.replace('-form', '-status'));
    if (!target) return;
    target.hidden = true;
    target.textContent = '';
  }

  function setBusy(form, busy) {
    var button = form.querySelector('[type="submit"]');
    if (!button) return;
    button.disabled = busy;
    if (!button.dataset.label) button.dataset.label = button.textContent.trim();
    button.textContent = busy ? 'Sending…' : button.dataset.label;
    form.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function value(form, name) {
    var field = form.elements[name];
    return field ? String(field.value || '').trim() : '';
  }

  function checked(form, name) {
    var field = form.elements[name];
    return Boolean(field && field.checked);
  }

  function basePayload(form) {
    return {
      idempotency_key: form.dataset.idempotency || (form.dataset.idempotency = uuid()),
      website: value(form, 'website'),
      privacy_accepted: checked(form, 'privacy_accepted'),
      marketing: marketing
    };
  }

  function selectText(select) {
    if (!select || select.selectedIndex < 0) return '';
    return select.options[select.selectedIndex].text;
  }

  function formatDate(date) {
    if (!date) return 'No date selected';
    var parsed = new Date(date + 'T12:00:00+02:00');
    if (Number.isNaN(parsed.valueOf())) return date;
    return new Intl.DateTimeFormat('en-ZA', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(parsed);
  }

  function formatSlot(iso) {
    var date = new Date(iso);
    return new Intl.DateTimeFormat('en-ZA', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Johannesburg'
    }).format(date);
  }

  function formatPrice(service) {
    if (!service || service.price_type === 'unpublished') {
      return 'Price awaiting practice approval — call 083 450 7861 to confirm.';
    }
    if (service.price_type === 'quote') return 'Employer pricing is provided by quote.';
    var formatter = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });
    var start = formatter.format(service.cash_price_cents / 100);
    if (service.price_type === 'range' && service.cash_price_max_cents) {
      return start + '–' + formatter.format(service.cash_price_max_cents / 100);
    }
    return service.price_type === 'from' ? 'From ' + start : start;
  }

  function track(eventName, serviceId) {
    var payload = {
      event_name: eventName,
      anonymous_session_id: sessionId(),
      page_path: window.location.pathname,
      service_id: serviceId || null,
      marketing: marketing,
      website: ''
    };
    return api('/events', {
      method: 'POST',
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(function () { /* Analytics must never block a visitor action. */ });
  }

  document.querySelectorAll('[data-track]').forEach(function (element) {
    element.addEventListener('click', function () {
      track(element.getAttribute('data-track'), element.getAttribute('data-service-id'));
    });
  });

  function trackServiceView() {
    var slug = document.body && document.body.getAttribute('data-service-slug');
    if (!slug) return;
    var storageKey = STORAGE_PREFIX + 'viewed.' + window.location.pathname;
    if (safeStorage(sessionStorage, 'getItem', storageKey)) return;

    getConfig().then(function (config) {
      var service = (config.services || []).find(function (candidate) {
        return candidate.slug === slug;
      });
      if (!service) return;
      safeStorage(sessionStorage, 'setItem', storageKey, '1');
      track('service_viewed', service.id);
    }).catch(function () { /* Measurement must never affect the page journey. */ });
  }

  function bindBookingForm() {
    var form = document.getElementById('book-form');
    if (!form) return;

    var serviceSelect = form.elements.service_id;
    var dateInput = form.elements.preferred_date;
    var periodField = document.getElementById('preferred-period-field');
    var slotField = document.getElementById('slot-field');
    var slotList = document.getElementById('slot-options');
    var slotNote = document.getElementById('slot-note');
    var serviceFacts = document.getElementById('booking-service-facts');
    var whatsapp = document.getElementById('booking-whatsapp');
    var completed = false;
    var started = false;
    var servicesById = {};

    dateInput.min = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });

    function renderServiceFacts() {
      var service = servicesById[serviceSelect.value];
      if (!service || !serviceFacts) return;
      serviceFacts.hidden = false;
      serviceFacts.querySelector('[data-service-price]').textContent = formatPrice(service);
      serviceFacts.querySelector('[data-service-requirement]').textContent = service.appointment_requirement || 'Appointment requirements still need practice confirmation.';
      serviceFacts.querySelector('[data-service-verification]').hidden = service.verification_status === 'verified';
      if (service.price_type !== 'unpublished') track('price_viewed', service.id);
    }

    function renderSlots(slots) {
      slotList.textContent = '';
      if (!slots.length) {
        slotField.hidden = true;
        periodField.hidden = false;
        slotNote.hidden = false;
        slotNote.textContent = 'No live slots have been published for this date. Submit a preferred time and the practice will confirm availability.';
        return;
      }

      slotField.hidden = false;
      periodField.hidden = true;
      slotNote.hidden = false;
      slotNote.textContent = 'Choose one of the times currently available. The server checks it again when you submit.';
      slots.forEach(function (slot, index) {
        var label = document.createElement('label');
        label.className = 'slot-option';
        var input = document.createElement('input');
        input.type = 'radio';
        input.name = 'slot_id';
        input.value = slot.slot_id;
        input.required = index === 0;
        var span = document.createElement('span');
        span.textContent = formatSlot(slot.starts_at);
        label.append(input, span);
        slotList.appendChild(label);
      });
    }

    function loadAvailability() {
      var service = servicesById[serviceSelect.value];
      var date = dateInput.value;
      if (!service || !date || service.booking_mode !== 'appointment') {
        renderSlots([]);
        return;
      }
      slotNote.hidden = false;
      slotNote.textContent = 'Checking available times…';
      var from = new Date(date + 'T00:00:00+02:00');
      var until = new Date(from.valueOf() + 86_400_000);
      api('/availability?service_id=' + encodeURIComponent(service.id) + '&from=' + encodeURIComponent(from.toISOString()) + '&until=' + encodeURIComponent(until.toISOString()))
        .then(function (body) { renderSlots(body.slots || []); })
        .catch(function () {
          renderSlots([]);
          slotNote.textContent = 'Live availability could not be loaded. You can still submit a preferred time for staff confirmation.';
        });
    }

    getConfig().then(function (config) {
      var requested = new URLSearchParams(window.location.search).get('service');
      serviceSelect.textContent = '';
      var placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Choose a service';
      serviceSelect.appendChild(placeholder);
      config.services.filter(function (service) {
        return service.booking_mode === 'appointment' || service.booking_mode === 'request';
      }).forEach(function (service) {
        servicesById[service.id] = service;
        var option = document.createElement('option');
        option.value = service.id;
        option.textContent = service.name;
        option.dataset.slug = service.slug;
        if (requested === service.slug) option.selected = true;
        serviceSelect.appendChild(option);
      });
      if (serviceSelect.value) {
        renderServiceFacts();
        loadAvailability();
      }
    }).catch(function () {
      setStatus(form, 'Services could not be loaded. Please call 083 450 7861 or try again.', 'error');
      serviceSelect.disabled = true;
    });

    serviceSelect.addEventListener('change', function () {
      renderServiceFacts();
      loadAvailability();
    });
    dateInput.addEventListener('change', loadAvailability);

    form.addEventListener('input', function () {
      if (!started) {
        started = true;
        track('booking_started', serviceSelect.value || null);
      }
    }, { once: true });

    if (whatsapp) whatsapp.addEventListener('click', function () {
      var name = [value(form, 'first_name'), value(form, 'surname')].filter(Boolean).join(' ');
      var message = [
        "Hi InsureSPR, I'd like to request a booking.",
        '',
        'Service: ' + (selectText(serviceSelect) || 'Not selected'),
        'Name: ' + (name || 'Not entered'),
        'Preferred date: ' + formatDate(value(form, 'preferred_date')),
        'Preferred time: ' + (value(form, 'preferred_time_period') || 'Any'),
        'New/returning patient: ' + (value(form, 'patient_status') || 'Not selected'),
        '',
        'Please confirm availability.'
      ].join('\n');
      track('whatsapp_clicked', serviceSelect.value || null);
      window.open('https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(message), '_blank', 'noopener');
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      clearStatus(form);
      if (!form.reportValidity()) return;
      setBusy(form, true);
      var slot = form.querySelector('input[name="slot_id"]:checked');
      var payload = Object.assign(basePayload(form), {
        first_name: value(form, 'first_name'),
        surname: value(form, 'surname'),
        mobile: value(form, 'mobile'),
        email: value(form, 'email'),
        service_id: value(form, 'service_id'),
        slot_id: slot ? slot.value : null,
        preferred_date: value(form, 'preferred_date'),
        preferred_time_period: value(form, 'preferred_time_period') || 'any',
        patient_status: value(form, 'patient_status'),
        notes: value(form, 'notes') || null
      });
      api('/bookings', { method: 'POST', body: JSON.stringify(payload) }).then(function (body) {
        completed = true;
        safeStorage(sessionStorage, 'setItem', STORAGE_PREFIX + 'lastBooking', JSON.stringify(body.booking));
        track('booking_completed', payload.service_id);
        window.location.assign('booking-confirmation.html');
      }).catch(function (error) {
        if (error.code === 'SLOT_UNAVAILABLE') loadAvailability();
        setStatus(form, error.message, 'error');
        setBusy(form, false);
      });
    });

    window.addEventListener('pagehide', function () {
      if (started && !completed) track('booking_abandoned', serviceSelect.value || null);
    });
  }

  function bindContactForm() {
    var form = document.getElementById('contact-form');
    if (!form) return;
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      clearStatus(form);
      if (!form.reportValidity()) return;
      setBusy(form, true);
      var payload = Object.assign(basePayload(form), {
        name: value(form, 'name'),
        email: value(form, 'email'),
        phone: value(form, 'phone') || null,
        enquiry_type: value(form, 'enquiry_type') || 'general',
        message: value(form, 'message')
      });
      api('/contact-enquiries', { method: 'POST', body: JSON.stringify(payload) }).then(function (body) {
        setStatus(form, 'Thank you. Your enquiry reference is ' + body.enquiry.reference + '. Save the reference and call the practice if your question is time-sensitive.', 'success');
        form.reset();
        form.dataset.idempotency = '';
        setBusy(form, false);
      }).catch(function (error) {
        setStatus(form, error.message, 'error');
        setBusy(form, false);
      });
    });
  }

  function bindEmployerForm() {
    var form = document.getElementById('employer-form');
    if (!form) return;
    var started = false;
    form.addEventListener('input', function () {
      if (!started) {
        started = true;
        track('quote_started');
      }
    }, { once: true });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      clearStatus(form);
      if (!form.reportValidity()) return;
      var services = Array.prototype.map.call(form.querySelectorAll('input[name="services_required"]:checked'), function (field) { return field.value; });
      var servicesError = document.getElementById('employer-services-error');
      if (!services.length) {
        if (servicesError) {
          servicesError.hidden = false;
          servicesError.setAttribute('role', 'alert');
        }
        var firstService = form.querySelector('input[name="services_required"]');
        if (firstService) firstService.focus();
        return;
      }
      if (servicesError) servicesError.hidden = true;
      setBusy(form, true);
      var payload = Object.assign(basePayload(form), {
        contact_name: value(form, 'contact_name'),
        company_name: value(form, 'company_name'),
        work_email: value(form, 'work_email'),
        phone: value(form, 'phone'),
        employee_count_range: value(form, 'employee_count_range'),
        services_required: services,
        preferred_timeframe: value(form, 'preferred_timeframe') || null,
        delivery_mode: value(form, 'delivery_mode') || 'needs_advice',
        location: value(form, 'location') || null,
        notes: value(form, 'notes') || null
      });
      api('/employer-leads', { method: 'POST', body: JSON.stringify(payload) }).then(function (body) {
        track('quote_submitted');
        setStatus(form, 'Thank you. Your quote-request reference is ' + body.lead.reference + '. InsureSPR will use the contact details you supplied to follow up.', 'success');
        form.reset();
        form.dataset.idempotency = '';
        setBusy(form, false);
      }).catch(function (error) {
        setStatus(form, error.message, 'error');
        setBusy(form, false);
      });
    });
  }

  function renderConfirmation() {
    var root = document.getElementById('booking-confirmation');
    if (!root) return;
    var raw = safeStorage(sessionStorage, 'getItem', STORAGE_PREFIX + 'lastBooking');
    if (!raw) {
      root.querySelector('[data-confirmation-empty]').hidden = false;
      root.querySelector('[data-confirmation-details]').hidden = true;
      return;
    }
    try {
      var booking = JSON.parse(raw);
      root.querySelector('[data-booking-reference]').textContent = booking.reference || 'Unavailable';
      root.querySelector('[data-booking-service]').textContent = booking.service_name || 'Requested service';
      root.querySelector('[data-booking-date]').textContent = booking.slot_start ? formatSlot(booking.slot_start) : formatDate(booking.preferred_date) + ' · ' + (booking.preferred_time_period || 'Any time');
      root.querySelector('[data-booking-state]').textContent = booking.status === 'confirmed'
        ? 'Confirmed'
        : 'Request received — awaiting staff confirmation';
      var manage = root.querySelector('[data-manage-booking]');
      if (booking.management_token) {
        manage.href = 'manage-booking.html?token=' + encodeURIComponent(booking.management_token);
        manage.hidden = false;
      }
      var calendar = root.querySelector('[data-add-calendar]');
      if (calendar && booking.status === 'confirmed' && booking.slot_start) {
        calendar.hidden = false;
        calendar.addEventListener('click', function () {
          getConfig().catch(function () { return {}; }).then(function (config) {
            downloadCalendar(booking, config.practice || {});
          });
        }, { once: true });
      }
    } catch (_) {
      root.querySelector('[data-confirmation-empty]').hidden = false;
      root.querySelector('[data-confirmation-details]').hidden = true;
    }
  }

  function calendarTimestamp(iso) {
    var date = new Date(iso);
    if (Number.isNaN(date.valueOf())) return '';
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  function calendarText(value) {
    return String(value || '')
      .replace(/\\/g, '\\\\')
      .replace(/\r?\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
  }

  function downloadCalendar(booking, practice) {
    var startsAt = calendarTimestamp(booking.slot_start);
    if (!startsAt) return;
    var createdAt = calendarTimestamp(new Date().toISOString());
    var reference = calendarText(booking.reference || 'booking');
    var service = calendarText(booking.service_name || 'InsureSPR appointment');
    var address = [practice.address_line, practice.locality, practice.region]
      .filter(Boolean).join(', ');
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//InsureSPR//Booking//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:' + reference + '@insuresprhealth.co.za',
      'DTSTAMP:' + createdAt,
      'DTSTART:' + startsAt,
      'SUMMARY:' + service,
      'DESCRIPTION:' + calendarText('Confirmed booking reference: ' + (booking.reference || 'Unavailable')),
      address ? 'LOCATION:' + calendarText(address) : '',
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR'
    ].filter(Boolean);
    var blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'insurespr-' + String(booking.reference || 'booking').replace(/[^a-z0-9-]/gi, '-').toLowerCase() + '.ics';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function bindManageForm() {
    var form = document.getElementById('manage-booking-form');
    if (!form) return;
    var params = new URLSearchParams(window.location.search);
    var token = params.get('token') || safeStorage(sessionStorage, 'getItem', STORAGE_PREFIX + 'manageToken');
    if (token) {
      safeStorage(sessionStorage, 'setItem', STORAGE_PREFIX + 'manageToken', token);
      history.replaceState(null, '', window.location.pathname);
    }
    form.elements.token.value = token || '';
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      clearStatus(form);
      if (!form.reportValidity()) return;
      setBusy(form, true);
      var payload = {
        token: value(form, 'token'),
        action: value(form, 'action'),
        preferred_date: value(form, 'preferred_date') || null,
        preferred_time_period: value(form, 'preferred_time_period') || null,
        note: value(form, 'note') || null,
        website: value(form, 'website')
      };
      api('/booking-actions', { method: 'POST', body: JSON.stringify(payload) }).then(function (body) {
        var wording = body.booking.status === 'cancelled'
          ? 'The booking has been cancelled.'
          : 'Your reschedule request has been recorded. It is not a new confirmed time yet.';
        setStatus(form, wording + ' Reference: ' + body.booking.reference + '.', 'success');
        setBusy(form, false);
      }).catch(function (error) {
        setStatus(form, error.message, 'error');
        setBusy(form, false);
      });
    });
  }

  bindBookingForm();
  bindContactForm();
  bindEmployerForm();
  renderConfirmation();
  trackServiceView();
  bindManageForm();
})();
