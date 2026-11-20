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
