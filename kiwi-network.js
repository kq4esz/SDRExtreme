export class KiwiNetwork {
  constructor({ api, toast, settings, onSaved }) {
    Object.assign(this, { api, toast, settings, onSaved });
    this.receivers = []; this.markers = new Map(); this.selected = null; this.loading = false;
    this.$ = id => document.getElementById(id);
    this.$('kiwi-refresh').addEventListener('click', () => this.load(true));
    for (const id of ['kiwi-search', 'kiwi-available', 'kiwi-favorites-only', 'kiwi-in-view', 'kiwi-sort']) {
      this.$(id).addEventListener(id === 'kiwi-search' ? 'input' : 'change', () => { this.$('kiwi-list').scrollTop = 0; this.render(); });
    }
    this.$('kiwi-list').addEventListener('click', event => {
      const button = event.target.closest('[data-receiver]');
      if (button) this.select(button.dataset.receiver, true);
    });
    this.$('kiwi-listen').addEventListener('click', () => this.listen());
    this.$('kiwi-favorite').addEventListener('click', () => this.toggleFavorite());
    this.$('kiwi-disconnect').addEventListener('click', () => this.disconnect());
    this.$('kiwi-open-new').addEventListener('click', async () => {
      if (!this.session) return;
      if (window.sdrDesktop) { try { await window.sdrDesktop.openReceiver(this.session.id); } catch (error) { this.toast(error.message, 'error'); } }
      else window.open(this.session.url, '_blank', 'noopener,noreferrer');
    });
    this.$('kiwi-map-reset').addEventListener('click', () => this.map?.setView([24, 5], 2));
    document.addEventListener('signal-outpost:themechange', () => {
      for (const receiver of this.receivers) this.markers.get(receiver.id)?.setStyle(this.markerStyle(receiver));
    });
  }

  show() {
    if (!this.map) this.createMap();
    requestAnimationFrame(() => this.map?.invalidateSize());
    if (!this.receivers.length && !this.loading) this.load();
    else if (this.lastFetch && Date.now() - this.lastFetch > 300000) this.load();
  }

  createMap() {
    if (!window.L) { this.$('kiwi-map-message').textContent = 'Map library unavailable. Restart the application after running setup.'; return; }
    this.map = L.map('kiwi-map', { preferCanvas: true, minZoom: 2, maxZoom: 12, worldCopyJump: true }).setView([24, 5], 2);
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    }).addTo(this.map);
    let errors = 0;
    tiles.on('tileerror', () => { if (++errors === 4) this.$('kiwi-map-message').textContent = 'Map tiles could not load. You can still select a receiver from the station list.'; });
    tiles.on('load', () => { if (!errors) this.$('kiwi-map-message').textContent = ''; });
    this.layer = L.layerGroup().addTo(this.map);
    this.map.on('moveend', () => { if (this.$('kiwi-in-view').checked) this.render(); });
  }

  async load(force = false) {
    if (this.loading) return;
    this.loading = true;
    const refresh = this.$('kiwi-refresh'); refresh.disabled = true; refresh.textContent = 'Refreshing…';
    this.$('kiwi-directory-note').textContent = 'Loading the public receiver directory…';
    if (!this.receivers.length) this.$('kiwi-list').innerHTML = '<div class="kiwi-list-empty">Finding public receivers around the world…</div>';
    try {
      const data = await this.api(`/api/kiwi/receivers${force ? '?refresh=1' : ''}`);
      this.receivers = data.receivers; this.lastFetch = data.fetchedAt;
      const time = new Date(data.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      this.$('kiwi-directory-note').textContent = `${data.stale ? 'Saved directory' : 'Directory updated'} ${time}${data.warning ? ' · Live refresh unavailable' : ''}`;
      this.$('kiwi-directory-note').title = data.warning || 'Directory availability is a recent snapshot. Selected stations are checked before opening.';
      const available = this.receivers.filter(receiver => receiver.connectable).length;
      this.$('kiwi-total').textContent = this.receivers.length.toLocaleString();
      this.$('kiwi-free').textContent = available.toLocaleString();
      this.render();
      const saved = this.selected?.id || this.settings().kiwiReceiverId;
      if (saved && this.receivers.some(receiver => receiver.id === saved)) this.select(saved);
    } catch (error) {
      this.$('kiwi-directory-note').textContent = 'Directory unavailable · use Refresh to retry';
      this.$('kiwi-list').replaceChildren();
      const message = document.createElement('div'); message.className = 'kiwi-list-empty'; message.textContent = error.message; this.$('kiwi-list').append(message);
      this.toast(error.message, 'error');
    } finally { this.loading = false; refresh.disabled = false; refresh.textContent = '⟳ Refresh directory'; }
  }

  favorites() { return new Set(this.settings().kiwiFavorites || []); }

  filtered() {
    const query = this.$('kiwi-search').value.toLowerCase().trim(), favorites = this.favorites();
    const bounds = this.map?.getBounds();
    return this.receivers.filter(receiver => {
      if (this.$('kiwi-available').checked && !receiver.connectable) return false;
      if (this.$('kiwi-favorites-only').checked && !favorites.has(receiver.id)) return false;
      if (this.$('kiwi-in-view').checked && bounds && !bounds.contains([receiver.latitude, receiver.longitude])) return false;
      return !query || `${receiver.name} ${receiver.location} ${receiver.grid} ${receiver.antenna}`.toLowerCase().includes(query);
    }).sort((a, b) => {
      if (this.$('kiwi-sort').value === 'name') return a.name.localeCompare(b.name);
      if (this.$('kiwi-sort').value === 'slots') return b.available - a.available || (b.snr ?? -100) - (a.snr ?? -100);
      return (b.snr ?? -100) - (a.snr ?? -100) || b.available - a.available;
    });
  }

  render() {
    const filtered = this.filtered(), favorites = this.favorites();
    this.$('kiwi-results').textContent = `${filtered.length} receiver${filtered.length === 1 ? '' : 's'}`;
    this.$('kiwi-list').replaceChildren();
    if (!filtered.length) this.$('kiwi-list').innerHTML = '<div class="kiwi-list-empty">No stations match these filters. Try another location or include full receivers.</div>';
    const fragment = document.createDocumentFragment();
    for (const receiver of filtered.slice(0, 200)) {
      const card = document.createElement('button');
      card.className = `kiwi-station${this.selected?.id === receiver.id ? ' selected' : ''}`; card.dataset.receiver = receiver.id;
      const title = document.createElement('strong'); title.textContent = `${favorites.has(receiver.id) ? '★ ' : ''}${receiver.name}`;
      const location = document.createElement('span'); location.className = 'station-location'; location.textContent = receiver.location || `${receiver.latitude.toFixed(2)}°, ${receiver.longitude.toFixed(2)}°`;
      const stats = document.createElement('span'); stats.className = 'station-stats';
      const slots = document.createElement('span'); slots.className = `station-slots ${receiver.connectable ? 'available' : 'full'}`; slots.textContent = receiver.online ? `${receiver.available}/${receiver.capacity} slots free` : 'Offline';
      const snr = document.createElement('span'); snr.textContent = receiver.snr === null ? 'SNR unknown' : `SNR ${receiver.snr} dB`;
      stats.append(slots, snr); card.append(title, location, stats); fragment.append(card);
    }
    if (filtered.length > 200) { const note = document.createElement('div'); note.className = 'kiwi-list-empty'; note.textContent = 'Showing the first 200 stations. Search or zoom the map to narrow the list.'; fragment.append(note); }
    this.$('kiwi-list').append(fragment);
    if (this.layer) {
      this.layer.clearLayers(); this.markers.clear();
      for (const receiver of filtered) {
        const marker = L.circleMarker([receiver.latitude, receiver.longitude], this.markerStyle(receiver));
        const tip = document.createElement('div'); tip.textContent = `${receiver.name} · ${receiver.available} slots free`;
        marker.bindTooltip(tip, { direction: 'top', className: 'kiwi-tooltip' });
        marker.on('click', () => this.select(receiver.id)); marker.addTo(this.layer); this.markers.set(receiver.id, marker);
      }
    }
  }

  markerStyle(receiver) {
    const selected = this.selected?.id === receiver.id;
    const light = document.documentElement.dataset.theme === 'light', available = light ? '#3b681c' : '#c7f36b', full = light ? '#935016' : '#d89662';
    return { radius: selected ? 9 : 5, color: selected ? light ? '#203342' : '#fff' : receiver.connectable ? available : full, weight: selected ? 2 : 1, fillColor: receiver.connectable ? available : full, fillOpacity: selected ? 1 : .7 };
  }

  select(id, pan = false) {
    const receiver = this.receivers.find(row => row.id === id); if (!receiver) return;
    const previous = this.selected; this.selected = receiver;
    if (previous) this.markers.get(previous.id)?.setStyle(this.markerStyle(previous));
    this.markers.get(id)?.setStyle(this.markerStyle(receiver)); this.markers.get(id)?.bringToFront();
    for (const card of this.$('kiwi-list').querySelectorAll('[data-receiver]')) card.classList.toggle('selected', card.dataset.receiver === id);
    if (pan && this.map) this.map.flyTo([receiver.latitude, receiver.longitude], Math.max(4, this.map.getZoom()), { duration: .6 });
    this.$('kiwi-selection-empty').classList.add('hidden'); this.$('kiwi-selection').classList.remove('hidden');
    this.$('kiwi-station-name').textContent = receiver.name;
    this.$('kiwi-station-location').textContent = receiver.location || 'Public KiwiSDR receiver';
    this.$('kiwi-station-antenna').textContent = receiver.antenna || 'Antenna not specified';
    this.$('kiwi-station-hardware').textContent = receiver.hardware || 'KiwiSDR';
    this.$('kiwi-station-grid').textContent = receiver.grid || '—';
    this.$('kiwi-station-band').textContent = `${(receiver.minimum / 1e6).toFixed(2)}–${(receiver.maximum / 1e6).toFixed(1)} MHz`;
    this.$('kiwi-station-snr').textContent = receiver.snr === null ? '—' : `${receiver.snr} dB`;
    this.$('kiwi-station-slots').textContent = `${receiver.available} of ${receiver.capacity} free`;
    this.$('kiwi-listen').disabled = !receiver.connectable;
    this.$('kiwi-listen').textContent = receiver.connectable ? '▶ Check & listen' : receiver.online ? 'Receiver full' : 'Receiver offline';
    this.renderFavorite();
  }

  renderFavorite() {
    const saved = this.selected && this.favorites().has(this.selected.id);
    this.$('kiwi-favorite').textContent = saved ? '★ Saved' : '☆ Favorite'; this.$('kiwi-favorite').setAttribute('aria-pressed', String(Boolean(saved)));
  }

  async toggleFavorite() {
    if (!this.selected) return;
    const ids = this.favorites(); ids.has(this.selected.id) ? ids.delete(this.selected.id) : ids.add(this.selected.id);
    try { const result = await this.api('/api/kiwi/favorites', { ids: [...ids] }); this.onSaved({ kiwiFavorites: result.ids }); this.renderFavorite(); this.render(); }
    catch (error) { this.toast(error.message, 'error'); }
  }

  async listen() {
    if (!this.selected) return;
    const id = this.selected.id, button = this.$('kiwi-listen');
    button.disabled = true; button.textContent = 'Checking receiver…';
    try {
      const station = await this.api('/api/kiwi/connect', { id });
      Object.assign(this.receivers.find(row => row.id === id), station);
      if (this.selected?.id !== id) return;
      this.session = station;
      this.onSaved({ kiwiReceiverId: station.id, kiwiUrl: station.url });
      const frame = this.$('kiwi-frame');
      this.$('kiwi-empty').classList.add('hidden'); frame.classList.remove('hidden');
      this.$('kiwi-title').textContent = station.name;
      this.$('kiwi-session').classList.remove('hidden'); this.$('kiwi-status').textContent = 'Opening receiver…';
      this.$('kiwi-session-note').textContent = station.warning || 'Use the receiver’s controls below to tune and start audio. Availability can change after the check.';
      frame.onload = () => { this.$('kiwi-status').textContent = 'Receiver page loaded'; };
      frame.src = station.url;
      this.$('kiwi-session').scrollIntoView({ behavior: 'smooth', block: 'start' });
      this.toast(station.warning || `Opening ${station.location || station.name}.`, station.warning ? '' : 'success');
      this.render();
    } catch (error) {
      if (error.details?.receiver) { const current = this.receivers.find(row => row.id === id); if (current) Object.assign(current, error.details.receiver); this.render(); }
      this.toast(error.message, 'error');
    } finally { this.select(this.selected?.id); }
  }

  disconnect() {
    this.$('kiwi-frame').src = 'about:blank'; this.$('kiwi-frame').classList.add('hidden');
    this.$('kiwi-empty').classList.remove('hidden'); this.$('kiwi-session').classList.add('hidden');
    this.$('kiwi-status').textContent = 'Disconnected'; this.session = null;
  }
}
