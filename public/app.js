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
