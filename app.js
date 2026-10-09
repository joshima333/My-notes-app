// ---------- Storage (IndexedDB) ----------
const DB = (() => {
  let db;
  const open = () => db ? Promise.resolve(db) : new Promise((res, rej) => {
    const r = indexedDB.open('note-vocali', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('notes', { keyPath: 'id' });
    r.onsuccess = () => res(db = r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction('notes', mode), req = fn(t.objectStore('notes'));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    all: () => tx('readonly', s => s.getAll()),
    put: n => tx('readwrite', s => s.put(n)),
    del: id => tx('readwrite', s => s.delete(id)),
  };
})();

const $ = id => document.getElementById(id);
const DEFAULT_CATS = ['Idee', 'Lavoro', 'Diario', 'Spesa', 'Salute', 'Promemoria'];
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const settings = {
  get cats() { try { return JSON.parse(localStorage.cats) } catch { return DEFAULT_CATS } },
  set cats(v) { localStorage.cats = JSON.stringify(v) },
  // iPhone: modello leggero di default (Safari ha poca memoria per le web app)
  get model() { return localStorage.model || (IS_IOS ? 'Xenova/whisper-base' : 'Xenova/whisper-small') },
  set model(v) { localStorage.model = v },
};

// ---------- Categories UI ----------
function fillCats() {
  const opts = settings.cats.map(c => `<option>${esc(c)}</option>`).join('');
  $('category').innerHTML = opts;
  $('noteCat').innerHTML = opts;
  $('filterCat').innerHTML = '<option value="">Tutte</option>' + opts;
}
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Recording + private transcription ----------
// Mai server esterni: o riconoscimento vocale *locale* del browser (Chrome recenti),
// oppure Whisper eseguito sul telefono (whisper-worker.js).
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const LOCAL_OPTS = { langs: ['it-IT'], processLocally: true };
let liveLocal = false;

async function checkLocalSR() {
  if (!SR || typeof SR.available !== 'function') return false;
  try {
    const st = await SR.available(LOCAL_OPTS);
    if (st === 'available') return true;
    if (st === 'downloadable' || st === 'downloading') SR.install(LOCAL_OPTS).catch(() => {});
  } catch {}
  return false;
}
const setStatus = t => { $('status').textContent = t; $('status').classList.toggle('hidden', !t); };

let rec = null, media = null, chunks = [], finalText = '', recording = false, t0 = 0, tick;

async function start() {
  finalText = ''; chunks = [];
  $('live').innerHTML = '';
  liveLocal = await checkLocalSR();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    media = new MediaRecorder(stream);
    media.ondataavailable = e => e.data.size && chunks.push(e.data);
    media.start(1000);
  } catch (e) {
    media = null;
    if (!liveLocal) return alert('Impossibile usare il microfono: controlla i permessi.');
  }

  if (liveLocal) {
    rec = new SR();
    rec.lang = 'it-IT';
    rec.processLocally = true;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript.trim() + ' ';
        else interim += r[0].transcript;
      }
      $('live').innerHTML = esc(finalText) + `<span class="interim">${esc(interim)}</span>`;
    };
    rec.onend = () => { if (recording) try { rec.start() } catch {} };
    rec.start();
  } else {
    $('live').innerHTML = '<span class="interim">Sto registrando… il testo apparirà dopo lo stop.</span>';
  }
  recording = true;
  t0 = Date.now();
  tick = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    $('timer').textContent = `${String(s / 60 | 0).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, 500);
  $('btnRec').textContent = '■ Stop';
  $('btnRec').classList.add('on');
}

async function stop() {
  recording = false;
  clearInterval(tick);
  $('btnRec').textContent = '● Registra';
  $('btnRec').classList.remove('on');
  if (rec) { rec.onend = null; rec.stop(); rec = null; }
  let audio = null;
  if (media) {
    await new Promise(r => { media.onstop = r; media.stop(); });
    media.stream.getTracks().forEach(t => t.stop());
    if (chunks.length) audio = new Blob(chunks, { type: media.mimeType || 'audio/webm' });
    media = null;
  }
  await new Promise(r => setTimeout(r, 600));
  const text = finalText.trim();
  $('live').innerHTML = '';
  if (!text && !audio) return;
  const pending = !text && !!audio;
  const note = {
    id: crypto.randomUUID(), created: Date.now(),
    category: $('category').value,
    title: text ? makeTitle(text) : 'Nota vocale',
    text, audio, pending, duration: Math.round((Date.now() - t0) / 1000),
  };
  await DB.put(note);
  render();
  if (pending) transcribe(note); else openNote(note);
}
const makeTitle = t => { const w = t.split(/\s+/); return w.slice(0, 6).join(' ') + (w.length > 6 ? '…' : ''); };

// ---------- Whisper on-device ----------
let worker = null;
const queue = [];
let busy = false;

async function to16kMono(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const buf = await blob.arrayBuffer();
  const dec = await new Promise((res, rej) => ctx.decodeAudioData(buf, res, rej));
  ctx.close && ctx.close();
  // Mono + ricampionamento a 16 kHz fatto a mano (Safari non accetta OfflineAudioContext a 16 kHz ovunque)
  const n = dec.length, chs = dec.numberOfChannels, mono = new Float32Array(n);
  for (let c = 0; c < chs; c++) { const d = dec.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / chs; }
  const ratio = dec.sampleRate / 16000, out = new Float32Array(Math.floor(n / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio, j = x | 0, f = x - j;
    out[i] = mono[j] * (1 - f) + (mono[j + 1] || 0) * f;
  }
  return out;
}

function transcribe(note) {
  if (!queue.some(n => n.id === note.id)) queue.push(note);
  nextJob();
}
async function nextJob() {
  if (busy || !queue.length) return;
  busy = true;
  const note = queue[0];
  note.attempts = (note.attempts || 0) + 1;
  if (note.attempts > 2) {
    // Già fallita due volte (es. il telefono ha chiuso la pagina per memoria): non riprovare in loop
    Object.assign(note, { pending: false, failed: true });
    await DB.put(note); queue.shift(); busy = false; render();
    setStatus('⚠️ Trascrizione non riuscita. Apri la nota e premi "Riprova", oppure scegli qualità "Veloce" in ⚙️.');
    return nextJob();
  }
  await DB.put(note);
  try {
    if (!worker) worker = new Worker('whisper-worker.js', { type: 'module' });
    setStatus('⏳ Preparo l\'audio…');
    const audio = await to16kMono(note.audio);
    const text = await new Promise((res, rej) => {
      worker.onerror = () => { worker = null; rej(new Error('modello non caricato, controlla la connessione')); };
      worker.onmessage = ({ data: m }) => {
        if (m.type === 'progress') setStatus(`⬇️ Scarico il modello (solo la prima volta)… ${Math.round(m.progress || 0)}%`);
        else if (m.type === 'working') setStatus('✍️ Trascrivo sul telefono…');
        else if (m.type === 'done') res(m.text);
        else if (m.type === 'error') rej(new Error(m.error));
      };
      worker.postMessage({ id: note.id, audio, model: settings.model }, [audio.buffer]);
    });
    Object.assign(note, { text, pending: false, failed: false, attempts: 0, title: note.title === 'Nota vocale' && text ? makeTitle(text) : note.title });
    await DB.put(note);
    render();
    if (!$('noteDlg').open && !locked) openNote(note);
  } catch (e) {
    setStatus('⚠️ Trascrizione non riuscita: ' + e.message);
    queue.shift(); busy = false;
    return;
  }
  queue.shift(); busy = false;
  setStatus('');
  nextJob();
}

$('btnRec').onclick = () => recording ? stop() : start();

// ---------- List ----------
async function render() {
  const q = $('search').value.toLowerCase(), cat = $('filterCat').value;
  const notes = (await DB.all())
    .filter(n => (!cat || n.category === cat) && (!q || (n.title + ' ' + n.text).toLowerCase().includes(q)))
    .sort((a, b) => b.created - a.created);
  $('notes').innerHTML = notes.length ? notes.map(n => `
    <li data-id="${n.id}">
      <div class="meta"><span class="tag">${esc(n.category)}</span>
        <span>${new Date(n.created).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</span>
        ${n.audio ? '<span>🔊</span>' : ''}</div>
      <div class="t">${esc(n.title)}</div>
      <div class="p">${n.pending ? '⏳ Trascrizione in corso…' : n.failed ? '⚠️ Trascrizione non riuscita: apri per riprovare' : esc(n.text)}</div>
    </li>`).join('') : '<p class="muted">Nessuna nota. Premi Registra e parla!</p>';
}
$('notes').onclick = async e => {
  const li = e.target.closest('li'); if (!li) return;
  openNote((await DB.all()).find(n => n.id === li.dataset.id));
};
$('search').oninput = render;
$('filterCat').onchange = render;

// ---------- Note detail ----------
let current = null, audioURL = null;
function openNote(n) {
  current = n;
  $('noteTitle').value = n.title;
  $('noteCat').value = n.category;
  $('noteText').value = n.text;
  if (audioURL) URL.revokeObjectURL(audioURL);
  if (n.audio) { audioURL = URL.createObjectURL(n.audio); $('noteAudio').src = audioURL; }
  $('noteAudio').classList.toggle('hidden', !n.audio);
  $('btnRetry').classList.toggle('hidden', !(n.audio && !n.pending && (n.failed || !n.text)));
  $('noteDlg').showModal();
}
const exportText = () => `${$('noteTitle').value}\n[${$('noteCat').value}]\n\n${$('noteText').value}`;

$('btnSave').onclick = async () => {
  Object.assign(current, { title: $('noteTitle').value, category: $('noteCat').value, text: $('noteText').value });
  await DB.put(current); $('noteDlg').close(); render();
};
$('btnRetry').onclick = async () => {
  Object.assign(current, { pending: true, failed: false, attempts: 0 });
  await DB.put(current); $('noteDlg').close(); render(); transcribe(current);
};
$('btnDelete').onclick = async () => {
  if (!confirm('Eliminare questa nota?')) return;
  await DB.del(current.id); $('noteDlg').close(); render();
};
$('btnCopy').onclick = async () => { await navigator.clipboard.writeText(exportText()); alert('Copiato!'); };
$('btnShare').onclick = async () => {
  if (navigator.share) navigator.share({ title: $('noteTitle').value, text: exportText() }).catch(() => {});
  else { await navigator.clipboard.writeText(exportText()); alert('Condivisione non supportata: testo copiato.'); }
};
$('btnDownload').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([exportText()], { type: 'text/plain' }));
  a.download = ($('noteTitle').value || 'nota').replace(/[^\w\- ]/g, '') + '.txt';
  a.click();
};

// ---------- Settings ----------
function openSettings() {
  $('model').value = settings.model;
  $('privacyInfo').textContent = liveLocalInfo;
  $('catsInput').value = settings.cats.join('\n');
  $('settingsDlg').showModal();
}
$('btnSettings').onclick = openSettings;
$('btnSaveSettings').onclick = () => {
  settings.model = $('model').value;
  const cats = $('catsInput').value.split('\n').map(s => s.trim()).filter(Boolean);
  settings.cats = cats.length ? cats : DEFAULT_CATS;
  fillCats(); render();
};

// ---------- PIN lock ----------
let locked = true, pinStep = null, firstPin = '';
const hash = async pin => {
  if (!localStorage.pinSalt) localStorage.pinSalt = crypto.randomUUID();
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(localStorage.pinSalt + pin));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
};
function lock(step) {
  locked = true;
  pinStep = step || (localStorage.pinHash ? 'unlock' : 'new');
  $('lockMsg').textContent = pinStep === 'unlock' ? 'Inserisci il PIN' : 'Crea un PIN (4-8 cifre)';
  $('notes').innerHTML = '';
  $('noteDlg').open && $('noteDlg').close();
  $('settingsDlg').open && $('settingsDlg').close();
  $('lock').classList.remove('hidden');
  $('pinInput').value = '';
  setTimeout(() => $('pinInput').focus(), 50);
}
function unlock() { locked = false; $('lock').classList.add('hidden'); render(); }
$('lockForm').onsubmit = async e => {
  e.preventDefault();
  const pin = $('pinInput').value;
  $('pinInput').value = '';
  if (pinStep === 'unlock') {
    if (await hash(pin) === localStorage.pinHash) unlock();
    else $('lockMsg').textContent = 'PIN errato, riprova';
  } else if (pinStep === 'new') {
    if (!/^\d{4,8}$/.test(pin)) return $('lockMsg').textContent = 'Il PIN deve avere 4-8 cifre';
    firstPin = pin; pinStep = 'confirm'; $('lockMsg').textContent = 'Ripeti il PIN';
  } else if (pinStep === 'confirm') {
    if (pin !== firstPin) { pinStep = 'new'; return $('lockMsg').textContent = 'Non coincidono. Crea un PIN (4-8 cifre)'; }
    localStorage.pinHash = await hash(pin);
    unlock();
  }
};
$('btnPin').onclick = () => lock('new');
document.addEventListener('visibilitychange', () => { if (document.hidden && !locked) lock(); });

// ---------- Privacy info ----------
let liveLocalInfo = '';
checkLocalSR().then(ok => {
  liveLocalInfo = '🔐 Note e audio restano solo su questo telefono. ' + (ok
    ? 'Trascrizione in diretta eseguita sul telefono.'
    : 'Trascrizione eseguita sul telefono con Whisper, dopo lo stop. Da internet si scarica solo il modello, una volta.');
});

if (navigator.storage?.persist) navigator.storage.persist();
fillCats();
lock();
// Riprende trascrizioni rimaste a metà
DB.all().then(ns => ns.filter(n => n.pending && n.audio).forEach(transcribe));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
