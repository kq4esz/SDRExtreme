import koffi from 'koffi';
import readline from 'node:readline';

const libraryPath = process.env.SDREXTREME_RTL_LIBRARY;
const TUNERS = ['Unknown', 'E4000', 'FC0012', 'FC0013', 'FC2580', 'R820T/R820T2', 'R828D'];
let dev = null, running = false, api, config, deviceInfo;
let reading = false, readCallback = null, stopPromise = null, stopResolve = null, fatalPending = false;
const iqCallbackType = koffi.proto('void RtlIqCallback(uint8_t *buffer, uint32_t length, void *context)');
const report = value => process.stderr.write(JSON.stringify(value) + '\n');
const checked = (code, operation) => { if (code < 0) throw new Error(`${operation} failed (${code}). Check USB access and permissions, and whether another app owns the dongle.`); return code; };

function loadApi() {
  let lib;
  try { lib = koffi.load(libraryPath); }
  catch (error) { throw new Error(`Cannot load ${libraryPath}: ${error.message}. Install the RTL-SDR runtime for ${process.platform} ${process.arch}, or choose a matching library.`); }
  const bind = (prototype, optional = false) => { try { return lib.func(prototype); } catch (error) { if (optional) return null; throw error; } };
  return {
    count: bind('uint32_t rtlsdr_get_device_count()'),
    name: bind('const char *rtlsdr_get_device_name(uint32_t index)'),
    strings: bind('int rtlsdr_get_device_usb_strings(uint32_t index, _Out_ char *manufacturer, _Out_ char *product, _Out_ char *serial)'),
    open: bind('int rtlsdr_open(_Out_ void **dev, uint32_t index)'),
    close: bind('int rtlsdr_close(void *dev)'),
    tuner: bind('int rtlsdr_get_tuner_type(void *dev)'),
    gains: bind('int rtlsdr_get_tuner_gains(void *dev, _Out_ int *gains)'),
    frequency: bind('int rtlsdr_set_center_freq(void *dev, uint32_t frequency)'),
    rate: bind('int rtlsdr_set_sample_rate(void *dev, uint32_t rate)'),
    actualRate: bind('uint32_t rtlsdr_get_sample_rate(void *dev)'),
    gainMode: bind('int rtlsdr_set_tuner_gain_mode(void *dev, int manual)'),
    gain: bind('int rtlsdr_set_tuner_gain(void *dev, int gain)'),
    ppm: bind('int rtlsdr_set_freq_correction(void *dev, int ppm)'),
    agc: bind('int rtlsdr_set_agc_mode(void *dev, int on)'),
    direct: bind('int rtlsdr_set_direct_sampling(void *dev, int input)'),
    bandwidth: bind('int rtlsdr_set_tuner_bandwidth(void *dev, uint32_t bandwidth)', true),
    bias: bind('int rtlsdr_set_bias_tee(void *dev, int on)', true),
    reset: bind('int rtlsdr_reset_buffer(void *dev)'),
    readAsync: lib.func('rtlsdr_read_async', 'int', ['void *', koffi.pointer(iqCallbackType), 'void *', 'uint32_t', 'uint32_t']),
    cancel: bind('int rtlsdr_cancel_async(void *dev)')
  };
}

function enumerate() {
  const devices = [];
  for (let index = 0, count = Math.min(api.count(), 64); index < count; index++) {
    const manufacturer = Buffer.alloc(256), product = Buffer.alloc(256), serial = Buffer.alloc(256);
    const result = api.strings(index, manufacturer, product, serial);
    const text = buffer => buffer.toString('utf8').split('\0')[0];
    devices.push({ index, name: api.name(index), manufacturer: result === 0 ? text(manufacturer) : '', product: result === 0 ? text(product) : '', serial: result === 0 ? text(serial) : '' });
  }
  return devices;
}

function control(fn, ...args) {
  // Leave the JS loop free while librtlsdr services control transfers. The
  // asynchronous USB reader can be waiting for a registered JS callback.
  return reading ? new Promise((resolve, reject) => fn.async(...args, (error, result) => error ? reject(error) : resolve(result))) : Promise.resolve(fn(...args));
}
async function applyGain(value) {
  const requested = Number(typeof value === 'object' ? value.value : value) || 0;
  const manual = typeof value === 'object' ? value.manual !== false : requested > 0;
  checked(await control(api.gainMode, dev, manual ? 1 : 0), 'Set tuner gain mode');
  deviceInfo.gainMode = manual ? 'manual' : 'auto';
  if (!manual) return 0;
  const gain = deviceInfo.gains.length ? deviceInfo.gains.reduce((a, b) => Math.abs(b - requested) < Math.abs(a - requested) ? b : a) : requested;
  checked(await control(api.gain, dev, gain), 'Set tuner gain');
  return gain;
}

