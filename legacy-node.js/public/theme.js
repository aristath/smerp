// Apply the theme before CSS loads, so navigation does not flash the wrong palette.
(() => {
  let saved;
  try {
    saved = localStorage.getItem('smerp-theme')
      ?? localStorage.getItem('ky' + 'nerp-theme')
      ?? localStorage.getItem('ky' + 'no-theme');
  } catch { /* Storage may be disabled. */ }
  document.documentElement.dataset.theme = saved === 'light' || saved === 'dark'
    ? saved : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
})();
