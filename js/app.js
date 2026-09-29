/* Shared helpers: settings + guest storage, theme, icons, API calls, viewport fix.
   Written in plain ES2017 (no ?. / ??) so it also runs on older phones. */
(function () {
  var S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  var P = {
    menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    up: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
    right: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    clip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    term: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
    globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    star: '<path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z"/>',
    db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>'
  };

  var App = window.App = {
    LOGO: 'assets/farvo-logo.webp',
    KEY: 'farvoai.v1',

    icon: function (n) { return '<svg class="ic" viewBox="0 0 24 24" ' + S + ' aria-hidden="true">' + (P[n] || '') + '</svg>'; },
    hydrate: function (root) {
      [].forEach.call((root || document).querySelectorAll('[data-ic]'), function (el) {
        el.innerHTML = App.icon(el.getAttribute('data-ic')); el.removeAttribute('data-ic');
      });
    },

    /* local state: settings + guest chats (chats are only used when NOT signed in) */
    load: function () {
      var s = null;
      try { s = JSON.parse(localStorage.getItem(App.KEY)); } catch (e) { s = null; }
      s = s || {};
      s.settings = Object.assign({ theme: 'dark', typing: true }, s.settings || {});
      s.chats = Array.isArray(s.chats) ? s.chats : [];
      return s;
    },
    save: function (state) {
      try { localStorage.setItem(App.KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
    },
    applyTheme: function (t) { document.documentElement.setAttribute('data-theme', t); },

    uid: function () {                         // RFC4122 v4 without crypto.randomUUID (missing on older phones)
      var b = new Uint8Array(16);
      if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
      else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
      b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
      var h = [].map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    },

    /* fetch wrapper: always sends cookies, always returns {ok,status,data}; throws only on network failure */
    api: function (path, opt) {
      opt = opt || {};
      var ctl = window.AbortController ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, opt.timeout || 70000) : null;
      return fetch(path, {
        method: opt.method || 'GET',
        credentials: 'same-origin',
        headers: opt.body ? { 'Content-Type': 'application/json' } : {},
        body: opt.body ? JSON.stringify(opt.body) : undefined,
        signal: ctl ? ctl.signal : undefined
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
      }).catch(function () {
        throw new Error('Network problem. Check your internet connection and try again.');
      }).then(function (x) { clearTimeout(timer); return x; }, function (e) { clearTimeout(timer); throw e; });
    }
  };

  /* phone-safe height: 100vh/100dvh are unreliable on many mobile browsers */
  function fitHeight() {
    var h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    document.documentElement.style.setProperty('--app-h', Math.round(h) + 'px');
  }
  fitHeight();
  window.addEventListener('resize', fitHeight);
  window.addEventListener('orientationchange', function () { setTimeout(fitHeight, 250); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fitHeight);

  App.applyTheme(App.load().settings.theme);

  document.addEventListener('DOMContentLoaded', function () {
    App.hydrate();
    document.documentElement.className += ' js';
    var y = document.getElementById('yr'); if (y) y.textContent = new Date().getFullYear();

    /* landing page: mobile menu, theme toggle, reveal-on-scroll */
    var mb = document.getElementById('navToggle'), nav = document.getElementById('nav');
    if (mb && nav) {
      mb.onclick = function () { nav.classList.toggle('open'); };
      [].forEach.call(nav.querySelectorAll('a'), function (a) { a.addEventListener('click', function () { nav.classList.remove('open'); }); });
    }
    var tb = document.getElementById('themeBtn');
    if (tb) tb.onclick = function () {
      var st = App.load(); st.settings.theme = st.settings.theme === 'dark' ? 'light' : 'dark';
      App.applyTheme(st.settings.theme); App.save(st);
    };
    var els = [].slice.call(document.querySelectorAll('.reveal'));
    if (!('IntersectionObserver' in window)) els.forEach(function (e) { e.classList.add('in'); });
    else {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
      }, { threshold: 0.1 });
      els.forEach(function (e) { io.observe(e); });
      setTimeout(function () { els.forEach(function (e) { e.classList.add('in'); }); }, 2500); // safety net
    }
  });

  /* if anything ever breaks on a phone, show the reason instead of a blank screen */
  window.addEventListener('error', function (e) {
    if (!document.body || !document.body.classList.contains('chat-page')) return;
    var b = document.getElementById('fatal');
    if (!b) { b = document.createElement('div'); b.id = 'fatal'; b.onclick = function () { location.reload(); }; document.body.appendChild(b); }
    b.textContent = 'Something went wrong: ' + (e.message || 'unknown error') + ' (tap to reload)';
  });
})();
