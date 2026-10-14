import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const files = fs.readdirSync(out).filter(name => /\.(exe|blockmap|yml)$/.test(name) && !name.startsWith('builder-')).sort();
if (!files.some(name => name.endsWith('.exe')) || !files.includes('latest.yml')) throw new Error('Build the Windows installer and update manifest first.');
const rows = [];
for (const name of files) {
  const hash = createHash('sha256');
  for await (const bytes of fs.createReadStream(path.join(out, name))) hash.update(bytes);
  rows.push(`${hash.digest('hex')}  ${name}`);
}
fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), rows.join('\n') + '\n');
console.log(rows.join('\n'));
