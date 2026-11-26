// Progressive enhancement only: every page works without JavaScript.
(function () {
  'use strict';
  document.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('[data-pw-toggle]');
    if (!button) return;
    var input = document.getElementById(button.getAttribute('data-pw-toggle'));
    if (!input) return;
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.setAttribute('aria-pressed', show ? 'true' : 'false');
    button.setAttribute('aria-label', button.getAttribute(show ? 'data-label-hide' : 'data-label-show'));
    input.focus();
  });

  // Prescriptions: add more medicine lines (the page always offers a few without JavaScript).
  var addLine = document.querySelector('[data-rx-add]');
  if (addLine) {
    addLine.hidden = false;
    addLine.addEventListener('click', function () {
      var list = addLine.closest('[data-rx]').querySelector('[data-rx-lines]');
      var lines = list.querySelectorAll('[data-rx-line]');
      if (lines.length >= Number(addLine.getAttribute('data-max'))) return;
      var copy = lines[lines.length - 1].cloneNode(true);
      Array.prototype.forEach.call(copy.querySelectorAll('input'), function (el) { el.value = ''; });
      Array.prototype.forEach.call(copy.querySelectorAll('select'), function (el) { el.selectedIndex = 0; });
      list.appendChild(copy);
      copy.querySelector('[data-medicine]').focus();
      if (lines.length + 1 >= Number(addLine.getAttribute('data-max'))) addLine.hidden = true;
    });
  }

  // Prescriptions: picking a known medicine fills in its usual form.
  document.addEventListener('change', function (event) {
    var field = event.target;
    if (!field.matches || !field.matches('[data-medicine]')) return;
    var line = field.closest('[data-rx-line]');
    var form = line && line.querySelector('[data-form]');
    var list = document.getElementById('medicine-list');
    if (!form || !list || form.value) return;
    var wanted = field.value.trim().toLowerCase();
    var match = Array.prototype.find.call(list.options, function (o) { return o.value.toLowerCase() === wanted; });
    if (match) form.value = match.getAttribute('data-form');
  });

  // Printable prescriptions and lab orders.
  var print = document.querySelector('[data-print]');
  if (print) {
    print.hidden = false;
    print.addEventListener('click', function () { window.print(); });
  }

  // Working hours: copy the first ticked day's times to every other ticked day.
  var copy = document.querySelector('[data-copy-hours]');
  if (copy) {
    copy.hidden = false;
    copy.addEventListener('click', function () {
      var rows = Array.prototype.filter.call(document.querySelectorAll('[data-day-row]'), function (row) {
        return row.querySelector('input[type=checkbox]').checked;
      });
      if (rows.length < 2) return;
      var start = rows[0].querySelector('[data-time=start]').value;
      var end = rows[0].querySelector('[data-time=end]').value;
      rows.slice(1).forEach(function (row) {
        row.querySelector('[data-time=start]').value = start;
        row.querySelector('[data-time=end]').value = end;
      });
    });
  }
})();

// After a form error, bring the list of problems into view so the user sees what to fix.
(function () {
  var summary = document.querySelector('.error-summary');
  if (summary) {
    summary.scrollIntoView({ block: 'start' });
    summary.focus({ preventScroll: true });
  }
})();

