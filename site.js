/* InsureSPR Health concept — the entire client-side behaviour.
 *
 * Deliberately small. The site is static HTML and every page is fully usable
 * with this file blocked: the nav stays expanded, reveal targets are visible,
 * and the FAQ accordions are native <details>. Nothing here is load-bearing.
 */
(function () {
  'use strict';

  /* ---------------------------------------------------------- nav toggle -- */
  /* The button is rendered in the markup but only styled into existence under
     `.js` at narrow widths, so it can never appear without this handler
     attached to it. */
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');

  if (toggle && nav) {
    var setOpen = function (open) {
      nav.setAttribute('data-open', open ? 'true' : 'false');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.querySelector('.nav-toggle-label').textContent = open ? 'Close' : 'Menu';
      toggle.querySelector('use').setAttribute('href', open ? '#i-close' : '#i-menu');
    };

    toggle.addEventListener('click', function () {
      setOpen(nav.getAttribute('data-open') !== 'true');
    });

    /* Escape closes it, and focus goes back to the button that opened it —
       otherwise keyboard users are dropped at the top of the document. */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.getAttribute('data-open') === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });

    /* Following a link inside the open menu should close it. In-page anchors
       otherwise leave the panel covering the thing it just scrolled to. */
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });

    /* Returning to a desktop width must clear the collapsed state, or the nav
       is left with data-open="false" and simply never reappears. */
    var wide = window.matchMedia('(min-width: 981px)');
    var sync = function () { if (wide.matches) setOpen(false); };
    wide.addEventListener ? wide.addEventListener('change', sync) : wide.addListener(sync);
  }

  /* --------------------------------------------------------------- forms -- */
  /* The booking and contact forms are inert by design — this is a concept and
     there is no backend to send anything to. A form that looks real and then
     silently swallows a submission is a dark pattern, so the handler says so
     outright, at the moment the button is pressed, and repeats the real phone
     number. The same warning already sits ABOVE the fields, so nobody types
     anything in before finding out.

     Note the honest failure mode: with JavaScript blocked the form does a
     native GET to the same page, the fields clear, and the notice above the
     form is still there to explain why. Nothing is transmitted either way. */
  var FORMS = {
    'book-form': 'book-status',
    'contact-form': 'contact-status',
  };

  Object.keys(FORMS).forEach(function (formId) {
    var form = document.getElementById(formId);
    var status = document.getElementById(FORMS[formId]);
    if (!form || !status) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      /* Static literal — no field value is interpolated into this string, so
         there is no injection surface. Anything the visitor typed stays in the
         form where they typed it and is never re-rendered as markup. */
      status.innerHTML =
        '<svg class="icon" aria-hidden="true"><use href="#i-info"></use></svg>' +
        '<span><strong>Nothing was sent.</strong> This is a design concept, so the form has nowhere to submit to — ' +
        'your details were not stored or transmitted anywhere. To reach InsureSPR Health for real, call ' +
        '<a href="tel:+27834507861">083 450 7861</a> or email ' +
        '<a href="mailto:health@insuresprhealth.co.za">health@insuresprhealth.co.za</a>.</span>';
      status.hidden = false;
      status.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  });

  /* -------------------------------------------------------- scroll reveal -- */
  /* `.js` is stamped on <html> by an inline script in <head>, before first
     paint — see the note in styles.css for why a deferred script cannot do it.
     This half just adds `.in` as things scroll into view.

     Reduced motion is handled entirely in CSS (targets are forced back to
     opacity 1). Bailing out here as well would be wrong: without the observer
     the elements would keep whatever the stylesheet gave them, and any future
     change to that rule would silently blank the page. */
  var targets = document.querySelectorAll('.reveal');

  if (!('IntersectionObserver' in window)) {
    /* No observer — show everything rather than hide it. */
    for (var i = 0; i < targets.length; i++) targets[i].classList.add('in');
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      io.unobserve(entry.target);      /* one-shot: never re-hide on scroll up */
    });
    /* threshold 0, not a fraction.
       `threshold` is a proportion of the ELEMENT's own area, not of the
       viewport, so a percentage punishes tall elements: at 0.08 a 1231px form
       card needed 98px on screen before it would fire, while the -8% bottom
       rootMargin had already trimmed 72px off a 900px viewport. The result was
       a card sitting at opacity 0 while plainly visible — it self-healed on the
       next scroll, which is exactly why it survived review.
       At threshold 0 any pixel entering triggers, so tall and short elements
       behave identically, and a fixed-pixel rootMargin keeps the trigger point
       independent of viewport height. */
  }, { rootMargin: '0px 0px -60px 0px', threshold: 0 });

  targets.forEach(function (el) { io.observe(el); });
})();
