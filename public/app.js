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
