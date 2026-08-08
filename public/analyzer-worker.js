import { analyzePcm, spectrogramPreview } from './analyzer.js';

self.onmessage = ({ data }) => {
  if (data.type !== 'analyze') return;
  try {
    self.postMessage({ type: 'progress', requestId: data.requestId, value: 15, message: 'Spektrális jellemzők számítása…' });
    const pcm = new Float32Array(data.pcm);
    const analysis = analyzePcm(pcm, data.sampleRate);
    self.postMessage({ type: 'progress', requestId: data.requestId, value: 72, message: 'Forenzikus spektrogram készítése…' });
    const spectrogram = spectrogramPreview(pcm, data.sampleRate);
    self.postMessage({ type: 'progress', requestId: data.requestId, value: 96, message: 'Auditjegyzék összeállítása…' });
    self.postMessage({ type: 'result', requestId: data.requestId, analysis, spectrogram }, [spectrogram.values.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', requestId: data.requestId, message: error.message || 'A háttérelemzés nem sikerült.' });
  }
};
