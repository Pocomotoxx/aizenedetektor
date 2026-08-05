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

export function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function quantile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = clamp(fraction, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function cosineSimilarity(left, right) {
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]; leftNorm += left[index] ** 2; rightNorm += right[index] ** 2;
  }
  return dot / (Math.sqrt(leftNorm * rightNorm) + EPSILON);
}

function chromaVector(spectrum, hzPerBin) {
  const chroma = Array(12).fill(0);
  for (let bin = 1; bin < spectrum.length; bin += 1) {
    const frequency = bin * hzPerBin;
    if (frequency < 65 || frequency > 4200) continue;
    const pitchClass = ((Math.round(69 + 12 * Math.log2(frequency / 440)) % 12) + 12) % 12;
    chroma[pitchClass] += spectrum[bin] ** 2;
  }
  const total = chroma.reduce((sum, value) => sum + value, EPSILON);
  return chroma.map((value) => value / total);
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

const WINDOW_SIZE = 2048;

// The named weights of the transparent baseline score. Exposed so the calibration
// layer can report exactly which term moved a verdict, and so the offline fitter
// can re-weight without editing the detector.
export const EVIDENCE_WEIGHTS = Object.freeze({
  'Spektrális csúcsok': 0.30,
  'Periodikus mintázat': 0.25,
  'Magasfrekvenciás textúra': 0.14,
  'Időbeli stabilitás': 0.08,
  'Többsávos spektrális eltérés': 0.13
});
export const EVIDENCE_BIAS = 0.10;

export function rawScore(evidence, weights = EVIDENCE_WEIGHTS, bias = EVIDENCE_BIAS) {
  return clamp(Object.entries(weights).reduce((total, [label, weight]) => total + (evidence[label] ?? 0) * weight, bias));
}

// A sample-rate independent residual profile. Log-spaced bands keep two files
// comparable even when they were decoded at different rates, and the unit-sum
// normalisation removes loudness so NMF factorises artefact shape, not level.
export const RESIDUAL_BANDS = 48;
const RESIDUAL_LOW_HZ = 300;
const RESIDUAL_HIGH_HZ = 12000;

export function residualBandEdges(sampleRate) {
  const high = Math.max(RESIDUAL_LOW_HZ * 2, Math.min(RESIDUAL_HIGH_HZ, sampleRate / 2 * 0.95));
  return Array.from({ length: RESIDUAL_BANDS + 1 }, (_, index) => RESIDUAL_LOW_HZ * (high / RESIDUAL_LOW_HZ) ** (index / RESIDUAL_BANDS));
}

export function residualProfile(averageSpectrum, hzPerBin, sampleRate) {
  const baseline = smooth(averageSpectrum, 5);
  const residual = averageSpectrum.map((value, index) => Math.max(0, value - baseline[index]));
  const edges = residualBandEdges(sampleRate);
  const profile = [];
  for (let band = 0; band < RESIDUAL_BANDS; band += 1) {
    const start = Math.max(1, Math.ceil(edges[band] / hzPerBin));
    const end = Math.max(start + 1, Math.min(residual.length, Math.floor(edges[band + 1] / hzPerBin)));
    profile.push(start >= residual.length ? 0 : mean(residual.slice(start, end)));
  }
  const total = profile.reduce((sum, value) => sum + value, 0);
  return total > EPSILON ? profile.map((value) => value / total) : profile.map(() => 1 / RESIDUAL_BANDS);
}

function spectralFrames(pcm, offsetStart, offsetEnd, frameCount) {
  const frames = [];
  const span = Math.max(0, offsetEnd - offsetStart - WINDOW_SIZE);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = offsetStart + Math.floor(frame * span / Math.max(1, frameCount - 1));
    const windowed = Array.from({ length: WINDOW_SIZE }, (_, index) => pcm[offset + index] * (0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (WINDOW_SIZE - 1))));
    frames.push(magnitudeSpectrum(windowed));
  }
  return frames;
}

