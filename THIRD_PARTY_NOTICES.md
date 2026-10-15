# SDR Extreme third-party components

SDR Extreme application source is distributed under GPL-3.0-only; see `LICENSE`.
Third-party components retain their own licenses and copyright notices.

| Component | Version | License and source |
| --- | --- | --- |
| Electron / Chromium / Node.js | 44.7.1 | Electron MIT and included Chromium notices: `LICENSE.electron.txt`, `LICENSES.chromium.html` beside the executable; https://github.com/electron/electron/tree/v44.7.1 |
| Koffi | 3.3.3 | MIT; installed package `LICENSE.txt`; https://github.com/Koromix/koffi |
| Leaflet | 1.9.4 | BSD-2-Clause; installed package `LICENSE`; https://github.com/Leaflet/Leaflet/tree/v1.9.4 |
| electron-updater | 6.8.9 | MIT; installed package `LICENSE`; https://github.com/electron-userland/electron-builder |
| MeshCore JavaScript SDK (@liamcottle/meshcore.js) | 1.15.0 | MIT; installed package `LICENSE`; https://github.com/meshcore-dev/meshcore.js |
| MeshCore device catalog metadata | companion-v1.18.0 | Derived from official release assets, board definitions and flasher names; upstream MIT notice in `lib/MESHCORE_CATALOG_LICENSE.txt`; https://github.com/meshcore-dev/MeshCore/tree/companion-v1.18.0/variants |
| SerialPort / @serialport/bindings-cpp | 13.0.0 | MIT; installed package licenses; https://github.com/serialport/node-serialport |
| RTL-SDR Blog driver | V1.4.0 | GPL-2.0-or-later; `native/COPYING-RTL-SDR.txt`; https://github.com/rtlsdrblog/rtl-sdr-blog/tree/V1.4.0 |
| nrsc5 | 3.2.0 | GPL-3.0; `native/hd-radio/COPYING.GPL-3.0`; corresponding source snapshot and build recipe in `native/hd-radio/source/` |
| DSD-neo | 2.10.0+32ae7c8 | GPL-3.0-or-later; notices under `native/digital/win32-x64/share/doc/dsd-neo/`; corresponding source snapshot in `native/digital/source/` |

The nrsc5 DLL is an unmodified file from NRSC5 Studio v0.6.5. Its embedded
FFTW, libusb, librtlsdr and FAAD2 components are documented, with exact source
links, in `native/hd-radio/THIRD_PARTY_NOTICES.md`. Only the nrsc5 library is
included from that distribution.

DSD-neo's dependent DLLs, source provenance and license notices are retained
in `native/digital/win32-x64/`, including its SPDX software bill of materials.
The RTL-SDR Blog companion pthread and Microsoft Visual C runtime files are
unmodified upstream release files; see `native/README.md` for their origin.
The Microsoft Visual C++ runtime DLLs from the DSD-neo distribution are also
placed beside the application executable; its `VCRUNTIME140.dll` accompanies
the Blog USB library as well. These are unchanged copies of the same files.

Application source and release tags are available without charge at
https://github.com/kq4esz/SDRExtreme. The native source archives, manifests,
build information and notices are included in both the source repository
and the installed application. Upstream dependency source locations remain
listed in their respective native notices.

The KiwiSDR directory is supplied by Linkfanel. Map tiles are supplied by
OpenStreetMap, with attribution displayed in the receiver map. Station
metadata and images displayed while listening are received from broadcasts.

HD Radio is a trademark of its owner. SDR Extreme is an independent project
and is not endorsed by the trademark owner, RTL-SDR Blog, RadioReference,
KiwiSDR or the upstream decoder projects.
