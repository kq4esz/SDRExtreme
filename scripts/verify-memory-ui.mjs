import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';
import electronPath from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runs = path.join(root, 'local-data', 'test-runs'); fs.mkdirSync(runs, { recursive: true });
const directory = fs.mkdtempSync(path.join(runs, 'memory-ui-'));
const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
const env = { ...process.env, SDREXTREME_PORT: String(port), SDREXTREME_DATA_DIR: path.join(directory, 'data'), SDREXTREME_PROFILE: path.join(directory, 'profile'), SDREXTREME_TEST_MODE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app, page, success = false, checks = 0;
const pass = message => { checks++; console.log(`PASS: ${message}`); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, ms = 10000) { const deadline = Date.now() + ms; while (Date.now() < deadline) { if (await check()) return; await pause(50); } throw new Error(message); }

try {
  app = await _electron.launch({ executablePath: electronPath, args: ['.'], cwd: root, env, timeout: 20000 });
  page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const base = `http://127.0.0.1:${port}`;
  const get = async endpoint => { const response = await page.request.get(base + endpoint); return response.json(); };
  const post = async (endpoint, body = {}) => { const response = await page.request.post(base + endpoint, { data: body }); const result = await response.json(); if (!response.ok()) throw new Error(result.error); return result; };
  await page.locator('#add-channel-button').waitFor({ state: 'attached' });
  await until(async () => (await get('/api/channels')).length === 4, 'Starter memories did not load');
  await page.locator('.nav-item[data-page="channels"]').click();
  const initial = await get('/api/channels'); let writes = 0;
  page.on('request', request => { if (/\/api\/channels(?:\/|$)/.test(new URL(request.url()).pathname) && ['POST', 'PUT'].includes(request.method())) writes++; });
  const open = async () => { await page.locator('#add-channel-button').click(); await page.locator('#channel-dialog').waitFor({ state: 'visible' }); };
  const closed = () => page.locator('#channel-dialog').waitFor({ state: 'hidden' });

  await open(); await page.locator('#cancel-channel').click(); await closed();
  assert.equal(writes, 0); assert.deepEqual(await get('/api/channels'), initial); pass('Cancel closes an empty required form without validation or a channel write');
  await open(); await page.locator('#channel-name').fill('Do not save this'); await page.locator('#cancel-channel').click(); await closed();
  assert.equal(writes, 0); assert.deepEqual(await get('/api/channels'), initial); pass('Cancel with a valid name does not create a channel');
  await open(); await page.locator('#close-channel-dialog').click(); await closed();
  await open(); await page.locator('#channel-name').fill('Escape test'); await page.keyboard.press('Escape'); await closed();
  assert.equal(writes, 0); pass('Close and Escape dismiss the memory dialog without saving');
  await page.locator('#import-rr-button').click(); await page.locator('#rr-dialog button[value="cancel"]').last().click();
  await page.locator('#rr-dialog').waitFor({ state: 'hidden' }); pass('RadioReference Cancel also bypasses empty credential validation');

  await open(); await page.locator('#channel-name').fill('QA P25'); await page.locator('#channel-kind').selectOption('trunked');
  assert.equal(await page.locator('#channel-mode').inputValue(), 'P25');
  await page.locator('#channel-frequency').fill('851.012500'); await page.locator('#channel-p25-phase').selectOption('2');
  await page.locator('#channel-p25-control').selectOption('phase1'); await page.locator('#channel-p25-modulation').selectOption('cqpsk');
  await page.locator('#channel-p25-wacn').fill('BEE00'); await page.locator('#channel-p25-system-id').fill('ABC'); await page.locator('#channel-p25-nac').fill('123');
  await page.locator('#channel-site-frequencies').fill('0, 851.012500, control\n12, 852.025000, voice');
  await page.locator('#save-channel').click(); await closed();
  let saved = (await get('/api/channels')).find(channel => channel.name === 'QA P25');
  assert.equal(saved.p25Phase, '2'); assert.equal(saved.p25Control, 'phase1'); assert.equal(saved.p25Modulation, 'cqpsk');
  assert.equal(saved.p25Wacn, 'BEE00'); assert.equal(saved.sites[0].frequencies[0].lcn, 0);
  assert.equal(saved.sites[0].frequencies[1].frequency, 852025000); pass('P25 Phase 2, control type, identities and site LCNs save correctly');
  const p25Row = page.locator('.channel-row').filter({ hasText: 'QA P25' });
  await p25Row.locator('[data-action="edit"]').click(); assert.equal(await page.locator('#channel-p25-phase').inputValue(), '2');
  await page.locator('#channel-p25-phase').selectOption('1'); await page.locator('#cancel-channel').click(); await closed();
  saved = (await get('/api/channels')).find(channel => channel.name === 'QA P25'); assert.equal(saved.p25Phase, '2'); pass('Cancel while editing leaves the stored protocol unchanged');
  await p25Row.locator('[data-action="edit"]').click(); await page.locator('#channel-p25-phase').selectOption('1'); await page.locator('#save-channel').click(); await closed();
  saved = (await get('/api/channels')).find(channel => channel.name === 'QA P25'); assert.equal(saved.p25Phase, '1'); assert.equal(saved.p25Control, 'phase1'); pass('P25 Phase 1 edits persist with a matching control channel');

  await open(); await page.locator('#channel-name').fill('QA NXDN96'); await page.locator('#channel-kind').selectOption('trunked'); await page.locator('#channel-mode').selectOption('NXDN');
  await page.locator('#channel-nxdn-mode').selectOption('NXDN96'); await page.locator('#channel-frequency').fill('453.125');
  await page.locator('#save-channel').click(); await closed();
  saved = (await get('/api/channels')).find(channel => channel.name === 'QA NXDN96'); assert.equal(saved.nxdnMode, 'NXDN96'); assert.ok(saved.sites.length); pass('NXDN96 trunked memories retain their air interface and a usable control site');
  await page.locator('.channel-row').filter({ hasText: 'QA NXDN96' }).locator('[data-action="edit"]').click();
  assert.equal(await page.locator('#channel-nxdn-mode').inputValue(), 'NXDN96'); await page.locator('#channel-nxdn-mode').selectOption('NXDN48'); await page.locator('#save-channel').click(); await closed();
  saved = (await get('/api/channels')).find(channel => channel.name === 'QA NXDN96'); assert.equal(saved.nxdnMode, 'NXDN48'); pass('NXDN48 edits round-trip through storage');

  await page.getByRole('checkbox', { name: 'Scan Airband Guard', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Scan 2 m Calling', exact: true }).check();
  assert.match(await page.locator('#scan-selection-count').textContent(), /2 channels selected/);
  assert.equal(await page.getByRole('checkbox', { name: 'Scan QA P25', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('#scan-selected').isEnabled(), true); pass('The rapid scan panel tracks the exact selected conventional memories');

  if (process.env.SDREXTREME_VERIFY_USB === '1') {
    const response = await fetch('http://127.0.0.1:17890/api/state').catch(() => null);
    const existing = response?.ok ? await response.json() : null;
    if (existing?.status.connected || existing?.status.digitalActive) throw new Error('Stop the main application receiver before the optional live USB scan check.');
    try {
      await page.locator('#scan-hold').uncheck(); await page.locator('#scan-speed').selectOption('150'); await page.locator('#scan-selected').click();
      await until(async () => (await get('/api/state')).status.scan?.hops >= 5, 'Rapid USB scan did not visit the selected memories');
      let current = (await get('/api/state')).status;
      const selectedIds = initial.filter(channel => ['Airband Guard', '2 m Calling'].includes(channel.name)).map(channel => channel.id).sort();
      assert.deepEqual([...current.scan.channelIds].sort(), selectedIds); assert.equal(current.scan.rapid, true); assert.equal(current.scan.dwellMs, 150);
      const visits = current.scan.hops; await page.locator('#scan-skip').click();
      await until(async () => (await get('/api/state')).status.scan?.hops > visits, 'Skip did not advance scanning');
      await page.locator('#scan-stop').click(); await until(async () => !(await get('/api/state')).status.scannerActive, 'Stop did not end scanning');
      current = (await get('/api/state')).status; assert.equal(current.connected, true); pass('Live USB rapid scan visits only the two selected memories; Skip and Stop work');
    } finally { await post('/api/scan/stop').catch(() => {}); await post('/api/rtl/stop').catch(() => {}); }
  }
  assert.deepEqual(errors, []); pass('No renderer exceptions during the memory and scan workflows');
  success = true;
  console.log(`${checks} UI checks passed with isolated memory files.`);
} catch (error) {
  if (page) await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
  console.error(`Diagnostic files: ${directory}`); throw error;
} finally {
  await app?.close().catch(() => {});
  if (success) {
    const resolved = path.resolve(directory), allowed = path.resolve(runs) + path.sep;
    if (!resolved.startsWith(allowed)) throw new Error('Refusing to remove a test directory outside the intended test workspace.');
    for (let attempt = 0; attempt < 10; attempt++) {
      try { fs.rmSync(resolved, { recursive: true, force: true }); break; }
      catch { if (attempt === 9) console.log('Test files retained because Windows is still releasing them.'); else await pause(100); }
    }
  }
}