// Doctor dictation: a microphone button on patient-file text boxes. Uses the browser's own
// speech-to-text (Chrome sends audio to Google, Safari to Apple); the text only lands in the box,
// and nothing is saved until the doctor presses Save. Hidden where the browser cannot do it.
(function () {
  var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var boxes = document.querySelectorAll('textarea[data-dictate], input[data-dictate]');
  if (!Recognition || !boxes.length) return;
  var active = null; // { rec, button, box }
  var noteShown = false;

  function stop() {
    if (!active) return;
    try { active.rec.stop(); } catch (e) { /* already stopped */ }
    active.button.setAttribute('aria-pressed', 'false');
    active.button.textContent = '🎤 ' + active.box.getAttribute('data-dictate-start');
    active.box.classList.remove('dictating');
    active = null;
  }

  // Arabic-Indic and Persian digits to 0-9, then keep only the digits (for mobile numbers).
  // Number words, in case the speech service writes them out ("zero one…", "صفر واحد…").
  var WORDS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    'صفر': 0, 'واحد': 1, 'اتنين': 2, 'اثنين': 2, 'إثنين': 2, 'ثلاثة': 3, 'تلاتة': 3, 'اربعة': 4, 'أربعة': 4, 'خمسة': 5,
    'ستة': 6, 'سبعة': 7, 'ثمانية': 8, 'تمانية': 8, 'تسعة': 9 };
  function digitsOnly(text) {
    text = text.split(/\s+/).map(function (w) {
      var k = w.toLowerCase().replace(/^و(?=\S{3,})/, ''); // Arabic "and" glued to a word
      return Object.prototype.hasOwnProperty.call(WORDS, k) ? String(WORDS[k]) : w;
    }).join(' ');
    return text.replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
      .replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); })
      .replace(/\D/g, '');
  }

  Array.prototype.forEach.call(boxes, function (box) {
    var oneLine = box.tagName === 'INPUT';
    var digits = box.getAttribute('data-dictate-mode') === 'digits';
    var bar = document.createElement('div');
    bar.className = 'dictate-bar' + (oneLine ? ' dictate-inline' : '');
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-outline btn-sm';
    button.setAttribute('aria-pressed', 'false');
    button.textContent = '🎤 ' + box.getAttribute('data-dictate-start');
    var lang = box.getAttribute('data-dictate-lang');
    var switcher = document.createElement('button');
    switcher.type = 'button';
    switcher.className = 'btn btn-ghost btn-sm';
    var otherLabel = box.getAttribute('data-dictate-other');
    function langLabel() { return lang === 'ar-EG' ? 'عربي ⇄ English' : 'English ⇄ عربي'; }
    switcher.textContent = langLabel();
    switcher.setAttribute('aria-label', otherLabel);
    switcher.addEventListener('click', function () {
      lang = lang === 'ar-EG' ? 'en-US' : 'ar-EG';
      switcher.textContent = langLabel();
      if (active && active.box === box) { stop(); button.click(); }
    });
    var live = document.createElement('span');
    live.className = 'hint dictate-live';
    live.setAttribute('aria-live', 'polite');
    bar.appendChild(button);
    bar.appendChild(switcher);
    bar.appendChild(live);
    var anchor = box.closest('.input-group') || box; // keep the +20 box intact
    anchor.parentNode.insertBefore(bar, anchor.nextSibling);
    if (!noteShown) {
      var note = document.createElement('p');
      note.className = 'hint';
      note.textContent = box.getAttribute('data-dictate-note');
      bar.parentNode.insertBefore(note, bar.nextSibling);
      noteShown = true;
    }

    button.addEventListener('click', function () {
      if (active && active.box === box) { stop(); return; }
      stop();
      var rec = new Recognition();
      rec.lang = lang;
      rec.continuous = !oneLine; // a name or number is one short phrase
      rec.interimResults = true;
      rec.onresult = function (event) {
        var interim = '';
        for (var i = event.resultIndex; i < event.results.length; i++) {
          var text = event.results[i][0].transcript;
          if (event.results[i].isFinal && digits) {
            box.value = digitsOnly(text).slice(0, Number(box.getAttribute('maxlength')) || 15);
            box.dispatchEvent(new Event('input', { bubbles: true }));
          } else if (event.results[i].isFinal) {
            var sep = box.value && !/\s$/.test(box.value) ? ' ' : '';
            var max = Number(box.getAttribute('maxlength')) || 100000;
            box.value = (box.value + sep + text.trim()).slice(0, max);
            box.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            interim += text;
          }
        }
        live.textContent = interim;
      };
      rec.onerror = function (event) {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') live.textContent = box.getAttribute('data-dictate-denied');
        stop();
      };
      rec.onend = function () { if (active && active.rec === rec) { live.textContent = ''; stop(); } };
      try {
        rec.start();
        active = { rec: rec, button: button, box: box };
        button.setAttribute('aria-pressed', 'true');
        button.textContent = '⏹ ' + box.getAttribute('data-dictate-stop');
        box.classList.add('dictating');
        box.focus();
      } catch (e) { stop(); }
    });
  });
  window.addEventListener('pagehide', stop);
})();

