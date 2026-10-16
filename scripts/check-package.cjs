const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Audit the files in the actual distribution, after dependencies are copied.
// Missing sidecars and modified pinned decoders must fail before publication.
module.exports = async function checkPackage(context) {
  if (context.electronPlatformName !== 'win32') return;
  const install = context.appOutDir;
  const app = path.join(install, 'resources', 'app');
  function requireFile(relative) {
    const filename = path.join(app, relative);
    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) throw new Error(`Package dependency is missing: ${relative}`);
    return filename;
  }
  for (const relative of [
    'node_modules/koffi/index.cjs',
    'node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node',
    'node_modules/leaflet/dist/leaflet.js',
    'node_modules/electron-updater/out/main.js',
    'desktop/updates.cjs',
    'desktop/preload.cjs',
    'desktop/startup.html',
    'desktop/startup.css',
    'desktop/startup.js',
    'node_modules/@liamcottle/meshcore.js/src/index.js',
    'node_modules/serialport/dist/index.js',
    'node_modules/@serialport/bindings-cpp/prebuilds/win32-x64/@serialport+bindings-cpp.node',
    'lib/meshcore.mjs',
    'lib/meshcore-conversations.mjs',
    'lib/meshcore-repeater.mjs',
    'lib/meshcore-delivery.mjs',
    'lib/meshcore-paths.mjs',
    'lib/meshcore-devices.mjs',
    'lib/meshcore-devices.json',
    'lib/MESHCORE_CATALOG_LICENSE.txt',
    'meshcore-ui.js',
    'meshcore.css',
    'native/win32-x64/rtlsdr.dll',
    'native/win32-x64/VCRUNTIME140.dll'
  ]) requireFile(relative);
  for (const folder of ['native/hd-radio', 'native/digital']) {
    const manifest = JSON.parse(fs.readFileSync(requireFile(`${folder}/manifest.json`), 'utf8'));
    const filename = requireFile(`${folder}/${manifest.library || manifest.executable}`);
    const hash = createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
    if (hash !== (manifest.librarySha256 || manifest.executableSha256)) throw new Error(`Pinned native runtime was modified during packaging: ${folder}`);
  }
  const files = [];
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const filename = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(filename);
      else if (/\.(dll|exe|node)$/i.test(entry.name)) files.push(filename);
    }
  }
  walk(path.join(app, 'native'));
  files.push(requireFile('node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node'));
  files.push(requireFile('node_modules/@serialport/bindings-cpp/prebuilds/win32-x64/@serialport+bindings-cpp.node'));
  const system = path.join(process.env.WINDIR || 'C:\\Windows', 'System32');
  for (const filename of files) {
    for (const dependency of peImports(filename)) {
      if (/^(api-ms-|ext-ms-)/i.test(dependency)) continue; // Windows API sets.
      const local = [path.dirname(filename), install].some(folder => fs.existsSync(path.join(folder, dependency)));
      // These are redistributable runtimes, even if installed on the build PC.
      const runtime = /^(vcruntime\d|msvcp\d|msvcr\d|libgcc|libstdc\+\+|libwinpthread|pthread)/i.test(dependency);
      if (!local && (runtime || !fs.existsSync(path.join(system, dependency)))) {
        throw new Error(`Unbundled native dependency: ${path.relative(app, filename)} requires ${dependency}`);
      }
    }
  }
  console.log(`Package dependency audit passed (${files.length} Windows x64 native files).`);
};

function peImports(filename) {
  const bytes = fs.readFileSync(filename);
  const pe = bytes.readUInt32LE(0x3c);
  if (bytes.readUInt32LE(pe) !== 0x4550 || bytes.readUInt16LE(pe + 4) !== 0x8664) throw new Error(`Expected a Windows x64 native binary: ${filename}`);
  const count = bytes.readUInt16LE(pe + 6), optional = pe + 24, optionalSize = bytes.readUInt16LE(pe + 20);
  const directories = optional + 112; // PE32+.
  const table = bytes.readUInt32LE(directories + 8);
  if (!table) return [];
  const sections = Array.from({ length: count }, (_, index) => {
    const offset = optional + optionalSize + index * 40;
    return { start: bytes.readUInt32LE(offset + 12), size: Math.max(bytes.readUInt32LE(offset + 8), bytes.readUInt32LE(offset + 16)), raw: bytes.readUInt32LE(offset + 20) };
  });
  function offset(rva) {
    const section = sections.find(value => rva >= value.start && rva < value.start + value.size);
    if (!section) throw new Error(`Invalid import address in ${filename}`);
    return section.raw + rva - section.start;
  }
  const imports = [];
  for (let entry = offset(table); bytes.readUInt32LE(entry + 12); entry += 20) {
    const name = offset(bytes.readUInt32LE(entry + 12));
    imports.push(bytes.toString('ascii', name, bytes.indexOf(0, name)));
  }
  return imports;
}
