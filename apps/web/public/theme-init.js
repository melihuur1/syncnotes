// Applied before first paint so the page never flashes the wrong theme.
// Kept as an external file (not inline) so the Content-Security-Policy can forbid inline scripts.
(function () {
  try {
    var stored = localStorage.getItem('syncnotes:theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = stored === 'dark' || ((!stored || stored === 'system') && prefersDark);
    document.documentElement.classList.toggle('dark', dark);
  } catch {
    /* storage unavailable */
  }
})();
