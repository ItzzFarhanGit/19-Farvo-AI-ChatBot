/* Farvo AI chat controller.
   Guest  -> chats live in localStorage.
   Signed in -> chats live in the Postgres database (via /api/*), same on every device.
   Plain ES2017 (no ?. / ??) so older phones run it too. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var st = App.load();                    // { settings, chats } (chats = guest chats)
  var S = { user: null, dbEnabled: false, chats: [], activeId: null, busy: false, pending: [] };
  var ACTIVE_KEY = 'farvoai.active';

  /* ---------- tiny UI helpers ---------- */
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.className = 'toast-lite show';
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.className = 'toast-lite'; }, 2200);
  }
  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Copied'); } catch (e) { toast('Copy failed'); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { toast('Copied'); }, fallback);
    else fallback();
  }
  var hljsState = 0;                        // 0 = not loaded, 1 = loading, 2 = ready/failed
  function loadHljs(cb) {
    if (window.hljs) return cb();
    if (hljsState === 1) return setTimeout(function () { loadHljs(cb); }, 400);
    if (hljsState === 2) return;
    hljsState = 1;
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js';
    s.onload = function () {
      var l = document.createElement('link'); l.rel = 'stylesheet';
      l.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css';
      document.head.appendChild(l); hljsState = 2; cb();
    };
    s.onerror = function () { hljsState = 2; };
    document.head.appendChild(s);
  }
  function enhance(el) {                    // copy button + (lazy) highlighting for code blocks
    var pres = el.querySelectorAll('pre'), any = false;
    [].forEach.call(pres, function (pre) {
      var code = pre.querySelector('code');
      if (!code || pre.querySelector('.code-bar')) return;
      any = true;
      var bar = document.createElement('div'); bar.className = 'code-bar';
      var lang = document.createElement('span'); lang.textContent = code.getAttribute('data-lang') || 'code';
      var b = document.createElement('button'); b.className = 'copy-code'; b.type = 'button'; b.textContent = 'Copy';
      b.onclick = function () { copyText(code.textContent); };
      bar.appendChild(lang); bar.appendChild(b); pre.appendChild(bar);
    });
    if (any) loadHljs(function () {
      [].forEach.call(el.querySelectorAll('pre code'), function (c) { try { hljs.highlightElement(c); } catch (e) {} });
    });
  }
  var md = function (t) { return MD.render(t); };
  var scrollDown = function () { var m = $('messages'); m.scrollTop = m.scrollHeight; };
  function openModal(id) { $(id).className = 'overlay show'; }
  function closeModal(id) { $(id).className = 'overlay'; }
  [].forEach.call(document.querySelectorAll('.overlay'), function (o) {
    o.addEventListener('click', function (e) { if (e.target === o || (e.target.closest && e.target.closest('[data-close]'))) o.className = 'overlay'; });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') [].forEach.call(document.querySelectorAll('.overlay'), function (o) { o.className = 'overlay'; }); });

  /* ---------- state helpers ---------- */
  function active() { for (var i = 0; i < S.chats.length; i++) if (S.chats[i].id === S.activeId) return S.chats[i]; return null; }
  function persist() {                       // only guests store chats locally
    if (!S.user) {
      st.chats = S.chats.filter(function (c) { return c.messages.length; });
      if (!App.save(st)) toast('Storage is full. Delete some chats.');
    }
    try { localStorage.setItem(ACTIVE_KEY, S.activeId || ''); } catch (e) {}
  }
  function savedSettings() { var s = App.load(); s.settings = st.settings; if (S.user) s.chats = []; else s.chats = st.chats; App.save(s); }

  /* ---------- conversations ---------- */
  function newChat() {
    var empty = S.chats.filter(function (c) { return !c.messages.length; })[0];
    if (empty) S.activeId = empty.id;
    else {
      var c = { id: App.uid(), title: 'New chat', messages: [], updated: Date.now(), loaded: true };
      S.chats.unshift(c); S.activeId = c.id;
    }
    persist(); renderAll();
    if (window.innerWidth > 767) $('input').focus();
  }
  function selectChat(id) {
    S.activeId = id; persist();
    var c = active();
    if (S.user && c && !c.loaded) {
      renderList(); $('messages').innerHTML = '<div class="loading">Loading…</div>'; $('chatTitle').textContent = c.title;
      App.api('/api/chats/' + id).then(function (r) {
        if (r.ok) { c.messages = r.data.messages; c.loaded = true; }
        else toast(r.data.error || 'Could not load this chat');
        if (S.activeId === id) renderAll();
      }, function (e) { toast(e.message); });
    } else renderAll();
  }
  function deleteChat(id) {
    var c = S.chats.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    S.chats = S.chats.filter(function (x) { return x.id !== id; });
    if (S.user && (c.loaded === false || c.messages.length)) App.api('/api/chats/' + id, { method: 'DELETE' }).then(function (r) { if (!r.ok && r.status !== 404) toast(r.data.error || 'Delete failed'); }, function () { toast('Delete failed (offline?)'); });
    if (!S.chats.length) return newChat();
    if (S.activeId === id) S.activeId = S.chats[0].id;
    persist(); renderAll();
  }
  function renameChat(id) {
    var c = S.chats.filter(function (x) { return x.id === id; })[0]; if (!c) return;
    var t = window.prompt('Rename chat', c.title);
    if (t === null) return;
    t = t.replace(/\s+/g, ' ').trim().slice(0, 60); if (!t) return;
    c.title = t; persist(); renderList(); if (S.activeId === id) $('chatTitle').textContent = t;
    if (S.user && c.messages.length) App.api('/api/chats/' + id, { method: 'PATCH', body: { title: t } }).then(function (r) { if (!r.ok) toast(r.data.error || 'Rename failed'); });
  }

  /* ---------- rendering ---------- */
  function renderAll() { renderList(); renderMessages(); }
  function renderList() {
    var q = $('search').value.toLowerCase(), box = $('chatList');
    box.innerHTML = '';
    S.chats.filter(function (c) { return c.title.toLowerCase().indexOf(q) >= 0; }).forEach(function (c) {
      var row = document.createElement('div');
      row.className = 'chat-item' + (c.id === S.activeId ? ' active' : '');
      var t = document.createElement('span'); t.textContent = c.title;
      var ed = document.createElement('button'); ed.className = 'icon-btn'; ed.title = 'Rename chat'; ed.type = 'button'; ed.innerHTML = App.icon('edit');
      ed.onclick = function (e) { e.stopPropagation(); renameChat(c.id); };
      var d = document.createElement('button'); d.className = 'icon-btn'; d.title = 'Delete chat'; d.type = 'button'; d.innerHTML = App.icon('trash');
      d.onclick = function (e) { e.stopPropagation(); if (confirm('Delete "' + c.title + '"?')) deleteChat(c.id); };
      row.onclick = function () { selectChat(c.id); drawer(false); };
      row.appendChild(t); row.appendChild(ed); row.appendChild(d); box.appendChild(row);
    });
  }
  var SUGGEST = [['code', 'Explain closures in JavaScript'], ['term', 'Write a Python script to rename files'], ['globe', 'Plan a 3-day trip to Kyoto'], ['edit', 'Write a professional email asking for a meeting']];
  function renderMessages() {
    var c = active(), box = $('messages');
    $('chatTitle').textContent = c.title; box.innerHTML = '';
    if (!c.messages.length) {
      box.innerHTML = '<div class="welcome"><div class="hero-logo"><img src="' + App.LOGO + '" alt="Farvo AI"></div>' +
        '<h2>Hi, I\'m <span class="gt">Farvo AI</span></h2><p class="muted">Your smart assistant from Farvo Digital. Ask me anything.</p><div class="suggest"></div></div>';
      SUGGEST.forEach(function (x) {
        var b = document.createElement('button'); b.className = 's-card'; b.type = 'button';
        b.innerHTML = '<i>' + App.icon(x[0]) + '</i><span></span>'; b.lastChild.textContent = x[1];
        b.onclick = function () { $('input').value = x[1]; onInput(); send(); };
        box.querySelector('.suggest').appendChild(b);
      });
      return;
    }
    c.messages.forEach(function (m) { addMsg(m.role === 'user' ? 'user' : 'ai', m.content, m.files); });
    scrollDown();
  }
  function addMsg(kind, content, files) {
    var row = document.createElement('div'); row.className = 'msg ' + kind;
    var av = document.createElement('div'); av.className = 'avatar';
    av.innerHTML = kind === 'user' ? App.icon('user') : '<img src="' + App.LOGO + '" alt="Farvo AI">';
    var wrap = document.createElement('div'); wrap.className = 'bubble-wrap';
    var bubble = document.createElement('div'); bubble.className = 'bubble';
    if (kind === 'user') {
      (files || []).forEach(function (f) {
        if (f.thumb) { var im = document.createElement('img'); im.src = f.thumb; im.className = 'msg-thumb'; im.alt = f.name; bubble.appendChild(im); }
        else { var ch = document.createElement('div'); ch.className = 'file-chip'; ch.textContent = '📎 ' + f.name; bubble.appendChild(ch); }
      });
      if (content) bubble.appendChild(document.createTextNode(content));
    } else if (kind === 'error') bubble.textContent = content;
    else { bubble.innerHTML = md(content); enhance(bubble); }
    wrap.appendChild(bubble);
    if (kind !== 'error') {
      var actions = document.createElement('div'); actions.className = 'msg-actions';
      var cp = document.createElement('button'); cp.className = 'icon-btn'; cp.type = 'button'; cp.title = 'Copy message';
      cp.innerHTML = App.icon('copy'); cp.onclick = function () { copyText(bubble.getAttribute('data-raw') || content); };
      actions.appendChild(cp); wrap.appendChild(actions);
    }
    row.appendChild(av); row.appendChild(wrap); $('messages').appendChild(row); scrollDown();
    return bubble;
  }
  function showThinking() {
    var b = addMsg('ai', ''); b.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
    return function () { var r = b.closest('.msg'); if (r && r.parentNode) r.parentNode.removeChild(r); };
  }
  function typeInto(bubble, text) {
    return new Promise(function (resolve) {
      if (!st.settings.typing) { bubble.innerHTML = md(text); enhance(bubble); return resolve(); }
      var i = 0, step = Math.max(3, Math.ceil(text.length / 120));
      var timer = setInterval(function () {
        i = Math.min(text.length, i + step);
        bubble.innerHTML = md(text.slice(0, i)); scrollDown();
        if (i >= text.length) { clearInterval(timer); enhance(bubble); resolve(); }
      }, 24);
    });
  }

  /* ---------- attachments ---------- */
  function b64(f) { return new Promise(function (ok, no) { var r = new FileReader(); r.onload = function () { ok(String(r.result).split(',')[1]); }; r.onerror = no; r.readAsDataURL(f); }); }
  function shrink(file, max, q) {           // resize photos in the browser so requests stay small
    return new Promise(function (ok, no) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', q));
      };
      img.onerror = function () { URL.revokeObjectURL(url); no(new Error('bad image')); };
      img.src = url;
    });
  }
  async function addFiles(list) {
    for (var n = 0; n < list.length; n++) {
      var f = list[n];
      if (S.pending.length >= 4) { toast('Max 4 files per message'); break; }
      if (f.size > 12 * 1024 * 1024 || (f.type.indexOf('image/') !== 0 && f.size > 2.5 * 1024 * 1024)) { toast(f.name + ' is too large (files max 2.5 MB)'); continue; }
      try {
        if (f.type.indexOf('image/') === 0) {
          S.pending.push({ name: f.name || 'photo.jpg', type: 'image/jpeg', data: (await shrink(f, 1600, 0.85)).split(',')[1], thumb: await shrink(f, 120, 0.7) });
        } else {
          var isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
          var isText = f.type.indexOf('text/') === 0 || /json|javascript|xml/.test(f.type) || /\.(txt|md|csv|json|html|css|js|ts|jsx|tsx|py|java|c|cpp|sql|sh|xml|ya?ml|log|php)$/i.test(f.name);
          if (!isPdf && !isText) { toast(f.name + ': unsupported file type'); continue; }
          S.pending.push({ name: f.name, type: isPdf ? 'application/pdf' : 'text/plain', data: await b64(f) });
        }
        if (S.pending.reduce(function (s, x) { return s + x.data.length; }, 0) > 3.8e6) { S.pending.pop(); toast('Too much attached data. Remove a file first.'); }
      } catch (e) { toast('Could not read ' + f.name); }
    }
    renderPending();
  }
  function renderPending() {
    var box = $('attachStrip'); box.innerHTML = '';
    S.pending.forEach(function (f, i) {
      var el = document.createElement('div'); el.className = 'attach-item';
      el.innerHTML = f.thumb ? '<img src="' + f.thumb + '" alt="">' : App.icon('file');
      var n = document.createElement('span'); n.textContent = f.name;
      var x = document.createElement('button'); x.className = 'icon-btn'; x.type = 'button'; x.style.minWidth = '28px'; x.style.minHeight = '28px'; x.innerHTML = App.icon('x');
      x.onclick = function () { S.pending.splice(i, 1); renderPending(); };
      el.appendChild(n); el.appendChild(x); box.appendChild(el);
    });
  }
  $('attachBtn').onclick = function () { $('fileInput').click(); };
  $('fileInput').onchange = function (e) { addFiles([].slice.call(e.target.files)); e.target.value = ''; };
  ['dragover', 'drop'].forEach(function (ev) {
    document.querySelector('.composer').addEventListener(ev, function (e) { e.preventDefault(); if (ev === 'drop') addFiles([].slice.call(e.dataTransfer.files)); });
  });
  $('input').addEventListener('paste', function (e) {
    var fs = e.clipboardData && e.clipboardData.files ? [].slice.call(e.clipboardData.files) : [];
    if (fs.length) { e.preventDefault(); addFiles(fs); }
  });

  /* ---------- sending ---------- */
  function fileMeta(f) { return { name: f.name, type: f.type, thumb: f.thumb }; }
  async function send() {
    var input = $('input'), text = input.value.trim(), files = S.pending.slice();
    if ((!text && !files.length) || S.busy) return;
    var c = active(), wasEmpty = !c.messages.length;
    if (wasEmpty) c.title = (text || files[0].name).replace(/\s+/g, ' ').slice(0, 40);
    var msg = { role: 'user', content: text, files: files.map(fileMeta) };
    c.messages.push(msg); c.updated = Date.now();
    input.value = ''; S.pending = []; renderPending(); onInput(); persist();
    renderList(); if (wasEmpty) $('messages').innerHTML = '';
    addMsg('user', text, msg.files);
    S.busy = true; $('send').disabled = true; $('chatTitle').textContent = c.title;
    var stop = showThinking();
    try {
      var body;
      if (S.user) body = { chatId: c.id, message: text, files: files.map(function (f) { return { name: f.name, type: f.type, data: f.data, thumb: f.thumb }; }) };
      else {
        var recent = c.messages.slice(-20);
        body = { messages: recent.map(function (m, i) {
          var o = { role: m.role, content: m.content || '' };
          if (m.role === 'user' && m.files && m.files.length) {
            if (i === recent.length - 1) o.files = files.map(function (f) { return { name: f.name, type: f.type, data: f.data }; });
            else o.content += ' [Earlier attachments: ' + m.files.map(function (f) { return f.name; }).join(', ') + ']';
          }
          return o;
        }) };
      }
      var res = await App.api('/api/chat', { method: 'POST', body: body });
      stop();
      if (!res.ok) {
        if (res.data && res.data.code === 'auth') { S.user = null; renderAccount(); openAuth('login'); }
        var err = new Error(res.status === 413 ? 'Files are too large. Try smaller ones.' :
          (res.data.error ? res.data.error + (res.data.detail ? ' [' + res.data.detail + ']' : '') : 'Request failed (' + res.status + ')'));
        err.failed = true; throw err;
      }
      var reply = res.data.reply;
      if (res.data.title && wasEmpty) c.title = res.data.title;
      c.messages.push({ role: 'assistant', content: reply }); c.updated = Date.now(); persist(); renderList();
      if (S.activeId === c.id) { $('chatTitle').textContent = c.title; var bubble = addMsg('ai', ''); bubble.setAttribute('data-raw', reply); await typeInto(bubble, reply); }
    } catch (err) {
      stop();
      // put the message back so the user can just press send again (no duplicates)
      var idx = c.messages.indexOf(msg); if (idx >= 0) c.messages.splice(idx, 1);
      if (!c.messages.length) c.title = 'New chat';
      if (!input.value) { input.value = text; onInput(); }
      if (!S.pending.length) { S.pending = files; renderPending(); }
      persist();
      if (S.activeId === c.id) { renderAll(); addMsg('error', err.message || 'Something went wrong. Try again.'); }
    } finally { S.busy = false; $('send').disabled = false; }
  }

  /* ---------- composer ---------- */
  function onInput() {
    var i = $('input'); i.style.height = 'auto'; i.style.height = Math.min(i.scrollHeight, 180) + 'px';
    $('chars').textContent = i.value.length; $('tokens').textContent = Math.ceil(i.value.length / 4);
  }
  $('input').addEventListener('input', onInput);
  $('input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 767) { e.preventDefault(); send(); }   // phones: Enter = new line, use the send button
  });
  $('input').addEventListener('focus', function () { setTimeout(scrollDown, 300); });
  $('send').onclick = send;
  $('newChat').onclick = function () { newChat(); drawer(false); };
  $('search').oninput = renderList;
  function drawer(o) { $('sidebar').className = 'sidebar glass' + (o ? ' open' : ''); $('backdrop').className = 'backdrop' + (o ? ' show' : ''); }
  $('menuBtn').onclick = function () { drawer($('sidebar').className.indexOf('open') < 0); };
  $('backdrop').onclick = function () { drawer(false); };

  /* ---------- export ---------- */
  $('exportBtn').onclick = function () {
    var c = active();
    if (!c.messages.length) return toast('Nothing to export yet');
    var txt = c.messages.map(function (m) {
      return (m.role === 'user' ? 'You' : 'AI') + ':\n' + m.content + (m.files && m.files.length ? '\n[Attachments: ' + m.files.map(function (f) { return f.name; }).join(', ') + ']' : '');
    }).join('\n\n---\n\n');
    var a = document.createElement('a'), url = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
    a.href = url; a.download = (c.title.replace(/[^\w]+/g, '-') || 'chat') + '.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };

  /* ---------- settings ---------- */
  function syncSettings() { $('setTheme').value = st.settings.theme; $('setTyping').checked = st.settings.typing; App.applyTheme(st.settings.theme); }
  $('settingsBtn').onclick = function () { drawer(false); $('deleteAcc').style.display = S.user ? 'flex' : 'none'; openModal('settingsModal'); };
  $('setTheme').onchange = function (e) { st.settings.theme = e.target.value; savedSettings(); syncSettings(); };
  $('setTyping').onchange = function (e) { st.settings.typing = e.target.checked; savedSettings(); };
  $('clearAll').onclick = function () {
    if (!confirm('Delete all conversations? This cannot be undone.')) return;
    var done = function () { S.chats = []; S.activeId = null; closeModal('settingsModal'); newChat(); toast('History cleared'); };
    if (S.user) App.api('/api/chats', { method: 'DELETE' }).then(function (r) { if (r.ok) done(); else toast(r.data.error || 'Could not clear history'); }, function (e) { toast(e.message); });
    else done();
  };
  $('deleteAcc').onclick = function () {
    if (!confirm('Delete your account and ALL saved chats permanently?')) return;
    var pw = window.prompt('Enter your password to confirm:'); if (!pw) return;
    App.api('/api/auth/delete', { method: 'POST', body: { password: pw } }).then(function (r) {
      if (!r.ok) return toast(r.data.error || 'Could not delete account');
      S.user = null; S.chats = []; S.activeId = null; closeModal('settingsModal'); renderAccount(); newChat(); toast('Account deleted');
    }, function (e) { toast(e.message); });
  };

  /* ---------- account ---------- */
  function renderAccount() {
    var box = $('account'); box.innerHTML = '';
    if (!S.dbEnabled) { box.innerHTML = '<div class="guest-note">Chats are saved on this device only.</div>'; return; }
    if (S.user) {
      var name = S.user.name || S.user.email;
      box.innerHTML = '<div class="account"><div class="av"></div><div class="who"><b></b><small></small></div><button class="icon-btn" id="logoutBtn" title="Sign out" aria-label="Sign out">' + App.icon('logout') + '</button></div>';
      box.querySelector('.av').textContent = name.charAt(0).toUpperCase();
      box.querySelector('b').textContent = name; box.querySelector('small').textContent = S.user.email;
      $('logoutBtn').onclick = logout;
    } else {
      box.innerHTML = '<div class="guest-note">Guest mode: chats stay on this device. Sign in to sync them everywhere.</div><button class="btn btn-ghost btn-block" id="signinBtn" style="margin-bottom:.6rem"></button>';
      $('signinBtn').innerHTML = App.icon('user') + 'Sign in / Create account';
      $('signinBtn').onclick = function () { drawer(false); openAuth('login'); };
    }
  }
  var authMode = 'login';
  function openAuth(mode) { setAuthMode(mode); $('authErr').textContent = ''; openModal('authModal'); }
  function setAuthMode(m) {
    authMode = m;
    $('tabLogin').className = m === 'login' ? 'on' : ''; $('tabReg').className = m === 'register' ? 'on' : '';
    $('nameWrap').style.display = m === 'register' ? 'block' : 'none'; $('passHint').style.display = m === 'register' ? 'inline' : 'none';
    $('authTitle').textContent = m === 'login' ? 'Sign in' : 'Create account';
    $('authGo').textContent = m === 'login' ? 'Sign in' : 'Create account';
    $('aPass').setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
  }
  $('tabLogin').onclick = function () { setAuthMode('login'); };
  $('tabReg').onclick = function () { setAuthMode('register'); };
  $('aPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('authGo').click(); });
  $('authGo').onclick = async function () {
    var btn = $('authGo'), email = $('aEmail').value.trim(), pass = $('aPass').value, name = $('aName').value.trim();
    $('authErr').textContent = '';
    if (!email || !pass) { $('authErr').textContent = 'Enter your email and password.'; return; }
    btn.disabled = true;
    try {
      var r = await App.api('/api/auth/' + authMode, { method: 'POST', body: { email: email, password: pass, name: name } });
      if (!r.ok) { $('authErr').textContent = r.data.error || 'Something went wrong.'; return; }
      S.user = r.data.user; $('aPass').value = '';
      closeModal('authModal');
      await afterLogin();
    } catch (e) { $('authErr').textContent = e.message; }
    finally { btn.disabled = false; }
  };
  async function afterLogin() {
    // move guest chats into the account (once), then load the account's chats
    var guest = st.chats.filter(function (c) { return c.messages.length; });
    if (guest.length) {
      try {
        var r = await App.api('/api/chats/import', { method: 'POST', body: { chats: guest.map(function (c) {
          return { id: c.id, title: c.title, messages: c.messages.map(function (m) { return { role: m.role, content: m.content, files: m.files }; }) };
        }) } });
        if (r.ok) { st.chats = []; App.save(st); toast('Imported ' + r.data.imported + ' chat(s) into your account'); }
      } catch (e) { /* keep local copy, try again next login */ }
    }
    renderAccount(); await loadServerChats(); toast('Signed in as ' + (S.user.name || S.user.email));
  }
  function logout() {
    App.api('/api/auth/logout', { method: 'POST', body: {} }).then(function () {
      S.user = null; S.chats = st.chats.slice(); S.activeId = null; renderAccount();
      if (!S.chats.length) newChat(); else { S.activeId = S.chats[0].id; renderAll(); }
      drawer(false); toast('Signed out');
    }, function (e) { toast(e.message); });
  }
  async function loadServerChats() {
    var r = await App.api('/api/chats');
    if (!r.ok) { toast(r.data.error || 'Could not load your chats'); S.chats = []; }
    else S.chats = r.data.chats.map(function (c) { return { id: c.id, title: c.title, updated: c.updated, messages: [], loaded: false }; });
    var saved = ''; try { saved = localStorage.getItem(ACTIVE_KEY) || ''; } catch (e) {}
    var pick = S.chats.filter(function (c) { return c.id === saved; })[0] || S.chats[0];
    if (pick) selectChat(pick.id); else { S.activeId = null; newChat(); }
  }

  /* ---------- start ---------- */
  async function boot() {
    syncSettings();
    var me = null;
    try { me = await App.api('/api/auth/me', { timeout: 10000 }); } catch (e) { me = null; }
    if (me && me.ok) { S.dbEnabled = !!me.data.dbEnabled; S.user = me.data.user || null; }
    renderAccount();
    if (S.user) { await loadServerChats(); return; }
    S.chats = st.chats.filter(function (c) { return c && c.id && Array.isArray(c.messages); }).map(function (c) { c.loaded = true; return c; });
    var saved = ''; try { saved = localStorage.getItem(ACTIVE_KEY) || ''; } catch (e) {}
    var pick = S.chats.filter(function (c) { return c.id === saved; })[0];
    if (pick) { S.activeId = pick.id; renderAll(); } else if (S.chats.length) { S.activeId = S.chats[0].id; renderAll(); } else newChat();
    if (location.search.indexOf('auth=1') >= 0 && S.dbEnabled && !S.user) openAuth('login');
  }
  boot();
})();
