import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePcm, clamp, compareToHumanReference, magnitudeSpectrum } from '../public/analyzer.js';

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
});
test('human-reference comparison rewards a matching profile and flags a distant one', () => {
  const references = [[.2, .3, .4, .6], [.21, .31, .39, .59], [.19, .29, .41, .61], [.2, .3, .4, .6], [.2, .3, .4, .6]];
  assert.ok(compareToHumanReference([.2, .3, .4, .6], references).alignment > .9);
  assert.ok(compareToHumanReference([.9, .9, .9, .1], references).outlier > .9);
});