// Subspecialties follow the chosen specialty: the list shows only that specialty's
// subspecialties as soon as it is picked (search filters and doctor sign-up).
(function () {
  var wraps = document.querySelectorAll('[data-sub-for]');
  Array.prototype.forEach.call(wraps, function (wrap) {
    var form = wrap.closest('form');
    var spec = form && form.querySelector('select[name="' + wrap.getAttribute('data-sub-for') + '"]');
    var sub = wrap.querySelector('select');
    if (!spec || !sub) return;
    var map;
    try { map = JSON.parse(wrap.getAttribute('data-sub-map') || '{}'); } catch (e) { return; }
    var anyLabel = wrap.getAttribute('data-sub-any');
    function refresh() {
      var chosen = {};
      Array.prototype.forEach.call(sub.options, function (o) { if (o.selected && o.value) chosen[o.value] = true; });
      var list = map[spec.value] || [];
      while (sub.firstChild) sub.removeChild(sub.firstChild);
      if (anyLabel !== null) sub.appendChild(new Option(anyLabel, ''));
      list.forEach(function (pair) {
        var o = new Option(pair[1], pair[0]);
        if (chosen[pair[0]]) o.selected = true;
        sub.appendChild(o);
      });
      wrap.hidden = list.length === 0;
      if (sub.multiple) sub.size = Math.min(Math.max(list.length, 2), 6);
    }
    spec.addEventListener('change', refresh);
    refresh();
  });
})();

// Live waiting-time page: reload every N seconds while the tab is visible (no reload in a hidden tab).
(function () {
  var el = document.querySelector('[data-autorefresh]');
  if (!el) return;
  var secs = Math.max(30, parseInt(el.getAttribute('data-autorefresh'), 10) || 60);
  setInterval(function () { if (document.visibilityState === 'visible') location.reload(); }, secs * 1000);
})();

