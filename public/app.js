import { analyzePcm, buildEvidenceTriage, compareToHumanReference } from './analyzer.js';

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
const exportAudit = document.querySelector('#export-audit');
const humanReference = [];
let latestAudit = null;

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
    const buffer = await context.decodeAudioData(bytes);
    const data = mixToMono(buffer);
    const analysis = analyzePcm(data, buffer.sampleRate);
    context.close();
    render(analysis, file, fileHash);
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

function render(analysis, file, fileHash) {
  const filename = file.name;
  const percent = Math.round(analysis.probability * 100);
  score.textContent = `${percent}%`;
  meter.style.setProperty('--score', `${percent}%`);
  const humanComparison = compareToHumanReference(analysis.humanProfile, humanReference);
  const triage = buildEvidenceTriage(analysis, humanComparison);
  const uncertain = analysis.confidence < 0.45 || (percent > 40 && percent < 60) || (humanComparison && (!humanComparison.calibrated || (percent >= 60) === (humanComparison.alignment >= .55)));
  verdict.textContent = uncertain ? 'Bizonytalan - felülvizsgálat javasolt' : percent >= 60 ? 'AI-artefaktumok valószínűek' : 'Kevés AI-artefaktum észlelhető';
  verdict.dataset.tone = uncertain ? 'caution' : percent >= 60 ? 'ai' : 'human';
  metadata.textContent = `${filename} · ${formatTime(analysis.duration)} · ${analysis.sampleRate.toLocaleString('hu-HU')} Hz · ${analysis.frameCount} spektrális ablak · ${analysis.structure.segmentCount} teljes-dal szegmens`;
  evidence.innerHTML = Object.entries(analysis.evidence).map(([label, value]) => `<div class="evidence-row"><span>${label}</span><div class="bar"><i style="width:${Math.round(value * 100)}%"></i></div><b>${Math.round(value * 100)}%</b></div>`).join('');
  results.querySelector('.warnings')?.remove();
  if (analysis.warnings.length) evidence.insertAdjacentHTML('afterend', `<p class="warnings">${analysis.warnings.join(' ')}</p>`);
  const alternatives = [
    file.type.includes('mpeg') || file.name.toLowerCase().endsWith('.mp3') ? 'veszteséges MP3-kódolás' : null,
    file.type.includes('aac') || file.name.toLowerCase().endsWith('.m4a') ? 'veszteséges AAC-kódolás' : null,
    analysis.sampleRate < 22050 ? 'alacsony mintavételi frekvencia' : null,
    analysis.segments?.dispersion > 0.6 ? 'szegmensenként eltérő mastering vagy hangszerelés' : null,
    'mastering, újrakódolás vagy forrás-szeparálási műtermék'
  ].filter(Boolean);
  auditDiagnostics.innerHTML = `<h3>Bizonyíték-triage <small>emberi felülvizsgálathoz</small></h3>
    <p><strong>${triage.assessment}</strong></p>
    <div class="residual-grid">${triage.layers.map((layer) => `<div><span>${layer.label}</span><b>${layer.status}</b></div>`).join('')}</div>
    <p><strong>Alternatív magyarázatok:</strong> ${alternatives.join('; ')}.</p>
    <p>Provenance/SynthID/C2PA és stemszintű eredet ebben a böngészős verzióban nincs ellenőrizve. Jogi vagy szerzői jogi következtetéshez szakértői felülvizsgálat szükséges.</p>`;
  latestAudit = {
    schemaVersion: '1.0', detector: { name: 'AI Zene Detektor', version: '0.2.0', mode: 'browser-local-triage' }, generatedAt: new Date().toISOString(),
    file: { name: file.name, type: file.type || 'ismeretlen', size: file.size, lastModified: file.lastModified, sha256: fileHash },
    analysis: { probability: analysis.probability, confidence: analysis.confidence, evidence: analysis.evidence, warnings: analysis.warnings, segments: analysis.segments, residual: analysis.residual },
    triage, alternativeExplanations: alternatives,
    limitations: ['A provenance, a szolgáltatóspecifikus vízjelek és a stemszintű eredet nincs ellenőrizve.', 'Az eredmény kutatási jelzés, nem jogi bizonyíték.']
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
  </div><p>Az önhasonlóság és az MFDFA csak műfajazonos referenciával értelmezhető kutatási jellemző; nincs beleszámítva az AI-pontszámba.</p>`);
  renderHumanComparison(humanComparison);
  results.hidden = false;
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
