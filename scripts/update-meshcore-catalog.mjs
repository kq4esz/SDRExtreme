import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Build metadata only. Never downloads/flashes firmware or executes upstream code.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = 'https://api.github.com/repos/meshcore-dev/MeshCore';
const headers = { 'User-Agent': 'SDRExtreme-device-catalog', Accept: 'application/vnd.github+json' };
async function get(url, json = false) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Catalog source returned ${response.status}: ${url}`);
  return json ? response.json() : response.text();
}
const releases = await get(repository + '/releases?per_page=30', true);
const release = releases.find(row => !row.draft && !row.prerelease && /^companion-v\d/.test(row.tag_name));
if (!release) throw new Error('No stable MeshCore companion release found.');
const ref = encodeURIComponent(release.tag_name);
const tree = await get(`${repository}/git/trees/${ref}?recursive=1`, true);
if (tree.truncated) throw new Error('Upstream source tree was truncated.');
const raw = `https://raw.githubusercontent.com/meshcore-dev/MeshCore/${ref}/`;
const paths = ['platformio.ini', ...tree.tree.filter(row => /^variants\/[^/]+\/platformio\.ini$/.test(row.path)).map(row => row.path).sort()];
const sections = new Map();
function parseIni(text, source) {
  let section, key;
  for (const line of text.split(/\r?\n/)) {
    const content = line.replace(/\s*;.*$/, '').trimEnd();
    if (!content.trim()) continue;
    const heading = content.match(/^\[([^\]]+)\]/);
    if (heading) {
      section = sections.get(heading[1]) || { source }; sections.set(heading[1], section); key = null; continue;
    }
    if (!section) continue;
    const property = content.match(/^([\w.]+)\s*=\s*(.*)$/);
    if (property) { key = property[1]; section[key] = property[2]; }
    else if (key && /^\s/.test(content)) section[key] += '\n' + content.trim();
  }
}
for (let index = 0; index < paths.length; index += 8) {
  const batch = await Promise.all(paths.slice(index, index + 8).map(async source => [source, await get(raw + source)]));
  for (const [source, text] of batch) parseIni(text, source);
}
function resolve(sectionName, key, trail = []) {
  const token = sectionName + '.' + key;
  if (trail.includes(token) || trail.length > 35) throw new Error(`Cyclic build metadata: ${token}`);
  const section = sections.get(sectionName);
  if (!section) return '';
  if (section[key] !== undefined) return section[key].replace(/\$\{([^}]+)\.([^}.]+)\}/g, (_match, parent, field) => resolve(parent, field, [...trail, token]));
  for (const parent of (section.extends || '').split(/[,\s]+/).filter(Boolean)) {
    const value = resolve(parent, key, [...trail, token]); if (value) return value;
  }
  return '';
}
const flasher = await get('https://flasher.meshcore.io/config.json', true);
const models = new Map();
for (const asset of release.assets) {
  const match = asset.name.match(/^(.+?)_companion_radio(?:_(usb|ble|wifi))?-v\d/);
  if (!match) continue;
  const key = match[1].toLowerCase();
  if (!models.has(key)) models.set(key, { id: key, buildName: match[1], assetNames: [] });
  models.get(key).assetNames.push(asset.name);
}
const transportOrder = ['usb', 'bluetooth', 'wifi'];
const devices = [];
for (const model of models.values()) {
  const builds = [];
  let platform = '', source = '';
  for (const [name, section] of sections) {
    const match = name.match(/^env:(.+?)_companion_radio(?:_(usb|ble|wifi))?$/);
    if (!match || match[1].toLowerCase() !== model.id) continue;
    const flags = resolve(name, 'build_flags'), transports = [];
    if (/\bENABLE_USB_INTERFACE\b/.test(flags)) transports.push('usb');
    if (/\bBLE_PIN_CODE\b/.test(flags)) transports.push('bluetooth');
    if (/\bENABLE_WIFI_INTERFACE\b/.test(flags)) transports.push('wifi');
    const environment = name.slice(4);
    const published = model.assetNames.some(filename => filename.startsWith(environment + '-v'));
    // Some board definitions rely on implicit/board-header interface defaults.
    // Retain the published variant's declared transport in those cases.
    const declared = ({ usb: 'usb', ble: 'bluetooth', wifi: 'wifi' })[match[2]];
    if (!transports.length && declared) transports.push(declared);
    if (!transports.length) throw new Error(`No companion interface metadata for ${name}`);
    builds.push({ name: environment, transports, published });
    platform ||= /\bNRF52_PLATFORM\b/.test(flags) ? 'nRF52' : /\bRP2040_PLATFORM\b/.test(flags) ? 'RP2040' : /\bSTM32_PLATFORM\b/.test(flags) ? 'STM32' : /\bESP32_PLATFORM\b/.test(flags) ? 'ESP32' : '';
    source ||= section.source;
  }
  if (!builds.length || !platform) throw new Error(`Released board metadata could not be resolved: ${model.buildName}`);
  const friendly = flasher.device.find(device => device.firmware.some(firmware => firmware.class === 'community' && firmware.github?.type === 'companion' && Object.values(firmware.github.files || {}).some(pattern => model.assetNames.some(filename => new RegExp('^(?:' + pattern + ')$').test(filename)))));
  let name = model.id === 'picow' ? 'Raspberry Pi Pico W + LoRa radio' : friendly?.name || model.buildName.replaceAll('_', ' ');
  name = name.replace(/^Heltec\s+Heltec\s+/i, 'Heltec ');
  if (friendly && /_without_display$/.test(model.id)) name += ' (without display)';
  const power = model.id.match(/_(22|30|33)dbm$/);
  if (friendly && power) name += ` (${power[1]} dBm)`;
  const family = /^heltec/i.test(model.id) || /^Heltec\b/i.test(name) ? 'Heltec' : /^(lilygo|tbeam|t_beam)/i.test(model.id) ? 'LilyGO' : /^rak_/i.test(model.id) ? 'RAKwireless' : /^(xiao|wio|t1000e|sensecap)/i.test(model.id) || /^Seeed\b/i.test(name) ? 'Seeed Studio' : /^thinknode/i.test(model.id) ? 'Elecrow ThinkNode' : /^waveshare/i.test(model.id) ? 'Waveshare' : 'Other manufacturers';
  const transports = transportOrder.filter(transport => builds.some(build => build.transports.includes(transport)));
  const publishedTransports = transportOrder.filter(transport => builds.some(build => build.published && build.transports.includes(transport)));
  devices.push({ id: model.id, name, family, platform, aliases: [model.buildName, name], transports, publishedTransports, source: `https://github.com/meshcore-dev/MeshCore/blob/${ref}/${source}`, builds });
}
const nameCounts = new Map();
for (const device of devices) nameCounts.set(device.name, (nameCounts.get(device.name) || 0) + 1);
for (const device of devices) if (nameCounts.get(device.name) > 1) device.name += ` (${device.id.replaceAll('_', ' ')})`;
devices.sort((a, b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name));
const catalog = { schema: 1, checkedAt: new Date().toISOString().slice(0, 10), release: { tag: release.tag_name, url: release.html_url, publishedAt: release.published_at, sourceTree: tree.sha }, flasher: 'https://flasher.meshcore.io/config.json', devices };
const output = path.join(root, 'lib', 'meshcore-devices.json');
fs.writeFileSync(output, JSON.stringify(catalog, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'lib', 'MESHCORE_CATALOG_LICENSE.txt'), await get(raw + 'license.txt'));
const table = devices.map(device => `| ${device.name.replaceAll('|', '/')} | ${device.platform} | ${device.transports.map(transport => ({ usb: 'USB', bluetooth: 'Bluetooth LE', wifi: device.publishedTransports.includes('wifi') ? 'Wi-Fi' : 'Wi-Fi (custom build)' })[transport]).join(', ')} |`).join('\n');
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs', 'meshcore-devices.md'), `# MeshCore device catalog\n\nCatalog checked ${catalog.checkedAt}: **${devices.length} board profiles** from [${release.tag_name}](${release.html_url}).\n\nThese are companion firmware profiles, including hardware/display/radio variants.\nTransport availability is derived from published firmware names and upstream build\ndefinitions. Interfaces listed across different builds are not necessarily active\nat the same time. The installed firmware must enable the selected interface.\nWi-Fi marked **custom build** is defined in source but is not present in this\nboard's published companion images. USB-only hardware is not given Bluetooth or\nWi-Fi capability by the desktop application.\n\n**Auto / other compatible node** accepts any device implementing the MeshCore\ncompanion protocol, including compatible unlisted boards and custom builds.\nProfile selection is optional. Repeaters, room servers, standalone chat firmware\nand bootloaders do not automatically expose the companion chat protocol.\n\nUSB uses the Windows serial driver for the board at 115200 baud. Bluetooth uses\nthe Windows BLE stack with the MeshCore Nordic UART service. Wi-Fi uses the node's\ncompanion TCP service (default port 5000). No external Python client, RTL-TCP\nservice, or third-party MeshCore application is required. Physical hardware\ncompatibility is not established by generating this metadata or packaging the app.\n\n| Board profile | Platform | Available companion interfaces |\n| --- | --- | --- |\n${table}\n\n## Source and maintenance\n\n- Official board definitions: https://github.com/meshcore-dev/MeshCore/tree/${ref}/variants\n- Official flasher names: https://flasher.meshcore.io/config.json\n- Full machine-readable provenance and firmware-build interfaces: [meshcore-devices.json](../lib/meshcore-devices.json)\n- Refresh with \`pnpm update:meshcore-devices\`, review the changes, then release a new application version.\n- The app includes the catalog for offline use and does not download or flash firmware.\n- Upstream MIT notice: [MESHCORE_CATALOG_LICENSE.txt](../lib/MESHCORE_CATALOG_LICENSE.txt).\n`);
console.log(`Saved ${devices.length} MeshCore companion board profiles from ${release.tag_name}.`);
