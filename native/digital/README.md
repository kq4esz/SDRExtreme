# Integrated digital voice engine

SDR Extreme bundles a native Windows x64 **DSD-neo** worker. The application manages its lifecycle, chooses the selected USB device, creates channel and talkgroup maps, authenticates its local control connection, consumes structured telemetry, and plays its decoded PCM through the application's audio controls. It is an integrated upstream decoder running in a separate process; the P25/NXDN protocol implementation was not written from scratch for SDR Extreme.

## Pinned build

- Upstream: <https://github.com/arancormonk/dsd-neo>
- Commit: `32ae7c8afba7bb8acbc95d1c6b4099db48d899a0`
- Build channel: **preview**, native MSVC x64, downloaded October 14, 2026.
- Binary archive SHA-256: `f8ef451c93c03266d009fa7f39c651acb791fe1839ba91f07def3978127e2b33`.
- Executable SHA-256: recorded in `manifest.json` and checked before every launch.
- The pinned upstream source archive is included in `source/dsd-neo-32ae7c8.zip`. It includes CMake/vcpkg build files and dependency pins. Build instructions are in its README.
- Runtime files and upstream notices are preserved under `win32-x64/`; dependency provenance and license identifiers are recorded in `win32-x64/sbom.spdx.json`.
- The bundled RTL-SDR library uses upstream osmocom v2.0.3 with Blog V4 / V4 Lite support, as pinned in the source's `vcpkg-ports/rtlsdr/portfile.cmake`.

The preview build supplies the structured control/telemetry API absent from the current stable 2.10.0 release. This copy is pinned to its commit and hash and does not update automatically. Protocol reliability on the user's local systems still requires reception checks.

## Data path

1. DSD-neo opens the dongle through **librtlsdr/libusb and the installed WinUSB driver**, using `-i rtl:...`. There is no RTL-TCP IQ connection.
2. The engine performs RF filtering, timing recovery, protocol framing, FEC, trunk following and IMBE/AMBE speech synthesis. Its mbelib-neo codec is included. JMBE and Java are not required.
3. Raw signed 16-bit little-endian PCM travels over the child process's **stdout pipe**. The launch preset fixes its 8 kHz rate and mono/stereo layout. SDR Extreme preserves partial frames between pipe reads, mixes TDMA slots to mono and interpolates to 48 kHz for the existing browser audio path.
4. JSON telemetry/control uses an ephemeral **127.0.0.1** TCP port with a random per-session authentication token. This carries commands and metadata, not USB samples. Tokens are not exposed to the frontend and are removed on shutdown.
5. The engine runs without its terminal frontend. Its stderr is shown in the app's diagnostics. A disconnected control connection stops the session so the UI cannot continue claiming to control an unmanaged decoder.
6. `--iq-capture` supplies raw **CU8 receiver IQ** to a temporary sparse session file. `DecoderSpectrum` reads only the newest four 2048-sample windows, computes a power-averaged complex FFT and publishes ten RF frames per second. The metadata's hardware capture center offset is retained when labelling the frequency axis. Old bytes are reclaimed with Windows `FSCTL_SET_ZERO_DATA`; about 4 MiB plus the current write block remains allocated. Files are removed after the child exits. The sparse file's logical size can grow, so this is an internal live buffer and is not a valid recording for replay.
7. The child belongs to a Windows job with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. A service exit terminates the decoder and its capture writer. Sparse-buffer errors stop the session before it can continue accumulating sample data. The runtime requires local sparse-file support for this RF view.

The file controls follow Microsoft's [sparse file operations](https://learn.microsoft.com/en-us/windows/win32/fileio/sparse-file-operations) and [FSCTL_SET_ZERO_DATA](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ni-winioctl-fsctl_set_zero_data) contracts. The source of this bridge is in `lib/decoder-spectrum.mjs`, `lib/rf-spectrum.mjs` and `lib/windows-native.mjs`; the pinned native executable is unmodified.

Only the specific app controls exposed in `server.mjs` are forwarded. Runtime mode switching is intentionally performed by stopping and starting a session: the audio layout must agree with the launch preset. Slot preference can change during a session.

## Source and notices

DSD-neo is GPL-3.0-or-later. Preserve `win32-x64/share/doc/dsd-neo/LICENSE`, `COPYRIGHT`, `THIRD_PARTY.md`, and their license directory with the binary. Individual dependencies keep their own licenses and upstream source links, recorded in the SBOM and upstream build pins. The bundled upstream source is unmodified. SDR Extreme's JavaScript integration is under `lib/digital-decoder.mjs` and `lib/digital-audio.mjs`.
