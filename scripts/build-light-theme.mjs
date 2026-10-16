import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Derive only color overrides. The original styles remain the source of truth
// for dark mode, geometry, responsive layouts, typography and state selectors.
const palette = `:root[data-theme="light"]{
  color-scheme:light;
  --bg:#f2f5f7;--sidebar:#e9eff3;--panel:#ffffff;--panel-2:#edf2f6;
  --line:#ccd7df;--line-soft:#e1e8ed;--text:#203342;--muted:#506878;--muted-2:#617583;
  --lime:#3b681c;--lime-2:#305718;--cyan:#08756b;--orange:#935016;--red:#b32d40;
  --light-surface:#ffffff;--light-surface-alt:#f4f7f9;--light-surface-strong:#e7eef3;
  --light-text:#203342;--light-muted:#506878;--light-border:#ccd7df;--light-border-strong:#a9bbc8;
  --light-green:#3b681c;--light-teal:#08756b;--light-blue:#28628e;--light-purple:#6d47aa;--light-amber:#935016;--light-red:#b32d40;
  --light-green-bg:#edf4e6;--light-teal-bg:#e5f3f0;--light-purple-bg:#f0ebf8;--light-amber-bg:#fff1df;--light-red-bg:#fcebee;
  --light-green-border:#afc89c;--light-teal-border:#a5ccc4;--light-purple-border:#c9b9e0;--light-amber-border:#dfc398;--light-red-border:#dfb0b8;
  --spectrum-bg:#f6f9fb;--spectrum-grid:#d1dce4;--spectrum-grid-soft:#e3eaf0;--spectrum-label:#526b7c;
  --spectrum-fill-top:#0c8c7138;--spectrum-fill-bottom:#0c8c7109;--spectrum-trace:#08796a;--spectrum-marker:#466e1d;
}`;

function color(hex, property) {
  let raw = hex.slice(1);
  if (raw.length === 3 || raw.length === 4) raw = [...raw].map(char => char + char).join('');
  const [r, g, b] = [0, 2, 4].map(offset => parseInt(raw.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min, lightness = (max + min) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  let hue = delta === 0 ? 0 : max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  let accent = '';
  if (saturation > .16) {
    if (hue >= 65 && hue < 165) accent = 'green';
    else if (hue >= 165 && hue < 195 && saturation > .23) accent = 'teal';
    else if (hue >= 245 && hue < 315) accent = 'purple';
    else if (hue >= 20 && hue < 65) accent = 'amber';
    else if (hue < 20 || hue >= 315) accent = 'red';
  }
  if (property === 'color') return `var(--light-${accent || (lightness > .65 ? 'text' : 'muted')})`;
  if (property.startsWith('border') || property === 'outline' || property === 'scrollbar-color') return `var(--light-${accent ? accent + '-border' : lightness > .3 ? 'border-strong' : 'border'})`;
  // Keep bright collection dots, brand color, and signal-scale colors intact.
  if (lightness > .5) return hex;
  return `var(--light-${accent ? accent + '-bg' : lightness > .16 ? 'surface-strong' : lightness > .11 ? 'surface-alt' : 'surface'})`;
}

function convert(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let result = '', start = 0;
  while (start < css.length) {
    const open = css.indexOf('{', start); if (open < 0) break;
    const selector = css.slice(start, open).trim();
    let end = open + 1, depth = 1;
    while (end < css.length && depth) { if (css[end] === '{') depth++; else if (css[end] === '}') depth--; end++; }
    if (depth) throw new Error('Unbalanced stylesheet braces.');
    const body = css.slice(open + 1, end - 1); start = end;
    if (selector.startsWith('@')) {
      if (/^@(media|supports|container)\b/.test(selector)) { const inner = convert(body); if (inner) result += `${selector}{\n${inner}}\n`; }
      continue;
    }
    if (selector === ':root' || selector.includes('::backdrop') || selector === '.signal-scale i') continue;
    const declarations = [];
    for (const declaration of body.split(';')) {
      const colon = declaration.indexOf(':'); if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim(), value = declaration.slice(colon + 1).trim();
      if (!/^(color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline|scrollbar-color)$/.test(property) || !/#[\da-f]{3,8}\b/i.test(value)) continue;
      const mapped = value.replace(/#[\da-f]{3,8}\b/gi, hex => color(hex, property));
      if (mapped !== value) declarations.push(`${property}:${mapped}`);
    }
    if (!declarations.length) continue;
    const scoped = selector.split(',').map(part => part.trim() === 'html' ? ':root[data-theme="light"]' : `:root[data-theme="light"] ${part.trim()}`).join(',');
    result += `${scoped}{${declarations.join(';')}}\n`;
  }
  return result;
}

const exceptions = `
/* Filled actions and count badges need a foreground on their accent fill. */
:root[data-theme="light"] .primary-button,:root[data-theme="light"] .listen-button,:root[data-theme="light"] .hd-actions .primary-button,:root[data-theme="light"] .mesh-unread-badge{background:#3b681c;border-color:#3b681c;color:#ffffff}
:root[data-theme="light"] .primary-button:hover,:root[data-theme="light"] .listen-button:hover,:root[data-theme="light"] .hd-actions .primary-button:hover{background:#305718;border-color:#305718;color:#ffffff}
:root[data-theme="light"] .listen-button.connected{background:#edf4e6;border-color:#afc89c;color:#3b681c}
:root[data-theme="light"] .brand-mark{color:#101a0c}
:root[data-theme="light"] .leaflet-tile-pane{filter:none}
:root[data-theme="light"] input::placeholder,:root[data-theme="light"] textarea::placeholder{color:#617583;opacity:1}
:root[data-theme="light"] ::selection{background:#d4e7c5;color:#203342}
`;
const output = '/* Generated by scripts/build-light-theme.mjs. Dark styles are unchanged. */\n' + palette + '\n' +
  ['app.css', 'meshcore.css'].map(file => `\n/* ${file} */\n${convert(fs.readFileSync(path.join(root, file), 'utf8'))}`).join('') + exceptions;
fs.writeFileSync(path.join(root, 'theme-light.css'), output);
console.log('Built light theme from the application and MeshCore styles.');
