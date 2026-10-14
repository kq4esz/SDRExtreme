# SDR Extreme

SDR Extreme is a Windows desktop receiver suite with native RTL-SDR USB access, a worldwide KiwiSDR receiver map, scanner memories, and digital decoding integrations. The desktop application uses Electron, with a local receiver service and an isolated native USB acquisition process.

## Start the app

1. Download **SDR-Extreme-Setup-0.6.1-x64.exe** from [GitHub Releases](https://github.com/kq4esz/SDRExtreme/releases/latest), run the installer, then launch **SDR Extreme** from the desktop or Start menu. The installer includes Electron, the local service, USB libraries and decoders; Node.js is not required. For a source checkout, use **`launch-sdr-extreme.cmd`** after the setup below.
2. Open **Settings → RTL-SDR device manager**. Click **Refresh**, select your attached receiver, and save the hardware settings.
3. Go to **Live radio** and click **Start listening**. Select a memory or tune to a frequency.
4. Go to **KiwiSDR network** to choose a receiver on the world map or in the station list. Select a station, then click **Check & listen**. Its listening interface opens inside the app; **Open receiver in a new window** offers a dedicated desktop window if a receiver blocks embedding.

For a fresh source checkout, install Node.js **22.12 or newer**, then run `setup-sdr-extreme.cmd`. It installs the JavaScript dependencies and desktop runtime. The driver DLLs under `native/win32-x64` must accompany the app. The setup script can also use the bundled Codex Node runtime on this PC.

Installed builds save memory channels, preferences, the receiver directory and window size in **`%APPDATA%\SDR Extreme\data`**, outside the installation directory. Updates preserve this data. **Help → Open saved data folder** opens it. Source checkouts continue to use the ignored `local-data` folder. To migrate from a source checkout, close both versions and copy `channels.json` and `settings.json` from `local-data` into the installed build's data folder; keep a backup before replacing an existing profile. Closing the desktop app releases its receiver. In a source checkout, `stop-sdr-extreme.cmd` also stops the local service.

The local UI service uses `127.0.0.1:17890` for the desktop interface and audio/waterfall display. **Hardware access is direct USB through `rtlsdr.dll` and WinUSB. There is no RTL-TCP process, hardware TCP connection, or port 1234 requirement.** `launch-browser-console.cmd` is an optional browser interface to the same native USB backend.

## Windows installation and automatic updates

The Windows 10/11 x64 installer creates desktop and Start menu shortcuts and
installs for the current user. A supported RTL-SDR still needs the WinUSB
hardware driver described below. This release is unsigned because no code
signing certificate is configured; Windows SmartScreen can display an
unknown-publisher warning. Download from this project's releases and compare
`SHA256SUMS.txt` when checking a downloaded installer.

Installed builds check **kq4esz/SDRExtreme** releases 15 seconds after launch
and every four hours. A newer stable version downloads in the background
over HTTPS with SHA-512 verification. It installs after normal app exit, once
the receiver service has stopped. **Help → Check for updates** checks manually;
**Restart to install update** becomes available when a download is ready.
Downloads do not stop reception. Offline/update errors are recorded in
`updates.log` in the saved data folder and retried at the next check.
Automatic updates run only in packaged builds. No GitHub token is included
in the application or needed by users to download public releases.

### Build and publish another version

Use Node.js 24 and pnpm 11.25.0 on Windows x64:

```powershell
pnpm install --frozen-lockfile
pnpm build:win
pnpm release:checksums
```

The installer, `.blockmap`, `latest.yml` update manifest and `SHA256SUMS.txt`
are written to `dist/`. `pnpm build:dir` produces an unpacked executable for
local development. Native workers and DLLs are shipped as regular files so
their OS paths and library hashes remain valid. Build output and personal
`local-data` are excluded from Git.

The package includes the Windows x64 Koffi addon and the required Visual C++
runtime sidecars. An after-pack dependency audit checks native imports and
the bundled decoder hashes before an installer is produced. USB sample
callbacks copy native memory with `koffi.decode`; external ArrayBuffer views
are incompatible with Electron's V8 memory cage, including its Node helper
processes. Version 0.6.1 fixes the first-sample crash in installed 0.6.0 builds.

For future releases, update `package.json`'s version and the sidebar version
in `index.html`; add notes in `docs/releases/<version>.md`, commit and push
the source, then push a matching `v<version>` tag. The Windows release Actions
workflow builds the installer and publishes all four assets together from a
draft release. Its scoped `GITHUB_TOKEN` supplies publishing access; no
personal access token needs to be committed or configured for this workflow.
Published versions are never overwritten. The release script rejects a tag,
installer or manifest that does not match the version being published.

To publish a tagged build locally, push the tag first and use
`node scripts/publish-release.mjs` after building/checksums. It reads
`GH_TOKEN`/`GITHUB_TOKEN` or the existing Git Credential Manager login and
keeps credentials in memory. Use either the Actions publishing path or the
local path for a version, not both at once.

Source and bundled native components retain their respective licenses; see
`LICENSE`, `THIRD_PARTY_NOTICES.md` and the notices/source archives under
`native/`.

## USB hardware and driver settings

The bundled RTL-SDR Blog V1.4.0 x64 library supports Blog V4 receivers and compatible RTL2832U dongles. On this PC, native discovery identifies **RTLSDRBlog / Blog V4**, serial **00000001**, with the **R828D** tuner and an installed WinUSB driver. Live USB sample reception, retuning, manual gain and clean release were verified during this update.

For other PCs, follow the [official RTL-SDR Windows setup guide](https://www.rtl-sdr.com/rtl-sdr-quick-start-guide/): install **WinUSB on Bulk-In Interface 0**, keeping the composite parent and Interface 1 unchanged. The app does not replace Windows drivers automatically. Close other receiver applications before opening a dongle.

Hardware controls include USB device selection (remembered by serial), 1.024–3.2 MSPS sample rate, supported manual gain / automatic tuner gain, PPM frequency correction, tuner bandwidth, RTL digital AGC, direct sampling I/Q selection and bias tee control. Changes to sampling controls take effect after reconnecting. Higher sample rates may drop samples on some USB controllers. Bias tee is off by default and supplies antenna DC power when enabled.

**Blog V4:** leave sampling input at Quadrature for HF. Its internal upconverter is handled by the Blog driver. **Blog V3:** HF may require Direct sampling Q branch. A custom matching x64 DLL can be selected under Driver library & diagnostics.

## KiwiSDR network atlas

- Pan and zoom the world map; click a station or choose one from the matching list.
- Search by country, city, callsign, locator grid or antenna description.
- Filter to receivers with free slots, favorites or the visible map area; sort by HF SNR, free slots or name.
- View antenna, hardware, coverage, grid locator, HF SNR and user capacity before connecting.
- Save favorites locally and return to them later.
- The selected receiver's `/status` endpoint is checked before its listening page opens. Full/offline receivers are blocked when the current check confirms that state. If a host's status cannot be reached, the app explains this and permits trying its page.

Receiver metadata comes from [Pierre Ynard / Linkfanel's public KiwiSDR directory](http://rx.linkfanel.net/), cached for five minutes, with the last saved data available during outages. This is an independently published receiver feed; the app does not bypass the KiwiSDR website's human access check. Map imagery is from OpenStreetMap, displayed with attribution. Internet access is needed for directory refresh, map tiles and remote listening. Directory capacity is a snapshot, and slots can fill before a session connects. Remote receivers can impose passwords or listening limits. Some hosts block embedding; use the dedicated receiver window in that case.

## Included receiver features

- Native RTL-SDR USB control, with device identity, tuning, sample-rate selection, manual/automatic gain, PPM, AGC, tuner bandwidth, HF sampling controls and local audio playback.
- Live FFT spectrum and waterfall.
- HD Radio FM/AM reception with HD1–HD8 selection, stereo playback, station/track information and broadcast artwork, through bundled nrsc5.
- Analog receive modes: AM, narrow FM, wide FM, USB, LSB, and CW, plus a raw-IQ monitor setting. FM is mono. The simple browser DSP uses a 48 kHz audio path; wide-FM stereo/RDS and advanced filtering are not included yet.
- Basic CW/Morse text decoding from the CW demodulated audio. Treat this first decoder as experimental; weak or noisy signals can produce errors.
- Conventional memory channels with local add/edit/delete, groups, search, CSV/JSON import, JSON export, selected rapid scanning, signal hold, automatic resume after silence, and Skip/Stop controls.
- KiwiSDR world map and station browser, availability checks, local favorites, embedded listening and dedicated receiver windows.
- FT8/FT4 decode display through WSJT-X UDP decode messages. For audio, choose a virtual cable playback output in Settings, select its paired recording input in WSJT-X, and configure WSJT-X to send UDP decodes to `127.0.0.1:2237`. For example, VB-CABLE playback **CABLE Input** is paired with recording **CABLE Output**. Keep WSJT-X in receive-only use with this app.
- Integrated native digital voice decoder: **P25 Phase 1/2, NXDN48/96, DMR, D-STAR, YSF and M17**, using a bundled DSD-neo core and its included IMBE/AMBE codec. It opens the RTL-SDR directly over USB, follows saved trunked sites or selected conventional memories, and plays decoded voice through SDR Extreme's volume, mute and audio output controls. The workstation displays call slots, talkgroups, source radio IDs, system/control information, RF metrics, P25 FEC quality, call events and diagnostics. A separately configured DSD-FME engine remains available in Settings.

## HD Radio

On **Live radio**, tune an FM broadcast frequency from **87.5–108 MHz** or an AM broadcast frequency from **0.530–1.710 MHz**, then choose **Listen in HD** in the HD Radio panel. You can also select **HD Radio** in Demodulation and use the main listen button. The app switches the selected dongle from its previous reception engine to the HD decoder. Ordinary analog stations do not acquire an HD lock: use **Listen in FM / AM** to receive their analog audio. The receiver must be capable of the selected frequency; AM on Blog V4 uses Quadrature mode and its built-in upconverter.

- **HD1–HD8** selects a zero-based native audio program, shown with the familiar one-based HD label. Advertised services light up as their descriptors arrive; an unadvertised program can be selected to wait for it. Restricted services are identified. Acquisition can take several seconds, and weak signals may lose lock.
- Station name, slogan/message, song title, artist, album, genre, MER and BER appear when supplied by the broadcast. The main app volume, mute and output device apply to HD audio, with both stereo channels retained.
- **Automatic FM fallback** is on by default and saved locally. During FM HD reception, a separate mono FM demodulator uses the same centered USB IQ, keeping nrsc5 running. FM plays while HD acquires, after a sustained loss of lock, when decoded audio runs out, or while a failed HD worker restarts with bounded retry backoff. The player identifies the actual audio source. The selected HD program returns after stable lock/audio and a recovery buffer; brief sync changes are debounced. Short source-change ramps reduce clicks, but broadcast analog/digital delay and loudness are not aligned.
- Fallback uses the **FM main program at the same frequency**. For HD2–HD8 this can be different content. The selected HD subchannel is retained for recovery and for memory saving. HD song details and artwork are paused while FM is playing so they are not presented as FM metadata. The fallback toggle can be changed during reception; it applies to FM broadcast frequencies. AM HD reception retains its manual **Listen in AM** option.
- **Album art / station logos** come from the station's over-the-air LOT image transfers and ID3 artwork references. Artwork is associated with the current program, not taken from an unrelated song search. Some stations supply no art or no track metadata, and images can arrive later than text. No Internet metadata account or external music service is required.
- **Save HD memory** opens a reviewable memory draft for the tuned frequency and selected HD program. The general **Add current to memory** button also retains the active HD subchannel. HD memories can be edited, imported/exported as JSON and recalled individually. Rapid scanning excludes HD memories because the receiver needs time to acquire each digital broadcast.
- Live radio and Decoders both display the HD receiver's actual IQ spectrum and waterfall. HD reception uses the selected RTL-SDR USB device/serial, PPM and bias tee. It fixes the IQ rate at **1.488375 MSPS**, uses full automatic tuner bandwidth, and turns **RTL digital AGC off** for this session. Hardware settings' automatic gain selects an ADC-headroom controller, beginning at manual 0 dB and choosing a supported gain near -7 dBFS peak span. Once calibrated it holds gain through normal variations and responds to overload or large RF level changes. A manually selected gain is respected. The normal analog sample rate and RTL AGC preference are retained.
- USB acquisition uses **32 queued asynchronous transfers**, with nonblocking gain and frequency controls. The browser keeps a **250 ms playback reserve** and rebuffers on a real underrun instead of repeatedly emitting short gaps. **Playback diagnostics** shows actual sample rate, gain/RTL AGC, clipping, HD and browser buffers, underruns, and native silent-block counts. If browser autoplay leaves the output suspended, use **Resume audio** there.

The app bundles **nrsc5 v3.2.0**, including its HDC audio decoder, for Windows x64. Its source, pinned hashes, API header, build recipe and preserved license notices are in [native/hd-radio](native/hd-radio/README.md). The library runs inside an app-managed worker and receives samples over an anonymous pipe from the existing direct-USB receiver; it does not need a second dongle, an RTL-TCP server, or a separately installed HD Radio player. Version 0.5.2 was live checked on **101.5 MHz WQUT HD1** using this PC's Blog V4. Signal conditions and appropriate manual gain vary by station and antenna.

## Integrated digital voice

Open **Decoders**, choose a protocol and click **Start decoder**. For a saved trunked system, select its memory and site first. Tune a conventional digital memory from Memory channels to retain its phase, modulation and identity settings. Stop the current decoder before changing protocol. **Audio slot** sets the native TDMA slot preference; **Return to control** returns a trunked session to its control channel. The application's audio output and volume controls also apply to the integrated decoder.

The app bundles an unmodified native DSD-neo worker with its own DSP, protocol/FEC, trunking and voice codec implementations. SDR Extreme manages that worker as part of the app. **Java and JMBE are not required** for this engine. JMBE provides the speech codec stage; it does not replace RF demodulation and P25/NXDN frame decoding.

The bundled build is a **preview**, pinned to upstream commit `32ae7c8afba7bb8acbc95d1c6b4099db48d899a0`. Its structured control API is not yet in upstream's stable 2.10.0 release. The app checks the executable's SHA-256 before launch. Source, dependency information and preserved license notices are in [native/digital](native/digital/README.md). It does not download or update the decoder at runtime.

The native decoder receives RF over USB; decoded PCM returns over an OS pipe. An authenticated connection on an ephemeral loopback port carries commands and telemetry. **No RTL-TCP receiver is used.** The native decoder's 48 kHz DSP stream is separate from the analog receiver's configurable IQ sample rate. The selected USB device/serial, gain, PPM and bias-tee setting are applied; digital reception requires quadrature sampling. The decoder owns the dongle during reception.

**Decoders includes an RF spectrum and waterfall.** The integrated engine's raw receiver IQ feeds a 2048-bin, Hann-windowed FFT, averaged over four windows, at up to ten updates per second. The frequency axis follows the hardware capture center and sample rate; a green marker identifies the tuned frequency, including the native receiver's offset tuning. The same RF feed is available on Live radio. With the analog USB receiver running (including CW), Decoders displays that receiver's existing RF feed. An external DSD-FME process does not expose this integrated RF feed.

Use **Freeze / Resume** to pause the decoder RF display while reception continues. **Clear waterfall** clears its history. Changing frequency clears the history to keep every row on the same frequency axis. A paused view is labelled PAUSED; stopped or stalled reception shows a waiting/idle state. The native RF bridge uses a temporary sparse IQ buffer in the session folder, reclaims old data in 64 KiB units, keeps approximately 4 MiB of recent allocated sample data, and removes its files on normal shutdown. It requires a local filesystem supporting Windows sparse files. Its logical file size grows during a session; it is not a saved recording. A Windows job object terminates the native decoder if its owning service exits, preventing an orphaned writer.

**Add current to memory** is available on Live radio and the decoder RF toolbar. It takes a fresh snapshot of the receiver's tuned frequency and mode and opens a new conventional memory for review. It preserves P25 phase/modulation/identity settings and NXDN48/96, uses a detected protocol when available, and includes known source/talkgroup context in notes. During trunk following, it captures the currently tuned control or voice frequency. Enter or edit the name, then **Save channel**; Cancel, Close and Escape discard the draft. The button also works with the idle frequency/protocol selection. It never overwrites an existing memory.

Start succeeds only after the worker's API authenticates and it reports a running USB stream. Signal lock and intelligible speech additionally require valid received frames. Local P25/NXDN reception and trunk following remain unverified in this update. Encrypted calls are indicated and their unavailable audio remains muted. The event display retains up to 100 received records per session; Clear view clears the current window's display.

## Memory protocols and selected scanning

Cancel, the close button and Escape dismiss memory dialogs without validating required fields or writing a channel. Save is the only action that creates or updates a memory. Imported trunked memories retain other sites and talkgroups when their primary site is edited.

P25 memories store **Phase 1**, **Phase 2**, or **Auto**, plus modulation and optional WACN/system ID/NAC in hexadecimal. For Phase 2 trunked systems, set the **control channel type** separately: many Phase 2 voice systems use a Phase 1 FDMA control channel. The app uses the native core's mixed P25 decoder for that case, and its Phase 2 / 6000-symbol QPSK options for a TDMA control channel. For direct Phase 2 voice, supply all three identity values when the signal lacks sufficient identity information. The decoder learns normal trunking identities from the control channel.

NXDN memories explicitly select **NXDN48 (4800 bps / 6.25 kHz)** or **NXDN96 (9600 bps / 12.5 kHz)**. These choices select the corresponding native decoder preset. Existing generic NXDN memories default to NXDN48, matching the previous build; edit them if their system uses NXDN96. New manual trunked memories include a primary site automatically, and accept additional site frequencies as `LCN, MHz, role`, preserving LCN zero. Enter the correct channel numbers for NXDN sites that need a channel map.

In **Memory channels**, check the conventional channels to include, choose **Rapid · 150 ms** (or another dwell time), then click **Scan selected**. The native USB receiver starts if needed. The saved selection is retained for the next app session after starting a scan. **Select visible conventional** selects the current search/filter results; **Clear selection** empties it.

One RTL-SDR visits separated frequencies sequentially; this option does not receive all selected frequencies simultaneously. Native rapid dwell choices are 80, 150 and 250 ms, with standard 500 ms / 1.5 second options. Actual visit rate includes hardware tuning time. Signal hold uses channel energy above nearby spectrum noise; scanning resumes after the selected silence interval. Use **Skip active** to leave a continuous transmission, or **Stop** to remain on the current channel. Fast hopping can miss short bursts or weak signals.

Selected digital conventional memories use the decoder core's fastest scan setting or a one-second hangtime, with its own activity hold. Native analog and digital memories need separate scan groups. P25/DMR can use the combined decoder; NXDN48 and NXDN96 need separate groups. Trunked systems follow one site's control channel and talkgroups from **Decoders**, rather than appearing in the conventional rapid-scan list. The integrated engine reports the current scan frequency and supports **Skip active**.

Decoder presets follow the [DSD-neo CLI documentation](https://github.com/arancormonk/dsd-neo/blob/32ae7c8afba7bb8acbc95d1c6b4099db48d899a0/docs/cli.md) and the compatible [DSD-FME usage guide](https://github.com/lwvmobile/dsd-fme/blob/audio_work/examples/Example_Usage.md).

## RadioReference import

The import screen uses RadioReference's official SOAP database service. It supports:

- Trunked systems by RadioReference system ID, including site frequencies and talkgroups.
- Conventional county frequencies by 5-digit US ZIP code.

Each user must supply their own approved application key and their own Premium account credentials. The importer sends these credentials to RadioReference for the request, does not store them, and saves only the resulting channel data locally. Fully encrypted talkgroups and frequencies are omitted from the generated decoder lists. The conventional import caps each import at 500 memories and queries up to 180 frequency subcategories.

Request API access through [RadioReference's application page](https://www.radioreference.com/account/api/apply). The integration follows their [Database Web Service API requirements](https://support.radioreference.com/hc/en-us/articles/18844460198932-Database-Web-Service-API). The API key must be approved before online import can work.

## Digital-mode boundaries

“All demodulation modes” is open-ended: protocols require different demodulators and decoders. This build covers common analog modes, Morse, FT8/FT4 through WSJT-X, and the listed digital voice families through the integrated DSD core. RTTY, PSK, SSTV, ADS-B, DRM, and other data modes are not implemented in this build. The Kiwi view embeds the remote receiver's own interface and extensions; it is not a separate local Kiwi protocol decoder.

The RTL-SDR is receive-only here. The repository bundles native RTL-SDR libraries and the pinned DSD-neo decoder runtime; Windows must already have a suitable USB driver. WSJT-X and the optional DSD-FME selection are external programs.

## Verification and diagnostics

- `npm test` runs the directory, memory protocol and scanner regression checks. These cover phase/control decoder choices, NXDN variants, LCN preservation, selected scan groups, signal hold/resume, Skip, Stop, device errors and in-flight tuning cancellation.
- `npm run test:ui` runs Electron dialog and persistence checks using separate test memory files. Set `SDREXTREME_VERIFY_USB=1` to include a live selected-channel scan; stop reception in the main app first. The UI checks never modify the main memory library.
- `npm run diagnose:usb` opens the selected receiver briefly, receives real IQ samples, retunes, applies a supported manual gain and closes it. Stop listening in the app first so the diagnostic can claim the device.
- Desktop service output is in `local-data/desktop.log`.

## Project files

- `desktop/` — Windows desktop window, menus, hardware DLL picker and isolated remote receiver windows.
- `lib/rtl-usb.mjs`, `lib/rtl-usb-worker.mjs` — native librtlsdr bindings, USB enumeration and IQ acquisition over OS pipes.
- `lib/digital-decoder.mjs`, `lib/digital-audio.mjs` — app-managed native DSD worker, authenticated telemetry/control, call events and PCM conversion.
- `lib/decoder-spectrum.mjs`, `lib/rf-spectrum.mjs`, `lib/windows-native.mjs` — native decoder IQ monitor, complex FFT, sparse buffer management and child-process lifetime control.
- `lib/current-memory.mjs` — current receiver snapshot to a new conventional memory draft.
- `lib/hd-radio.mjs`, `lib/hd-radio-worker.mjs`, `lib/hd-options.mjs`, `hd-radio-ui.js` — HD Radio USB IQ feed, isolated nrsc5 bindings, stereo audio, broadcast metadata/artwork and station player.
- `lib/broadcast-fm.mjs`, `lib/hd-fm-worker.mjs`, `lib/hd-audio-router.mjs` — parallel FM fallback DSP, paced stereo audio queues, signal-loss switching and HD recovery.
- `lib/hd-gain.mjs`, `lib/hd-receiver-metrics.mjs`, `lib/playback-buffer.mjs` — ADC headroom gain selection, live receiver diagnostics and browser audio buffering.
- `lib/kiwi-directory.mjs`, `kiwi-network.js` — public receiver feed, saved cache, map, search, station details and favorites.
- `server.mjs` — local application service, DSP, memory store, RadioReference importer and decoder launchers.
- `index.html`, `app.css`, `app.js` — receiver workstation interface.
- `native/` — bundled Windows x64 RTL-SDR and digital decoder libraries, pinned decoder source and license information.
- `launch-sdr-extreme.cmd`, `setup-sdr-extreme.cmd`, `stop-sdr-extreme.cmd` — Windows desktop launch, setup and shutdown helpers.
