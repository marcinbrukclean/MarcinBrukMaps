(function () {
  window.setStatus = function setStatus(message, isError = false) {
    const el = document.getElementById('status');
    if (!el) return;

    el.textContent = message || '';
    el.classList.toggle('warn', Boolean(isError));
  };

  window.showMapError = function showMapError(message) {
    window.setStatus(message, true);
  };
})();
