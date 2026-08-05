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

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function cosineSimilarity(left, right) {
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]; leftNorm += left[index] ** 2; rightNorm += right[index] ** 2;
  }
  return dot / (Math.sqrt(leftNorm * rightNorm) + EPSILON);
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

function bandEnergy(spectrum, hzPerBin, low, high) {
  const start = Math.max(1, Math.ceil(low / hzPerBin));
  const end = Math.min(spectrum.length, Math.floor(high / hzPerBin));
  return mean(spectrum.slice(start, end).map((value) => 10 ** value));
}

function structuralDiagnostics(pcm, sampleRate) {
  const windowSize = 2048;
  const segmentCount = Math.min(12, Math.max(3, Math.floor(pcm.length / sampleRate / 8)));
  const embeddings = [];
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const center = Math.floor((segment + 0.5) * pcm.length / segmentCount);
    const offset = Math.min(Math.max(0, center - Math.floor(windowSize / 2)), pcm.length - windowSize);
    const windowed = Array.from({ length: windowSize }, (_, index) => pcm[offset + index] * (0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (windowSize - 1))));
    const spectrum = magnitudeSpectrum(windowed).map((value) => Math.log10(value + EPSILON));
    const hzPerBin = sampleRate / windowSize;
    const bands = [[0, 2000], [2000, 6000], [6000, Math.min(12000, sampleRate / 2 - hzPerBin)]].map(([low, high]) => bandEnergy(spectrum, hzPerBin, low, high));
    const total = bands.reduce((sum, value) => sum + value, EPSILON);
    const weighted = spectrum.slice(1).reduce((sum, value, index) => sum + (index + 1) * hzPerBin * (10 ** value), 0);
    const allEnergy = spectrum.slice(1).reduce((sum, value) => sum + 10 ** value, EPSILON);
    embeddings.push([...bands.map((value) => Math.log10(value / total + EPSILON)), weighted / allEnergy / (sampleRate / 2)]);
  }
  const adjacent = []; const distant = [];
  for (let row = 0; row < embeddings.length; row += 1) {
    for (let column = row + 1; column < embeddings.length; column += 1) {
      (column === row + 1 ? adjacent : distant).push(cosineSimilarity(embeddings[row], embeddings[column]));
    }
  }
  // Diagnostic only: without a calibrated real-music reference this must not affect the verdict.
  return {
    segmentCount,
    coherence: clamp((mean(adjacent) - mean(distant) + 0.35) / 0.7),
    profile: embeddings[0].map((_, index) => mean(embeddings.map((embedding) => embedding[index])))
  };
}

function residualDiagnostics(frameSpectra, averageSpectrum, hzPerBin) {
  let harmonicEnergy = 0;
  let percussiveEnergy = 0;
  const timeRadius = 2;
  const frequencyRadius = 3;
  for (let frame = 0; frame < frameSpectra.length; frame += 1) {
    for (let bin = 1; bin < frameSpectra[frame].length; bin += 1) {
      const timeValues = frameSpectra.slice(Math.max(0, frame - timeRadius), Math.min(frameSpectra.length, frame + timeRadius + 1)).map((spectrum) => spectrum[bin]);
      const frequencyValues = frameSpectra[frame].slice(Math.max(1, bin - frequencyRadius), Math.min(frameSpectra[frame].length, bin + frequencyRadius + 1));
      const harmonicPrior = median(timeValues);
      const percussivePrior = median(frequencyValues);
      const energy = frameSpectra[frame][bin] ** 2;
      harmonicEnergy += energy * harmonicPrior / (harmonicPrior + percussivePrior + EPSILON);
      percussiveEnergy += energy * percussivePrior / (harmonicPrior + percussivePrior + EPSILON);
    }
  }
  const fluxes = [];
  for (let frame = 1; frame < frameSpectra.length; frame += 1) {
    const previousTotal = frameSpectra[frame - 1].reduce((sum, value) => sum + value, EPSILON);
    const currentTotal = frameSpectra[frame].reduce((sum, value) => sum + value, EPSILON);
    fluxes.push(mean(frameSpectra[frame].map((value, bin) => Math.max(0, value / currentTotal - frameSpectra[frame - 1][bin] / previousTotal))));
  }
  const baseline = smooth(averageSpectrum, 5);
  const residual = averageSpectrum.map((value, index) => Math.max(0, value - baseline[index]));
  const residualEnergy = residual.map((value) => 10 ** value - 1);
  const total = residualEnergy.reduce((sum, value) => sum + value, EPSILON);
  const squared = residualEnergy.reduce((sum, value) => sum + value ** 2, EPSILON);
  const effectiveBandwidthHz = clamp((total ** 2 / squared) * hzPerBin, 0, 20000);
  const peakPersistence = mean(residual.map((value, bin) => {
    if (value <= median(residual)) return 0;
    return frameSpectra.filter((spectrum) => Math.log10(spectrum[bin] + EPSILON) > averageSpectrum[bin]).length / frameSpectra.length;
  }));
  return {
    harmonicPercussiveRatio: harmonicEnergy / (percussiveEnergy + EPSILON),
    spectralFlux: mean(fluxes),
    effectiveBandwidthHz,
    peakPersistence: clamp(peakPersistence)
  };
}

