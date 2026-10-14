# RTL-SDR native USB library

The Windows x64 native receiver uses the unmodified `rtlsdr.dll`, `pthreadVC2.dll`, and `msvcr100.dll` from RTL-SDR Blog driver release **V1.4.0**. It supports the Blog V4 as well as compatible RTL2832U receivers.

- Binary release: https://github.com/rtlsdrblog/rtl-sdr-blog/releases/tag/V1.4.0
- Corresponding RTL-SDR source: https://github.com/rtlsdrblog/rtl-sdr-blog/tree/V1.4.0
- Source archive: https://github.com/rtlsdrblog/rtl-sdr-blog/archive/refs/tags/V1.4.0.zip
- Original release ZIP SHA-256: `7ef33f1304647f65e5e0fde43637a73d54f076e91e651a3cecc4f55a17fd9815`
- RTL-SDR license: GNU GPL v2 or later; see `COPYING-RTL-SDR.txt` and the upstream source headers.
- The companion pthread and Microsoft Visual C runtime retain their upstream licenses and notices. The original release archive is the source of these companion files.

The DLL talks to the dongle through libusb/WinUSB. SDR Extreme does not install or change Windows USB drivers. If discovery fails, install WinUSB on the dongle's **Bulk-In Interface 0** with the official RTL-SDR setup instructions. Leave the composite parent and Interface 1 alone.

Use a matching architecture for custom libraries. This build bundles x64 DLLs. Hardware acquisition is isolated in a local helper process; IQ samples travel through an anonymous OS pipe. There is no RTL-TCP receiver or port 1234 dependency.
