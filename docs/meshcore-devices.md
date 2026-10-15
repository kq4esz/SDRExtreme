# MeshCore device catalog

Catalog checked 2026-10-15: **94 board profiles** from [companion-v1.18.0](https://github.com/meshcore-dev/MeshCore/releases/tag/companion-v1.18.0).

These are companion firmware profiles, including hardware/display/radio variants.
Transport availability is derived from published firmware names and upstream build
definitions. Interfaces listed across different builds are not necessarily active
at the same time. The installed firmware must enable the selected interface.
Wi-Fi marked **custom build** is defined in source but is not present in this
board's published companion images. USB-only hardware is not given Bluetooth or
Wi-Fi capability by the desktop application.

**Auto / other compatible node** accepts any device implementing the MeshCore
companion protocol, including compatible unlisted boards and custom builds.
Profile selection is optional. Repeaters, room servers, standalone chat firmware
and bootloaders do not automatically expose the companion chat protocol.

USB uses the Windows serial driver for the board at 115200 baud. Bluetooth uses
the Windows BLE stack with the MeshCore Nordic UART service. Wi-Fi uses the node's
companion TCP service (default port 5000). No external Python client, RTL-TCP
service, or third-party MeshCore application is required. Physical hardware
compatibility is not established by generating this metadata or packaging the app.

| Board profile | Platform | Available companion interfaces |
| --- | --- | --- |
| Elecrow ThinkNode M1 | nRF52 | USB, Bluetooth LE |
| Elecrow ThinkNode M2 | ESP32 | USB, Bluetooth LE, Wi-Fi (custom build) |
| Elecrow ThinkNode M3 | nRF52 | USB, Bluetooth LE |
| Elecrow ThinkNode M5 | ESP32 | USB, Bluetooth LE, Wi-Fi (custom build) |
| Elecrow ThinkNode M6 | nRF52 | USB, Bluetooth LE |
| Elecrow ThinkNode M7 | ESP32 | USB, Bluetooth LE, Wi-Fi |
| ThinkNode M4 | nRF52 | USB, Bluetooth LE |
| ThinkNode M8 | nRF52 | USB, Bluetooth LE |
| Heltec ct62 | ESP32 | USB, Bluetooth LE |
| Heltec Mesh Node T096 | nRF52 | USB, Bluetooth LE |
| Heltec Mesh Node T1 | nRF52 | USB, Bluetooth LE |
| Heltec MeshPocket | nRF52 | USB, Bluetooth LE |
| Heltec MeshTower V2 | nRF52 | USB, Bluetooth LE |
| heltec rc32 | ESP32 | USB, Bluetooth LE, Wi-Fi (custom build) |
| heltec rc32 without display | ESP32 | USB, Bluetooth LE, Wi-Fi (custom build) |
| Heltec T114 | nRF52 | USB, Bluetooth LE |
| Heltec T114 (without display) | nRF52 | USB, Bluetooth LE |
| Heltec v2 | ESP32 | USB, Bluetooth LE, Wi-Fi (custom build) |
| Heltec v3 | ESP32 | USB, Bluetooth LE, Wi-Fi |
| Heltec v4 | ESP32 | USB, Bluetooth LE, Wi-Fi |
| Heltec v4 + Expansion Kit (Touch) | ESP32 | USB, Bluetooth LE, Wi-Fi (custom build) |
| Heltec v4 R8 | ESP32 | USB, Bluetooth LE, Wi-Fi |
| heltec v4 r8 tft | ESP32 | USB, Bluetooth LE, Wi-Fi (custom build) |
| Heltec Vision Master E213 | ESP32 | USB, Bluetooth LE |
| Heltec Wireless Paper | ESP32 | USB, Bluetooth LE, Wi-Fi |
| Heltec Wireless Tracker | ESP32 | USB, Bluetooth LE |
| Heltec Wireless Tracker v2 | ESP32 | USB, Bluetooth LE, Wi-Fi (custom build) |
| Heltec WSL3 | ESP32 | USB, Bluetooth LE, Wi-Fi |
| LilyGo LoRa32 V2.1_1.6 | ESP32 | USB, Bluetooth LE, Wi-Fi (custom build) |
| LilyGo T Impulse Plus | nRF52 | Bluetooth LE |
| LilyGo T-Beam (SX1262) | ESP32 | Bluetooth LE |
| LilyGo T-Beam 1.2 (SX1276) | ESP32 | Bluetooth LE |
| LilyGo T-Beam 1W | ESP32 | USB, Bluetooth LE, Wi-Fi (custom build) |
| LilyGo T-Beam Supreme (SX1262) | ESP32 | Bluetooth LE, Wi-Fi (custom build) |
| LilyGo T-Deck | ESP32 | USB, Bluetooth LE |
| LilyGo T-Echo | nRF52 | USB, Bluetooth LE |
| LilyGo T-Echo Card | nRF52 | USB, Bluetooth LE |
| LilyGo T-Echo Lite | nRF52 | USB, Bluetooth LE |
| LilyGo T-Echo-Lite non shell | nRF52 | USB, Bluetooth LE |
| LilyGo T3 S3 (SX126x) | ESP32 | USB, Bluetooth LE |
| LilyGo T3 S3 (SX127x) | ESP32 | USB, Bluetooth LE |
| LilyGo TETH Elite sx1262 | ESP32 | USB, Bluetooth LE |
| Ebyte EoRa-S3 | ESP32 | USB, Bluetooth LE |
| GAT-IoT GAT562 30s | nRF52 | USB, Bluetooth LE |
| GAT-IoT GAT562 Tracker | nRF52 | USB, Bluetooth LE |
| GAT562 Mesh Watch13 | nRF52 | Bluetooth LE |
| ikoka handheld nrf e22 30dbm 096 | nRF52 | USB, Bluetooth LE |
| ikoka handheld nrf e22 30dbm 096 rotated | nRF52 | USB, Bluetooth LE |
| Ikoka Nano (22 dBm) | nRF52 | USB, Bluetooth LE |
| Ikoka Nano (30 dBm) | nRF52 | USB, Bluetooth LE |
| Ikoka Nano (33 dBm) | nRF52 | USB, Bluetooth LE |
| Ikoka Stick (22 dBm) | nRF52 | USB, Bluetooth LE |
| Ikoka Stick (30 dBm) | nRF52 | USB, Bluetooth LE |
| Ikoka Stick (33 dBm) | nRF52 | USB, Bluetooth LE |
| Keepteen LT1 | nRF52 | USB, Bluetooth LE |
| M5Stack Unit C6L | ESP32 | USB, Bluetooth LE |
| Meshadventurer sx1262 | ESP32 | USB, Bluetooth LE |
| Meshadventurer sx1268 | ESP32 | USB, Bluetooth LE |
| meshnology w12 | ESP32 | USB, Bluetooth LE, Wi-Fi (custom build) |
| Meshtiny | nRF52 | USB, Bluetooth LE |
| Minewsemi me25ls01 | nRF52 | USB, Bluetooth LE |
| muzi base duo | nRF52 | USB, Bluetooth LE |
| muzi base duo superIO | nRF52 | Bluetooth LE |
| muzi base uno | nRF52 | USB, Bluetooth LE |
| muzi base uno superIO | nRF52 | Bluetooth LE |
| Muzi Works R1 Neo | nRF52 | USB, Bluetooth LE |
| ProMicro nrf52 (faketec) | nRF52 | USB, Bluetooth LE |
| Raspberry Pi Pico W + LoRa radio | RP2040 | USB, Bluetooth LE, Wi-Fi (custom build) |
| Tiny Relay | STM32 | USB |
| UnitEng Nano G2 Ultra | nRF52 | USB, Bluetooth LE |
| UnitEng Station G2 | ESP32 | USB, Bluetooth LE, Wi-Fi (custom build) |
| UnitEng/BQ Voyage Station G3 | ESP32 | USB, Bluetooth LE, Wi-Fi (custom build) |
| RAK 11310 | RP2040 | USB |
| RAK 3x72 | STM32 | USB |
| RAK WisBlock / WisMesh (RAK 4631) | nRF52 | USB, Bluetooth LE |
| RAK WisBlock 3112 | ESP32 | USB, Bluetooth LE, Wi-Fi |
| RAK WisMesh 1W Booster (3401 + 13302) | nRF52 | USB, Bluetooth LE |
| RAK WisMesh Tag | nRF52 | USB, Bluetooth LE |
| Seeed Studio SenseCAP MeshTracker X1 | nRF52 | USB, Bluetooth LE |
| Seeed Studio SenseCAP Solar Node P1 | nRF52 | USB, Bluetooth LE |
| Seeed Studio SenseCAP T1000-E | nRF52 | USB, Bluetooth LE |
| Seeed Studio Wio Tracker L1 EINK | nRF52 | Bluetooth LE |
| Seeed Studio Wio Tracker L1 Pro | nRF52 | USB, Bluetooth LE |
| Seeed Studio Xiao C3 | ESP32 | USB, Bluetooth LE, Wi-Fi (custom build) |
| Seeed Studio Xiao nRF52 WIO | nRF52 | USB, Bluetooth LE |
| Seeed Studio Xiao S3 WIO | ESP32 | USB, Bluetooth LE, Wi-Fi |
| wio wm1110 | nRF52 | Bluetooth LE |
| wio-e5 | STM32 | USB |
| wio-e5-mini | STM32 | USB |
| WioTrackerL1-1W | nRF52 | USB, Bluetooth LE |
| Xiao rp2040 | RP2040 | USB |
| Xiao S3 | ESP32 | USB, Bluetooth LE, Wi-Fi |
| waveshare rp2040 lora | RP2040 | USB |
| Waveshare S3 LR1121 | ESP32 | USB, Bluetooth LE |

## Source and maintenance

- Official board definitions: https://github.com/meshcore-dev/MeshCore/tree/companion-v1.18.0/variants
- Official flasher names: https://flasher.meshcore.io/config.json
- Full machine-readable provenance and firmware-build interfaces: [meshcore-devices.json](../lib/meshcore-devices.json)
- Refresh with `pnpm update:meshcore-devices`, review the changes, then release a new application version.
- The app includes the catalog for offline use and does not download or flash firmware.
- Upstream MIT notice: [MESHCORE_CATALOG_LICENSE.txt](../lib/MESHCORE_CATALOG_LICENSE.txt).
