import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePcm, buildEvidenceTriage, clamp, compareToHumanReference, effectProfileFeatures, highFrequencyMarkers, inspectContainerMetadata, magnitudeSpectrum, multifractalDiagnostics, spectralTransientDiagnostics, spectrogramPreview } from '../public/analyzer.js';
import { compareStemNoiseProfiles, deriveResidualPcm, measureStemNoiseProfile } from '../public/stem-evidence.js';

test('clamp confines a score to the expected range', () => {
  assert.equal(clamp(-2), 0); assert.equal(clamp(2), 1); assert.equal(clamp(.4), .4);
});
test('FFT finds the dominant sine-wave frequency', () => {
  const rate = 8192; const samples = Array.from({ length: 2048 }, (_, i) => Math.sin(2 * Math.PI * 512 * i / rate));
  const spectrum = magnitudeSpectrum(samples); const peak = spectrum.indexOf(Math.max(...spectrum));
  assert.equal(peak * rate / 2048, 512);
});
test('analysis returns bounded, explainable signals', () => {
  const rate = 16000; const pcm = Float32Array.from({ length: rate * 2 }, (_, i) => Math.sin(2 * Math.PI * 330 * i / rate));
  const result = analyzePcm(pcm, rate);
  assert.ok(result.probability >= 0 && result.probability <= 1); assert.equal(Object.keys(result.evidence).length, 6);
  assert.ok(result.structure.segmentCount >= 3); assert.ok(result.structure.coherence >= 0 && result.structure.coherence <= 1);
  assert.ok(Number.isFinite(result.residual.harmonicPercussiveRatio)); assert.ok(result.residual.effectiveBandwidthHz >= 0);
  assert.ok(result.structure.recurrence >= 0 && result.structure.recurrence <= 1);
});
test('multifractal diagnostics are bounded to sufficiently long audio', () => {
  const rate = 16000; const pcm = Float32Array.from({ length: rate * 8 }, (_, i) => Math.sin(2 * Math.PI * 220 * i / rate) * (0.5 + 0.4 * Math.sin(2 * Math.PI * 1.5 * i / rate)));
  const result = multifractalDiagnostics(pcm, rate);
  assert.equal(result.supported, true); assert.ok(Number.isFinite(result.hurst)); assert.ok(Number.isFinite(result.spectrumWidth));
});
test('human-reference comparison rewards a matching profile and flags a distant one', () => {
  const references = [[.2, .3, .4, .6], [.21, .31, .39, .59], [.19, .29, .41, .61], [.2, .3, .4, .6], [.2, .3, .4, .6]];
  assert.ok(compareToHumanReference([.2, .3, .4, .6], references).alignment > .9);
  assert.ok(compareToHumanReference([.9, .9, .9, .1], references).outlier > .9);
});
test('evidence triage keeps unavailable layers explicitly unresolved', () => {
  const analysis = { probability: .7, segments: { dispersion: .1 } };
  const triage = buildEvidenceTriage(analysis, { calibrated: true, alignment: .3 });
  assert.equal(triage.assessment, 'Többrétegű vizsgálat javasolt');
  assert.equal(triage.layers.find((layer) => layer.id === 'provenance').status, 'nincs észlelt konténerjel');
});
test('effect profile features remain finite for a controlled signal', () => {
  const rate = 16000; const pcm = Float32Array.from({ length: rate }, (_, i) => .5 * Math.sin(2 * Math.PI * 440 * i / rate));
  const profile = effectProfileFeatures(pcm, rate);
  assert.ok(profile.rms > 0); assert.ok(profile.peak > 0); assert.ok(Number.isFinite(profile.crestDb));
});
test('container provenance scan finds Suno text, UUID and timestamp without treating it as watermark', () => {
  const bytes = new TextEncoder().encode('made with suno 123e4567-e89b-42d3-a456-426614174000 2026-08-06T12:34:56Z');
  const result = inspectContainerMetadata(bytes);
  assert.equal(result.madeWithSuno, true); assert.equal(result.uuids.length, 1); assert.equal(result.timestamps.length, 1);
});
test('high-frequency marker reports a localized 16.6 kHz prominence', () => {
  const spectrum = Array(2000).fill(0); spectrum[1660] = 1;
  const marker = highFrequencyMarkers(spectrum, 10, 48000).find((item) => item.frequency === 16600);
  assert.equal(marker.supported, true); assert.equal(marker.present, true);
});
test('spectrogram preview returns a bounded display matrix', () => {
  const rate = 16000; const pcm = Float32Array.from({ length: rate * 2 }, (_, i) => Math.sin(2 * Math.PI * 440 * i / rate));
  const preview = spectrogramPreview(pcm, rate, { frames: 8, bands: 10 });
  assert.equal(preview.values.length, 80); assert.ok([...preview.values].every((value) => value >= 0 && value <= 1));
});
test('spectral and transient diagnostics are finite research features', () => {
  const rate = 16000; const pcm = Float32Array.from({ length: rate * 2 }, (_, i) => (i % 400 < 4 ? 1 : .2 * Math.sin(2 * Math.PI * 440 * i / rate)));
  const diagnostics = spectralTransientDiagnostics(pcm, rate);
  assert.ok(Number.isFinite(diagnostics.spectralConcentration)); assert.ok(Number.isFinite(diagnostics.transientSharpness));
});
test('stem noise evidence stays bounded and remains separate from the verdict', () => {
  const rate = 16000;
  const pcm = Float32Array.from({ length: rate * 2 }, (_, index) => Math.sin(2 * Math.PI * 220 * index / rate) * .2);
  const profile = measureStemNoiseProfile(pcm, rate);
  const comparison = compareStemNoiseProfiles(profile, { vocals: profile, instrumental: profile });
  assert.ok(profile.noiseIndex >= 0 && profile.noiseIndex <= 1);
  assert.equal(comparison.stemCount, 2);
  assert.equal(comparison.available, true);
});
test('six stems can produce a separate residual signal', () => {
  const roles = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];
  const mix = Float32Array.from({ length: 128 }, (_, index) => .2 + index / 1000);
  const stems = Object.fromEntries(roles.map((role) => [role, { pcm: Float32Array.from({ length: 128 }, () => .02), sampleRate: 16000 }]));
  const result = deriveResidualPcm(mix, stems, 16000);
  assert.equal(result.available, true); assert.equal(result.stemCount, 6); assert.ok(result.pcm[0] > 0);
});
