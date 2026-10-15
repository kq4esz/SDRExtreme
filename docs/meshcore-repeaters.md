# MeshCore repeater access

## Use

1. Connect a local MeshCore companion using USB serial, Bluetooth LE or Wi-Fi.
2. Open **Contacts**, sync the node if needed, and select a **Repeater**.
3. Enter its repeater password and click **Connect & log in**. Leave the password
   blank to try the companion's existing ACL authorization. Passwords are limited
   to 15 UTF-8 bytes, matching the repeater's password field.
4. Wait for a confirmed login. A guest session can request status; an admin
   session can send CLI commands. Older login replies may omit the access level.
5. Click **Refresh status**, or prepare a command using **Version**, **Clock** or
   **Radio settings**, then click **Send command**. Replies appear in the console.

The repeater must already exist in the companion's contact table. Routing uses
the companion's current route. A flood login can discover a return route; direct
and relayed routes are displayed after the companion reports a path update.
There is no repeater USB-console connection in this feature.

## Sessions and replies

- A local `SENT` frame acknowledges the companion's transmission request only.
  Authentication requires the selected repeater's `LOGIN_SUCCESS` push.
- Success, rejection and status responses must match the repeater's six-byte
  public-key prefix. Ambiguous prefixes are rejected before sending a request.
- Only one repeater operation runs at a time. The RF response timeout uses the
  companion's estimated timeout, with a bounded allowance for the return packet.
- Waiting for a remote reply leaves the companion command queue available for
  message retrieval. CLI responses are retrieved with normal message sync.
- A timeout may indicate range, routing, duty-cycle delays or a wrong password.
  Some repeaters silently discard incorrect passwords. No automatic retries run.
- Remote commands use `TXT_TYPE_CLI_DATA` and do not wait for a chat delivery ACK.
  A command can execute without returning a reply; inspect its result before retrying.
- The app honors the reported admin flag. Legacy eight-byte login replies have
  no reliable access flag; the repeater enforces permission checks in that case.
- `CMD_LOGOUT` ends the companion-managed connection. It does not remove the
  companion's ACL entry or revoke permissions on the repeater. Repeater access
  management must be performed on the repeater itself.

## Local data

Passwords are used only for the login request and are not included in saved
configuration, chat messages or snapshots. Newly received repeater CLI output
and commands stay in memory, capped at 100 entries per repeater, because command
replies may contain credentials or other private configuration. Disconnecting
the companion clears these logs and all confirmed login state. History already
saved by older application versions is retained and displayed separately from
the new session entries in the same conversation view.

## Upstream references

The implementation uses the bundled official JavaScript command encoder and
the companion-v1.17.1 wire format, with optional newer status fields checked by
length. Repeater firmware controls available CLI commands and permissions.

- [MeshCore CLI command reference](https://docs.meshcore.io/cli_commands/)
- [Companion remote login, status and logout handlers](https://github.com/meshcore-dev/MeshCore/blob/companion-v1.17.1/examples/companion_radio/MyMesh.cpp)
- [Repeater login, permissions, status and CLI replies](https://github.com/meshcore-dev/MeshCore/blob/companion-v1.17.1/examples/simple_repeater/MyMesh.cpp)
- [Official JavaScript library](https://github.com/meshcore-dev/meshcore.js)

Build and package checks do not establish RF delivery or access to a physical
repeater. A repeater login is never attempted automatically by the build.
