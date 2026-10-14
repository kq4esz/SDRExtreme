export function hdBandForFrequency(value) {
  const frequency = Number(value);
  if (Number.isFinite(frequency) && frequency >= 87_500_000 && frequency <= 108_000_000) return 'FM';
  if (Number.isFinite(frequency) && frequency >= 530_000 && frequency <= 1_710_000) return 'AM';
  throw new Error('HD Radio reception supports FM 87.5–108 MHz or AM 0.530–1.710 MHz.');
}

export function hdProgram(value = 0) {
  const program = Number(value);
  if (!Number.isInteger(program) || program < 0 || program > 7) throw new Error('Choose an HD Radio program from HD1 through HD8.');
  return program;
}

export function hdMemoryOptions(value) {
  return { hdProgram: hdProgram(value.hdProgram ?? 0), hdBand: hdBandForFrequency(value.frequency) };
}
