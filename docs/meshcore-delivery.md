# MeshCore message delivery

## Direct messages

- One chat entry owns up to four send attempts, using the same timestamp and
  protocol attempt bytes 0, 1, 2 and 3. No additional sends follow a matching ACK.
- Each attempt records its node acceptance, expected ACK, routing mode and
  outbound contact path. The path is refreshed from the companion just before
  sending, with the cached path used if that local query is unsupported.
- The app computes the expected ACK before transmission so an ACK arriving
  immediately behind `SENT` is not lost. The node-reported code is retained.
- Late ACKs from an earlier attempt can confirm the message, including after
  its last wait window has expired. The confirmed attempt is shown separately.
- ACK waits use 1.25 times the companion's estimate plus two seconds, bounded
  between ten seconds and three minutes. These waits leave the local companion
  command queue available for incoming message retrieval and status traffic.
- After two unacknowledged attempts on a known route, a remaining attempt can
  reset that contact to flood discovery. A returned path can then be learned.
- Busy/full errors retry with a bounded delay. Missing destinations, ambiguous
  destination prefixes, invalid arguments and other permanent errors stop.
- A confirmed receipt means the recipient node acknowledged the text. It is
  not a read receipt. Missing an ACK does not establish that the text was lost.

## Channel messages

MeshCore group text messages have no per-recipient ACK. The app cannot establish
delivery to every channel member or provide a verified path to each member
without protocol support on those recipients.

The current policy stops immediately after the first send accepted by the local
node. Only explicit node send errors permit another attempt, with bounded
backoff and at most four attempts total. Local destination validation failures,
disconnects, timeouts and ambiguous responses stop the send. A lost local reply
does not establish that the node rejected the broadcast, so it is not retried.
Rejected attempts retain the original wire timestamp. Successful node acceptance
is recorded separately from recipient delivery, which stays **unavailable**.
Accepted broadcasts are never repeated just because recipient ACKs are absent.

### Repeaters heard

New channel sends display **Repeaters heard: N IDs** and a separate count of
matching rebroadcast copies. The host reproduces the firmware's encrypted
group-text payload from the node-provided channel key, timestamp, sender name
and text. A SHA-256 fingerprint of the payload type and full payload matches
returning RX-log copies independently of their changing flood paths. Messages
on a different channel, with a different sender/text/timestamp, or unrelated
radio traffic do not count just because they arrived near the send time.

For each matching flooded copy, the **last** path hash identifies the local
rebroadcaster heard over the final radio link. The app counts distinct final
hash IDs, rather than every upstream relay in the path or every copy from one
repeater. A short hash can identify several physical nodes. Names are candidate
matches from repeater contacts; collisions and unknown names are shown explicitly.
Sync Contacts to refresh names in the details dialog.

**Receipt & path** lists the local repeater names/hashes, number of copies,
last-heard time, SNR/RSSI, and expandable observed rebroadcast paths. These are
paths of returning copies, not independently verified forward routes to every
channel member. Zero observations do not establish that no repeaters heard the
message. Routed packets with consumed paths are not counted as local flood
rebroadcasters. No additional radio transmissions are used to collect evidence.

Channel secrets stay in host memory only, are omitted from frontend/saved
state, and are cleared on disconnect. Only fingerprints and compact observation
metadata are saved. Observations are collected for sends tracked in the current
connection; old messages do not acquire a fabricated zero count. Missing keys,
unsupported key response formats, or absent RX logs can prevent observations.
At most 256 recent channel messages are tracked per connection; a bounded
ten-minute RX cache can correlate packets logged before a queued message is read.
Saved detail is bounded to 64 repeater entries and eight distinct paths per
message. The distinct-ID count is bounded to 256; reaching a limit is labelled.

## Received message hops

Incoming channel and direct-chat messages display the companion's received hop
count. The encoded path-length byte contains both hash width and relay count;
the low six bits provide the count, and the full path must fit the protocol's
64-byte limit. Zero relay hops means one direct radio link. Previously saved
messages can show their recorded metadata without inventing missing paths.

A receive value of `0xFF` denotes a routed message, whose consumed relay list
does not reveal the number of traversed hops. These show **Hops not reported**.
The app does not substitute a contact's outbound route for a measured inbound
hop count. A matching channel RX-log copy can supply a separately labelled
observed path when its hop count/hash width and available SNR agree with the
received-message metadata. This copy's path is not a signed identity proof.

## Route evidence

**Receipt & path** displays the evidence available for that message:

| Evidence | Meaning |
| --- | --- |
| Outbound route at send time | A snapshot of the companion contact's route, with relay hashes and known names. Native `SENT` determines whether the node actually selected direct routing or flood. |
| Learned route near delivery | The contact path reported within three seconds of an ACK for a flood attempt. It is a route learned near delivery, not an independent packet trace. |
| Observed ACK return path | Relay hashes from a matching RX-log ACK packet, accepted as evidence only with the companion's `SEND_CONFIRMED` receipt. A flooded ACK retains its return relay list. |
| Routed ACK without full path | Direct routing consumes relay entries during travel. The remaining list is not the count of traversed relays. Full return hops remain unknown. |
| Heard local rebroadcasters | Final relay hashes of matching flooded channel copies heard by your companion, with repeater contact-name candidates. |
| Received-message hop count | Hop metadata supplied with the received message; a routed `0xFF` response does not contain a measured count. |

The app never derives a full forward path from round-trip time or substitutes
the contact's later route for a recorded outbound snapshot. Counts are relay
hops; radio links equal relay hops plus one. Unknown names remain unidentified.
Multiple contacts sharing a relay hash are listed as possible matches.

## Queue, storage and interruption

Only one ordinary message delivery runs at a time, with up to 32 active/queued
entries. Attempts, receipts and compact route evidence are saved in the existing
node-scoped `meshcore.json` history. Raw RF payload logs are not saved.

Disconnecting or restarting stops pending attempts and records the interruption.
There is no automatic retransmission of old entries on reconnect. Old messages
keep their existing receipts and explicitly lack details that were not recorded.
Repeater CLI commands use their separate command/reply workflow; potentially
state-changing commands are not automatically replayed.

## Protocol references

- [Companion send handlers and ACK push](https://github.com/meshcore-dev/MeshCore/blob/companion-v1.17.1/examples/companion_radio/MyMesh.cpp)
- [Text retry flags, ACK hashes, path returns and channel broadcasts](https://github.com/meshcore-dev/MeshCore/blob/companion-v1.17.1/src/helpers/BaseChatMesh.cpp)
- [Packet routes, payload types and variable-length relay hashes](https://github.com/meshcore-dev/MeshCore/blob/companion-v1.17.1/src/Packet.h)
- [Wire encoding for packet paths](https://github.com/meshcore-dev/MeshCore/blob/companion-v1.17.1/src/Packet.cpp)

Package and syntax checks cannot establish delivery or paths over a physical
mesh. No radio message is sent as part of building this feature.
