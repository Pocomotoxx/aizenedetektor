import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePcm, clamp, magnitudeSpectrum } from '../public/analyzer.js';

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
  assert.ok(result.probability >= 0 && result.probability <= 1); assert.equal(Object.keys(result.evidence).length, 4);
});