// The Fourier/fakeprint evidence shared by the whole-track verdict and by every
// per-segment score. Kept free of the expensive HPSS and structural passes so it
// can run on a hundred segments without stalling the page.
function coreEvidence(frameSpectra, sampleRate) {
  const averageSpectrum = frameSpectra[0].map((_, bin) => mean(frameSpectra.map((spectrum) => Math.log10(spectrum[bin] + EPSILON))));
  const hzPerBin = sampleRate / WINDOW_SIZE;
  const start = Math.max(1, Math.ceil(1000 / hzPerBin));
  const end = Math.min(averageSpectrum.length - 1, Math.floor(8000 / hzPerBin));
  const band = averageSpectrum.slice(start, end);
  const envelope = smooth(band, 5);
  const residual = band.map((value, index) => Math.max(0, value - envelope[index]));
  const residualMean = mean(residual);
  const spikeRatio = residual.filter((value) => value > residualMean + standardDeviation(residual) * 1.4).length / Math.max(1, residual.length);
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
  const evidence = {
    'Spektrális csúcsok': clamp(spikeRatio / 0.12),
    'Periodikus mintázat': clamp(periodicity * 4),
    'Magasfrekvenciás textúra': highFrequencyRatio,
    'Időbeli stabilitás': stability,
    'Többsávos spektrális eltérés': clamp(mean(multiBandResiduals) * 1.5)
  };
  return { evidence, averageSpectrum, hzPerBin };
}

function structuralDiagnostics(pcm, sampleRate) {
  const segmentCount = Math.min(12, Math.max(3, Math.floor(pcm.length / sampleRate / 8)));
  const embeddings = [];
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const center = Math.floor((segment + 0.5) * pcm.length / segmentCount);
    const offset = Math.min(Math.max(0, center - Math.floor(WINDOW_SIZE / 2)), pcm.length - WINDOW_SIZE);
    const windowed = Array.from({ length: WINDOW_SIZE }, (_, index) => pcm[offset + index] * (0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (WINDOW_SIZE - 1))));
    const spectrum = magnitudeSpectrum(windowed).map((value) => Math.log10(value + EPSILON));
    const hzPerBin = sampleRate / WINDOW_SIZE;
    const bands = [[0, 2000], [2000, 6000], [6000, Math.min(12000, sampleRate / 2 - hzPerBin)]].map(([low, high]) => bandEnergy(spectrum, hzPerBin, low, high));
    const total = bands.reduce((sum, value) => sum + value, EPSILON);
    const weighted = spectrum.slice(1).reduce((sum, value, index) => sum + (index + 1) * hzPerBin * (10 ** value), 0);
    const allEnergy = spectrum.slice(1).reduce((sum, value) => sum + 10 ** value, EPSILON);
    const chroma = chromaVector(spectrum.map((value) => 10 ** value), hzPerBin);
    embeddings.push([...bands.map((value) => Math.log10(value / total + EPSILON)), weighted / allEnergy / (sampleRate / 2), ...chroma]);
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
    recurrence: clamp((mean(distant) + 1) / 2),
    profile: embeddings[0].map((_, index) => mean(embeddings.map((embedding) => embedding[index])))
  };
}

function linearSlope(xs, ys) {
  const meanX = mean(xs); const meanY = mean(ys);
  const denominator = xs.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
  return denominator > EPSILON ? xs.reduce((sum, value, index) => sum + (value - meanX) * (ys[index] - meanY), 0) / denominator : 0;
}

