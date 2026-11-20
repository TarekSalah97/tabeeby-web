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
})();
