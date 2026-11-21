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
  var boxes = document.querySelectorAll('textarea[data-dictate]');
  if (!Recognition || !boxes.length) return;
  var active = null; // { rec, button, box }
  var noteShown = false;

  function stop() {
    if (!active) return;
    try { active.rec.stop(); } catch (e) { /* already stopped */ }
    active.button.setAttribute('aria-pressed', 'false');
    active.button.textContent = '🎤 ' + active.box.getAttribute('data-dictate-start');
    active = null;
  }

  Array.prototype.forEach.call(boxes, function (box) {
    var bar = document.createElement('div');
    bar.className = 'dictate-bar';
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
    box.parentNode.insertBefore(bar, box.nextSibling);
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
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = function (event) {
        var interim = '';
        for (var i = event.resultIndex; i < event.results.length; i++) {
          var text = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
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
        box.focus();
      } catch (e) { stop(); }
    });
  });
  window.addEventListener('pagehide', stop);
})();
