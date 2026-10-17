import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function read(relative) { return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')); }
function write(relative, value) { fs.writeFileSync(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`); }
function sha256(relative) {
  return createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');
}

const hdPath = 'native/hd-radio/linux-x64/lib/libnrsc5.so';
const dsdPath = 'native/digital/linux-x64/bin/dsd-neo';
const hd = read('native/hd-radio/manifest.json');
const dsd = read('native/digital/manifest.json');
if (!fs.existsSync(path.join(root, hdPath)) || !fs.existsSync(path.join(root, dsdPath))) {
  throw new Error('Build both Linux decoder runtimes before recording their manifest hashes.');
}
hd.runtimes['linux-x64'] = { library: 'linux-x64/lib/libnrsc5.so', sha256: sha256(hdPath), libraryDirectory: 'linux-x64/lib' };
dsd.runtimes['linux-x64'] = { executable: 'linux-x64/bin/dsd-neo', sha256: sha256(dsdPath), libraryDirectory: 'linux-x64/lib' };
write('native/hd-radio/manifest.json', hd);
write('native/digital/manifest.json', dsd);
