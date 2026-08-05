import { analyzePcm } from './analyzer.js';

const input = document.querySelector('#audio-file');
const dropzone = document.querySelector('#dropzone');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const score = document.querySelector('#score');
const verdict = document.querySelector('#verdict');
const meter = document.querySelector('#meter');
const metadata = document.querySelector('#metadata');
const evidence = document.querySelector('#evidence');

for (const event of ['dragenter', 'dragover']) dropzone.addEventListener(event, (e) => { e.preventDefault(); dropzone.classList.add('active'); });
for (const event of ['dragleave', 'drop']) dropzone.addEventListener(event, (e) => { e.preventDefault(); dropzone.classList.remove('active'); });
dropzone.addEventListener('drop', (event) => handleFile(event.dataTransfer.files[0]));
input.addEventListener('change', () => handleFile(input.files[0]));

async function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith('audio/')) return setStatus('Kérlek, hangfájlt válassz (MP3, WAV, M4A, OGG vagy FLAC).', true);
  results.hidden = true;
  setStatus(`„${file.name}” dekódolása és spektrális elemzése…`);
  try {
    const context = new AudioContext();
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const data = mixToMono(buffer);
    const analysis = analyzePcm(data, buffer.sampleRate);
    context.close();
    render(analysis, file.name);
    setStatus('Kész. A hangfájl nem hagyta el az eszközödet.');
  } catch (error) {
    setStatus(error.message || 'A fájl dekódolása nem sikerült. Próbálj WAV vagy MP3 formátumot.', true);
  }
}

function mixToMono(buffer) {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < buffer.length; index += 1) mono[index] += data[index] / buffer.numberOfChannels;
  }
  return mono;
}

function render(analysis, filename) {
  const percent = Math.round(analysis.probability * 100);
  score.textContent = `${percent}%`;
  meter.style.setProperty('--score', `${percent}%`);
  const uncertain = analysis.confidence < 0.45 || (percent > 40 && percent < 60);
  verdict.textContent = uncertain ? 'Bizonytalan eredmény' : percent >= 60 ? 'AI-eredet valószínű' : 'Emberi / hagyományos eredet valószínű';
  verdict.dataset.tone = uncertain ? 'caution' : percent >= 60 ? 'ai' : 'human';
  metadata.textContent = `${filename} · ${formatTime(analysis.duration)} · ${analysis.sampleRate.toLocaleString('hu-HU')} Hz · ${analysis.frameCount} mintavételi ablak`;
  evidence.innerHTML = Object.entries(analysis.evidence).map(([label, value]) => `<div class="evidence-row"><span>${label}</span><div class="bar"><i style="width:${Math.round(value * 100)}%"></i></div><b>${Math.round(value * 100)}%</b></div>`).join('');
  results.hidden = false;
}

function formatTime(seconds) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
function setStatus(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
