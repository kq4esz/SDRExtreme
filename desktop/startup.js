const heading = document.getElementById('update-heading');
const detail = document.getElementById('update-detail');
const progress = document.getElementById('update-progress');
const button = document.getElementById('continue-button');
function render(status) {
  document.getElementById('installed-version').textContent = `INSTALLED ${status.version}`;
  button.disabled = status.phase === 'installing';
  if (status.phase === 'downloading' || status.phase === 'ready') {
    heading.textContent = `Updating to Signal Outpost ${status.availableVersion}`;
    detail.textContent = `${Math.floor(status.percent || 0)}% downloaded. The latest version will open automatically after installation.`;
    progress.value = status.percent || 0;
    document.getElementById('update-note').textContent = 'You can open now and finish updating later.';
  } else if (status.phase === 'installing') {
    heading.textContent = 'Installing update…';
    detail.textContent = 'Signal Outpost will close briefly and reopen with the latest version.';
    document.getElementById('update-note').textContent = 'Memories and settings are preserved.';
    progress.removeAttribute('value');
  } else if (status.phase === 'current') {
    heading.textContent = 'Signal Outpost is up to date';
    detail.textContent = 'Opening your receiver…';
    progress.value = 100;
  } else if (status.phase === 'error') {
    heading.textContent = 'Opening Signal Outpost';
    detail.textContent = 'The update service is unavailable. We’ll try again while you use the application.';
    progress.removeAttribute('value');
  }
}
button.addEventListener('click', () => window.sdrDesktop.continueStartup());
window.sdrDesktop.onUpdateStatus(render);
window.sdrDesktop.getUpdateStatus().then(render).catch(() => {});
