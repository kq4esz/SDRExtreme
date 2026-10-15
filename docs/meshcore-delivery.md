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

The current policy requests four broadcasts, spaced twenty seconds apart,
within four total send attempts. A rejected request consumes an attempt, so
fewer than four broadcasts may be accepted. Successful node acceptance is
recorded separately from recipient delivery, which stays **unavailable**.
Fresh wire timestamps make repeated broadcasts distinct to the mesh's packet
duplicate cache. They can appear as repeated messages in other clients.

## Route evidence

**Receipt & path** displays the evidence available for that message:

| Evidence | Meaning |
| --- | --- |
| Outbound route at send time | A snapshot of the companion contact's route, with relay hashes and known names. Native `SENT` determines whether the node actually selected direct routing or flood. |
| Learned route near delivery | The contact path reported within three seconds of an ACK for a flood attempt. It is a route learned near delivery, not an independent packet trace. |
| Observed ACK return path | Relay hashes from a matching RX-log ACK packet, accepted as evidence only with the companion's `SEND_CONFIRMED` receipt. A flooded ACK retains its return relay list. |
| Routed ACK without full path | Direct routing consumes relay entries during travel. The remaining list is not the count of traversed relays. Full return hops remain unknown. |

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
