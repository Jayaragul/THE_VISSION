/* THE VISSION — progressive enhancement only.
   Every page is fully readable with this file blocked. Nothing here fetches. */

(function () {
  'use strict';

  // --- theme ---------------------------------------------------------------
  // The inline head script has already applied the stored theme to avoid a flash;
  // this only wires the button.
  var root = document.documentElement;
  var btn = document.querySelector('[data-theme-toggle]');

  function label() {
    if (!btn) return;
    var dark = root.getAttribute('data-theme') === 'dark' ||
      (!root.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    btn.textContent = dark ? 'Light' : 'Dark';
    btn.setAttribute('aria-label', 'Switch to ' + (dark ? 'light' : 'dark') + ' theme');
  }

  if (btn) {
    btn.addEventListener('click', function () {
      var dark = root.getAttribute('data-theme') === 'dark' ||
        (!root.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
      var next = dark ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('tv-theme', next); } catch (e) {}
      label();
    });
    label();
  }

  // --- relative timestamps -------------------------------------------------

  var UNITS = [
    [60, 'second', 1],
    [3600, 'minute', 60],
    [86400, 'hour', 3600],
    [604800, 'day', 86400],
    [2629800, 'week', 604800],
    [31557600, 'month', 2629800]
  ];

  function relative(iso) {
    var then = Date.parse(iso);
    if (isNaN(then)) return null;
    var secs = Math.round((Date.now() - then) / 1000);
    if (secs < 45) return 'just now';
    for (var i = 0; i < UNITS.length; i++) {
      if (secs < UNITS[i][0]) {
        var n = Math.round(secs / UNITS[i][2]);
        return n + ' ' + UNITS[i][1] + (n === 1 ? '' : 's') + ' ago';
      }
    }
    var years = Math.round(secs / 31557600);
    return years + ' year' + (years === 1 ? '' : 's') + ' ago';
  }

  function stampAll() {
    var nodes = document.querySelectorAll('[data-relative]');
    for (var i = 0; i < nodes.length; i++) {
      var text = relative(nodes[i].getAttribute('datetime') || nodes[i].getAttribute('data-relative'));
      if (text) nodes[i].textContent = text;
    }
  }
  stampAll();
  setInterval(stampAll, 60000);

  // --- reading progress ----------------------------------------------------

  var bar = document.querySelector('.progress');
  if (bar) {
    var tick = false;
    function draw() {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      var pct = h > 0 ? Math.min(1, window.scrollY / h) : 0;
      bar.style.width = (pct * 100).toFixed(2) + '%';
      tick = false;
    }
    addEventListener('scroll', function () {
      if (!tick) { tick = true; requestAnimationFrame(draw); }
    }, { passive: true });
    draw();
  }

  // --- section highlighting on the front page ------------------------------

  var links = document.querySelectorAll('.beatnav a[href^="#"]');
  if (links.length && 'IntersectionObserver' in window) {
    var map = {};
    for (var j = 0; j < links.length; j++) {
      map[links[j].getAttribute('href').slice(1)] = links[j];
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var link = map[e.target.id];
        if (!link) return;
        if (e.isIntersecting) {
          for (var k = 0; k < links.length; k++) links[k].removeAttribute('aria-current');
          link.setAttribute('aria-current', 'page');
        }
      });
    }, { rootMargin: '-46px 0px -70% 0px' });

    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) io.observe(el);
    });
  }

  // For whoever opens the console. This paper is read by people who do that.
  try {
    console.log(
      '%cTHE VISSION%c\nBuilt by Jayaragul N · CBE Devs\nSource: https://github.com/Jayaragul/THE_VISSION',
      'font-weight:700;font-size:15px',
      'font-weight:400'
    );
  } catch (e) {}
})();
