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
const settings = {
  get cats() { try { return JSON.parse(localStorage.cats) } catch { return DEFAULT_CATS } },
  set cats(v) { localStorage.cats = JSON.stringify(v) },
  get key() { return localStorage.apiKey || '' },
  set key(v) { localStorage.apiKey = v },
};

// ---------- Categories UI ----------
function fillCats() {
  const opts = settings.cats.map(c => `<option>${esc(c)}</option>`).join('');
  $('category').innerHTML = opts;
  $('noteCat').innerHTML = opts;
  $('filterCat').innerHTML = '<option value="">Tutte</option>' + opts;
}
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Recording + live transcription ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) {
  $('support').textContent = 'Questo browser non supporta la trascrizione. Usa Chrome (Android) o Safari (iPhone).';
  $('support').classList.remove('hidden');
}

let rec = null, media = null, chunks = [], finalText = '', recording = false, t0 = 0, tick;

async function start() {
  finalText = ''; chunks = [];
  $('live').innerHTML = '';
  // Audio recording (optional: if it fails we keep the transcription)
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    media = new MediaRecorder(stream);
    media.ondataavailable = e => e.data.size && chunks.push(e.data);
    media.start(1000);
  } catch (e) { media = null; }

  if (SR) {
    rec = new SR();
    rec.lang = 'it-IT';
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
    // Mobile browsers stop after silence: restart while recording
    rec.onend = () => { if (recording) try { rec.start() } catch {} };
    rec.onerror = e => { if (e.error === 'not-allowed') alert('Permesso microfono negato.'); };
    rec.start();
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
  if (rec) { rec.onend = null; rec.stop(); }
  let audio = null;
  if (media) {
    await new Promise(r => { media.onstop = r; media.stop(); });
    media.stream.getTracks().forEach(t => t.stop());
    if (chunks.length) audio = new Blob(chunks, { type: media.mimeType || 'audio/webm' });
  }
  // Small delay so the last final result can arrive
  await new Promise(r => setTimeout(r, 600));
  const text = finalText.trim();
  if (!text && !audio) return;
  const note = {
    id: crypto.randomUUID(), created: Date.now(),
    category: $('category').value,
    title: text ? text.split(/\s+/).slice(0, 6).join(' ') + (text.split(/\s+/).length > 6 ? '…' : '') : 'Nota vocale',
    text, audio, summary: '', duration: Math.round((Date.now() - t0) / 1000),
  };
  await DB.put(note);
  $('live').innerHTML = '';
  render();
  openNote(note);
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
      <div class="p">${esc(n.summary || n.text)}</div>
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
  $('noteSummary').textContent = n.summary ? '✨ ' + n.summary : '';
  $('noteSummary').classList.toggle('hidden', !n.summary);
  $('noteDlg').showModal();
}
const exportText = () => `${$('noteTitle').value}\n[${$('noteCat').value}]\n\n${current.summary ? 'Riassunto:\n' + current.summary + '\n\n' : ''}${$('noteText').value}`;

$('btnSave').onclick = async () => {
  Object.assign(current, { title: $('noteTitle').value, category: $('noteCat').value, text: $('noteText').value });
  await DB.put(current); $('noteDlg').close(); render();
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

// ---------- AI summary (Claude API, key stored locally) ----------
$('btnSummary').onclick = async () => {
  const text = $('noteText').value.trim();
  if (!text) return alert('Nessun testo da riassumere.');
  if (!settings.key) { alert('Inserisci la chiave API Claude nelle impostazioni ⚙️'); return openSettings(); }
  const btn = $('btnSummary'); btn.disabled = true; btn.textContent = '⏳ …';
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-5-5',
        max_tokens: 400,
        messages: [{ role: 'user', content:
          'Questa è la trascrizione di una nota vocale in italiano (può contenere errori di riconoscimento). ' +
          'Rispondi SOLO in JSON: {"titolo": "max 6 parole", "riassunto": "2-4 punti elenco brevi con •, includi eventuali cose da fare"}.\n\n' + text }],
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || r.status);
    const raw = data.content[0].text, json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    current.summary = json.riassunto;
    $('noteTitle').value = json.titolo;
    $('noteSummary').textContent = '✨ ' + json.riassunto;
    $('noteSummary').classList.remove('hidden');
  } catch (e) { alert('Errore riassunto: ' + e.message); }
  btn.disabled = false; btn.textContent = '✨ Riassunto AI';
};

// ---------- Settings ----------
function openSettings() {
  $('apiKey').value = settings.key;
  $('catsInput').value = settings.cats.join('\n');
  $('settingsDlg').showModal();
}
$('btnSettings').onclick = openSettings;
$('btnSaveSettings').onclick = () => {
  settings.key = $('apiKey').value.trim();
  const cats = $('catsInput').value.split('\n').map(s => s.trim()).filter(Boolean);
  settings.cats = cats.length ? cats : DEFAULT_CATS;
  fillCats(); render();
};

fillCats();
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
