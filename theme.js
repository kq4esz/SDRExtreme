(() => {
  const key = 'signal-outpost-theme';
  const root = document.documentElement;
  const read = () => { try { return localStorage.getItem(key) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } };
  function apply(theme) {
    root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f2f5f7' : '#0a1018');
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.setAttribute('aria-checked', String(theme === 'light'));
      toggle.title = `Switch to ${theme === 'light' ? 'dark' : 'light'} mode`;
      toggle.querySelector('.theme-switch-label').textContent = theme === 'light' ? 'Light' : 'Dark';
    }
    document.dispatchEvent(new CustomEvent('signal-outpost:themechange', { detail: { theme } }));
  }
  // Run before styles load, so a saved light preference never paints dark first.
  apply(read());
  document.addEventListener('DOMContentLoaded', () => {
    apply(root.dataset.theme);
    document.getElementById('theme-toggle').addEventListener('click', () => {
      const theme = root.dataset.theme === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(key, theme); } catch { /* The current window can still switch when storage is unavailable. */ }
      apply(theme);
    });
  });
  window.addEventListener('storage', event => { if (event.key === key || event.key === null) apply(read()); });
})();