// One-class comparison: a score is meaningful only against user-supplied, known-human reference tracks.
export function compareToHumanReference(profile, references) {
  if (!references.length) return null;
  const center = profile.map((_, index) => mean(references.map((reference) => reference[index])));
  const spreads = profile.map((_, index) => Math.max(0.045, standardDeviation(references.map((reference) => reference[index]))));
  const normalizedDistance = Math.sqrt(mean(profile.map((value, index) => ((value - center[index]) / spreads[index]) ** 2)));
  const alignment = clamp(Math.exp(-normalizedDistance / 2));
  return { alignment, outlier: 1 - alignment, referenceCount: references.length, calibrated: references.length >= 5 };
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
  const multiBandResiduals = [[0, 2000], [2000, 6000], [6000, Math.min(12000, sampleRate / 2 - hzPerBin)]].map(([low, high]) => {
    const lower = Math.max(start, Math.ceil(low / hzPerBin));
    const upper = Math.min(end, Math.floor(high / hzPerBin));
    const values = averageSpectrum.slice(lower, upper);
    if (values.length < 4) return 0;
    const residuals = values.map((value, index) => Math.max(0, value - mean(values.slice(Math.max(0, index - 3), Math.min(values.length, index + 4)))));
    return clamp(mean(residuals) / (standardDeviation(values) + EPSILON));
  });
  const multiBandAnomaly = clamp(mean(multiBandResiduals) * 1.5);
  const structure = structuralDiagnostics(pcm, sampleRate);
  const residualDiagnostic = residualDiagnostics(frameSpectra, averageSpectrum, hzPerBin);
  const evidence = {
    'Spektrális csúcsok': clamp(spikeRatio / 0.12),
    'Periodikus mintázat': clamp(periodicity * 4),
    'Magasfrekvenciás textúra': highFrequencyRatio,
    'Időbeli stabilitás': stability,
    'Többsávos spektrális eltérés': multiBandAnomaly,
    'Szerkezeti konzisztencia': structure.coherence
  };
  // This is a transparent baseline score, not a trained classifier. The structural diagnostic is deliberately excluded from the verdict.
  const probability = clamp(0.10 + evidence['Spektrális csúcsok'] * 0.30 + evidence['Periodikus mintázat'] * 0.25 + evidence['Magasfrekvenciás textúra'] * 0.14 + evidence['Időbeli stabilitás'] * 0.08 + multiBandAnomaly * 0.13);
  const confidence = clamp((frameCount / 12) * (1 - Math.abs(probability - 0.5) * 0.35) * (sampleRate >= 22050 ? 1 : 0.72));
  const warnings = [];
  if (sampleRate < 22050) warnings.push('Az alacsony mintavételi frekvencia korlátozza a magasfrekvenciás jelek vizsgálatát.');
  if (pcm.length / sampleRate < 12) warnings.push('A rövid részlet miatt a teljes-dal szerkezeti jelzés kevésbé megbízható.');
  return { probability, confidence, evidence, residual: residualDiagnostic, sampleRate, duration: pcm.length / sampleRate, frameCount, structure, humanProfile: [...structure.profile, structure.coherence], warnings };
}