// DEMO ONLY: the fictional "Tabeeby AI" diagnosis helper on the visit notes form.
// Results are built with textContent (never innerHTML), and nothing is added to the notes
// unless the doctor presses "Add".
(function () {
  var panels = document.querySelectorAll('[data-ai-assist]');
  Array.prototype.forEach.call(panels, function (panel) {
    var form = panel.closest('form');
    var btn = panel.querySelector('[data-ai-run]');
    var out = panel.querySelector('.ai-out');
    if (!form || !btn || !out) return;
    var L = function (k) { return panel.getAttribute('data-l-' + k) || ''; };
    var field = function (name) { var el = form.querySelector('[name="' + name + '"]'); return el ? el.value : ''; };
    var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    function append(name, text) {
      var ta = form.querySelector('[name="' + name + '"]');
      if (!ta) return;
      ta.value = ta.value.trim() ? ta.value.replace(/\s+$/, '') + '\n' + text : text;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function list(title, items, cls) {
      if (!items || !items.length) return null;
      var box = el('div', 'ai-block' + (cls ? ' ' + cls : ''));
      box.appendChild(el('h4', null, title));
      var ul = el('ul');
      items.forEach(function (x) { ul.appendChild(el('li', null, x)); });
      box.appendChild(ul);
      return box;
    }
    function render(r) {
      out.textContent = '';
      if (!r.matched) {
        out.appendChild(el('p', 'muted', L('none')));
      } else {
        var dx = el('div', 'ai-block');
        dx.appendChild(el('h4', null, L('ddx')));
        var ul = el('ul', 'ai-ddx');
        r.suggestions.forEach(function (s) {
          var li = el('li', 'ai-ddx-item');
          var top = el('div', 'ai-ddx-top');
          top.appendChild(el('span', 'ai-level ai-' + s.likelihood, L(s.likelihood)));
          top.appendChild(el('strong', null, s.condition));
          li.appendChild(top);
          li.appendChild(el('span', 'small muted', s.why));
          var add = el('button', 'btn btn-ghost btn-sm', L('add-dx'));
          add.type = 'button';
          add.addEventListener('click', function () { append('diagnosis', s.condition); add.textContent = L('added'); add.disabled = true; });
          li.appendChild(add);
          ul.appendChild(li);
        });
        dx.appendChild(ul);
        out.appendChild(dx);
        var tests = list(L('tests'), r.tests);
        if (tests) {
          var addPlan = el('button', 'btn btn-ghost btn-sm', L('add-plan'));
          addPlan.type = 'button';
          addPlan.addEventListener('click', function () { append('plan', r.tests.join(', ')); addPlan.textContent = L('added'); addPlan.disabled = true; });
          tests.appendChild(addPlan);
          out.appendChild(tests);
        }
        [list(L('flags'), r.redFlags, 'ai-flags'), list(L('ask'), r.questions)].forEach(function (b) { if (b) out.appendChild(b); });
      }
      var c = list(L('cautions'), r.cautions, 'ai-cautions');
      if (c) out.appendChild(c);
    }
    btn.addEventListener('click', function () {
      var csrf = form.querySelector('input[name="_csrf"]');
      var body = new URLSearchParams();
      body.set('_csrf', csrf ? csrf.value : '');
      body.set('record', panel.getAttribute('data-record') || '');
      body.set('complaint', field('complaint'));
      body.set('history', field('history'));
      body.set('examination', field('examination'));
      btn.disabled = true;
      out.textContent = '';
      var steps = L('steps').split('|');
      var thinking = el('p', 'ai-thinking', steps[0]);
      out.appendChild(thinking);
      var i = 0;
      var timer = setInterval(function () { i = Math.min(i + 1, steps.length - 1); thinking.textContent = steps[i]; }, 450);
      var request = fetch(panel.getAttribute('data-url'), {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: body.toString(),
      }).then(function (res) { if (!res.ok) throw new Error(String(res.status)); return res.json(); });
      // A short pause so the "thinking" steps can be read (it is a demo).
      var pause = new Promise(function (ok) { setTimeout(ok, 1400); });
      Promise.all([request, pause]).then(function (v) { render(v[0]); })
        .catch(function () { out.textContent = ''; out.appendChild(el('p', 'field-error', L('error'))); })
        .then(function () { clearInterval(timer); btn.disabled = false; });
    });
  });
})();

// Search filters: open on wide screens, folded on phones so the doctors show first.
(function () {
  if (!window.matchMedia || !window.matchMedia('(max-width: 900px)').matches) return;
  Array.prototype.forEach.call(document.querySelectorAll('details[data-close-on-phone]'), function (d) { d.open = false; });
})();

// Sign-up documents: show the chosen file's name, and show kind-specific documents (the radiation
// licence) only when that kind is picked. Without JavaScript every box is shown.
(function () {
  Array.prototype.forEach.call(document.querySelectorAll('.doc-field input[type=file]'), function (input) {
    input.addEventListener('change', function () {
      var out = input.closest('.doc-field').querySelector('[data-file-name]');
      var n = input.files ? input.files.length : 0;
      if (out) out.textContent = n === 0 ? '' : n === 1 ? '✓ ' + input.files[0].name
        : '✓ ' + (document.documentElement.lang === 'ar' ? n + ' ملفات' : n + ' files');
      input.closest('.doc-field').classList.toggle('has-file', !!(input.files && input.files[0]));
    });
  });
  var only = document.querySelectorAll('[data-only-kind]');
  if (!only.length) return;
  function sync() {
    var picked = document.querySelector('input[name=kind]:checked');
    Array.prototype.forEach.call(only, function (box) {
      var show = !!picked && picked.value === box.getAttribute('data-only-kind');
      box.hidden = !show;
      var input = box.querySelector('input[type=file]');
      if (input) input.required = show;
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[name=kind]'), function (r) { r.addEventListener('change', sync); });
  sync();
})();

// Buttons that ask before doing something (data-confirm="question").
document.addEventListener('click', function (e) {
  var b = e.target && e.target.closest ? e.target.closest('[data-confirm]') : null;
  if (b && !window.confirm(b.getAttribute('data-confirm'))) e.preventDefault();
});

// Visit photos: show how many are chosen; on a saved visit, upload straight after choosing.
(function () {
  Array.prototype.forEach.call(document.querySelectorAll('.photo-pickers'), function (box) {
    var inputs = box.querySelectorAll('input[type=file]');
    var count = box.querySelector('[data-photo-count]');
    var form = box.closest('form');
    var original = count ? count.textContent : '';
    Array.prototype.forEach.call(inputs, function (input) {
      input.addEventListener('change', function () {
        var n = 0;
        Array.prototype.forEach.call(inputs, function (i) { n += i.files ? i.files.length : 0; });
        if (count) count.textContent = n ? '✓ ' + n + ' 📷' : original;
        if (n && form && form.hasAttribute('data-photo-form')) form.submit();
      });
    });
  });
})();

// Quick lab sets: ticking a set ticks its tests (and adds its typed tests) so the doctor sees and can
// adjust exactly what will be ordered. With this script running, the set boxes are display-only:
// the server then uses only the ticked tests. Without it, the server expands the ticked sets itself.
(function () {
  Array.prototype.forEach.call(document.querySelectorAll('input[data-lab-set]'), function (box) {
    var form = box.closest('form');
    if (!form) return;
    box.removeAttribute('name');
    box.addEventListener('change', function () {
      var codes = (box.getAttribute('data-lab-set') || '').split(',').filter(Boolean);
      var names = (box.getAttribute('data-lab-names') || '').split('|').filter(Boolean);
      var others = form.querySelectorAll('input[data-lab-set]');
      function inOtherTickedSet(code) {
        return Array.prototype.some.call(others, function (o) {
          return o !== box && o.checked && (o.getAttribute('data-lab-set') || '').split(',').indexOf(code) >= 0;
        });
      }
      codes.forEach(function (code) {
        var t = form.querySelector('input[name=lab_code][value="' + code + '"]');
        if (!t) return;
        if (box.checked) {
          t.checked = true;
          var group = t.closest('details');
          if (group) group.open = true;
        } else if (!inOtherTickedSet(code)) {
          t.checked = false;
        }
      });
      var other = form.querySelector('textarea[name=lab_other]');
      if (other && names.length) {
        var lines = other.value.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
        names.forEach(function (n) {
          var i = lines.map(function (l) { return l.toLowerCase(); }).indexOf(n.toLowerCase());
          if (box.checked && i < 0) lines.push(n);
          if (!box.checked && i >= 0) lines.splice(i, 1);
        });
        other.value = lines.join('\n');
      }
    });
  });
})();

// City + district pickers: choosing a city narrows the district list to that city; choosing a
// district sets its city. Without this script both lists still work (districts are grouped by city).
(function () {
  Array.prototype.forEach.call(document.querySelectorAll('[data-city-pair]'), function (pair) {
    var city = pair.querySelector('select[name=city]');
    var district = pair.querySelector('select[name=district]');
    if (!city || !district) return;
    var first = district.firstElementChild && district.firstElementChild.tagName === 'OPTION' ? district.firstElementChild : null;
    var groups = Array.prototype.map.call(district.querySelectorAll('optgroup'), function (g) { return g.cloneNode(true); });
    function cityLabel() {
      var o = city.options[city.selectedIndex];
      return o && o.value ? o.textContent.trim() : '';
    }
    function rebuild() {
      var keep = district.value;
      var label = cityLabel();
      district.innerHTML = '';
      if (first) district.appendChild(first.cloneNode(true));
      groups.forEach(function (g) {
        if (!label || g.label === label) district.appendChild(g.cloneNode(true));
      });
      district.value = keep;
      if (district.value !== keep) district.value = '';
    }
    city.addEventListener('change', rebuild);
    district.addEventListener('change', function () {
      var opt = district.options[district.selectedIndex];
      var g = opt && opt.parentNode && opt.parentNode.tagName === 'OPTGROUP' ? opt.parentNode.label : '';
      if (!g) return;
      Array.prototype.forEach.call(city.options, function (o) { if (o.textContent.trim() === g) city.value = o.value; });
    });
    if (cityLabel()) rebuild();
  });
})();

// Medicine reminders: turn phone / browser notifications on or off for this device.
(function () {
  var box = document.querySelector('[data-push]');
  if (!box) return;
  var on = box.querySelector('[data-push-on]');
  var off = box.querySelector('[data-push-off]');
  var status = box.querySelector('[data-push-status]');
  var unsupported = box.querySelector('[data-push-unsupported]');
  var csrfInput = document.querySelector('input[name="_csrf"]');
  var csrf = csrfInput ? csrfInput.value : '';
  var t = {
    on: document.documentElement.lang === 'ar' ? 'الإشعارات شغالة على الجهاز ده.' : 'Notifications are on for this device.',
    off: document.documentElement.lang === 'ar' ? 'الإشعارات مقفولة على الجهاز ده.' : 'Notifications are off for this device.',
    denied: document.documentElement.lang === 'ar'
      ? 'الإشعارات ممنوعة للموقع ده من إعدادات المتصفح. افتح إعدادات الموقع واسمح بالإشعارات، وبعدين جرّب تاني.'
      : 'Notifications are blocked for this site in your browser settings. Allow them in the site settings, then try again.',
    failed: document.documentElement.lang === 'ar' ? 'ماقدرناش نشغّل الإشعارات. جرّب تاني.' : "Couldn't turn notifications on. Please try again."
  };
  function show(el, yes) { if (el) el.hidden = !yes; }
  function say(text) { if (status) { status.textContent = text; status.hidden = false; } }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    show(unsupported, true);
    return;
  }
  function keyBytes(b64) {
    var s = (b64 + '===='.slice((b64.length + 3) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(s); var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function b64u(buf) {
    var bytes = new Uint8Array(buf); var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function post(url, fields) {
    var body = new URLSearchParams(); body.set('_csrf', csrf);
    Object.keys(fields).forEach(function (k) { body.set(k, fields[k]); });
    return fetch(url, { method: 'POST', body: body, credentials: 'same-origin' });
  }
  function refresh(reg) {
    return reg.pushManager.getSubscription().then(function (sub) {
      show(on, !sub); show(off, !!sub);
      say(Notification.permission === 'denied' ? t.denied : sub ? t.on : t.off);
      return sub;
    });
  }
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(function (reg) {
    refresh(reg);
    on.addEventListener('click', function () {
      on.disabled = true;
      Notification.requestPermission().then(function (perm) {
        if (perm !== 'granted') { say(t.denied); on.disabled = false; return; }
        return navigator.serviceWorker.ready.then(function (ready) {
          return ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(box.getAttribute('data-key')) });
        }).then(function (sub) {
          return post(box.getAttribute('data-subscribe'), { endpoint: sub.endpoint, p256dh: b64u(sub.getKey('p256dh')), auth: b64u(sub.getKey('auth')) })
            .then(function (res) { if (!res.ok) throw new Error('save failed'); window.location.reload(); });
        });
      }).catch(function () { say(t.failed); on.disabled = false; });
    });
    off.addEventListener('click', function () {
      off.disabled = true;
      reg.pushManager.getSubscription().then(function (sub) {
        if (!sub) return;
        return post(box.getAttribute('data-unsubscribe'), { endpoint: sub.endpoint }).then(function () { return sub.unsubscribe(); });
      }).then(function () { window.location.reload(); }).catch(function () { off.disabled = false; });
    });
  }).catch(function () { show(unsupported, true); });
})();


// Big phone photos are made smaller before upload (still sharp enough to read a licence), so
// several photos fit in one form and upload quickly on mobile data. PDFs and anything the browser
// can't draw (e.g. HEIC outside Safari) are sent as they are; the server accepts those too.
(function () {
  var MAX_SIDE = 2200, QUALITY = 0.85, MIN_BYTES = 1.2 * 1024 * 1024;
  if (!window.DataTransfer || !window.HTMLCanvasElement) return;
  function shrink(file) {
    return new Promise(function (resolve) {
      if (!/^image\//.test(file.type) || file.size < MIN_BYTES) return resolve(file);
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (blob) {
          if (!blob || blob.size >= file.size) return resolve(file);
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
        }, 'image/jpeg', QUALITY);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[type=file][data-shrink]'), function (input) {
    input.addEventListener('change', function () {
      if (input.dataset.shrinking === '1' || !input.files || !input.files.length) return;
      var form = input.form;
      var btn = form && form.querySelector('button[type=submit]');
      if (btn) btn.disabled = true;
      Promise.all(Array.prototype.map.call(input.files, shrink)).then(function (files) {
        try {
          var dt = new DataTransfer();
          files.forEach(function (f) { dt.items.add(f); });
          input.dataset.shrinking = '1';
          input.files = dt.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (e) { /* keep the originals */ }
        input.dataset.shrinking = '';
        if (btn) btn.disabled = false;
      });
    });
  });
})();
