// Choose tuner gain using raw ADC headroom, as nrsc5's native gain search
// does. Hardware tuner AGC and RTL digital AGC are unsuitable substitutes:
// digital AGC can hide clipping that has already occurred in the ADC.
export function hdGainRecommendation(metrics, current, gains) {
  if (!Number.isFinite(metrics.amplitudeDbfs) || !gains.length) return current;
  const error = -7 - metrics.amplitudeDbfs;
  if (metrics.clippingPercent <= 0.005 && Math.abs(error) < 2) return current;
  const target = Math.max(gains[0], current + Math.floor((metrics.clippingPercent > 0.005 ? Math.min(-6, error) : error) * 10));
  return [...gains].sort((a, b) => a - b).filter(gain => gain <= target).at(-1) ?? gains[0];
}
