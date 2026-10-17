import { hdBandForFrequency } from './lib/hd-options.mjs';

const $ = selector => document.querySelector(selector);
const buttons = () => [...document.querySelectorAll('[data-hd-program]')];
const mhz = hz => `${(Number(hz) / 1e6).toFixed(6)} MHz`;
export class HdRadioUi {
  constructor({ api, getState, updateStatus, audio, saveSettings, memory, toast }) {
    Object.assign(this, { api, getState, updateStatus, audio, saveSettings, memory, toast });
    this.program = 0; this.busy = false;
    $('#hd-toggle').addEventListener('click', () => this.toggle());
    $('#hd-analog').addEventListener('click', () => this.analog());
    $('#hd-save-memory').addEventListener('click', () => this.saveMemory());
    $('#hd-fallback').addEventListener('change', event => this.setFallback(event.target.checked));
    $('#hd-audio-resume').addEventListener('click', () => this.audio().then(() => this.render()).catch(error => this.toast(error.message, 'error')));
    for (const button of buttons()) button.addEventListener('click', () => this.select(Number(button.dataset.hdProgram)));
    $('#hd-art').addEventListener('error', () => { this.failedArtwork = $('#hd-art').getAttribute('src'); $('#hd-art').classList.add('hidden'); $('#hd-art-placeholder').classList.remove('hidden'); });
    $('#frequency-input').addEventListener('input', () => this.render());
  }
  frequency() { return Math.round(Number($('#frequency-input').value) * 1e6); }
  async toggle(memoryId) {
    if (this.busy) return;
    this.busy = true; this.render();
    try {
      const state = this.getState();
      if (state.status?.hdActive && !memoryId) this.updateStatus(await this.api('/api/hd/stop', {}));
      else {
        const memory = memoryId ? state.channels.find(item => item.id === memoryId) : null;
        hdBandForFrequency(memory?.frequency || this.frequency());
        if (!await this.saveSettings({ silent: true })) return;
        await this.audio();
        this.updateStatus(await this.api('/api/hd/start', { frequency: memory?.frequency || this.frequency(), program: this.program, memoryId }));
        this.toast('HD receiver listening. Waiting for a digital signal.', 'success');
      }
    } catch (error) { this.toast(error.message, 'error'); }
    finally { this.busy = false; this.render(); }
  }
  async select(program) {
    if (this.busy) return;
    this.program = program;
    const active = this.getState().status?.hdActive;
    this.busy = Boolean(active); this.render();
    try { if (active) this.updateStatus(await this.api('/api/hd/program', { program })); }
    catch (error) { this.toast(error.message, 'error'); }
    finally { this.busy = false; this.render(); }
  }
  async analog() {
    if (this.busy) return;
    this.busy = true; this.render();
    try {
      const frequency = this.getState().status?.hdActive ? this.getState().status.frequency : this.frequency();
      const mode = hdBandForFrequency(frequency) === 'AM' ? 'AM' : 'WFM';
      if (!await this.saveSettings({ silent: true })) return;
      await this.api('/api/hd/stop', {}); await this.api('/api/digital/stop', {});
      await this.audio();
      this.updateStatus(await this.api('/api/rtl/start', { frequency, mode, gain: this.getState().settings.tunerGain || 0 }));
    } catch (error) { this.toast(error.message, 'error'); }
    finally { this.busy = false; this.render(); }
  }
  async setFallback(enabled) {
    if (this.fallbackBusy) return;
    this.fallbackBusy = true; this.render();
    try { this.updateStatus(await this.api('/api/hd/fallback', { enabled })); }
    catch (error) { this.toast(error.message, 'error'); }
    finally { this.fallbackBusy = false; this.render(); }
  }
  saveMemory() {
    try {
      const { status } = this.getState(); const frequency = status?.hdActive ? status.frequency : this.frequency();
      hdBandForFrequency(frequency);
      const name = status?.hdActive ? status.hd?.station?.name : '';
      this.memory({ name: `${name || 'HD Radio'} HD${this.program + 1} ${(frequency / 1e6).toFixed(6)}`, mode: 'HD', frequency,
        hdProgram: this.program, kind: 'conventional', group: 'Broadcast', source: 'Receiver', notes: '' });
    } catch (error) { this.toast(error.message, 'error'); }
  }
  render() {
    const state = this.getState(), status = state.status || {}, hd = status.hd || {};
    const active = Boolean(status.hdActive), busy = this.busy || status.hdStarting || status.digitalStarting;
    const frequency = active ? hd.frequency : this.frequency(); let band;
    try { band = hdBandForFrequency(frequency); } catch {}
    if (active) this.program = hd.program;
    const fm = active && hd.audioSource === 'fm';
    const playing = active && hd.audioSource === 'hd';
    const selected = playing ? hd.selected || {} : {};
    const lock = active && hd.synced;
    const diagnostics=hd.diagnostics||{},playback=state.playbackDiagnostics||{};
    $('#hd-usb-diagnostics').textContent=active?`${hd.info?.readMode||'USB'} · ${((hd.info?.sampleRate||0)/1e6).toFixed(6)} MSPS`:'—';
    $('#hd-gain-diagnostics').textContent=active?`${hd.gainMode==='auto'?'Auto':'Manual'} · ${((hd.info?.gain||0)/10).toFixed(1)} dB · RTL AGC ${hd.info?.rtlAgc?'on':'off'}`:'—';
    $('#hd-adc-diagnostics').textContent=active&&Number.isFinite(diagnostics.clippingPercent)?`${diagnostics.clippingPercent.toFixed(4)}% clipped · ${diagnostics.amplitudeDbfs.toFixed(1)} dBFS span`:'—';
    $('#hd-buffer-diagnostics').textContent=active?`${Math.round(diagnostics.hdBufferedMs||0)} ms · ${diagnostics.audioUnderflows||0} underruns`:'—';
    $('#hd-browser-diagnostics').textContent=active?`${playback.contextState||'starting'} · ${Math.round(playback.bufferedMs||0)} ms · ${playback.underruns||0} underruns`:'—';
    $('#hd-audio-resume').classList.toggle('hidden',!active||playback.contextState!=='suspended');
    $('#hd-native-diagnostics').textContent=active&&diagnostics.native?`${diagnostics.native.silentPcmBlocks} silent / ${diagnostics.native.pcmBlocks} PCM blocks`:'—';
    const fallbackEnabled = active ? hd.fallbackEnabled : status.hdFmFallback !== false;
    $('#hd-fallback').checked = fallbackEnabled;
    $('#hd-fallback').disabled = busy || this.fallbackBusy || band !== 'FM';
    $('#hd-fallback-note').textContent = band !== 'FM' ? 'Automatic FM fallback applies to FM broadcast frequencies.' : hd.fallbackError && active ? hd.fallbackError : fm ? `Playing FM main program; watching for HD${this.program + 1} recovery.` : fallbackEnabled ? 'Play FM if HD drops out; return to HD when stable.' : 'Digital audio only. FM fallback is off.';
    $('.hd-panel').classList.toggle('hd-active', active); $('.hd-panel').classList.toggle('hd-locked', Boolean(lock)); $('.hd-panel').classList.toggle('hd-on-fm', fm);
    $('#hd-toggle').textContent = busy ? 'Please wait…' : active ? 'Stop HD' : 'Listen in HD';
    $('#hd-toggle').disabled = busy || !active && (!band || state.hdRuntime?.available === false);
    $('#hd-analog').textContent = band === 'AM' ? 'Listen in AM' : 'Listen in FM'; $('#hd-analog').disabled = busy || !band;
    $('#hd-save-memory').disabled = busy || !band;
    $('#hd-band').textContent = band ? `${band} DIGITAL` : 'FM / AM';
    $('#hd-lock').textContent = fm ? 'FM FALLBACK' : playing ? 'HD ON AIR' : lock ? 'HD LOCK' : active ? 'ACQUIRING' : 'STANDBY';
    $('#hd-lock').classList.toggle('locked', Boolean(lock));
    $('#hd-lock').classList.toggle('fallback', fm);
    $('#hd-frequency').textContent = band ? `${mhz(frequency)} · HD${this.program + 1}` : 'Choose a broadcast frequency';
    $('#hd-station').textContent = active ? hd.station?.name || 'Receiving station information…' : 'Tune a digital broadcast';
    $('#hd-slogan').textContent = active ? hd.station?.slogan || hd.station?.message || 'Station details appear when received.' : 'FM 87.5–108 MHz · AM 0.530–1.710 MHz';
    $('#hd-title').textContent = fm ? 'Listening to the FM main program' : selected.title || (active ? 'Waiting for HD song information' : 'Your next station is on the air');
    $('#hd-artist').textContent = fm ? `HD${this.program + 1} will resume once digital audio is stable.` : selected.artist || 'Artist and title appear when broadcast by the station.';
    $('#hd-album').textContent = fm ? 'HD track details and artwork are paused during FM playback.' : selected.album || '';
    $('#hd-audio-source').textContent = fm ? 'FM main program · mono' : playing ? `HD${this.program + 1} · stereo` : active ? 'Waiting for audio' : 'Standby';
    $('#hd-signal').textContent = !active && state.hdRuntime?.available === false ? 'Bundled HD Radio decoder is unavailable in this build' : hd.decoderError && active ? 'HD decoder recovering' : lock ? fm ? 'HD acquired · buffering recovery' : 'HD signal locked' : active ? 'Searching for digital signal' : 'No HD receiver running';
    const db = value => Number.isFinite(value) ? value.toFixed(1) : '—';
    $('#hd-mer').textContent = `${db(active ? hd.mer?.lower : null)} / ${db(active ? hd.mer?.upper : null)} dB`;
    $('#hd-ber').textContent = active && Number.isFinite(hd.ber) ? `${(hd.ber * 100).toFixed(3)}%` : '—';
    $('#hd-genre').textContent = fm ? 'FM main program' : selected.genre || selected.programGenre || '—';
    $('#hd-service-note').textContent = active && hd.selected?.access === 1 ? 'This HD program is marked restricted by the station.' : fm ? this.program ? `FM carries the main program, which can differ from HD${this.program + 1}. Your HD selection is retained.` : 'FM audio is playing while the receiver waits for stable HD audio.' : active && !hd.selected?.advertised && !hd.selected?.received ? 'This program has not been advertised yet. Choose a lit service or wait for reception.' : 'Advertised services are lit. Station artwork and track details depend on the broadcast.';
    $('#hd-message').textContent = active ? fm ? hd.decoderError ? 'FM main program is playing while the HD decoder restarts automatically.' : 'Automatic fallback is active. HD audio will return after stable reception.' : hd.decoderError || hd.station?.message || 'Audio and artwork are received over the air. Allow time for HD lock and artwork delivery.' : hd.phase === 'failed' ? hd.lastError : band ? fallbackEnabled && band === 'FM' ? 'Listen in HD keeps FM available while HD acquires or recovers.' : 'Choose Listen in HD. If this station has no digital service, use regular FM or AM audio.' : 'HD Radio supports FM 87.5–108 MHz and AM 0.530–1.710 MHz. Tune one of these bands.';
    for (const button of buttons()) {
      const program = Number(button.dataset.hdProgram), service = active ? hd.services?.find(item => item.program === program) : null;
      button.classList.toggle('selected', this.program === program); button.classList.toggle('available', Boolean(service?.advertised || service?.received));
      button.setAttribute('aria-pressed', String(this.program === program)); button.disabled = busy;
      button.title = service ? `HD${program + 1} · ${service.name || service.genre || 'Broadcast program'}${service.access === 1 ? ' · Restricted' : ''}` : `HD${program + 1} · Not yet advertised; select to listen if present`;
    }
    const img = $('#hd-art'), artwork = selected.artwork;
    if (artwork && artwork !== this.failedArtwork) {
      if (img.getAttribute('src') !== artwork) { img.src = artwork; img.classList.remove('hidden'); }
      $('#hd-art-placeholder').classList.add('hidden');
    } else { img.classList.add('hidden'); img.removeAttribute('src'); $('#hd-art-placeholder').classList.remove('hidden'); }
    img.alt = selected.artworkKind === 'logo' ? 'Broadcast station logo' : 'Broadcast album artwork';
    $('#hd-art-caption').textContent = selected.artworkKind === 'logo' ? 'Station logo · broadcast' : 'Album art · broadcast';
  }
}
