import { magnitudeSpectrum, mean } from './analyzer.js';

const EPSILON = 1e-12;
const FRAME_SIZE = 2048;
export const STEM_ROLES = Object.freeze(['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']);

function clamp01(value) { return Math.min(1, Math.max(0, value)); }

function frameSpectrum(pcm) {
  const frames = [];
  const count = Math.min(12, Math.max(1, Math.floor(pcm.length / FRAME_SIZE)));
  for (let frame = 0; frame < count; frame += 1) {
    const start = Math.floor(frame * Math.max(1, (pcm.length - FRAME_SIZE) / Math.max(1, count - 1)));
    const samples = Array.from({ length: FRAME_SIZE }, (_, index) => {
      const position = start + index;
      const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (FRAME_SIZE - 1));
      return (pcm[position] ?? 0) * window;
    });
    frames.push(magnitudeSpectrum(samples));
  }
  return frames;
}

function bandMean(spectrum, sampleRate, low, high) {
  const hzPerBin = sampleRate / FRAME_SIZE;
  const start = Math.max(1, Math.ceil(low / hzPerBin));
  const end = Math.min(spectrum.length, Math.floor(high / hzPerBin));
  return mean(spectrum.slice(start, end));
}

function spectralFlatness(spectrum, sampleRate) {
  const hzPerBin = sampleRate / FRAME_SIZE;
  const start = Math.max(1, Math.ceil(200 / hzPerBin));
  const end = Math.min(spectrum.length, Math.floor(Math.min(16000, sampleRate / 2) / hzPerBin));
  const values = spectrum.slice(start, end).map((value) => Math.max(value, EPSILON));
  const geometric = Math.exp(mean(values.map((value) => Math.log(value))));
  return clamp01(geometric / (mean(values) + EPSILON));
}

export function measureStemNoiseProfile(pcm, sampleRate) {
  const frames = frameSpectrum(pcm);
  const flatness = mean(frames.map((spectrum) => spectralFlatness(spectrum, sampleRate)));
  const highBand = mean(frames.map((spectrum) => bandMean(spectrum, sampleRate, 12000, Math.min(20000, sampleRate / 2))));
  const fullBand = mean(frames.map((spectrum) => bandMean(spectrum, sampleRate, 200, Math.min(20000, sampleRate / 2))));
  let squared = 0; let peak = 0; let crossings = 0;
  for (let index = 0; index < pcm.length; index += 1) {
    const sample = pcm[index]; squared += sample ** 2; peak = Math.max(peak, Math.abs(sample));
    if (index > 0 && (sample >= 0) !== (pcm[index - 1] >= 0)) crossings += 1;
  }
  const rms = Math.sqrt(squared / Math.max(1, pcm.length));
  const highBandRatio = clamp01(highBand / (fullBand + EPSILON));
  const noiseIndex = clamp01(0.55 * flatness + 0.30 * highBandRatio + 0.15 * clamp01(crossings / Math.max(1, pcm.length) * 8));
  return { rms, peak, crestDb: 20 * Math.log10((peak + EPSILON) / (rms + EPSILON)), zeroCrossingsPerSecond: crossings * sampleRate / Math.max(1, pcm.length), spectralFlatness: flatness, highBandRatio, noiseIndex, sampleRate, duration: pcm.length / sampleRate };
}

export function compareStemNoiseProfiles(mix, stems) {
  const entries = Object.entries(stems).filter(([, profile]) => profile);
  if (!entries.length) return { available: false, status: 'nincs betöltött stem' };
  const stemIndex = mean(entries.map(([, profile]) => profile.noiseIndex));
  const delta = mix ? stemIndex - mix.noiseIndex : null;
  return {
    available: true,
    stemCount: entries.length,
    stemNoiseIndex: stemIndex,
    mixNoiseIndex: mix?.noiseIndex ?? null,
    delta,
    status: delta !== null && delta > 0.08 ? 'stemben erősebb zajszerű maradvány' : 'nincs egyértelmű stem-zaj többlet',
    caveat: 'A szeparátor és a codec saját műterméke ugyanígy növelheti a zajindexet; kontroll és több modell szükséges.'
  };
}

export function deriveResidualPcm(mixPcm, stems, sampleRate) {
  const available = STEM_ROLES.map((role) => stems[role]).filter((stem) => stem?.pcm && stem.sampleRate === sampleRate);
  if (available.length !== STEM_ROLES.length || !mixPcm?.length) return { available: false, reason: 'A residual számításához mind a hat fő stem és azonos mintavétel szükséges.' };
  const length = Math.min(mixPcm.length, ...available.map((stem) => stem.pcm.length));
  const residual = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    let sum = 0;
    for (const stem of available) sum += stem.pcm[index];
    residual[index] = mixPcm[index] - sum;
  }
  return { available: true, pcm: residual, sampleRate, source: 'computed-mix-minus-six-stems', alignedSamples: length, stemCount: available.length };
}
