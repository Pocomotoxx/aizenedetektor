const EPSILON = 1e-12;

export function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function mean(values) {
  return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);
}

export function standardDeviation(values) {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

// Iterative radix-2 FFT. The input is copied so callers retain their PCM data.
export function magnitudeSpectrum(samples) {
  const size = samples.length;
  const real = Float64Array.from(samples);
  const imaginary = new Float64Array(size);
  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
    }
  }
  for (let width = 2; width <= size; width <<= 1) {
    const angle = -2 * Math.PI / width;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (let start = 0; start < size; start += width) {
      let wr = 1; let wi = 0;
      for (let offset = 0; offset < width / 2; offset += 1) {
        const even = start + offset;
        const odd = even + width / 2;
        const tr = wr * real[odd] - wi * imaginary[odd];
        const ti = wr * imaginary[odd] + wi * real[odd];
        real[odd] = real[even] - tr; imaginary[odd] = imaginary[even] - ti;
        real[even] += tr; imaginary[even] += ti;
        const nextWr = wr * cosine - wi * sine;
        wi = wr * sine + wi * cosine; wr = nextWr;
      }
    }
  }
  return Array.from({ length: size / 2 }, (_, index) => Math.hypot(real[index], imaginary[index]));
}

function smooth(values, radius = 4) {
  return values.map((_, index) => mean(values.slice(Math.max(0, index - radius), Math.min(values.length, index + radius + 1))));
}

export function analyzePcm(pcm, sampleRate) {
  const windowSize = 2048;
  if (pcm.length < windowSize || sampleRate < 8000) throw new Error('A megbízható elemzéshez legalább 0,2 másodpercnyi, 8 kHz-es vagy jobb hang szükséges.');
  const frameCount = Math.min(20, Math.max(6, Math.floor(pcm.length / sampleRate)));
  const frameSpectra = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = Math.floor(frame * (pcm.length - windowSize) / Math.max(1, frameCount - 1));
    const windowed = Array.from({ length: windowSize }, (_, index) => pcm[offset + index] * (0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (windowSize - 1))));
    frameSpectra.push(magnitudeSpectrum(windowed));
  }
  const averageSpectrum = frameSpectra[0].map((_, bin) => mean(frameSpectra.map((spectrum) => Math.log10(spectrum[bin] + EPSILON))));
  const hzPerBin = sampleRate / windowSize;
  const start = Math.max(1, Math.ceil(1000 / hzPerBin));
  const end = Math.min(averageSpectrum.length - 1, Math.floor(8000 / hzPerBin));
  const band = averageSpectrum.slice(start, end);
  const envelope = smooth(band, 5);
  const residual = band.map((value, index) => Math.max(0, value - envelope[index]));
  const residualMean = mean(residual);
  const spikeRatio = residual.filter((value) => value > residualMean + standardDeviation(residual) * 1.4).length / residual.length;
  const periodicity = mean(residual.map((value, index) => index > 5 ? Math.max(0, value * residual[index - 5]) : 0)) / (mean(residual.map((value) => value * value)) + EPSILON);
  const highStart = Math.max(1, Math.ceil(6000 / hzPerBin));
  const highEnergy = mean(averageSpectrum.slice(highStart).map((value) => 10 ** value));
  const fullEnergy = mean(averageSpectrum.slice(1).map((value) => 10 ** value));
  const highFrequencyRatio = clamp(highEnergy / (fullEnergy + EPSILON) * 3);
  const temporalResidual = frameSpectra.map((spectrum) => {
    const values = spectrum.slice(start, end).map((value, index) => Math.log10(value + EPSILON) - envelope[index]);
    return mean(values.map(Math.abs));
  });
  const stability = 1 - clamp(standardDeviation(temporalResidual) / (mean(temporalResidual) + EPSILON));
  const evidence = {
    'Spektrális csúcsok': clamp(spikeRatio / 0.12),
    'Periodikus mintázat': clamp(periodicity * 4),
    'Magasfrekvenciás textúra': highFrequencyRatio,
    'Időbeli stabilitás': stability
  };
  // This is a transparent baseline score, not a trained classifier.
  const probability = clamp(0.12 + evidence['Spektrális csúcsok'] * 0.34 + evidence['Periodikus mintázat'] * 0.28 + evidence['Magasfrekvenciás textúra'] * 0.16 + evidence['Időbeli stabilitás'] * 0.10);
  const confidence = clamp((frameCount / 12) * (1 - Math.abs(probability - 0.5) * 0.35));
  return { probability, confidence, evidence, sampleRate, duration: pcm.length / sampleRate, frameCount };
}
