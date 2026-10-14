import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackBuffer } from '../lib/playback-buffer.mjs';
import { hdGainRecommendation } from '../lib/hd-gain.mjs';
import { HdAudioRouter } from '../lib/hd-audio-router.mjs';
import { BroadcastFm } from '../lib/broadcast-fm.mjs';

test('browser waits for a reserve and then plays stereo without packet-boundary gaps', () => {
  const player = new PlaybackBuffer(); const left = new Float32Array(4096), right = new Float32Array(4096);
  const packet = new Float32Array(1920); for (let i = 0; i < 960; i++) { packet[i * 2] = 0.25; packet[i * 2 + 1] = -0.5; }
  for (let i = 0; i < 10; i++) player.push(packet, 2);
  player.render(left, right); assert.equal(player.playing, false); assert.equal(player.underruns, 0);
  for (let i = 0; i < 4; i++) player.push(packet, 2);
  player.render(left, right); assert.equal(player.playing, true); assert.ok(left.every(v => v === 0.25)); assert.ok(right.every(v => v === -0.5));
  for (let i = 0; i < 300; i++) { for (let j = 0; j < (i % 4 === 0 ? 5 : 4); j++) player.push(packet, 2); player.render(left, right); }
  assert.equal(player.underruns, 0);
});

test('browser underflow rebuffers once and preserves queued good audio', () => {
  const player = new PlaybackBuffer({ capacity: 64, prefill: 16 }); const left = new Float32Array(8), right = new Float32Array(8);
  player.push(new Float32Array(16).fill(0.2)); player.render(left, right); player.render(left, right);
  player.render(left, right); assert.equal(player.underruns, 1); assert.equal(player.playing, false);
  player.render(left, right); assert.equal(player.underruns, 1);
  player.push(new Float32Array(16).fill(0.4)); player.render(left, right); assert.equal(player.playing, true);
  player.clear(); assert.equal(player.frames, 0); assert.equal(player.playing, false);
});

test('output resampling supports a 44.1 kHz audio device and keeps bounded latency', () => {
  const player = new PlaybackBuffer(); player.push(new Float32Array(24000).fill(0.3));
  const left = new Float32Array(4410), right = new Float32Array(4410); player.render(left, right, 44100);
  assert.ok(Math.abs(player.frames - 19200) <= 1); assert.ok(left.every(v => Math.abs(v - 0.3) < 1e-6));
  player.push(new Float32Array(50000)); assert.ok(player.frames <= 12000); assert.ok(player.trimmed > 0);
});

test('HD gain uses ADC headroom, drops clipping gain and holds a safe level', () => {
  const gains = [0,9,14,27,37,77,87,125,144,157,166,197,207,229,254,280,297,328,338,364,372,386,402,421,434,439,445,480,496];
  assert.equal(hdGainRecommendation({ amplitudeDbfs: -6.8, clippingPercent: 0 }, 77, gains), 77);
  assert.equal(hdGainRecommendation({ amplitudeDbfs: -15, clippingPercent: 0 }, 0, gains), 77);
  assert.ok(hdGainRecommendation({ amplitudeDbfs: 0, clippingPercent: 37 }, 197, gains) < 197);
  assert.equal(hdGainRecommendation({ amplitudeDbfs: 0, clippingPercent: 1 }, 0, gains), 0);
});

test('HD router recovers with a reserve, ignores a short sync dip and falls back on real loss', () => {
  let now = 0; const router = new HdAudioRouter({ now: () => now });
  router.pushFm(new Float32Array(12000)); router.choose(now); assert.equal(router.source, 'fm');
  router.setSync(true); router.pushHd(new Float32Array(48000 * 4)); now = 2000; router.pushHd(new Float32Array(1920)); router.choose(now);
  assert.equal(router.source, 'hd');
  router.setSync(false); now += 200; router.choose(now); assert.equal(router.source, 'hd');
  router.setSync(true); now += 500; router.pushFm(new Float32Array(12000)); router.setSync(false); now += 300; router.choose(now);
  assert.equal(router.source, 'fm'); assert.equal(router.hd.frames, 0);
  router.fallback = false; router.choose(now); assert.equal(router.source, 'none');
});

test('FM fallback keeps exact audio duration across IQ block boundaries', () => {
  const fm = new BroadcastFm(), rate = 1488375; let frames = 0;
  // A constant carrier yields silence after filter startup, with no NaNs.
  for (let offset = 0; offset < rate * 2; offset += 65536) {
    const iq = new Uint8Array(Math.min(65536, rate * 2 - offset));
    for (let i = 0; i < iq.length; i += 2) { iq[i] = 180; iq[i + 1] = 128; }
    const output = fm.push(iq); frames += output.length; assert.ok(output.every(Number.isFinite));
  }
  assert.equal(frames, 48000);
});
