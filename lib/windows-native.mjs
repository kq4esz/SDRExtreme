import koffi from 'koffi';

let api;
function windows() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Native decoder RF monitoring requires Windows x64.');
  if (api) return api;
  const kernel = koffi.load('kernel32.dll');
  api = {
    createFile: kernel.func('void * __stdcall CreateFileW(const char16_t *name, uint32_t access, uint32_t share, void *security, uint32_t creation, uint32_t flags, void *templateFile)'),
    control: kernel.func('int __stdcall DeviceIoControl(void *file, uint32_t code, const void *input, uint32_t inputSize, void *output, uint32_t outputSize, _Out_ uint32_t *returned, void *overlapped)'),
    close: kernel.func('int __stdcall CloseHandle(void *handle)'),
    error: kernel.func('uint32_t __stdcall GetLastError()'),
    createJob: kernel.func('void * __stdcall CreateJobObjectW(void *security, const char16_t *name)'),
    setJob: kernel.func('int __stdcall SetInformationJobObject(void *job, int infoClass, const void *info, uint32_t length)'),
    openProcess: kernel.func('void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)'),
    assignJob: kernel.func('int __stdcall AssignProcessToJobObject(void *job, void *process)')
  };
  return api;
}
function valid(handle) { return handle !== undefined && handle !== null && handle !== 0n && handle !== -1n && handle !== 0xffffffffffffffffn; }

// This handle is deliberately not inherited. If the application service exits,
// Windows terminates its decoder, including a decoder still writing an IQ tap.
export function guardDecoderProcess(pid) {
  const native = windows();
  const job = native.createJob(null, null);
  if (!valid(job)) throw new Error(`Could not create the decoder process job (${native.error()}).`);
  let processHandle;
  try {
    const limits = Buffer.alloc(144); // JOBOBJECT_EXTENDED_LIMIT_INFORMATION, Windows x64.
    limits.writeUInt32LE(0x2000, 16); // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.
    if (!native.setJob(job, 9, limits, limits.length)) throw new Error(`Could not configure the decoder process job (${native.error()}).`);
    processHandle = native.openProcess(0x0101, 0, pid); // SET_QUOTA | TERMINATE, this child only.
    if (!valid(processHandle) || !native.assignJob(job, processHandle)) throw new Error(`Could not attach the decoder process job (${native.error()}).`);
  } catch (error) { native.close(job); throw error; }
  finally { if (valid(processHandle)) native.close(processHandle); }
  let closed = false;
  return () => { if (!closed) { closed = true; native.close(job); } };
}

// Keep the rolling capture sparse: old bytes become unallocated holes, while
// the writer's file position and the newest RF samples remain undisturbed.
export function sparseIqFile(filename) {
  const native = windows();
  const file = native.createFile(filename, 0xc0000000, 7, null, 3, 0x100, null);
  if (!valid(file)) throw new Error(`Could not open the RF sample buffer (${native.error()}).`);
  const returned = [0];
  if (!native.control(file, 0x900c4, null, 0, null, 0, returned, null)) {
    const code = native.error(); native.close(file);
    throw new Error(`The RF sample buffer needs sparse-file support on local storage (${code}).`);
  }
  let closed = false;
  return {
    release(start, end) {
      if (closed || end <= start) return Promise.resolve();
      const range = Buffer.alloc(16);
      range.writeBigInt64LE(BigInt(start), 0); range.writeBigInt64LE(BigInt(end), 8);
      return new Promise((resolve, reject) => {
        native.control.async(file, 0x980c8, range, range.length, null, 0, [0], null, (error, ok) => {
          if (error || !ok) reject(error || new Error('Could not reclaim the old RF sample buffer.'));
          else resolve();
        });
      });
    },
    close() { if (!closed) { closed = true; native.close(file); } }
  };
}
