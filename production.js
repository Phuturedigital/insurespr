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
  var turnstileScriptPromise;
  var REQUEST_TIMEOUT_MS = 12_000;

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

  function bindSkipLinks() {
    document.querySelectorAll('a.skip[href^="#"]').forEach(function (link) {
      var target = document.getElementById(link.getAttribute('href').slice(1));
      if (!target) return;
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      link.addEventListener('click', function () {
        window.setTimeout(function () {
          try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); }
        }, 0);
      });
    });
  }

  function sessionId() {
    var key = STORAGE_PREFIX + 'session';
    var existing = safeStorage(sessionStorage, 'getItem', key);
    if (existing) return existing;
    var created = uuid();
    safeStorage(sessionStorage, 'setItem', key, created);
    return created;
  }

  function cleanCampaignValue(candidate) {
    if (typeof candidate !== 'string') return null;
    var value = candidate.trim();
    if (!value || value.length > 120) return null;
    if (/[\u0000-\u001f\u007f]/.test(value)) return null;
    if (/[^\s@]+@[^\s@]+\.[^\s@]+/i.test(value)) return null;
    if ((value.match(/[0-9]/g) || []).length >= 8) return null;
    return value;
  }

  function cleanLandingPath(candidate) {
    if (typeof candidate !== 'string') return '/';
    var value = candidate.trim();
    if (!value.startsWith('/') || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) return '/';
    return value;
  }

  function cleanReferrerHost(candidate) {
    if (typeof candidate !== 'string') return null;
    var value = candidate.trim().toLowerCase();
    if (!value || value.length > 253 || /[\s@\u0000-\u001f\u007f]/.test(value)) return null;
    return value;
  }

  function cleanMarketingContext(candidate) {
    var source = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {};
    return {
      utm_source: cleanCampaignValue(source.utm_source),
      utm_medium: cleanCampaignValue(source.utm_medium),
      utm_campaign: cleanCampaignValue(source.utm_campaign),
      utm_term: cleanCampaignValue(source.utm_term),
      utm_content: cleanCampaignValue(source.utm_content),
      landing_path: cleanLandingPath(source.landing_path || window.location.pathname),
      referrer_host: cleanReferrerHost(source.referrer_host)
    };
  }

  function captureMarketing() {
    var key = STORAGE_PREFIX + 'marketing';
    var existing = safeStorage(sessionStorage, 'getItem', key);
    if (existing) {
      try {
        var restored = cleanMarketingContext(JSON.parse(existing));
        safeStorage(sessionStorage, 'setItem', key, JSON.stringify(restored));
        return restored;
      } catch (_) { /* replace malformed local state */ }
    }

    var params = new URLSearchParams(window.location.search);
    var context = cleanMarketingContext({
      utm_source: params.get('utm_source') || null,
      utm_medium: params.get('utm_medium') || null,
      utm_campaign: params.get('utm_campaign') || null,
      utm_term: params.get('utm_term') || null,
      utm_content: params.get('utm_content') || null,
      landing_path: window.location.pathname,
      referrer_host: null
    });
    if (document.referrer) {
      try { context.referrer_host = cleanReferrerHost(new URL(document.referrer).hostname); } catch (_) { /* ignore */ }
    }
    safeStorage(sessionStorage, 'setItem', key, JSON.stringify(context));
    return context;
  }

  var marketing = captureMarketing();

  function api(path, options) {
    var init = Object.assign({}, options || {});
    init.headers = Object.assign({ 'Content-Type': 'application/json' }, init.headers || {});
    var controller = new AbortController();
    var timeout = window.setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    init.signal = controller.signal;
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
    }).catch(function (error) {
      if (error && error.name === 'AbortError') {
        var timeoutError = new Error('The service is taking too long to respond. Please try again, or call 083 450 7861.');
        timeoutError.code = 'REQUEST_TIMEOUT';
        throw timeoutError;
      }
      if (error instanceof TypeError) {
        var networkError = new Error('We could not connect right now. Check your connection and try again, or call 083 450 7861.');
        networkError.code = 'NETWORK_ERROR';
        throw networkError;
      }
      throw error;
    }).finally(function () {
      window.clearTimeout(timeout);
    });
  }

  function getConfig() {
    if (!configPromise) {
      configPromise = api('/services').catch(function (error) {
        if (error.status && error.status !== 502 && error.status !== 503 && error.status !== 504) throw error;
        return new Promise(function (resolve) { window.setTimeout(resolve, 650); }).then(function () {
          return api('/services');
        });
      });
    }
    return configPromise;
  }

  function formGate(form) {
    return form.querySelector('[data-form-gate]');
  }

  function formGateNotice(form) {
    return document.querySelector('[data-form-gate-status="' + form.id + '"]');
  }

  function setFormGateNotice(form, title, copy) {
    var notice = formGateNotice(form);
    if (!notice) return;
    var titleTarget = notice.querySelector('[data-form-gate-title]');
    var copyTarget = notice.querySelector('[data-form-gate-copy]');
    if (titleTarget) titleTarget.textContent = title;
    if (copyTarget) copyTarget.textContent = copy;
    notice.hidden = false;
    notice.setAttribute('role', 'alert');
  }

  function closeFormGate(form, title, copy) {
    var gate = formGate(form);
    if (gate) {
      gate.disabled = true;
      gate.setAttribute('inert', '');
    }
    form.setAttribute('aria-busy', 'false');
    form.dataset.ready = 'false';
    setFormGateNotice(form, title, copy);
    var assistedWhatsApp = form.querySelector('#booking-whatsapp');
    if (assistedWhatsApp) assistedWhatsApp.disabled = true;
  }

  function activateBoundForm(form) {
    var gate = formGate(form);
    if (gate) {
      gate.disabled = false;
      gate.removeAttribute('inert');
    }
    form.setAttribute('aria-busy', 'false');
    form.dataset.ready = 'true';
    var notice = formGateNotice(form);
    if (notice) notice.hidden = true;
    var assistedWhatsApp = form.querySelector('#booking-whatsapp');
    if (assistedWhatsApp) assistedWhatsApp.disabled = false;
  }

  function approvedPrivacyVersion(config) {
    var candidate = config && config.practice && config.practice.privacy_notice_version;
    var version = typeof candidate === 'string' ? candidate.trim() : '';
    if (!version || /pending/i.test(version)) return null;
    return version.slice(0, 80);
  }

  function applyPrivacyVersion(form, version) {
    var hidden = form.elements.privacy_version;
    if (hidden) {
      hidden.value = version;
      hidden.defaultValue = version;
    }
    form.dataset.privacyVersion = version;
    var label = form.querySelector('[data-consent-policy-label]');
    var valueTarget = form.querySelector('[data-consent-policy-version]');
    if (valueTarget) valueTarget.textContent = version;
    if (label) label.hidden = false;
  }

  function activatePrivacyForm(form, action, config) {
    var version = approvedPrivacyVersion(config);
    if (!version) {
      closeFormGate(
        form,
        'Online requests are not open yet.',
        'The privacy notice still needs approval. Use one of the direct contact options below.'
      );
      return false;
    }
    var turnstileKey = config && typeof config.turnstile_site_key === 'string'
      ? config.turnstile_site_key.trim()
      : '';
    if (!turnstileKey) {
      closeFormGate(
        form,
        'Online requests are not open yet.',
        'The anti-spam protection still needs setup. Use one of the direct contact options below.'
      );
      return false;
    }
    applyPrivacyVersion(form, version);
    initTurnstile(form, action, config);
    activateBoundForm(form);
    return true;
  }

  function closeFormAfterConfigFailure(form) {
    closeFormGate(
      form,
      'The online form could not be opened.',
      'Use one of the direct contact options below, or refresh this page and try again.'
    );
  }

  function handlePrivacyNoticeChanged(form, error) {
    if (!error || error.code !== 'PRIVACY_NOTICE_CHANGED') return false;
    var consent = form.elements.privacy_accepted;
    var hidden = form.elements.privacy_version;
    if (consent) consent.checked = false;
    if (hidden) {
      hidden.value = '';
      hidden.defaultValue = '';
    }
    delete form.dataset.privacyVersion;
    var label = form.querySelector('[data-consent-policy-label]');
    var versionTarget = form.querySelector('[data-consent-policy-version]');
    if (versionTarget) versionTarget.textContent = '';
    if (label) label.hidden = true;
    removeTurnstile(form);
    setBusy(form, false);
    closeFormGate(
      form,
      'Privacy notice changed — reload and review it again.',
      'This request was not sent. Reload the page to review the current notice, or use a direct contact option below.'
    );
    return true;
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
    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
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
      privacy_version: value(form, 'privacy_version') || null,
      turnstile_token: value(form, 'turnstile_token') || null,
      marketing: marketing
    };
  }

  function loadTurnstileScript() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (turnstileScriptPromise) return turnstileScriptPromise;

    turnstileScriptPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.dataset.turnstileScript = 'true';
      script.addEventListener('load', function () {
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error('Anti-spam service did not initialise.'));
      }, { once: true });
      script.addEventListener('error', function () {
        reject(new Error('Anti-spam service could not be loaded.'));
      }, { once: true });
      document.head.appendChild(script);
    });
    return turnstileScriptPromise;
  }

  function initTurnstile(form, action, knownConfig) {
    function configure(config) {
      var siteKey = config && config.turnstile_site_key;
      if (!siteKey) return;

      form.dataset.turnstileRequired = 'true';
      var hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = 'turnstile_token';
      form.appendChild(hidden);

      var field = document.createElement('div');
      field.className = 'turnstile-field';
      field.setAttribute('data-turnstile-for', form.id);
      var mount = document.createElement('div');
      var status = document.createElement('p');
      status.id = form.id + '-turnstile-status';
      status.setAttribute('role', 'status');
      status.textContent = 'Loading the anti-spam check…';
      field.appendChild(mount);
      field.appendChild(status);

      var submit = form.querySelector('[type="submit"]');
      var actions = submit && submit.closest('.booking-step-actions, .form-actions, .btn-row');
      var anchor = actions || submit;
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(field, anchor);
      else form.appendChild(field);

      return loadTurnstileScript().then(function (turnstile) {
        var widgetId = turnstile.render(mount, {
          sitekey: siteKey,
          action: action,
          size: 'flexible',
          callback: function (token) {
            hidden.value = token;
            status.textContent = 'Anti-spam check complete.';
          },
          'expired-callback': function () {
            hidden.value = '';
            status.textContent = 'The anti-spam check expired. Please complete it again.';
          },
          'timeout-callback': function () {
            hidden.value = '';
            status.textContent = 'The anti-spam check timed out. Please try again.';
          },
          'error-callback': function () {
            hidden.value = '';
            status.textContent = 'The anti-spam check could not be completed. Please retry or call 083 450 7861.';
          }
        });
        form.dataset.turnstileWidgetId = String(widgetId);
      }).catch(function () {
        form.dataset.turnstileUnavailable = 'true';
        status.textContent = 'The anti-spam check is unavailable. Please refresh, retry, or call 083 450 7861.';
      });
    }

    if (knownConfig) {
      configure(knownConfig);
      return;
    }

    getConfig().then(configure).catch(function () {
      // The form API provides the authoritative error if production protection
      // is enabled while public configuration is temporarily unavailable.
    });
  }

  function validateTurnstile(form) {
    if (form.dataset.turnstileRequired !== 'true') return true;
    if (value(form, 'turnstile_token')) return true;
    var message = form.dataset.turnstileUnavailable === 'true'
      ? 'The anti-spam check is unavailable. Please refresh, retry, or call 083 450 7861.'
      : 'Please complete the anti-spam check before sending.';
    setStatus(form, message, 'error');
    var field = form.querySelector('.turnstile-field');
    if (field) {
      var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      field.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
    }
    return false;
  }

  function resetTurnstile(form) {
    var token = form.elements.turnstile_token;
    if (token) token.value = '';
    var widgetId = form.dataset.turnstileWidgetId;
    if (widgetId && window.turnstile) {
      try { window.turnstile.reset(Number(widgetId)); } catch (_) { /* ignore */ }
    }
  }

  function removeTurnstile(form) {
    var widgetId = form.dataset.turnstileWidgetId;
    if (widgetId && window.turnstile) {
      try { window.turnstile.remove(Number(widgetId)); } catch (_) { /* ignore */ }
    }
    var field = form.querySelector('[data-turnstile-for="' + form.id + '"]');
    if (field) field.remove();
    var token = form.elements.turnstile_token;
    if (token) token.remove();
    delete form.dataset.turnstileWidgetId;
    delete form.dataset.turnstileRequired;
    delete form.dataset.turnstileUnavailable;
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
    var review = document.getElementById('booking-review');
    var whatsapp = document.getElementById('booking-whatsapp');
    var completed = false;
    var started = false;
    var servicesById = {};

    // Johannesburg is UTC+02:00 year-round. Avoid cold-starting the full Intl
    // formatter on the booking page merely to derive an ISO date boundary.
    dateInput.min = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);

    var bookingSteps = Array.prototype.slice.call(form.querySelectorAll('[data-book-step]'));
    var bookingProgress = Array.prototype.slice.call(document.querySelectorAll('[data-book-progress]'));
    var currentStep = 1;
    var BOOKING_HISTORY_KEY = 'insuresprBookingStep';

    function bookingHistoryState(stepNumber) {
      var state = history.state && typeof history.state === 'object'
        ? Object.assign({}, history.state)
        : {};
      state[BOOKING_HISTORY_KEY] = stepNumber;
      return state;
    }

    function replaceBookingHistory(stepNumber) {
      history.replaceState(bookingHistoryState(stepNumber), '', window.location.href);
    }

    function pushBookingHistory(stepNumber) {
      history.pushState(bookingHistoryState(stepNumber), '', window.location.href);
    }

    function showBookingStep(stepNumber, focusStep) {
      currentStep = Math.max(1, Math.min(stepNumber, bookingSteps.length));
      bookingSteps.forEach(function (step) {
        step.hidden = Number(step.getAttribute('data-book-step')) !== currentStep;
      });
      bookingProgress.forEach(function (item) {
        var itemStep = Number(item.getAttribute('data-book-progress'));
        if (itemStep === currentStep) item.setAttribute('aria-current', 'step');
        else item.removeAttribute('aria-current');
        item.classList.toggle('is-complete', itemStep < currentStep);
      });
      if (focusStep) {
        var headingTarget = bookingSteps[currentStep - 1] && bookingSteps[currentStep - 1].querySelector('select, input, textarea, button');
        if (headingTarget) headingTarget.focus({ preventScroll: true });
        window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    }

    function firstInvalidInStep(stepNumber) {
      var step = bookingSteps.find(function (candidate) {
        return Number(candidate.getAttribute('data-book-step')) === stepNumber;
      });
      if (!step) return null;
      return Array.prototype.find.call(step.querySelectorAll('input, select, textarea'), function (field) {
        return !field.disabled && !field.checkValidity();
      }) || null;
    }

    function validateBookingStep(stepNumber) {
      var invalid = firstInvalidInStep(stepNumber);
      if (!invalid) return true;
      showBookingStep(stepNumber, false);
      replaceBookingHistory(stepNumber);
      invalid.reportValidity();
      return false;
    }

    function validateWholeBooking() {
      for (var stepNumber = 1; stepNumber <= bookingSteps.length; stepNumber += 1) {
        if (!validateBookingStep(stepNumber)) return false;
      }
      return true;
    }

    form.querySelectorAll('[data-book-next]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (!validateBookingStep(currentStep)) return;
        var nextStep = Number(button.getAttribute('data-book-next'));
        if (nextStep === 5) renderBookingReview();
        showBookingStep(nextStep, true);
        pushBookingHistory(nextStep);
      });
    });
    form.querySelectorAll('[data-book-back]').forEach(function (button) {
      button.addEventListener('click', function () {
        var previousStep = Number(button.getAttribute('data-book-back'));
        var stateStep = Number(history.state && history.state[BOOKING_HISTORY_KEY]);
        if (currentStep > previousStep && stateStep === currentStep) {
          history.back();
          return;
        }
        showBookingStep(previousStep, true);
        replaceBookingHistory(previousStep);
      });
    });
    showBookingStep(1, false);
    replaceBookingHistory(1);
    window.addEventListener('popstate', function (event) {
      var restoredStep = Number(event.state && event.state[BOOKING_HISTORY_KEY]);
      if (restoredStep >= 1 && restoredStep <= bookingSteps.length) {
        showBookingStep(restoredStep, true);
      }
    });

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
      if (!approvedPrivacyVersion(config)) {
        activatePrivacyForm(form, 'book', config);
        return;
      }
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
      activatePrivacyForm(form, 'book', config);
    }).catch(function () {
      closeFormAfterConfigFailure(form);
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

    function preferredTimeLabel() {
      var selectedSlot = form.querySelector('input[name="slot_id"]:checked');
      return selectedSlot && selectedSlot.parentElement
        ? selectedSlot.parentElement.textContent.trim()
        : (selectText(form.elements.preferred_time_period) || 'Any available time');
    }

    function renderBookingReview() {
      if (!review) return;
      var name = [value(form, 'first_name'), value(form, 'surname')].filter(Boolean).join(' ');
      review.querySelector('[data-review-service]').textContent = selectText(serviceSelect) || 'Not selected';
      review.querySelector('[data-review-date]').textContent = formatDate(value(form, 'preferred_date'));
      review.querySelector('[data-review-time]').textContent = preferredTimeLabel();
      review.querySelector('[data-review-patient]').textContent = name + ' · ' + selectText(form.elements.patient_status);
      review.querySelector('[data-review-contact]').textContent = value(form, 'mobile') + ' · ' + value(form, 'email');
    }

    function bookingPayload() {
      var slot = form.querySelector('input[name="slot_id"]:checked');
      return Object.assign(basePayload(form), {
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
    }

    function rememberBooking(body, payload) {
      completed = true;
      safeStorage(sessionStorage, 'setItem', STORAGE_PREFIX + 'lastBooking', JSON.stringify(body.booking));
      track('booking_request_submitted', payload.service_id);
    }

    if (whatsapp) whatsapp.addEventListener('click', function () {
      clearStatus(form);
      if (!validateWholeBooking()) return;
      if (!validateTurnstile(form)) return;
      setBusy(form, true);
      whatsapp.disabled = true;
      var payload = bookingPayload();
      api('/bookings', { method: 'POST', body: JSON.stringify(payload) }).then(function (body) {
        rememberBooking(body, payload);
        removeTurnstile(form);
        track('whatsapp_clicked', payload.service_id);
        var message = "Hi InsureSPR, I submitted website booking request " + body.booking.reference + '. Please help me continue.';
        var whatsappUrl = 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(message);
        var opened = window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
        setStatus(
          form,
          'Booking request saved. Reference: ' + body.booking.reference + '. WhatsApp opens separately so this confirmation stays available.',
          'success'
        );
        if (!opened) {
          var status = document.getElementById('book-status');
          var manualLink = document.createElement('a');
          manualLink.className = 'btn btn--ghost btn--sm';
          manualLink.href = whatsappUrl;
          manualLink.target = '_blank';
          manualLink.rel = 'noopener noreferrer';
          manualLink.textContent = 'Open WhatsApp';
          manualLink.setAttribute('aria-label', 'Open WhatsApp for booking reference ' + body.booking.reference);
          status.append(document.createElement('br'), manualLink);
        }
        setBusy(form, false);
        whatsapp.disabled = false;
      }).catch(function (error) {
        if (handlePrivacyNoticeChanged(form, error)) return;
        if (error.code === 'SLOT_UNAVAILABLE') loadAvailability();
        resetTurnstile(form);
        setStatus(form, error.message, 'error');
        setBusy(form, false);
        whatsapp.disabled = false;
      });
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      clearStatus(form);
      if (!validateWholeBooking()) return;
      if (!validateTurnstile(form)) return;
      setBusy(form, true);
      if (whatsapp) whatsapp.disabled = true;
      var payload = bookingPayload();
      api('/bookings', { method: 'POST', body: JSON.stringify(payload) }).then(function (body) {
        rememberBooking(body, payload);
        removeTurnstile(form);
        if (document.documentElement.classList.contains('booking-embed') && window.parent !== window) {
          window.parent.location.assign('booking-confirmation.html');
        } else {
          window.location.assign('booking-confirmation.html');
        }
      }).catch(function (error) {
        if (handlePrivacyNoticeChanged(form, error)) return;
        if (error.code === 'SLOT_UNAVAILABLE') loadAvailability();
        resetTurnstile(form);
        setStatus(form, error.message, 'error');
        setBusy(form, false);
        if (whatsapp) whatsapp.disabled = false;
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
      if (!validateTurnstile(form)) return;
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
        removeTurnstile(form);
        initTurnstile(form, 'contact');
        setBusy(form, false);
      }).catch(function (error) {
        if (handlePrivacyNoticeChanged(form, error)) return;
        resetTurnstile(form);
        setStatus(form, error.message, 'error');
        setBusy(form, false);
      });
    });
    getConfig().then(function (config) {
      activatePrivacyForm(form, 'contact', config);
    }).catch(function () {
      closeFormAfterConfigFailure(form);
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
      if (!validateTurnstile(form)) return;
      setBusy(form, true);
      var payload = Object.assign(basePayload(form), {
        contact_name: value(form, 'contact_name'),
        company_name: value(form, 'company_name'),
        work_email: value(form, 'work_email'),
        phone: value(form, 'phone'),
        employee_count_range: value(form, 'employee_count_range'),
        services_required: services,
        preferred_timeframe: value(form, 'preferred_timeframe') || null,
        delivery_mode: value(form, 'delivery_mode') || 'practice',
        location: '7 Malibongwe Drive, EmedCentre, Randburg',
        notes: value(form, 'notes') || null
      });
      api('/employer-leads', { method: 'POST', body: JSON.stringify(payload) }).then(function (body) {
        track('quote_submitted');
        setStatus(form, 'Thank you. Your quote-request reference is ' + body.lead.reference + '. InsureSPR will use the contact details you supplied to follow up.', 'success');
        form.reset();
        form.dataset.idempotency = '';
        removeTurnstile(form);
        initTurnstile(form, 'employer');
        setBusy(form, false);
      }).catch(function (error) {
        if (handlePrivacyNoticeChanged(form, error)) return;
        resetTurnstile(form);
        setStatus(form, error.message, 'error');
        setBusy(form, false);
      });
    });
    getConfig().then(function (config) {
      activatePrivacyForm(form, 'employer', config);
    }).catch(function () {
      closeFormAfterConfigFailure(form);
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
        manage.href = 'manage-booking.html#token=' + encodeURIComponent(booking.management_token);
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
    var fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    var fragmentToken = fragment.get('token');
    var queryToken = params.get('token');
    var candidate = fragmentToken || queryToken || safeStorage(sessionStorage, 'getItem', STORAGE_PREFIX + 'manageToken');
    var token = /^[0-9a-f]{64}$/i.test(candidate || '') ? candidate : '';
    if (token) {
      safeStorage(sessionStorage, 'setItem', STORAGE_PREFIX + 'manageToken', token);
    }
    if (fragmentToken !== null || queryToken !== null) history.replaceState(null, '', window.location.pathname);
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
    activateBoundForm(form);
  }

  bindSkipLinks();
  bindBookingForm();
  bindContactForm();
  bindEmployerForm();
  renderConfirmation();
  trackServiceView();
  bindManageForm();
})();