// A compact MFDFA estimate on the RMS envelope. It is intentionally diagnostic
// only: generator and genre differences must be learned from a reference set.
export function multifractalDiagnostics(pcm, sampleRate) {
  const envelopeSize = Math.max(64, Math.floor(sampleRate * 0.05));
  const envelope = [];
  for (let start = 0; start + envelopeSize <= pcm.length; start += envelopeSize) {
    let energy = 0;
    for (let index = start; index < start + envelopeSize; index += 1) energy += pcm[index] ** 2;
    envelope.push(Math.sqrt(energy / envelopeSize));
  }
  if (envelope.length < 64) return { supported: false, sampleCount: envelope.length, hurst: null, spectrumWidth: null };
  const centered = envelope.map((value) => value - mean(envelope));
  const profile = []; let cumulative = 0;
  for (const value of centered) { cumulative += value; profile.push(cumulative); }
  const scales = [8, 12, 16, 24, 32].filter((scale) => scale * 2 <= profile.length);
  const fluctuation = (scale, q) => {
    const variances = [];
    for (let start = 0; start + scale <= profile.length; start += scale) {
      const xs = Array.from({ length: scale }, (_, index) => index);
      const values = profile.slice(start, start + scale);
      const slope = linearSlope(xs, values);
      const intercept = mean(values) - slope * mean(xs);
      variances.push(mean(values.map((value, index) => (value - (intercept + slope * index)) ** 2)) + EPSILON);
    }
    if (q === 0) return Math.exp(mean(variances.map((variance) => Math.log(variance))) / 2);
    return mean(variances.map((variance) => variance ** (q / 2))) ** (1 / q);
  };
  const qs = [-2, 0, 2];
  const exponents = qs.map((q) => linearSlope(scales.map(Math.log), scales.map((scale) => Math.log(fluctuation(scale, q)))));
  const alphaLow = exponents[1] + (exponents[1] - exponents[0]) / 2;
  const alphaHigh = exponents[1] + (exponents[2] - exponents[1]) / 2;
  return {
    supported: true,
    sampleCount: envelope.length,
    hurst: exponents[2],
    spectrumWidth: Math.abs(alphaHigh - alphaLow)
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
  const residualMedian = median(residual);
  const peakPersistence = mean(residual.map((value, bin) => {
    if (value <= residualMedian) return 0;
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

// The triage deliberately does not turn correlated measurements into proof.
// It records what is available and reserves provenance/component claims for
// dedicated tools or a human reviewer.
export function buildEvidenceTriage(analysis, humanComparison) {
  const technicalSignal = analysis.probability >= 0.6;
  const stableAcrossSegments = Boolean(analysis.segments && analysis.segments.dispersion <= 0.6);
  const referenceDivergence = Boolean(humanComparison?.calibrated && humanComparison.alignment < 0.55);
  const layers = [
    { id: 'mix-forensics', label: 'Mixszintű Fourier- és residual-jel', status: technicalSignal ? 'jelzett' : 'nem jelzett', independent: true },
    { id: 'segment-stability', label: 'Időbeli szegmensstabilitás', status: analysis.segments ? (stableAcrossSegments ? 'stabil' : 'szórt') : 'nem értékelhető', independent: false },
    { id: 'human-reference', label: 'Emberi referenciailleszkedés', status: humanComparison ? (referenceDivergence ? 'eltérő' : 'illeszkedő') : 'nincs referencia', independent: true },
    { id: 'provenance', label: 'Provenance / vízjel', status: 'nem ellenőrzött', independent: true },
    { id: 'components', label: 'Stem- és komponenselemzés', status: 'nem ellenőrzött', independent: true }
  ];
  const independentSignals = [technicalSignal, referenceDivergence].filter(Boolean).length;
  const assessment = technicalSignal && referenceDivergence
    ? 'Többrétegű vizsgálat javasolt'
    : technicalSignal
      ? 'Technikai jelzés - önmagában nem bizonyíték'
      : 'Nincs erős technikai jelzés';
  return { assessment, technicalSignal, stableAcrossSegments, referenceDivergence, independentSignals, layers };
}

// Roadmap step 4: score every non-silent segment, then report the track-level
// median with a spread interval instead of one number from one arbitrary window.
// Loud-only gating keeps silence and fade-outs from dragging the median around.
export function analyzeSegments(pcm, sampleRate, { segmentSeconds = 2, maxSegments = 90, framesPerSegment = 4 } = {}) {
  const segmentLength = Math.max(WINDOW_SIZE * 2, Math.floor(segmentSeconds * sampleRate));
  const available = Math.floor(pcm.length / segmentLength);
  if (available < 2) return null;
  const step = Math.max(1, Math.floor(available / maxSegments));
  const energies = [];
  const candidates = [];
  for (let index = 0; index < available; index += step) {
    const offset = index * segmentLength;
    let sum = 0;
    for (let sample = offset; sample < offset + segmentLength; sample += 16) sum += pcm[sample] ** 2;
    energies.push(Math.sqrt(sum / (segmentLength / 16)));
    candidates.push({ offset, index });
  }
  const loudEnough = Math.max(1e-4, median(energies) * 0.25);
  const scores = [];
  const startSeconds = [];
  for (let index = 0; index < candidates.length; index += 1) {
    if (energies[index] < loudEnough) continue;
    const { offset } = candidates[index];
    const frames = spectralFrames(pcm, offset, offset + segmentLength, framesPerSegment);
    scores.push(rawScore(coreEvidence(frames, sampleRate).evidence));
    startSeconds.push(offset / sampleRate);
  }
  if (scores.length < 2) return null;
  const low = quantile(scores, 0.25);
  const high = quantile(scores, 0.75);
  return {
    scores,
    startSeconds,
    analyzed: scores.length,
    skipped: candidates.length - scores.length,
    segmentSeconds: segmentLength / sampleRate,
    median: median(scores),
    interquartileRange: high - low,
    low,
    high,
    // A wide spread means the track is not uniformly artefact-bearing; that is a
    // reason to distrust a single number, so it is surfaced rather than averaged away.
    dispersion: clamp((high - low) / 0.25)
  };
}

export function analyzePcm(pcm, sampleRate) {
  if (pcm.length < WINDOW_SIZE || sampleRate < 8000) throw new Error('A megbízható elemzéshez legalább 0,2 másodpercnyi, 8 kHz-es vagy jobb hang szükséges.');
  const frameCount = Math.min(20, Math.max(6, Math.floor(pcm.length / sampleRate)));
  const frameSpectra = spectralFrames(pcm, 0, pcm.length, frameCount);
  const { evidence, averageSpectrum, hzPerBin } = coreEvidence(frameSpectra, sampleRate);
  const structure = structuralDiagnostics(pcm, sampleRate);
  const residualDiagnostic = residualDiagnostics(frameSpectra, averageSpectrum, hzPerBin);
  const multifractal = multifractalDiagnostics(pcm, sampleRate);
  const segments = analyzeSegments(pcm, sampleRate);
  const fullEvidence = { ...evidence, 'Szerkezeti konzisztencia': structure.coherence };
  // This is a transparent baseline score, not a trained classifier. The structural diagnostic is deliberately excluded from the verdict.
  const probability = rawScore(evidence);
  let confidence = clamp((frameCount / 12) * (1 - Math.abs(probability - 0.5) * 0.35) * (sampleRate >= 22050 ? 1 : 0.72));
  const warnings = [];
  if (sampleRate < 22050) warnings.push('Az alacsony mintavételi frekvencia korlátozza a magasfrekvenciás jelek vizsgálatát.');
  if (pcm.length / sampleRate < 12) warnings.push('A rövid részlet miatt a teljes-dal szerkezeti jelzés kevésbé megbízható.');
  if (segments && segments.dispersion > 0.6) {
    confidence = clamp(confidence * (1 - segments.dispersion * 0.35));
    warnings.push('A szegmensenkénti pontszámok erősen szórnak, ezért a dalszintű érték kevésbé stabil.');
  }
  return {
    probability,
    confidence,
    evidence: fullEvidence,
    residual: residualDiagnostic,
    residualProfile: residualProfile(averageSpectrum, hzPerBin, sampleRate),
    multifractal,
    segments,
    sampleRate,
    duration: pcm.length / sampleRate,
    frameCount,
    structure,
    humanProfile: [...structure.profile, structure.coherence],
    warnings
  };
}
