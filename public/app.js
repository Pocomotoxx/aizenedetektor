import { analyzePcm, buildEvidenceTriage, compareToHumanReference, inspectContainerMetadata } from './analyzer.js';
import { inspectC2pa } from './provenance.js';
import { runConfiguredOnnx } from './ml-adapter.ts';
import { compareStemNoiseProfiles, deriveResidualPcm, measureStemNoiseProfile } from './stem-evidence.js';

const input = document.querySelector('#audio-file');
const dropzone = document.querySelector('#dropzone');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const score = document.querySelector('#score');
const verdict = document.querySelector('#verdict');
const meter = document.querySelector('#meter');
const metadata = document.querySelector('#metadata');
const evidence = document.querySelector('#evidence');
const referenceInput = document.querySelector('#human-reference-files');
const referenceStatus = document.querySelector('#reference-status');
const humanScore = document.querySelector('#human-score');
const humanVerdict = document.querySelector('#human-verdict');
const humanMeter = document.querySelector('#human-meter');
const residualDiagnostics = document.querySelector('#residual-diagnostics');
const segmentDiagnostics = document.querySelector('#segment-diagnostics');
const auditDiagnostics = document.querySelector('#audit-diagnostics');
const c2paStatus = document.querySelector('#c2pa-status') ?? createC2paStatus();
const exportAudit = document.querySelector('#export-audit');
const spectrogram = document.querySelector('#spectrogram');
const datasetSource = document.querySelector('#dataset-source');
const datasetFamily = document.querySelector('#dataset-family');
const datasetPlugin = document.querySelector('#dataset-plugin');
const datasetSignal = document.querySelector('#dataset-signal');
const datasetSettings = document.querySelector('#dataset-settings');
const saveDatasetRecord = document.querySelector('#save-dataset-record');
const exportDataset = document.querySelector('#export-dataset');
const datasetStatus = document.querySelector('#dataset-status');
const { onnxModel, onnxContract, runOnnx, onnxStatus } = createOnnxPanel();
const { stemInputs, stemStatus, stemDiagnostics } = createStemPanel();
const humanReference = [];
let latestAudit = null;
let latestModelFeatures = null;
let latestMixNoiseProfile = null;
let latestMixPcm = null;
let latestMixSampleRate = null;
const latestStemProfiles = {};
const STEM_LABELS = Object.freeze({ vocals: 'Vokál', drums: 'Dob', bass: 'Basszus', guitar: 'Gitár', piano: 'Zongora', other: 'Egyéb', residual: 'Residual / zaj' });
const DATASET_KEY = 'aizene-effect-profile-dataset-v1';
const analyzerWorker = new Worker('./analyzer-worker.js', { type: 'module' });
let pendingAnalysis = null;
let analysisRequestId = 0;

function createC2paStatus() {
  const element = document.createElement('p');
  element.id = 'c2pa-status'; element.className = 'metadata'; element.textContent = 'C2PA: ellenőrzésre vár';
  auditDiagnostics.insertAdjacentElement('afterend', element);
  return element;
}

function createOnnxPanel() {
  const section = document.createElement('section');
  section.className = 'residual-diagnostics';
  section.innerHTML = `<h3>Kalibrált ONNX-modell <small>opcionális, helyi futtatás</small></h3><p>Csak dokumentált feature-kontraktussal és validált modellkártyával használható. A stem-szeparációhoz külön, kompatibilis modell és előfeldolgozási kontraktus szükséges.</p><div class="dataset-fields"><label>ONNX-modell <input id="onnx-model" type="file" accept=".onnx,application/octet-stream"></label><label>Modellkontraktus (JSON) <input id="onnx-contract" type="file" accept=".json,application/json"></label></div><button id="run-onnx" type="button">ONNX-modell futtatása</button><p id="onnx-status" role="status"></p>`;
  c2paStatus.insertAdjacentElement('afterend', section);
  return {
    onnxModel: section.querySelector('#onnx-model'), onnxContract: section.querySelector('#onnx-contract'),
    runOnnx: section.querySelector('#run-onnx'), onnxStatus: section.querySelector('#onnx-status')
  };
}