async function start(next) {
  if (dev) throw new Error('USB device already open.');
  config = next;
  const devices = enumerate();
  const selected = config.deviceSerial ? devices.find(device => device.serial === config.deviceSerial) : devices.find(device => device.index === Number(config.deviceIndex || 0));
  if (!selected) throw new Error('The selected RTL-SDR USB device is not attached. Plug it in, then refresh Hardware settings.');
  const out = [null];
  checked(api.open(out, selected.index), 'Open RTL-SDR USB');
  dev = out[0];
  const count = api.gains(dev, null);
  const gains = new Int32Array(Math.max(0, Math.min(128, count)));
  if (gains.length) api.gains(dev, gains);
  const tunerType = api.tuner(dev);
  deviceInfo = { ...selected, tunerType, tunerName: TUNERS[tunerType] || `Tuner ${tunerType}`, gains: [...gains], libraryPath, transport: 'USB', bandwidthControl: Boolean(api.bandwidth), biasTeeControl: Boolean(api.bias) };
  checked(api.direct(dev, Number(config.directSampling) || 0), 'Set sampling input');
  checked(api.rate(dev, config.sampleRate), 'Set sample rate');
  if (config.ppm) checked(api.ppm(dev, config.ppm), 'Set frequency correction');
  checked(api.agc(dev, config.rtlAgc ? 1 : 0), 'Set RTL AGC');
  if (api.bandwidth && config.tunerBandwidth) checked(api.bandwidth(dev, config.tunerBandwidth), 'Set tuner bandwidth');
  if (config.biasTee && !api.bias) throw new Error('This RTL-SDR library does not support bias tee control.');
  if (api.bias) checked(api.bias(dev, config.biasTee ? 1 : 0), 'Set bias tee');
  deviceInfo.gain = await applyGain(config.manualGain ? { value: config.gain, manual: true } : config.gain);
  checked(api.frequency(dev, config.frequency), 'Tune receiver');
  checked(api.reset(dev), 'Reset USB buffers');
  deviceInfo.sampleRate = api.actualRate(dev);
  deviceInfo.readMode = 'asynchronous'; deviceInfo.usbBuffers = 32; deviceInfo.usbBlockBytes = 65536;
  deviceInfo.rtlAgc = Boolean(config.rtlAgc);
  running = true;
  startReads();
  report({ type: 'ready', info: deviceInfo });
}

function stop() {
  if (stopPromise) return stopPromise;
  running = false;
  stopPromise = new Promise(resolve => { stopResolve = resolve; });
  if (reading) api.cancel(dev);
  else finishStop();
  return stopPromise;
}

function finishStop() {
  if (reading) return;
  if (dev) { if (api.bias && config?.biasTee) api.bias(dev, 0); api.close(dev); dev = null; }
  if (readCallback) { koffi.unregister(readCallback); readCallback = null; }
  stopResolve?.();
}
async function fatal(error) {
  if (fatalPending) return; fatalPending = true;
  report({ type: 'fatal', error: error.message });
  try { await stop(); } catch {}
  process.exit(1);
}

function startReads() {
  readCallback = koffi.register((pointer, length) => {
    if (!running) { api.cancel(dev); return; }
    try {
      if (!length || length > 65536) throw new Error('Unexpected USB sample block size.');
      if (process.stdout.writableLength > 8 * 1024 * 1024) throw new Error('USB sample consumer fell behind.');
      // Decode into JS-owned memory before returning: the driver reuses this
      // buffer. External ArrayBuffer views abort Electron's V8 memory cage,
      // including helpers launched with ELECTRON_RUN_AS_NODE.
      process.stdout.write(Buffer.from(koffi.decode(pointer, 'uint8_t', length)));
    } catch (error) { void fatal(error); }
  }, koffi.pointer(iqCallbackType));
  reading = true;
  api.readAsync.async(dev, readCallback, null, 32, 65536, (error, result) => {
    reading = false;
    if (running) { void fatal(error || new Error(`USB stream stopped unexpectedly (${result}).`)); return; }
    finishStop();
  });
}

try {
  api = loadApi();
  if (process.argv.includes('--list')) {
    process.stdout.write(JSON.stringify({ available: true, libraryPath, architecture: process.arch, devices: enumerate() }));
  } else {
    const input = readline.createInterface({ input: process.stdin });
    process.stdout.on('error', error => { void fatal(error); });
    let commandQueue = Promise.resolve();
    input.on('line', line => { commandQueue = commandQueue.then(async () => {
      let message;
      try {
        message = JSON.parse(line);
        if (message.op === 'start') { await start(message.config); return; }
        if (message.op === 'stop') { await stop(); process.exit(0); }
        if (!dev) throw new Error('USB receiver is not open.');
        let result;
        if (message.op === 'frequency') { checked(await control(api.frequency, dev, message.value), 'Tune receiver'); result = message.value; }
        else if (message.op === 'gain') result = await applyGain(message.value);
        else throw new Error('Unknown USB command.');
        report({ type: 'reply', id: message.id, result });
      } catch (error) { message?.id ? report({ type: 'reply', id: message.id, error: error.message }) : fatal(error); }
    }); });
    input.on('close', () => { void stop().then(() => process.exit(0)); });
  }
} catch (error) {
  if (process.argv.includes('--list')) { process.stdout.write(JSON.stringify({ available: false, libraryPath, devices: [], error: error.message })); process.exitCode = 1; }
  else fatal(error);
}
