# Propagation workspace

Open **Propagation** in the sidebar or use **Ctrl+6** in the desktop application.
The workspace supports the saved Light/Dark appearance and has three tabs.

## Station and location

Expand **Station & location**, search an address or place, select the desired
result, and click **Save station**. Address lookup is performed only when you
click Find address or press Enter in that field. Searches are sent to
OpenStreetMap / Nominatim. Results can be ambiguous; check the selected
coordinates before saving. Address searches are not run automatically.

Alternatively, enter latitude and longitude directly, using negative values
for south and west. Coordinate entry works without a geocoder. Height is in
metres above sea level. The address label, coordinates, height, elevation mask,
prediction window, callsign and report direction are saved only in the local
data profile's `propagation.json`. Clear location removes the saved observer
while retaining the other station preferences.

The minimum elevation defaults to **10°** and can be set from **0–80°**. Choose
a pass window of **3, 5 or 7 days**. A callsign is optional. Without one, digital
activity uses the saved observer's four-character Maidenhead receiver grid.

## HF and ham band conditions

- NOAA SWPC supplies current R/S/G scales, observed planetary Kp and 10.7 cm
  solar flux. Kp history shows recent planetary observations.
- HAMQSL / N0NBH supplies calculated day/night outlooks for 80–40, 30–20,
  17–15 and 12–10 metre band groups, plus sunspots, X-ray class, solar wind,
  IMF Bz and an estimated noise level.
- Each source has its own observation and retrieval timestamps. Missing,
  aging and cached data are marked; an unavailable source does not become a
  favorable band report. The calculated outlook is general, not a local
  measurement or a prediction of a particular path.
- Refresh respects source intervals: NOAA 5–30 minutes and HAMQSL one hour.
  Failed sources are retried no more often than once a minute. Public feed
  caches permit offline display with explicit saved/stale labels.

## International Space Station

The ISS tab shows its calculated ground position, altitude and ground track
from 15 minutes before to 100 minutes after the current time. With an observer
saved, it also shows azimuth, elevation and slant range.

CelesTrak supplies ISS / NORAD **25544** GP/OMM elements; the pinned MIT-licensed
**satellite.js 7.1.0** library uses SGP4 for propagation and observer geometry.
Position updates every ten seconds while the ISS tab is visible. Orbital
elements are cached for two hours. Elements older than three days carry a
warning; data more than seven days old or implausibly far in the future cannot
be used. Elements and predicted positions are not measured real-time telemetry.

Pass calculations run in a worker thread, with bounded execution time and a
five-minute result cache. The schedule shows AOS, peak, maximum elevation, LOS,
duration and acquisition/loss azimuth. It includes a pass already in progress.
Times can be displayed in **UTC** or **this computer's local timezone**; they
are not automatically converted to the timezone of a searched address.

These are **radio passes above the chosen elevation mask**. Terrain, buildings,
radio equipment, spacecraft operating mode, optical illumination and sky
visibility are not modeled. Orbital age, maneuvers and observer coordinates
affect accuracy. Viewing a pass does not tune a receiver or transmit.

## FT8 and FT4

### Activity reports

Save a callsign or observer location, open **FT8 / FT4**, and load activity.
Callsign queries can show both directions, reports received by the station, or
reports of that station heard elsewhere. Grid queries show reports received
within the observer's four-character grid. These requests send the selected
callsign or grid to PSK Reporter, not the full saved street address.

PSK Reporter queries a 15-minute window and requests up to 500 reception
records. FT8/FT4 mode and band filters apply to the returned sample. The list
displays up to 100 matching reports and the map up to 150 paths/endpoints.
Distances and plotted endpoints use grid-square centers. Data may be delayed
or incomplete; an empty sample does not prove that a band is closed. Counts
are reception reports, not confirmations of a contact or message delivery.

One provider query is allowed per installation every five minutes, including
failures and query changes. The last allowed query time is saved across restarts.
Visible digital activity refreshes after that interval. Changing callsign or
location may require waiting until the next allowed query. Failed requests
show saved reports only when their query matches the current station.

### WSJT-X receive bridge

The same local UDP bridge used in **Decoders** can be started and stopped here.
In **WSJT-X → Settings → Reporting**, use UDP server **127.0.0.1** and the
matching port (default **2237**). WSJT-X performs the audio decoding. This
feature does not add an internal audio decoder or send transmit commands.

FT8 (`~`) and FT4 (`+`) Decode markers are normalized to their mode names.
Recent Status messages provide a dial frequency; the receive audio offset is
added to it for the displayed RF frequency. Without a recent Status message,
only the audio offset is shown. Replay, low-confidence and audio-file decodes
are labeled. Local decodes are not uploaded to reporting services. Both app
workspaces share the bridge state, and a port bind failure is reported before
the start request succeeds.

The common-frequency table offers copy buttons for USB dial frequencies.
Regional and event operating practices can differ. No receiver is tuned
automatically by opening the workspace or copying a frequency.

## Data sources and service configuration

- [NOAA SWPC radio communications](https://www.swpc.noaa.gov/communities/radio-communications)
- [NOAA scales](https://services.swpc.noaa.gov/products/noaa-scales.json)
- [HAMQSL / N0NBH solar data and feed policy](https://www.hamqsl.com/solar.html)
- [PSK Reporter retrieval protocol](https://pskreporter.info/pskdev.html)
- [CelesTrak GP formats](https://celestrak.org/NORAD/documentation/gp-data-formats.php)
- [satellite.js](https://github.com/shashwatak/satellite-js)
- [OpenStreetMap Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
- [WSJT-X UDP message definitions](https://github.com/WSJTX/wsjtx/blob/master/Network/NetworkMessage.hpp)
- [WSJT-X default working frequencies](https://github.com/WSJTX/wsjtx/blob/master/models/FrequencyList.cpp)

Map tiles use OpenStreetMap with attribution. Geocoding is manually triggered,
cached in memory and limited to at most one request per 1.1 seconds. To use
another compatible Nominatim provider, set `SIGNAL_OUTPOST_GEOCODER_URL` to its
search endpoint before launching the application. This allows an operator to
change providers without modifying or reinstalling the app. Larger deployments
should supply a provider appropriate for their aggregate traffic.

Build/package checks do not establish live receiver or WSJT-X interoperability,
pass accuracy against an observed ISS pass, or visual layout verification.