function createStemPanel() {
  const section = document.createElement('section');
  section.className = 'residual-diagnostics';
  const inputsMarkup = Object.entries(STEM_LABELS).map(([role, label]) => `<label>${label} stem <input data-stem-role="${role}" type="file" accept="audio/*"></label>`).join('');
  section.innerHTML = `<h3>6+1 stem-zajréteg <small>kísérleti bizonyítékréteg</small></h3><p>Tölts fel külső szeparátorral előállított hat zenei stemet és egy külön residual/noise stemet. A rendszer a mixhez viszonyított, szélessávú maradványt méri; ez nem önálló AI-bizonyíték.</p><div class="dataset-fields">${inputsMarkup}</div><p id="stem-status" role="status">Előbb elemezz egy eredeti mixet.</p><div id="stem-diagnostics" class="residual-grid"></div>`;
  c2paStatus.insertAdjacentElement('afterend', section);
  const inputs = [...section.querySelectorAll('[data-stem-role]')];
  for (const inputElement of inputs) inputElement.addEventListener('change', () => handleStemFile(inputElement.dataset.stemRole, inputElement.files[0]));
  return { stemInputs: inputs, stemStatus: section.querySelector('#stem-status'), stemDiagnostics: section.querySelector('#stem-diagnostics') };
}

analyzerWorker.onmessage = ({ data }) => {
  if (!pendingAnalysis || data.requestId !== pendingAnalysis.requestId) return;
  if (data.type === 'progress') { setStatus(`${data.message} (${data.value}%)`); return; }
  if (data.type === 'result') { pendingAnalysis.resolve(data); pendingAnalysis = null; }
  if (data.type === 'error') { pendingAnalysis.reject(new Error(data.message)); pendingAnalysis = null; }
};

function analyzeInWorker(pcm, sampleRate) {
  return new Promise((resolve, reject) => {
    if (pendingAnalysis) pendingAnalysis.reject(new Error('Az előző elemzést új fájl választása megszakította.'));
    const requestId = ++analysisRequestId;
    pendingAnalysis = { requestId, resolve, reject };
    analyzerWorker.postMessage({ type: 'analyze', requestId, pcm: pcm.buffer, sampleRate }, [pcm.buffer]);
  });
}

for (const event of ['dragenter', 'dragover']) dropzone.addEventListener(event, (e) => { e.preventDefault(); dropzone.classList.add('active'); });
for (const event of ['dragleave', 'drop']) dropzone.addEventListener(event, (e) => { e.preventDefault(); dropzone.classList.remove('active'); });
dropzone.addEventListener('drop', (event) => handleFile(event.dataTransfer.files[0]));
input.addEventListener('change', () => handleFile(input.files[0]));
referenceInput.addEventListener('change', () => loadHumanReferences([...referenceInput.files]));

