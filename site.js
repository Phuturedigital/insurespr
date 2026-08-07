/* InsureSPR Health concept — all client-side behaviour.
 *
 * Deliberately small. Every page is fully usable with this file blocked: the
 * nav stays expanded, reveal targets are visible (they are only hidden under
 * `.js`), the programme disclosures are native <details>, and the step rail is
 * a plain overflow-scroll list. Nothing here is load-bearing.
 */
(function () {
  'use strict';

  /* ---------------------------------------------------------- nav toggle -- */
  var toggle = document.querySelector('.nav-toggle');
  var links = document.getElementById('nav-links');

  if (toggle && links) {
    var setOpen = function (open) {
      links.setAttribute('data-open', open ? 'true' : 'false');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.querySelector('use').setAttribute('href', open ? '#i-close' : '#i-menu');
    };

    toggle.addEventListener('click', function () {
      setOpen(links.getAttribute('data-open') !== 'true');
    });

    /* Escape closes it and returns focus to the button that opened it —
       otherwise keyboard users are dropped at the top of the document. */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && links.getAttribute('data-open') === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });

    /* Following an in-page link should close the panel, or it covers the very
       thing it just scrolled to. */
    links.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });

    /* Returning to a desktop width must clear the collapsed state, or the nav
       is left with data-open="false" and simply never reappears. */
    var wide = window.matchMedia('(min-width: 1001px)');
    var sync = function () { if (wide.matches) setOpen(false); };
    wide.addEventListener ? wide.addEventListener('change', sync) : wide.addListener(sync);
  }

  /* ------------------------------------------------------------- step rail -- */
  /* The reference drives its step cards with arrow buttons. Here the rail is a
     real scroll container, so it works by drag and swipe with the buttons
     blocked, and the buttons just nudge it. Disabled state is derived from
     actual scroll position rather than a counter, so it cannot drift. */
  document.querySelectorAll('[data-rail]').forEach(function (rail) {
    var prev = document.querySelector('[data-rail-prev="' + rail.id + '"]');
    var next = document.querySelector('[data-rail-next="' + rail.id + '"]');
    if (!prev || !next) return;

    var sync = function () {
      var max = rail.scrollWidth - rail.clientWidth;
      prev.disabled = rail.scrollLeft < 8;
      next.disabled = rail.scrollLeft > max - 8;
    };
    var step = function (dir) {
      var card = rail.querySelector('.step');
      var by = card ? card.getBoundingClientRect().width + 18 : rail.clientWidth * 0.8;
      rail.scrollBy({ left: dir * by, behavior: 'smooth' });
    };

    prev.addEventListener('click', function () { step(-1); });
    next.addEventListener('click', function () { step(1); });
    rail.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();
  });

  /* ----------------------------------------------------------------- forms -- */
  /* The booking and contact forms are inert by design — this is a concept and
     there is no backend. A form that looks real and silently swallows a
     submission is a dark pattern, so the handler says so outright at the moment
     the button is pressed, and repeats the real phone number. The same warning
     already sits ABOVE the fields, so nobody types anything before finding out.

     Honest failure mode: with JS blocked the form does a native GET to the same
     page, the fields clear, and the notice above is still there to explain. */
  Object.keys({ 'book-form': 1, 'contact-form': 1 }).forEach(function (id) {
    var form = document.getElementById(id);
    var status = document.getElementById(id.replace('-form', '-status'));
    if (!form || !status) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      /* Static literal — no field value is interpolated, so there is no
         injection surface. What the visitor typed stays in the form. */
      status.innerHTML =
        '<svg class="icon" aria-hidden="true"><use href="#i-info"></use></svg>' +
        '<span><strong>Nothing was sent.</strong> This is a design concept, so the form has nowhere to submit to — ' +
        'your details were not stored or transmitted. To reach InsureSPR Health for real, call ' +
        '<a href="tel:+27834507861">083 450 7861</a> or email ' +
        '<a href="mailto:health@insuresprhealth.co.za">health@insuresprhealth.co.za</a>.</span>';
      status.hidden = false;
      status.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  });

  /* --------------------------------------------------------- scroll reveal -- */
  /* Reduced motion is handled entirely in CSS (targets forced back to opacity
     1). Bailing out here as well would be wrong: without the observer the
     elements keep whatever the stylesheet gave them, and any future change to
     that rule would silently blank the page. */
  var targets = document.querySelectorAll('.reveal');

  if (!('IntersectionObserver' in window)) {
    for (var i = 0; i < targets.length; i++) targets[i].classList.add('in');
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      io.unobserve(entry.target);        /* one-shot: never re-hide on scroll up */
    });
    /* threshold 0, not a fraction. `threshold` is a proportion of the ELEMENT's
       own area, not the viewport, so a percentage punishes tall elements — a
       1200px card would need ~100px on screen before firing and could sit at
       opacity 0 while plainly visible. Any pixel entering triggers instead, and
       a fixed-pixel rootMargin keeps the trigger independent of viewport height. */
  }, { rootMargin: '0px 0px -60px 0px', threshold: 0 });

  targets.forEach(function (el) { io.observe(el); });
})();
