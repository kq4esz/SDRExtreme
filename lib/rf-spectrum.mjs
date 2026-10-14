// Windowed complex FFT, power-averaged over adjacent windows of native CU8 IQ.
// Bins are ordered from -Fs/2 to +Fs/2 and calibrated relative to full scale.
const SIZE = 2048;
const window = Float64Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (SIZE - 1)));
const normalization = window.reduce((sum, value) => sum + value, 0) ** 2;

function fft(re, im) {
  for (let i = 1, j = 0; i < SIZE; i++) {
    let bit = SIZE >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let length = 2; length <= SIZE; length <<= 1) {
    const angle = -2 * Math.PI / length, stepRe = Math.cos(angle), stepIm = Math.sin(angle);
    for (let start = 0; start < SIZE; start += length) {
      let wr = 1, wi = 0;
      for (let j = 0; j < length / 2; j++) {
        const a = start + j, b = a + length / 2;
        const vr = re[b] * wr - im[b] * wi, vi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
        const next = wr * stepRe - wi * stepIm; wi = wr * stepIm + wi * stepRe; wr = next;
      }
    }
  }
}

export const RF_WINDOW_BYTES = SIZE * 2 * 4;
export function spectrumFromCu8(bytes) {
  const windows = Math.floor(bytes.length / (SIZE * 2));
  if (!windows) return null;
  const power = new Float64Array(SIZE), re = new Float64Array(SIZE), im = new Float64Array(SIZE);
  for (let block = 0; block < windows; block++) {
    const offset = block * SIZE * 2;
    for (let i = 0; i < SIZE; i++) {
      re[i] = (bytes[offset + i * 2] - 127.5) / 127.5 * window[i];
      im[i] = (bytes[offset + i * 2 + 1] - 127.5) / 127.5 * window[i];
    }
    fft(re, im);
    for (let i = 0; i < SIZE; i++) power[i] += re[i] * re[i] + im[i] * im[i];
  }
  return Array.from({ length: SIZE }, (_, i) => {
    const value = power[(i + SIZE / 2) % SIZE] / (normalization * windows);
    return Math.round(Math.max(-120, Math.min(3, 10 * Math.log10(Math.max(1e-12, value)))) * 10) / 10;
  });
}