async function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith('audio/')) return setStatus('Kérlek, hangfájlt válassz (MP3, WAV, M4A, OGG vagy FLAC).', true);
  results.hidden = true;
  setStatus(`„${file.name}” dekódolása és spektrális elemzése…`);
  try {
    const context = new AudioContext();
    const bytes = await file.arrayBuffer();
    const fileHash = await sha256(bytes);
    const containerMetadata = inspectContainerMetadata(bytes);
    const buffer = await context.decodeAudioData(bytes);
    const data = mixToMono(buffer);
    latestMixPcm = data.slice();
    latestMixSampleRate = buffer.sampleRate;
    latestMixNoiseProfile = measureStemNoiseProfile(data, buffer.sampleRate);
    for (const role of Object.keys(latestStemProfiles)) delete latestStemProfiles[role];
    renderStemEvidence();
    const workerResult = await analyzeInWorker(data, buffer.sampleRate);
    context.close();
    render(workerResult.analysis, file, fileHash, containerMetadata, workerResult.spectrogram);
    inspectC2pa(file).then((c2pa) => {
      c2paStatus.textContent = `C2PA: ${c2pa.status}`;
      if (latestAudit?.file.sha256 === fileHash) latestAudit.c2pa = c2pa;
    });
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

function render(analysis, file, fileHash, containerMetadata, spectrogramData) {
  const filename = file.name;
  const percent = Math.round(analysis.probability * 100);
  score.textContent = `${percent}%`;
  meter.style.setProperty('--score', `${percent}%`);
  const humanComparison = compareToHumanReference(analysis.humanProfile, humanReference);
  const triage = buildEvidenceTriage(analysis, humanComparison, containerMetadata);
  const uncertain = analysis.confidence < 0.45 || (percent > 40 && percent < 60) || (humanComparison && (!humanComparison.calibrated || (percent >= 60) === (humanComparison.alignment >= .55)));
  verdict.textContent = uncertain ? 'Bizonytalan - felülvizsgálat javasolt' : percent >= 60 ? 'AI-artefaktumok valószínűek' : 'Kevés AI-artefaktum észlelhető';
  verdict.dataset.tone = uncertain ? 'caution' : percent >= 60 ? 'ai' : 'human';
  metadata.textContent = `${filename} · ${formatTime(analysis.duration)} · ${analysis.sampleRate.toLocaleString('hu-HU')} Hz · ${analysis.frameCount} spektrális ablak · ${analysis.structure.segmentCount} teljes-dal szegmens`;
  evidence.innerHTML = Object.entries(analysis.evidence).map(([label, value]) => `<div class="evidence-row"><span>${label}</span><div class="bar"><i style="width:${Math.round(value * 100)}%"></i></div><b>${Math.round(value * 100)}%</b></div>`).join('');
  drawSpectrogram(spectrogramData);
  results.querySelector('.warnings')?.remove();
  if (analysis.warnings.length) evidence.insertAdjacentHTML('afterend', `<p class="warnings">${analysis.warnings.join(' ')}</p>`);
  const alternatives = [
    file.type.includes('mpeg') || file.name.toLowerCase().endsWith('.mp3') ? 'veszteséges MP3-kódolás' : null,
    file.type.includes('aac') || file.name.toLowerCase().endsWith('.m4a') ? 'veszteséges AAC-kódolás' : null,
    analysis.sampleRate < 22050 ? 'alacsony mintavételi frekvencia' : null,
    analysis.segments?.dispersion > 0.6 ? 'szegmensenként eltérő mastering vagy hangszerelés' : null,
    'mastering, újrakódolás vagy forrás-szeparálási műtermék'
  ].filter(Boolean);
  const highFrequency = analysis.highFrequency.filter((marker) => marker.supported).map((marker) => `${(marker.frequency / 1000).toFixed(1)} kHz: ${marker.prominenceDb.toFixed(1)} dB${marker.present ? ' kiemelés' : ''}`).join(' · ') || 'A mintavétel nem támogatja a vizsgálatot.';
  const provenance = containerMetadata.madeWithSuno ? `„made with suno” észlelve${containerMetadata.uuids.length ? `; UUID: ${containerMetadata.uuids.join(', ')}` : ''}${containerMetadata.timestamps.length ? `; időbélyeg: ${containerMetadata.timestamps.join(', ')}` : ''}.` : 'Nem észleltem „made with suno” konténerszöveget a vizsgált fájlrészekben.';
  auditDiagnostics.innerHTML = `<h3>Bizonyíték-triage <small>emberi felülvizsgálathoz</small></h3>
    <p><strong>${triage.assessment}</strong></p>
    <div class="residual-grid">${triage.layers.map((layer) => `<div><span>${layer.label}</span><b>${layer.status}</b></div>`).join('')}</div>
    <p><strong>Konténer-provenance:</strong> ${provenance} ${containerMetadata.limitation}</p>
    <p><strong>16–17 kHz keskenysávú jelzők:</strong> ${highFrequency} Ezek generátor-, codec- vagy masteringeredetűek lehetnek; nem tekintjük őket vízjelnek.</p>
    <p><strong>Alternatív magyarázatok:</strong> ${alternatives.join('; ')}.</p>
    <p>Az ellenőrizhető C2PA-manifestet a felület külön vizsgálja. A hiánya nem cáfol eredetet, a szolgáltatóspecifikus vízjelek és a stemszintű eredet továbbra sincsenek ellenőrizve. Jogi vagy szerzői jogi következtetéshez szakértői felülvizsgálat szükséges.</p>`;
  latestAudit = {
    schemaVersion: '1.0', detector: { name: 'AI Zene Detektor', version: '0.2.0', mode: 'browser-local-triage' }, generatedAt: new Date().toISOString(),
    file: { name: file.name, type: file.type || 'ismeretlen', size: file.size, lastModified: file.lastModified, sha256: fileHash },
    analysis: { probability: analysis.probability, confidence: analysis.confidence, sampleRate: analysis.sampleRate, duration: analysis.duration, evidence: analysis.evidence, warnings: analysis.warnings, segments: analysis.segments, residual: analysis.residual, effectProfile: analysis.effectProfile, highFrequency: analysis.highFrequency, spectralTransient: analysis.spectralTransient },
    containerMetadata,
    triage, alternativeExplanations: alternatives,
    limitations: ['C2PA-manifest csak akkor ellenőrizhető, ha a fájl és a böngésző támogatja; a hiány nem ellenbizonyíték.', 'A szolgáltatóspecifikus vízjelek és a stemszintű eredet nincs ellenőrizve.', 'Az eredmény kutatási jelzés, nem jogi bizonyíték.']
  };
  exportAudit.hidden = false;
  segmentDiagnostics.innerHTML = analysis.segments ? `
    <h3>Szegmensenkénti bizonytalanság <small>kutatási jelzés</small></h3>
    <div class="residual-grid">
      <div><span>Medián AI-kockázat</span><b>${Math.round(analysis.segments.median * 100)}%</b></div>
      <div><span>Középső 50% tartománya</span><b>${Math.round(analysis.segments.low * 100)}–${Math.round(analysis.segments.high * 100)}%</b></div>
      <div><span>Elemzett szegmensek</span><b>${analysis.segments.analyzed}</b></div>
      <div><span>Kihagyott, halk szegmensek</span><b>${analysis.segments.skipped}</b></div>
    </div>
    <p>A pontszámok szórása a dalszintű érték bizonytalanságát jelzi, nem külön AI-bizonyíték.</p>` : '<h3>Szegmensenkénti bizonytalanság</h3><p>A fájl túl rövid a több szegmens közötti összevetéshez.</p>';
  residualDiagnostics.innerHTML = `
    <h3>Maradványdiagnosztika <small>kutatási jelzés</small></h3>
    <div class="residual-grid">
      <div><span>Harmonikus / perkusszív arány</span><b>${analysis.residual.harmonicPercussiveRatio.toFixed(2)}</b></div>
      <div><span>Spektrális flux</span><b>${analysis.residual.spectralFlux.toFixed(3)}</b></div>
      <div><span>Maradvány spektrális szélesség</span><b>${Math.round(analysis.residual.effectiveBandwidthHz).toLocaleString('hu-HU')} Hz</b></div>
      <div><span>Csúcsok időbeli fennmaradása</span><b>${Math.round(analysis.residual.peakPersistence * 100)}%</b></div>
    </div>
    <p>Ez a kevert hang HPSS-alapú maradványprofilja. Nem stem-döntés és nem része az AI-kockázati pontszámnak.</p>`;
  residualDiagnostics.insertAdjacentHTML('beforeend', `<div class="residual-grid research-grid">
    <div><span>Strukturális önhasonlóság</span><b>${Math.round(analysis.structure.recurrence * 100)}%</b></div>
    <div><span>DFA Hurst-exponens</span><b>${analysis.multifractal.supported ? analysis.multifractal.hurst.toFixed(2) : 'kevés adat'}</b></div>
    <div><span>MFDFA spektrumszélesség</span><b>${analysis.multifractal.supported ? analysis.multifractal.spectrumWidth.toFixed(2) : 'kevés adat'}</b></div>
    <div><span>Spektrális koncentráció</span><b>${analysis.spectralTransient.spectralConcentration.toFixed(2)}</b></div>
    <div><span>Tranziensélesség</span><b>${analysis.spectralTransient.transientSharpness.toFixed(2)}</b></div>
  </div><p>Az önhasonlóság és az MFDFA csak műfajazonos referenciával értelmezhető kutatási jellemző; nincs beleszámítva az AI-pontszámba.</p>`);
  renderHumanComparison(humanComparison);
  latestModelFeatures = modelFeatures(analysis);
  onnxStatus.textContent = 'Nincs betöltött, kalibrált ONNX-modell.';
  results.hidden = false;
}

async function handleStemFile(role, file) {
  if (!file) return;
  if (!latestMixNoiseProfile) { stemStatus.textContent = 'Előbb elemezz egy eredeti mixet.'; return; }
  try {
    stemStatus.textContent = `${STEM_LABELS[role] ?? role} stem elemzése…`;
    const context = new AudioContext();
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const pcm = mixToMono(buffer);
    latestStemProfiles[role] = { file: { name: file.name, type: file.type || 'ismeretlen', size: file.size, lastModified: file.lastModified }, pcm, sampleRate: buffer.sampleRate, profile: measureStemNoiseProfile(pcm, buffer.sampleRate), source: 'uploaded-external-separator-stem' };
    if (role !== 'residual' && latestStemProfiles.residual?.source === 'computed-mix-minus-six-stems') delete latestStemProfiles.residual;
    context.close();
    renderStemEvidence();
  } catch (error) { stemStatus.textContent = error.message || 'A stem dekódolása nem sikerült.'; }
}

function renderStemEvidence() {
  if (!latestStemProfiles.residual && latestMixPcm) {
    const derived = deriveResidualPcm(latestMixPcm, latestStemProfiles, latestMixSampleRate);
    if (derived.available) latestStemProfiles.residual = { file: { name: 'residual-derived.wav', type: 'audio/wav' }, pcm: derived.pcm, sampleRate: derived.sampleRate, profile: measureStemNoiseProfile(derived.pcm, derived.sampleRate), source: derived.source, alignedSamples: derived.alignedSamples };
  }
  const profiles = Object.fromEntries(Object.entries(latestStemProfiles).map(([role, value]) => [role, value.profile]));
  const comparison = compareStemNoiseProfiles(latestMixNoiseProfile, profiles);
  if (!comparison.available) { stemStatus.textContent = latestMixNoiseProfile ? 'Válassz legalább egy stemet az összevetéshez.' : 'Előbb elemezz egy eredeti mixet.'; stemDiagnostics.innerHTML = ''; return; }
  stemStatus.textContent = `${comparison.status}. ${comparison.caveat}`;
  stemDiagnostics.innerHTML = `<div><span>Mix zajindex</span><b>${comparison.mixNoiseIndex.toFixed(3)}</b></div><div><span>6+1 stem átlagos zajindex</span><b>${comparison.stemNoiseIndex.toFixed(3)}</b></div><div><span>Stem–mix delta</span><b>${comparison.delta >= 0 ? '+' : ''}${comparison.delta.toFixed(3)}</b></div>${Object.entries(profiles).map(([role, profile]) => `<div><span>${STEM_LABELS[role] ?? role} zajindex</span><b>${profile.noiseIndex.toFixed(3)}</b></div><div><span>${STEM_LABELS[role] ?? role} spektrális laposság</span><b>${profile.spectralFlatness.toFixed(3)}</b></div>`).join('')}`;
  if (latestAudit) {
    const stemsForAudit = Object.fromEntries(Object.entries(latestStemProfiles).map(([role, value]) => [role, { file: value.file, profile: value.profile, source: value.source ?? 'uploaded', alignedSamples: value.alignedSamples ?? null }]));
    latestAudit.stemEvidence = { schemaVersion: 'stem-noise-evidence/1.1', comparison, stems: stemsForAudit };
  }
}

function modelFeatures(analysis) {
  return {
    probability: analysis.probability, confidence: analysis.confidence,
    spectralFlux: analysis.residual.spectralFlux,
    effectiveBandwidthHz: analysis.residual.effectiveBandwidthHz,
    peakPersistence: analysis.residual.peakPersistence,
    spectralConcentration: analysis.spectralTransient.spectralConcentration,
    transientSharpness: analysis.spectralTransient.transientSharpness,
    recurrence: analysis.structure.recurrence,
    hurst: analysis.multifractal.hurst,
    spectrumWidth: analysis.multifractal.spectrumWidth
  };
}

async function loadHumanReferences(files) {
  const candidates = files.filter((file) => file.type.startsWith('audio/'));
  if (!candidates.length) return;
  referenceStatus.textContent = `${candidates.length} emberi referencia feldolgozása…`;
  try {
    const context = new AudioContext();
    for (const file of candidates) {
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      humanReference.push(analyzePcm(mixToMono(buffer), buffer.sampleRate).humanProfile);
    }
    context.close();
    referenceStatus.textContent = `${humanReference.length} helyi emberi referencia betöltve. ${humanReference.length < 5 ? 'Legalább 5 ajánlott.' : 'A referencia összehasonlítás használható.'}`;
  } catch (error) {
    referenceStatus.textContent = error.message || 'A referenciafájlok egyikének dekódolása nem sikerült.';
  }
}

function renderHumanComparison(comparison) {
  if (!comparison) {
    humanScore.textContent = '—'; humanVerdict.textContent = 'Nincs referencia'; humanMeter.style.setProperty('--score', '0%');
    return;
  }
  const percent = Math.round(comparison.alignment * 100);
  humanScore.textContent = `${percent}%`;
  humanMeter.style.setProperty('--score', `${percent}%`);
  humanVerdict.textContent = comparison.calibrated ? (percent >= 55 ? 'Illeszkedik a referenciahalmazhoz' : 'Eltér a referenciahalmaztól') : `Tájékoztató (${comparison.referenceCount}/5 referencia)`;
}

function formatTime(seconds) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
function setStatus(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
function drawSpectrogram(data) {
  const context = spectrogram.getContext('2d');
  const image = context.createImageData(data.frames, data.bands);
  for (let row = 0; row < data.bands; row += 1) {
    for (let column = 0; column < data.frames; column += 1) {
      const strength = data.values[column * data.bands + (data.bands - 1 - row)];
      const pixel = (row * data.frames + column) * 4;
      image.data[pixel] = Math.round(18 + strength * 210);
      image.data[pixel + 1] = Math.round(35 + strength * 180);
      image.data[pixel + 2] = Math.round(32 + (1 - strength) * 120);
      image.data[pixel + 3] = 255;
    }
  }
  const buffer = document.createElement('canvas'); buffer.width = data.frames; buffer.height = data.bands;
  buffer.getContext('2d').putImageData(image, 0, 0);
  context.imageSmoothingEnabled = false; context.clearRect(0, 0, spectrogram.width, spectrogram.height);
  context.drawImage(buffer, 0, 0, spectrogram.width, spectrogram.height);
}
async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
exportAudit.addEventListener('click', () => {
  if (!latestAudit) return;
  const blob = new Blob([JSON.stringify(latestAudit, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `${latestAudit.file.name}.audit.json`; link.click(); URL.revokeObjectURL(url);
});
function getDatasetRecords() {
  try { return JSON.parse(localStorage.getItem(DATASET_KEY) || '[]'); } catch { return []; }
}
function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}
saveDatasetRecord.addEventListener('click', () => {
  if (!latestAudit) return;
  const labels = { source: datasetSource.value.trim() || 'unlabeled', effectFamily: datasetFamily.value, pluginOrModel: datasetPlugin.value.trim() || null, testSignal: datasetSignal.value, settingsId: datasetSettings.value.trim() || null };
  const record = { schemaVersion: 'effect-profile-record/1.0', recordedAt: new Date().toISOString(), audio: latestAudit.file, labels, features: { effectProfile: latestAudit.analysis.effectProfile, residual: latestAudit.analysis.residual, evidence: latestAudit.analysis.evidence, sampleRate: latestAudit.analysis.sampleRate } };
  const records = getDatasetRecords(); const existing = records.findIndex((item) => item.audio.sha256 === record.audio.sha256);
  if (existing >= 0) records[existing] = record; else records.push(record);
  try { localStorage.setItem(DATASET_KEY, JSON.stringify(records)); datasetStatus.textContent = `${records.length} helyi effektprofil-rekord mentve. Az azonos hash felülírja a korábbi címkét.`; } catch { datasetStatus.textContent = 'A böngésző helyi tárhelye nem elérhető; exportáld az auditjegyzéket.'; }
});
exportDataset.addEventListener('click', () => downloadJson({ schemaVersion: 'effect-profile-dataset/1.0', exportedAt: new Date().toISOString(), records: getDatasetRecords() }, 'effect-profile-dataset.json'));
runOnnx.addEventListener('click', async () => {
  const [modelFile] = onnxModel.files;
  const [contractFile] = onnxContract.files;
  if (!latestModelFeatures || !modelFile || !contractFile) { onnxStatus.textContent = 'Előbb elemezz hangfájlt, majd adj meg ONNX-modellt és JSON-kontraktust.'; return; }
  try {
    onnxStatus.textContent = 'ONNX-modell futtatása helyben…';
    const contract = JSON.parse(await contractFile.text());
    const result = await runConfiguredOnnx(modelFile, contract, latestModelFeatures);
    const values = result.values.map((value) => Number(value).toFixed(4)).join(', ');
    onnxStatus.textContent = `Modellkimenet: [${values}]${result.labels.length ? ` · címkék: ${result.labels.join(', ')}` : ''}. Csak a modellkártya szerinti kalibrációval értelmezhető.`;
    if (latestAudit) latestAudit.onnx = { contract, result };
  } catch (error) { onnxStatus.textContent = `ONNX-hiba: ${error.message}`; }
});
