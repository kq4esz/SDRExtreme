export const MESH_CATEGORIES = ['channels', 'contacts'];
export const MAX_MESH_LAYOUT_ITEMS = 4096;
const TYPES = { 1: 'Companion', 2: 'Repeater', 3: 'Room server' };
const recipientCategory = value => /^channel:(?:0|[1-9]\d{0,2})$/.test(value) && Number(value.slice(8)) < 256 ? 'channels' : /^contact:(?:[a-f0-9]{12}|[a-f0-9]{64})$/.test(value) ? 'contacts' : null;
export function emptyMeshLayout() {
  return { revision: 0, tabOrder: [...MESH_CATEGORIES], channels: { order: [], pinned: [], favorites: [] }, contacts: { order: [], pinned: [], favorites: [] } };
}
export function normalizeMeshLayout(value, resolveId = id => id) {
  const layout = emptyMeshLayout();
  if (!value || typeof value !== 'object') return layout;
  if (Number.isSafeInteger(value.revision) && value.revision >= 0) layout.revision = value.revision;
  if (Array.isArray(value.tabOrder) && value.tabOrder.length === 2 && new Set(value.tabOrder).size === 2 && value.tabOrder.every(id => MESH_CATEGORIES.includes(id))) layout.tabOrder = [...value.tabOrder];
  for (const category of MESH_CATEGORIES) for (const field of ['order', 'pinned', 'favorites']) {
    const ids = Array.isArray(value[category]?.[field]) ? value[category][field] : [];
    layout[category][field] = [...new Set(ids.slice(0, MAX_MESH_LAYOUT_ITEMS).filter(id => typeof id === 'string' && recipientCategory(id) === category).map(resolveId))];
  }
  return layout;
}
export function meshConversations({ channels = [], contacts = [], messages = [] }) {
  const targets = channels.map(row => ({ id: `channel:${row.index}`, name: row.name, detail: `Channel ${row.index}`, channel: true, writable: true }));
  for (const contact of contacts) targets.push({ id: `contact:${contact.publicKey}`, name: contact.name || contact.publicKey.slice(0, 12), detail: TYPES[contact.type] || 'Node', writable: contact.type === 1, publicKey: contact.publicKey });
  const byId = new Map(targets.map(target => [target.id, target])), prefixes = new Map(), groups = new Map();
  const unread = { channels: 0, contacts: 0, total: 0 };
  const resolveId = recipient => {
    if (!recipient || byId.has(recipient) || !recipient.startsWith('contact:')) return recipient;
    if (!prefixes.has(recipient)) {
      const matches = contacts.filter(contact => contact.publicKey.startsWith(recipient.slice(8)));
      prefixes.set(recipient, matches.length === 1 ? `contact:${matches[0].publicKey}` : recipient);
    }
    return prefixes.get(recipient);
  };
  for (const message of messages) {
    const recipient = resolveId(message.recipient);
    if (!byId.has(recipient)) {
      const target = { id: recipient, name: recipient.startsWith('channel:') ? `Channel ${recipient.slice(8)}` : message.sender || recipient.slice(8, 20), detail: 'History · not in node list', writable: false, channel: recipient.startsWith('channel:') };
      targets.push(target); byId.set(recipient, target);
    }
    if (!groups.has(recipient)) groups.set(recipient, { messages: [], unread: 0 });
    const group = groups.get(recipient); group.messages.push(message);
    if (message.direction === 'in' && message.unread === true) { group.unread++; unread[recipient.startsWith('channel:') ? 'channels' : 'contacts']++; unread.total++; }
  }
  return { targets, groups, unread, resolveId };
}
export function orderedMeshTargets(targets, value, category) {
  const layout = normalizeMeshLayout(value)[category], pinned = new Set(layout.pinned);
  const rank = new Map(layout.order.map((id, index) => [id, index]));
  return targets.filter(target => Boolean(target.channel) === (category === 'channels')).map((target, index) => ({ ...target, pinned: pinned.has(target.id), favorite: layout.favorites.includes(target.id), original: index }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.original - b.original);
}
