export const MESH_TRANSPORTS = ['usb', 'bluetooth', 'wifi'];
export const meshTransportName = value => ({ usb: 'USB serial', bluetooth: 'Bluetooth LE', wifi: 'Wi-Fi / TCP' })[value] || value;
export function meshProfile(catalog, id = 'auto') {
  if (id === 'auto') return { id: 'auto', name: 'Auto / other compatible node', platform: '', transports: MESH_TRANSPORTS, publishedTransports: [], builds: [] };
  return catalog.devices.find(device => device.id === id) || null;
}
export function detectedMeshProfile(catalog, model) {
  const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalized = normalize(model);
  if (!normalized) return null;
  const matches = catalog.devices.filter(device => [device.id, device.name, ...device.aliases].some(alias => normalize(alias) === normalized));
  return matches.length === 1 ? matches[0] : null;
}
export function meshConnectionHelp(profile, transport) {
  const device = profile.id === 'auto' ? 'your node' : profile.name;
  if (!profile.transports.includes(transport)) return `${meshTransportName(transport)} is not defined for this board in the upstream companion firmware. Choose one of its available connections.`;
  const custom = profile.id !== 'auto' && !profile.publishedTransports.includes(transport) ? ' This interface requires a custom companion build; it is not enabled in the published builds for this board.' : '';
  if (transport === 'wifi') return `Connect to ${device} using its companion TCP service (usually port 5000). Wi-Fi must be configured and enabled in the installed firmware; an HTTP page is not a companion endpoint.${custom}`;
  if (transport === 'bluetooth') return `Choose ${device} running Bluetooth companion firmware. Enable Bluetooth on your computer and close other apps connected to the node. Enter or confirm the node’s pairing PIN.${custom}`;
  const serial = profile.platform === 'nRF52' || profile.platform === 'RP2040' ? 'Use its USB CDC serial port in normal operating mode, rather than its UF2 bootloader.' : profile.platform === 'STM32' ? 'Use the board’s serial data interface or a supported USB-to-UART adapter.' : 'Use a USB data cable and the serial driver appropriate to the board.';
  return `Connect ${device} with USB companion firmware at 115200 baud. ${serial} Select its serial port and close other apps using it.${custom}`;
}
