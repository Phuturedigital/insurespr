/* InsureSPR Precision Healthcare — shared client-side behaviour.
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
      var iconUse = toggle.querySelector('use');
      if (iconUse) iconUse.setAttribute('href', open ? '#i-close' : '#i-menu');
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

  /* --------------------------------------------------------- hero images -- */
  var heroCarousel = document.querySelector('[data-hero-carousel]');
  if (heroCarousel) {
    var heroSlides = Array.prototype.slice.call(heroCarousel.querySelectorAll('.hero-slide'));
    var heroDots = Array.prototype.slice.call(heroCarousel.querySelectorAll('.hero-dots button'));
    var heroIndex = 0;
    var heroTimer = null;
    var heroCalm = window.matchMedia('(prefers-reduced-motion: reduce)');

    var showHero = function (nextIndex) {
      heroIndex = (nextIndex + heroSlides.length) % heroSlides.length;
      heroSlides.forEach(function (slide, index) {
        var active = index === heroIndex;
        slide.classList.toggle('is-active', active);
        slide.setAttribute('aria-hidden', active ? 'false' : 'true');
      });
      heroDots.forEach(function (dot, index) {
        var active = index === heroIndex;
        dot.classList.toggle('is-active', active);
        dot.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    };
    var stopHero = function () { if (heroTimer) window.clearInterval(heroTimer); heroTimer = null; };
    var startHero = function () {
      stopHero();
      if (!heroCalm.matches && heroSlides.length > 1) {
        heroTimer = window.setInterval(function () { showHero(heroIndex + 1); }, 5500);
      }
    };

    heroDots.forEach(function (dot, index) {
      dot.addEventListener('click', function () { showHero(index); startHero(); });
    });
    heroCarousel.addEventListener('pointerenter', stopHero);
    heroCarousel.addEventListener('pointerleave', startHero);
    heroCarousel.addEventListener('focusin', stopHero);
    heroCarousel.addEventListener('focusout', startHero);
    if (heroCalm.addEventListener) heroCalm.addEventListener('change', startHero);
    startHero();
  }

  /* ---------------------------------------------------- booking bottom sheet -- */
  var bookingTriggers = document.querySelectorAll('[data-booking-popover], a[href^="book.html"]');
  if (bookingTriggers.length && !document.getElementById('book-form') && 'HTMLDialogElement' in window) {
    var bookingDialog = null;
    var ensureBookingDialog = function () {
      if (bookingDialog) return bookingDialog;
      bookingDialog = document.createElement('dialog');
      bookingDialog.className = 'booking-dialog';
      bookingDialog.setAttribute('aria-label', 'Request an appointment');
      bookingDialog.innerHTML = '<div class="booking-dialog-bar"><strong>Request an appointment</strong><button type="button" aria-label="Close booking">×</button></div><iframe title="InsureSPR booking steps" loading="eager"></iframe>';
      document.body.appendChild(bookingDialog);
      bookingDialog.querySelector('button').addEventListener('click', function () { bookingDialog.close(); });
      bookingDialog.addEventListener('click', function (event) { if (event.target === bookingDialog) bookingDialog.close(); });
      bookingDialog.addEventListener('close', function () { document.documentElement.classList.remove('booking-open'); });
      return bookingDialog;
    };

    bookingTriggers.forEach(function (trigger) {
      trigger.addEventListener('click', function (event) {
        event.preventDefault();
        var dialog = ensureBookingDialog();
        var source = new URL(trigger.href, window.location.href);
        source.searchParams.set('embed', '1');
        var frame = dialog.querySelector('iframe');
        if (frame.src !== source.href) frame.src = source.href;
        document.documentElement.classList.add('booking-open');
        dialog.showModal();
      });
    });
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

  /* ------------------------------------------------------------ sticky nav -- */
  /* A sentinel rather than a scroll listener: the browser reports the state
     change itself, so there is no work on every scroll frame. */
  var shell = document.querySelector('.nav-shell');
  if (shell && 'IntersectionObserver' in window) {
    var sentinel = document.createElement('div');
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.style.cssText = 'position:absolute;top:0;height:1px;width:1px';
    document.body.insertBefore(sentinel, document.body.firstChild);
    new IntersectionObserver(function (e) {
      shell.setAttribute('data-stuck', e[0].isIntersecting ? 'false' : 'true');
    }).observe(sentinel);
  }

  /* -------------------------------------------------------- counting stats -- */
  /* Counts the figure up once, when it first comes into view.
     Reduced motion is honoured HERE as well as in CSS: an animated number is
     motion regardless of how it is drawn, and CSS cannot suppress a value that
     JavaScript is rewriting. Anyone with motion turned down simply gets the
     final number immediately. */
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  var counters = document.querySelectorAll('[data-count]');

  if (counters.length && 'IntersectionObserver' in window && !calm.matches) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        cio.unobserve(el);
        var target = parseFloat(el.getAttribute('data-count'));
        var suffix = el.getAttribute('data-suffix') || '';
        var t0 = null;
        var tick = function (now) {
          if (t0 === null) t0 = now;
          var k = Math.min((now - t0) / 900, 1);
          /* ease-out: fast then settling, which reads as a measurement coming
             to rest rather than a slot machine stopping. */
          var eased = 1 - Math.pow(1 - k, 3);
          el.textContent = Math.round(target * eased) + suffix;
          if (k < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }, { threshold: 0 });
    counters.forEach(function (el) { cio.observe(el); });
  }

  /* ------------------------------------------------------ density tile fade -- */
  var tiles = document.querySelectorAll('.ptile');
  if (tiles.length && 'IntersectionObserver' in window) {
    var tio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        tio.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -40px 0px', threshold: 0 });
    tiles.forEach(function (el) { tio.observe(el); });
  } else {
    tiles.forEach(function (el) { el.classList.add('in'); });
  }

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
