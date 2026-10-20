const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const DEFAULT_CATS = ['Idee', 'Brainstorming', 'Lavoro', 'Diario', 'Spesa', 'Salute', 'Promemoria'];
const settings = {
  get cats() { try { const c = JSON.parse(localStorage.cats); return c.length ? c : DEFAULT_CATS } catch { return DEFAULT_CATS } },
  set cats(v) { localStorage.cats = JSON.stringify(v); localStorage.catsUpdated = Date.now(); Cloud.schedule && Cloud.schedule(); },
  // iPhone: modello leggero di default (Safari ha poca memoria per le web app)
  get model() { return localStorage.model || (IS_IOS ? 'Xenova/whisper-base' : 'Xenova/whisper-small') },
  set model(v) { localStorage.model = v },
};

// Ogni modifica fatta dall'utente passa da qui: salva in locale e sincronizza
async function saveNote(n, quiet) {
  n.updated = Date.now(); n.dirty = true;
  await DB.put(n); if (!quiet) render(); Cloud.schedule();
}

// ---------- Raccolte ----------
const EMOJI = { idee: '💡', brainstorming: '🧠', lavoro: '💼', diario: '📔', spesa: '🛒', salute: '🩺', promemoria: '⏰', studio: '📚', casa: '🏠', viaggi: '✈️', ricette: '🍳', sport: '🏃' };
const catMeta = () => { try { return JSON.parse(localStorage.catMeta) || {}; } catch { return {}; } };
const setCatMeta = m => { localStorage.catMeta = JSON.stringify(m); localStorage.catsUpdated = Date.now(); Cloud.schedule(); };
const emoji = c => catMeta()[c]?.emoji || EMOJI[c.toLowerCase()] || '📁';
const HUES = [250, 320, 160, 30, 200, 280, 0, 120, 50, 340];
const hue = c => catMeta()[c]?.hue ?? HUES[Math.abs([...c].reduce((h, ch) => h * 31 + ch.charCodeAt(0) | 0, 7)) % HUES.length];
const selCat = () => settings.cats.includes(localStorage.selCat) ? localStorage.selCat : settings.cats[0];

function fillCats() {
  const sel = selCat();
  $('chips').innerHTML = settings.cats.map(c =>
    `<button type="button" class="chip${c === sel ? ' on' : ''}" style="--h:${hue(c)}" data-cat="${esc(c)}" role="radio" aria-checked="${c === sel}">${emoji(c)} ${esc(c)}</button>`
  ).join('') + '<button type="button" class="chip add" id="chipAdd" aria-label="Nuova raccolta">＋</button>';
  $('noteCat').innerHTML = settings.cats.map(c => `<option>${esc(c)}</option>`).join('');
  const on = $('chips').querySelector('.on');
  if (on) $('chips').scrollLeft = on.offsetLeft - ($('chips').clientWidth - on.offsetWidth) / 2;
}
$('chips').onclick = e => {
  const b = e.target.closest('.chip'); if (!b) return;
  if (b.id === 'chipAdd') {
    const name = (prompt('Nome della nuova raccolta:') || '').trim();
    if (!name) return;
    if (!settings.cats.includes(name)) settings.cats = [...settings.cats, name];
    localStorage.selCat = name;
  } else localStorage.selCat = b.dataset.cat;
  fillCats(); render();
};

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

let appendMode = false, discardRec = false;
const liveEl = () => appendMode ? $('appendLive') : $('live');
const recBtn = () => appendMode ? $('btnAppendRec') : $('btnRec');
let rec = null, media = null, chunks = [], finalText = '', lastInterim = '', recording = false, t0 = 0, tick;
// Su iPhone Whisper è troppo pesante: si usa la dettatura Apple (in diretta)
const useApple = () => IS_IOS && !!SR;
const flushInterim = () => { if (lastInterim.trim()) finalText += lastInterim.trim() + ' '; lastInterim = ''; };

async function start() {
  finalText = ''; lastInterim = ''; chunks = [];
  liveEl().innerHTML = '';
  liveLocal = await checkLocalSR();
  const live = liveLocal || useApple();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    media = new MediaRecorder(stream);
    media.ondataavailable = e => e.data.size && chunks.push(e.data);
    media.start(1000);
  } catch (e) {
    media = null;
    if (!live) { appendMode = false; return alert('Impossibile usare il microfono: controlla i permessi.'); }
  }

  if (live) {
    rec = new SR();
    rec.lang = 'it-IT';
    if (liveLocal) rec.processLocally = true;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript.trim() + ' ';
        else interim += r[0].transcript;
      }
      lastInterim = interim;
      liveEl().innerHTML = esc(finalText) + `<span class="interim">${esc(interim)}</span>`;
    };
    // iPhone a volte non "chiude" l'ultima frase: la salviamo comunque
    rec.onend = () => { flushInterim(); if (recording) try { rec.start() } catch {} };
    rec.onerror = e => {
      // Se microfono conteso tra registrazione audio e dettatura, priorità al testo
      if (e.error === 'audio-capture' && media) { media.stream.getTracks().forEach(t => t.stop()); media = null; chunks = []; }
      if (e.error === 'not-allowed') alert('Permesso negato: consenti microfono e riconoscimento vocale.');
    };
    rec.start();
  } else {
    liveEl().innerHTML = '<span class="interim">Sto registrando… il testo apparirà dopo lo stop.</span>';
  }
  recording = true;
  t0 = Date.now();
  tick = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    $('timer').textContent = `${String(s / 60 | 0).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, 500);
  recBtn().classList.add('on');
  liveEl().classList.remove('hidden');
  if (!appendMode) { $('recSheet').classList.remove('hidden'); fillCats(); }
}

async function stop() {
  recording = false;
  clearInterval(tick);
  recBtn().classList.remove('on');
  $('recSheet').classList.add('hidden');
  $('timer').textContent = '00:00';
  if (rec) { const r = rec; rec = null; r.onend = flushInterim; r.stop(); }
  let audio = null;
  if (media) {
    await new Promise(r => { media.onstop = r; media.stop(); });
    media.stream.getTracks().forEach(t => t.stop());
    if (chunks.length) audio = new Blob(chunks, { type: media.mimeType || 'audio/webm' });
    media = null;
  }
  await new Promise(r => setTimeout(r, 800));
  flushInterim();
  const text = finalText.trim();
  liveEl().innerHTML = '';
  if (appendMode) { appendMode = false; return finishAppend(text, audio); }
  if (discardRec) { discardRec = false; return; }
  if (!text && !audio) return;
  const pending = !text && !!audio;
  const items = Smart.isShopping(selCat()) && text ? Smart.parseList(text).map(t => ({ t, done: false })) : null;
  const note = {
    id: crypto.randomUUID(), created: Date.now(),
    category: selCat(),
    title: text ? makeTitle(text) : 'Nota vocale',
    text, audio, pending, items, duration: Math.round((Date.now() - t0) / 1000),
  };
  await saveNote(note);
  if (pending) transcribe(note); else openNote(note);
}
const makeTitle = t => { const w = t.trim().split(/\s+/); return w.slice(0, 6).join(' ').replace(/[.,;:!?]+$/, '') + (w.length > 6 ? '…' : ''); };

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
  if (IS_IOS) { // Whisper fa chiudere Safari su iPhone
    Object.assign(note, { pending: false, failed: true }); saveNote(note);
    return;
  }
  if (!queue.some(n => n.id === note.id)) queue.push(note);
  nextJob();
}
async function runWhisper(blob, onStatus) {
  if (!worker) worker = new Worker('whisper-worker.js', { type: 'module' });
  onStatus('⏳ Preparo l\'audio…');
  const audio = await to16kMono(blob);
  return new Promise((res, rej) => {
    worker.onerror = () => { worker = null; rej(new Error('modello non caricato, controlla la connessione')); };
    worker.onmessage = ({ data: m }) => {
      if (m.type === 'progress') onStatus(`⬇️ Scarico il modello (solo la prima volta)… ${Math.round(m.progress || 0)}%`);
      else if (m.type === 'working') onStatus('✍️ Trascrivo sul telefono…');
      else if (m.type === 'done') res(m.text);
      else if (m.type === 'error') rej(new Error(m.error));
    };
    worker.postMessage({ id: 'x', audio, model: settings.model }, [audio.buffer]);
  });
}
async function nextJob() {
  if (busy || !queue.length) return;
  busy = true;
  const note = queue[0];
  note.attempts = (note.attempts || 0) + 1;
  if (note.attempts > 2) {
    // Già fallita due volte (es. il telefono ha chiuso la pagina per memoria): non riprovare in loop
    Object.assign(note, { pending: false, failed: true });
    await saveNote(note); queue.shift(); busy = false;
    setStatus('⚠️ Trascrizione non riuscita. Apri la nota e premi "Riprova", oppure scegli qualità "Veloce" in ⚙️.');
    return nextJob();
  }
  await DB.put(note);
  try {
    const text = await runWhisper(note.audio, setStatus);
    if (Smart.isShopping(note.category)) note.items = Smart.parseList(text).map(t => ({ t, done: false }));
    Object.assign(note, { text, pending: false, failed: false, attempts: 0, title: note.title === 'Nota vocale' && text ? makeTitle(text) : note.title });
    await saveNote(note);
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
$('btnStop').onclick = () => recording && stop();

// ---------- Home: cartelle / ricerca / raccolta aperta ----------
let openFolder = null;
const fmtDate = t => new Date(t).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
const noteItem = (n, showCat) => `
  <li data-id="${n.id}" class="swipe${n.done ? ' done' : ''}" style="--h:${hue(n.category)}">
    <button type="button" class="smove" tabindex="-1">Sposta</button>
    <span class="sacts"><button type="button" class="sdone" tabindex="-1">${n.archived ? 'Ripristina' : 'Fatto'}</button><button type="button" class="sdel" tabindex="-1">Elimina</button></span>
    <div class="sc">
    <div class="meta">${showCat ? `<span class="tag">${emoji(n.category)} ${esc(n.category)}</span>` : ''}
      ${n.pinned ? '<span>📌</span>' : ''}<span>${fmtDate(n.created)}</span>${n.audio || n.hasAudio ? '<span>🔊</span>' : ''}</div>
    <div class="t">${esc(n.title)}</div>
    <div class="p">${n.pending ? '⏳ Trascrizione in corso…' : n.failed ? '⚠️ Trascrizione non riuscita' : notePreview(n)}</div>
    </div>
  </li>`;
function notePreview(n) {
  if (n.items?.length) {
    const done = n.items.filter(i => i.done).length;
    return `✅ ${done}/${n.items.length} · ` + esc(n.items.filter(i => !i.done).map(i => i.t).join(', ') || 'tutto preso!');
  }
  const ev = Smart.parseEvent(n.text, new Date(n.created));
  return (ev ? `📅 ${esc(Smart.fmtEvent(ev))} · ` : '') + esc(Smart.preview(n.text));
}

// Evento collegato a una nota (data calcolata rispetto al giorno in cui è stata creata)
const noteEvent = n => n.text ? Smart.parseEvent(n.text, new Date(n.created)) : null;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

// Archivia da sola gli eventi già passati (dal giorno dopo)
async function autoArchive(all) {
  const today = startOfToday();
  for (const n of all) {
    if (n.archived || n.keepActive) continue;
    const ev = noteEvent(n);
    if (ev && ev.start < today) { n.archived = true; await saveNote(n, true); }
  }
}

async function render() {
  if (locked) return;
  const every = await DB.all();
  await autoArchive(every);
  const sorted = every.sort((a, b) => (!!b.pinned - !!a.pinned) || b.created - a.created);
  const all = sorted.filter(n => !n.archived);
  renderHeader();
  renderUpcoming(all);
  if (currentView === 'viewCal') renderCalendar(every);
  if (currentView === 'viewArch') renderArchive(sorted.filter(n => n.archived));
  if (currentView === 'viewStats') renderStats(every);
  const q = $('search').value.trim().toLowerCase();
  $('home').classList.toggle('hidden', !!openFolder);
  $('folderView').classList.toggle('hidden', !openFolder);
  if (openFolder) {
    $('folderTitle').textContent = `${emoji(openFolder)} ${openFolder}`;
    const list = all.filter(n => n.category === openFolder);
    $('notes').innerHTML = list.length ? list.map(n => noteItem(n)).join('') : '<li class="empty">Nessuna nota qui.<br>Tocca 🎙️ per registrarne una.</li>';
    return;
  }
  const listMode = !!q || !!filter;
  $('results').classList.toggle('hidden', !listMode || filter === 'week');
  $('agenda').classList.toggle('hidden', filter !== 'week' || !!q);
  for (const id of ['folders', 'spark']) $(id).classList.toggle('hidden', listMode);
  document.querySelector('#home .sectionhead').classList.toggle('hidden', listMode);
  $('upcoming').classList.toggle('hidden', listMode || !$('upcoming').innerHTML);
  if (!listMode) renderSpark(all);
  if (filter === 'week' && !q) return renderAgenda(all);
  if (listMode) {
    const today = startOfToday();
    let list = q ? sorted.filter(n => (n.title + ' ' + n.text).toLowerCase().includes(q)) : all;
    if (filter === 'today') list = list.filter(n => { const e = noteEvent(n); return (e && sameDay(e.start, today)) || sameDay(new Date(n.created), today); });
    if (filter === 'pinned') list = list.filter(n => n.pinned);
    if (filter === 'audio') list = list.filter(n => n.audio || n.hasAudio);
    if (filter === 'photo') list = list.filter(n => n.photos?.length);
    if (filter === 'lists') list = list.filter(n => n.items?.length);
    $('results').innerHTML = list.length ? list.map(n => noteItem(n, true)).join('') : '<li class="empty">Niente qui per ora.</li>';
    return;
  }
  const cats = [...settings.cats, ...new Set(all.map(n => n.category).filter(c => !settings.cats.includes(c)))];
  $('folders').innerHTML = cats.map(c => {
    const list = all.filter(n => n.category === c);
    return `<button type="button" class="folder" data-cat="${esc(c)}" style="--h:${hue(c)}">
      <span class="ficon">${emoji(c)}</span>
      <span class="fcount">${list.length}</span>
      <span class="fname">${esc(c)}</span>
      <span class="flast">${list[0] ? esc(list[0].title) : 'Vuota'}</span>
    </button>`;
  }).join('');
}

// ---------- Filtri rapidi + agenda della settimana ----------
let filter = '';
$('filters').onclick = e => {
  const b = e.target.closest('.fchip'); if (!b) return;
  filter = b.dataset.f;
  document.querySelectorAll('.fchip').forEach(x => x.classList.toggle('on', x === b));
  b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  render();
};
function renderAgenda(all) {
  const today = startOfToday();
  const evs = all.map(n => [n, noteEvent(n)]).filter(([, e]) => e);
  let html = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(today); d.setDate(today.getDate() + i);
    const day = evs.filter(([, e]) => sameDay(e.start, d)).sort((a, b) => a[1].start - b[1].start);
    const label = i === 0 ? 'Oggi' : i === 1 ? 'Domani' : d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'short' });
    html += `<h3 class="daytitle agday${day.length ? '' : ' emptyday'}">${label[0].toUpperCase() + label.slice(1)}</h3>` +
      (day.length ? `<div class="upcoming">${day.map(([n, e]) => eventRow(n, e)).join('')}</div>` : '');
  }
  $('agenda').innerHTML = html + '<p class="muted small hint">Gli eventi nascono dalle tue note: di\' per esempio “giovedì alle 18 palestra”.</p>';
}
$('agenda').onclick = async e => { const r = e.target.closest('.uprow'); if (r) openNote(await DB.get(r.dataset.id)); };

// ---------- Spunto del giorno ----------
let sparkShift = 0;
function renderSpark(all) {
  const s = Insights.spark(all, new Date(), sparkShift);
  const icon = { prompt: '✨', idea: '💡', word: '🔤', recap: '🗓️' }[s.kind];
  $('spark').innerHTML = `<div class="sparkhead"><span>${icon} Spunto del giorno</span><button type="button" class="link small" id="sparkNext">Un altro</button></div>
    <p class="sparktext">${esc(s.text)}</p>${s.id ? `<button type="button" class="link small" data-open="${s.id}">Apri la nota ›</button>` : ''}`;
}
$('spark').onclick = async e => {
  if (e.target.id === 'sparkNext') { sparkShift++; return render(); }
  const o = e.target.closest('[data-open]'); if (o) openNote(await DB.get(o.dataset.open));
};

// ---------- Statistiche ----------
function renderStats(every) {
  const now = Date.now(), active = every.filter(n => !n.archived);
  const month = every.filter(n => now - n.created < 30 * 864e5);
  const secs = every.reduce((a, n) => a + (n.duration || 0), 0);
  const items = every.flatMap(n => n.items || []);
  const evs = every.filter(n => noteEvent(n));
  const tile = (v, l) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`;
  $('statTiles').innerHTML = tile(every.length, 'note totali') + tile(month.length, 'ultimi 30 giorni') +
    tile(secs >= 3600 ? (secs / 3600).toFixed(1) + ' h' : Math.round(secs / 60) + ' min', 'registrati') +
    tile(items.length ? Math.round(items.filter(i => i.done).length / items.length * 100) + '%' : '–', 'voci spuntate') +
    tile(evs.length, 'eventi') + tile(every.filter(n => n.archived).length, 'archiviate');
  // attività 30 giorni
  const today = startOfToday(), days = [];
  for (let i = 29; i >= 0; i--) { const d = new Date(today); d.setDate(today.getDate() - i); days.push([d, every.filter(n => sameDay(new Date(n.created), d)).length]); }
  const max = Math.max(1, ...days.map(x => x[1]));
  $('statDays').innerHTML = days.map(([d, c]) => `<i style="height:${Math.max(4, c / max * 100)}%" class="${c ? '' : 'zero'}" title="${d.toLocaleDateString('it-IT')}: ${c}"></i>`).join('');
  // per raccolta
  const cats = [...new Set([...settings.cats, ...active.map(n => n.category)])].map(c => [c, active.filter(n => n.category === c).length]).sort((a, b) => b[1] - a[1]);
  const cmax = Math.max(1, ...cats.map(x => x[1]));
  $('statCats').innerHTML = cats.map(([c, k]) => `<div class="hbar" style="--h:${hue(c)}"><span>${emoji(c)} ${esc(c)}</span><div><i style="width:${k / cmax * 100}%"></i></div><b>${k}</b></div>`).join('');
  // parole
  const sel = $('wordsCat'), cur = sel.value;
  sel.innerHTML = '<option value="">Tutte le note</option>' + settings.cats.map(c => `<option${c === cur ? ' selected' : ''}>${esc(c)}</option>`).join('');
  const words = Insights.topWords(cur ? every.filter(n => n.category === cur) : every, 30);
  const wmax = words[0]?.[1] || 1;
  $('statWords').innerHTML = words.length ? words.map(([w, c]) => `<span style="font-size:${0.85 + c / wmax * 1.1}rem;opacity:${0.55 + c / wmax * 0.45}" title="${c} volte">${esc(w)}</span>`).join('') : '<span class="muted small">Ancora poche parole: registra qualche nota!</span>';
}
$('wordsCat').onchange = () => render();

// ---------- Prossimi eventi ----------
const dayShort = d => d.toLocaleDateString('it-IT', { weekday: 'short' }).replace('.', '');
function eventRow(n, ev) {
  const time = ev.allDay ? 'Tutto il giorno' : ev.start.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return `<div class="uprow" data-id="${n.id}" style="--h:${hue(n.category)}">
    <div class="update"><small>${dayShort(ev.start)}</small><b>${ev.start.getDate()}</b></div>
    <div class="uptext"><b>${esc(ev.title)}</b><span class="muted small">${time} · ${emoji(n.category)} ${esc(n.category)}</span></div>
  </div>`;
}
function renderUpcoming(all) {
  const today = startOfToday();
  const evs = all.map(n => [n, noteEvent(n)]).filter(([, e]) => e && e.start >= today).sort((a, b) => a[1].start - b[1].start).slice(0, 3);
  $('upcoming').innerHTML = evs.length ? '<h3>Prossimi eventi</h3>' + evs.map(([n, e]) => eventRow(n, e)).join('') : '';
  $('upcoming').classList.toggle('hidden', !evs.length);
}
$('upcoming').onclick = async e => { const r = e.target.closest('.uprow'); if (r) openNote(await DB.get(r.dataset.id)); };

// ---------- Calendario ----------
let calMonth = new Date(); calMonth.setDate(1);
let calSel = startOfToday();
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
function renderCalendar(every) {
  const evs = every.map(n => [n, noteEvent(n)]).filter(([, e]) => e);
  $('calTitle').textContent = calMonth.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  const first = new Date(calMonth), offset = (first.getDay() + 6) % 7;
  const start = new Date(first); start.setDate(1 - offset);
  const today = startOfToday();
  let html = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    if (i >= 35 && d.getMonth() !== calMonth.getMonth()) break;
    const dayEvs = evs.filter(([, e]) => sameDay(e.start, d));
    const cls = [d.getMonth() !== calMonth.getMonth() && 'other', sameDay(d, today) && 'today', sameDay(d, calSel) && 'sel'].filter(Boolean).join(' ');
    html += `<button type="button" class="${cls}" data-d="${d.getTime()}"><span>${d.getDate()}</span><span class="dots">${dayEvs.slice(0, 3).map(([n]) => `<i style="--h:${hue(n.category)}"></i>`).join('')}</span></button>`;
  }
  $('calGrid').innerHTML = html;
  const sel = evs.filter(([, e]) => sameDay(e.start, calSel)).sort((a, b) => a[1].start - b[1].start);
  const t = calSel.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  $('calDayTitle').textContent = t[0].toUpperCase() + t.slice(1);
  $('calList').innerHTML = sel.length ? sel.map(([n]) => noteItem(n, true)).join('') : '<li class="empty">Nessun evento in questo giorno.</li>';
}
$('calGrid').onclick = e => { const b = e.target.closest('[data-d]'); if (!b) return; calSel = new Date(+b.dataset.d); if (calSel.getMonth() !== calMonth.getMonth()) calMonth = new Date(calSel.getFullYear(), calSel.getMonth(), 1); render(); };
$('calPrev').onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); render(); };
$('calNext').onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); render(); };

// ---------- Archivio ----------
function renderArchive(list) {
  $('archList').innerHTML = list.length ? list.map(n => noteItem(n, true)).join('') : '<li class="empty">L\'archivio è vuoto.</li>';
}
async function setArchived(n, on) {
  n.archived = on; n.done = on; n.keepActive = !on;
  await saveNote(n);
}

// ---------- Schede in basso ----------
let currentView = 'viewNotes';
document.querySelector('.tabs').onclick = e => {
  const t = e.target.closest('.tab'); if (!t) return;
  if (t.dataset.view === currentView && currentView === 'viewNotes') { openFolder = null; $('search').value = ''; filter = ''; document.querySelectorAll('.fchip').forEach(x => x.classList.toggle('on', !x.dataset.f)); }
  currentView = t.dataset.view;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t));
  for (const v of ['viewNotes', 'viewCal', 'viewStats', 'viewArch']) $(v).classList.toggle('hidden', v !== currentView);
  closeSwipe(); render(); scrollTo({ top: 0 });
};

$('folders').onclick = e => {
  const f = e.target.closest('.folder'); if (!f) return;
  openFolder = f.dataset.cat; localStorage.selCat = openFolder; fillCats(); render(); scrollTo({ top: 0 });
};
$('btnBack').onclick = () => { openFolder = null; render(); };
const openFromList = async e => {
  const li = e.target.closest('li'); if (!li) return;
  if (e.target.closest('.sdel')) return deleteWithUndo(li);
  if (e.target.closest('.sdone')) { const n = await DB.get(li.dataset.id); closeSwipe(); return setArchived(n, !n.archived); }
  if (e.target.closest('.smove')) { closeSwipe(); return openMove(li.dataset.id); }
  if (Date.now() - justSwiped < 400) return;
  if (openSwipe) return closeSwipe();            // tocco su una riga aperta = chiudi
  openNote(await DB.get(li.dataset.id));
};
$('notes').onclick = $('results').onclick = $('calList').onclick = $('archList').onclick = openFromList;

// ---------- Scorri: a sinistra Elimina, a destra Sposta (stile iPhone) ----------
const BTN_W = 92, ACT_W = 168, FULL = 0.6;
let sw = null, openSwipe = null, openX = 0, justSwiped = 0;
const setX = (li, x, anim) => {
  const sc = li.querySelector('.sc'), del = li.querySelector('.sacts'), mv = li.querySelector('.smove');
  sc.style.transition = del.style.transition = mv.style.transition = anim ? 'transform .25s ease, width .25s ease' : 'none';
  sc.style.transform = `translateX(${x}px)`;
  del.style.width = `${Math.max(0, -x)}px`; mv.style.width = `${Math.max(0, x)}px`;
  li.classList.toggle('full', Math.abs(x) > li.offsetWidth * FULL);
};
function closeSwipe() { if (openSwipe) { setX(openSwipe, 0, true); openSwipe.classList.remove('open'); } openSwipe = null; openX = 0; }
function onTouchStart(e) {
  const li = e.target.closest('li.swipe'); if (!li) return;
  if (openSwipe && openSwipe !== li) closeSwipe();
  const t = e.touches[0];
  sw = { li, x0: t.clientX, y0: t.clientY, base: openSwipe === li ? openX : 0, dir: null, dx: 0 };
}
function onTouchMove(e) {
  if (!sw) return;
  const t = e.touches[0], dx = t.clientX - sw.x0, dy = t.clientY - sw.y0;
  if (!sw.dir && Math.abs(dx) + Math.abs(dy) > 8) sw.dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
  if (sw.dir !== 'h') return;
  e.preventDefault();
  sw.dx = sw.base + dx;
  setX(sw.li, sw.dx);
}
function onTouchEnd() {
  if (!sw || sw.dir !== 'h') { sw = null; return; }
  const { li, dx } = sw; sw = null;
  justSwiped = Date.now(); // evita che il rilascio apra la nota
  const full = Math.abs(dx) > li.offsetWidth * FULL;
  if (full && dx < 0) return deleteWithUndo(li);
  if (full && dx > 0) { closeSwipe(); setX(li, 0, true); return openMove(li.dataset.id); }
  if (Math.abs(dx) > BTN_W / 2) { openX = dx < 0 ? -ACT_W : BTN_W; setX(li, openX, true); openSwipe = li; li.classList.add('open'); }
  else { setX(li, 0, true); openSwipe = null; openX = 0; }
}
for (const id of ['notes', 'results', 'calList', 'archList']) {
  $(id).addEventListener('touchstart', onTouchStart, { passive: true });
  $(id).addEventListener('touchmove', onTouchMove, { passive: false });
  $(id).addEventListener('touchend', onTouchEnd);
  $(id).addEventListener('touchcancel', onTouchEnd);
}

// Elimina con possibilità di annullare per qualche secondo
let undo = null;
async function deleteWithUndo(li) {
  const id = li.dataset.id;
  openSwipe = null;
  li.style.transition = 'height .25s ease, opacity .25s ease, margin .25s ease';
  li.style.height = li.offsetHeight + 'px';
  requestAnimationFrame(() => { li.style.height = '0px'; li.style.opacity = '0'; li.style.marginTop = '-12px'; });
  if (undo) await undo.commit();
  const note = await DB.get(id);
  await DB.del(id);
  const t = setTimeout(() => commit(), 4000);
  const commit = async () => { clearTimeout(t); $('toast').classList.add('hidden'); undo = null; Cloud.markDeleted(id); render(); };
  undo = { commit, restore: async () => { clearTimeout(t); $('toast').classList.add('hidden'); undo = null; await DB.put(note); render(); } };
  $('toast').classList.remove('hidden');
}
$('btnUndo').onclick = () => undo && undo.restore();
let toastT;
function showToast(msg) {
  const t = $('toast'); t.firstChild.textContent = msg + ' ';
  $('btnUndo').classList.add('hidden'); t.classList.remove('hidden');
  clearTimeout(toastT); toastT = setTimeout(() => { t.classList.add('hidden'); $('btnUndo').classList.remove('hidden'); t.firstChild.textContent = 'Nota eliminata '; }, 1800);
}
$('search').oninput = render;

// ---------- Sposta nota ----------
let moveId = null;
function openMove(id) {
  moveId = id;
  $('moveList').innerHTML = settings.cats.map(c =>
    `<button type="button" class="chip" style="--h:${hue(c)}" data-cat="${esc(c)}">${emoji(c)} ${esc(c)}</button>`).join('');
  $('moveDlg').showModal();
}
$('moveList').onclick = async e => {
  const b = e.target.closest('[data-cat]'); if (!b) return;
  const n = await DB.get(moveId);
  if (n) { n.category = b.dataset.cat; if (Smart.isShopping(n.category) && !n.items && n.text) n.items = Smart.parseList(n.text).map(t => ({ t, done: false })); await saveNote(n); }
  $('moveDlg').close();
};

// ---------- Nota scritta ----------
$('btnWrite').onclick = async () => {
  if (recording && !appendMode) { discardRec = true; await stop(); }
  openNote({ id: crypto.randomUUID(), created: Date.now(), category: selCat(), title: '', text: '', audio: null, draft: true });
  setTimeout(() => $('noteText').focus(), 150);
};

// ---------- Modifica raccolta (nome, emoji, colore) ----------
const EMOJIS = ['💡','🧠','💼','📔','🛒','🩺','⏰','📚','🏠','✈️','🍳','🏃','🐶','🐱','💊','🌸','🎨','🎵','🎬','💰','🎁','❤️','⭐','🌿','🧘','🍎','☕','📷','🛠️','👶','🎓','📝'];
let editCat = null, editHue = null;
function openCatEditor(c) {
  editCat = c; editHue = hue(c);
  $('catName').value = c; $('catEmoji').value = emoji(c);
  $('emojiGrid').innerHTML = EMOJIS.map(e => `<button type="button">${e}</button>`).join('');
  renderColors();
  $('catDlg').showModal();
}
function renderColors() {
  $('colorGrid').innerHTML = [250, 220, 200, 180, 160, 120, 50, 30, 0, 340, 320, 280].map(h =>
    `<button type="button" data-h="${h}" class="${h === editHue ? 'on' : ''}" style="--h:${h}" aria-label="Colore"></button>`).join('');
}
$('emojiGrid').onclick = e => { const b = e.target.closest('button'); if (b) $('catEmoji').value = b.textContent; };
$('colorGrid').onclick = e => { const b = e.target.closest('[data-h]'); if (b) { editHue = +b.dataset.h; renderColors(); } };
$('btnEditCat').onclick = () => openCatEditor(openFolder);
$('btnSaveCat').onclick = async () => {
  const name = $('catName').value.trim() || editCat;
  if (name !== editCat && settings.cats.includes(name)) return alert('Esiste già una raccolta con questo nome');
  const meta = catMeta(); delete meta[editCat];
  meta[name] = { emoji: $('catEmoji').value.trim() || '📁', hue: editHue };
  setCatMeta(meta);
  if (name !== editCat) {
    settings.cats = settings.cats.map(c => c === editCat ? name : c);
    for (const n of await DB.all()) if (n.category === editCat) { n.category = name; await saveNote(n); }
    if (localStorage.selCat === editCat) localStorage.selCat = name;
    if (openFolder === editCat) openFolder = name;
  }
  $('catDlg').close(); fillCats(); render();
};
$('btnDelCat').onclick = async () => {
  const count = (await DB.all()).filter(n => n.category === editCat).length;
  if (count) return alert(`La raccolta contiene ${count} ${count === 1 ? 'nota' : 'note'}: spostale o eliminale prima.`);
  if (!confirm(`Eliminare la raccolta "${editCat}"?`)) return;
  settings.cats = settings.cats.filter(c => c !== editCat);
  $('catDlg').close(); openFolder = null; fillCats(); render();
};

// ---------- Riordina le raccolte tenendo premuto ----------
if (window.Sortable) Sortable.create($('folders'), {
  animation: 180, delay: 350, delayOnTouchOnly: true, touchStartThreshold: 6,
  ghostClass: 'dragghost', chosenClass: 'dragchosen',
  onEnd: () => {
    const order = [...$('folders').querySelectorAll('.folder')].map(f => f.dataset.cat);
    settings.cats = [...order.filter(c => settings.cats.includes(c))];
    fillCats();
  },
});

// ---------- Dettaglio nota ----------
let current = null, audioURL = null;
function showAudio(blob) {
  if (audioURL) URL.revokeObjectURL(audioURL);
  audioURL = blob ? URL.createObjectURL(blob) : null;
  if (blob) $('noteAudio').src = audioURL;
  $('noteAudio').classList.toggle('hidden', !blob);
}
function openNote(n) {
  if (!n) return;
  current = n;
  $('noteTitle').value = n.title;
  $('noteCat').value = n.category;
  $('noteText').value = n.text;
  showAudio(n.audio);
  $('btnLoadAudio').classList.toggle('hidden', !!n.audio || !n.hasAudio);
  $('btnRetry').classList.toggle('hidden', IS_IOS || !(n.audio && !n.pending && (n.failed || !n.text)));
  if (Smart.isShopping(n.category) && !n.items && n.text) n.items = Smart.parseList(n.text).map(t => ({ t, done: false }));
  renderChecklist();
  renderEvent();
  setToolLabels();
  $('noteMeta').textContent = n.draft ? 'Nuova nota' : `${fmtDate(n.created)}${n.archived ? ' · Archiviata' : ''}`;
  caret = null;
  $('addItem').placeholder = isList() ? 'Aggiungi alla lista…' : 'Aggiungi testo alla nota…';
  $('appendLive').classList.add('hidden');
  $('noteDlg').showModal();
}
// Lista spuntabile
function renderChecklist() {
  const items = current.items || [];
  $('checklist').classList.toggle('hidden', !items.length);
  $('checklist').innerHTML = items.map((it, i) =>
    `<li class="${it.done ? 'done' : ''}" data-i="${i}"><span class="box">${it.done ? '✓' : ''}</span><span class="it">${esc(it.t)}</span><button type="button" class="rm" aria-label="Togli">✕</button></li>`).join('');
}
$('checklist').onclick = async e => {
  const li = e.target.closest('li'); if (!li) return;
  const i = +li.dataset.i;
  if (e.target.closest('.rm')) current.items.splice(i, 1);
  else current.items[i].done = !current.items[i].done;
  renderChecklist(); await saveNote(current);
};
// Aggiungere a una nota esistente: scrivendo o a voce
const isList = () => Smart.isShopping($('noteCat').value) || !!current.items?.length;
function syncFromForm() {
  Object.assign(current, { title: $('noteTitle').value, category: $('noteCat').value, text: $('noteText').value });
  if (current.text.trim()) { delete current.draft; if (!current.title.trim()) current.title = makeTitle(current.text); }
}
async function appendText(t) {
  t = t.trim(); if (!t) return;
  t = t[0].toUpperCase() + t.slice(1);
  const ta = $('noteText');
  if (!isList() && caret != null && caret < ta.value.length) {
    const before = ta.value.slice(0, caret), after = ta.value.slice(caret);
    const ins = (before && !/\s$/.test(before) ? ' ' : '') + (before.trim() && !/[.!?]\s*$/.test(before) ? t[0].toLowerCase() + t.slice(1) : t) + (after && !/^\s/.test(after) ? ' ' : '');
    ta.value = before + ins + after; caret += ins.length;
  } else ta.value = ta.value.trim() ? ta.value.trim().replace(/[.!?]?$/, m => m || '.') + ' ' + t : t;
  if (isList()) {
    const have = new Set((current.items || []).map(i => i.t.toLowerCase()));
    current.items = [...(current.items || []), ...Smart.parseList(t).filter(x => !have.has(x.toLowerCase())).map(x => ({ t: x, done: false }))];
  }
  syncFromForm(); renderChecklist(); renderEvent();
  await saveNote(current);
}
$('addItemForm').onsubmit = async e => {
  e.preventDefault();
  const v = $('addItem').value.trim(); if (!v) return;
  $('addItem').value = '';
  if (isList()) {
    current.items = [...(current.items || []), ...v.split(/[,;]/).map(x => x.trim()).filter(Boolean).map(x => ({ t: x[0].toUpperCase() + x.slice(1), done: false }))];
    syncFromForm(); renderChecklist(); await saveNote(current);
  } else await appendText(v);
};
$('btnAppendRec').onclick = () => {
  if (recording) return appendMode ? stop() : null;
  appendMode = true; start();
};
async function finishAppend(text, audio) {
  const box = $('appendLive');
  if (!text && audio && !IS_IOS) {
    try { text = (await runWhisper(audio, m => box.textContent = m)).trim(); }
    catch (e) { box.textContent = '⚠️ ' + e.message; return; }
  }
  box.textContent = ''; box.classList.add('hidden');
  if (text) await appendText(text);
}
$('noteDlg').addEventListener('close', async () => {
  if (recording && appendMode) await stop();
  // una nota scritta lasciata vuota non viene tenuta
  if (current?.draft && !current.text?.trim() && !current.title?.trim() && !current.items?.length) {
    if (await DB.get(current.id)) { await DB.del(current.id); Cloud.markDeleted(current.id); }
    render();
  }
});
function setToolLabels() {
  $('btnPinNote').innerHTML = `<span>${current.pinned ? '📍' : '📌'}</span><small>${current.pinned ? 'Sgancia' : 'Fissa'}</small>`;
  $('btnDone').innerHTML = `<span>${current.archived ? '↩️' : '✓'}</span><small>${current.archived ? 'Ripristina' : 'Fatto'}</small>`;
}
$('btnDone').onclick = async () => {
  syncFromForm(); delete current.draft;
  await setArchived(current, !current.archived);
  $('noteDlg').close();
  showToast(current.archived ? 'Archiviata ✓' : 'Ripristinata');
};
$('btnCloseNote').onclick = () => $('noteDlg').close();
$('btnPinNote').onclick = async () => {
  syncFromForm(); current.pinned = !current.pinned;
  setToolLabels();
  await saveNote(current);
};
// Inserire nel punto del testo toccato
let caret = null;
for (const ev of ['click', 'keyup', 'select']) $('noteText').addEventListener(ev, () => { caret = $('noteText').selectionStart; });
// Evento da calendario
let currentEvent = null;
function renderEvent() {
  currentEvent = Smart.parseEvent($('noteText').value, new Date(current.created));
  $('eventBox').classList.toggle('hidden', !currentEvent);
  if (!currentEvent) return;
  $('evTitle').textContent = currentEvent.title;
  $('evWhen').textContent = Smart.fmtEvent(currentEvent);
}
$('noteText').addEventListener('input', () => renderEvent());
$('eventBox').onclick = e => {
  const b = e.target.closest('[data-cal]'); if (!b || !currentEvent) return;
  const url = Smart.calendarLink(b.dataset.cal, currentEvent, $('noteText').value);
  if (b.dataset.cal === 'apple') { const a = document.createElement('a'); a.href = url; a.download = 'evento.ics'; a.click(); }
  else window.open(url, '_blank');
};
$('btnLoadAudio').onclick = async () => {
  const b = $('btnLoadAudio'); b.disabled = true; b.textContent = '⏳ Scarico…';
  try {
    current.audio = await Cloud.fetchAudio(current);
    current.audioSynced = true;
    await DB.put(current); showAudio(current.audio); b.classList.add('hidden');
  } catch (e) { alert('Audio non disponibile: ' + e.message); }
  b.disabled = false; b.textContent = '🔊 Scarica audio';
};
const exportText = () => `${$('noteTitle').value}\n[${$('noteCat').value}]\n\n${$('noteText').value}`;

$('btnSave').onclick = async () => {
  const text = $('noteText').value, category = $('noteCat').value;
  if (Smart.isShopping(category) && (text !== current.text || !current.items)) {
    const old = Object.fromEntries((current.items || []).map(i => [i.t.toLowerCase(), i.done]));
    current.items = Smart.parseList(text).map(t => ({ t, done: !!old[t.toLowerCase()] }));
  }
  Object.assign(current, { title: $('noteTitle').value.trim() || (text ? makeTitle(text) : 'Nota'), category, text });
  if (!text.trim() && !current.items?.length && current.draft) return $('noteDlg').close();
  delete current.draft;
  await saveNote(current); $('noteDlg').close();
};
$('btnRetry').onclick = async () => {
  Object.assign(current, { pending: true, failed: false, attempts: 0 });
  await saveNote(current); $('noteDlg').close(); transcribe(current);
};
$('btnDelete').onclick = async () => {
  if (!confirm('Eliminare questa nota?')) return;
  await DB.del(current.id); Cloud.markDeleted(current.id); $('noteDlg').close(); render();
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

// ---------- Impostazioni ----------
function openSettings() {
  $('model').value = settings.model;
  $('modelRow').classList.toggle('hidden', IS_IOS);
  $('privacyInfo').textContent = liveLocalInfo;
  $('catsInput').value = settings.cats.join('\n');
  $('nameInput').value = localStorage.name || '';
  $('accountBox').classList.toggle('hidden', !Cloud.enabled);
  $('btnLogout').classList.toggle('hidden', !Cloud.enabled);
  $('accountEmail').textContent = Cloud.email;
  $('settingsDlg').showModal();
}
$('btnSettings').onclick = openSettings;
$('btnSaveSettings').onclick = () => {
  settings.model = $('model').value;
  localStorage.name = $('nameInput').value.trim();
  const cats = $('catsInput').value.split('\n').map(s => s.trim()).filter(Boolean);
  settings.cats = cats.length ? cats : DEFAULT_CATS;
  fillCats(); render();
};
$('btnLogout').onclick = async () => {
  if (!confirm('Uscire? Le note restano salvate nel tuo account e le ritrovi quando accedi di nuovo.')) return;
  $('settingsDlg').close();
  await Cloud.logout();
  showAuth();
};

// ---------- Sincronizzazione: indicatore ----------
Cloud.onChange = () => { fillCats(); render(); };
Cloud.onStatus = (s, msg) => {
  const map = { sync: ['⏳ Salvo…', 'Sincronizzazione…'], ok: ['☁️ Salvato', 'Note salvate nel tuo account (cifrate)'], error: ['⚠️ Non salvato', 'Sincronizzazione non riuscita: ' + (msg || '') + '. Riprovo da sola.'] };
  $('syncIcon').textContent = map[s][0]; $('syncIcon').title = map[s][1]; $('syncIcon').classList.remove('hidden');
  $('syncText').textContent = map[s][1];
};

// ---------- Saluto, data, meteo ----------
function renderHeader() {
  const name = localStorage.name;
  $('hello').textContent = name ? `Ciao, ${name} 👋` : 'Ciao 👋';
  const d = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  $('today').textContent = d[0].toUpperCase() + d.slice(1);
}
async function renderWeather(force) {
  try {
    const w = await Weather.load(force);
    if (w) { $('weather').innerHTML = `<span>${w.icon}</span><span>${w.temp}°</span>`; $('weather').title = w.label; }
    else $('weather').innerHTML = '<span>📍</span>';
  } catch { }
}
$('weather').onclick = () => {
  const w = JSON.parse(localStorage.wx || 'null');
  if (w) alert(`${w.icon} ${w.label}, ${w.temp}°C`);
  renderWeather(true);
};
function askName() {
  if (localStorage.name || localStorage.nameAsked) return;
  localStorage.nameAsked = 1;
  const n = (prompt('Come ti chiami?') || '').trim();
  if (n) { localStorage.name = n; localStorage.catsUpdated = Date.now(); Cloud.schedule(); renderHeader(); }
}

// ---------- Account ----------
function showAuth(msg) {
  locked = true;
  $('lock').classList.remove('hidden');
  $('lockForm').classList.add('hidden');
  $('authForm').classList.remove('hidden');
  $('notes').innerHTML = $('results').innerHTML = $('folders').innerHTML = $('calList').innerHTML = $('archList').innerHTML = $('upcoming').innerHTML = '';
  if (msg) $('authMsg').textContent = msg;
}
async function doAuth(signup) {
  const email = $('authEmail').value.trim(), pass = $('authPass').value;
  if (!email || pass.length < 6) return $('authMsg').textContent = 'Inserisci email e password (almeno 6 caratteri)';
  $('btnLogin').disabled = $('btnSignup').disabled = true;
  $('authMsg').textContent = '⏳ Un momento…';
  try {
    const r = await Cloud.login(email, pass, signup);
    if (r === 'confirm') $('authMsg').textContent = '📧 Ti ho mandato una email: aprila, conferma, poi torna qui e premi Accedi.';
    else { $('authPass').value = ''; localStorage.lastSeen = 0; lock(); }
  } catch (e) { $('authMsg').textContent = '⚠️ ' + e.message; }
  $('btnLogin').disabled = $('btnSignup').disabled = false;
}
$('authForm').onsubmit = e => { e.preventDefault(); doAuth(false); };
$('btnSignup').onclick = () => doAuth(true);

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
  $('btnFaceId').classList.toggle('hidden', !(pinStep === 'unlock' && localStorage.credId));
  $('notes').innerHTML = $('results').innerHTML = $('folders').innerHTML = $('calList').innerHTML = $('archList').innerHTML = $('upcoming').innerHTML = '';
  $('noteDlg').open && $('noteDlg').close();
  $('settingsDlg').open && $('settingsDlg').close();
  $('lock').classList.remove('hidden');
  $('authForm').classList.add('hidden');
  $('lockForm').classList.remove('hidden');
  $('pinInput').value = '';
  if (pinStep === 'unlock' && localStorage.credId) faceIdUnlock(true);
  else setTimeout(() => $('pinInput').focus(), 50);
}
function unlock() {
  locked = false; $('lock').classList.add('hidden'); render(); Cloud.sync && Cloud.sync();
  renderWeather();
  setTimeout(askName, Cloud.enabled ? 2500 : 300); // prima lascia arrivare il nome dall'account
  if (!localStorage.credId && !localStorage.faceIdAsked && window.PublicKeyCredential) {
    localStorage.faceIdAsked = 1;
    if (confirm('Vuoi sbloccare l\'app con Face ID?')) setupFaceId();
  }
}

// Face ID / impronta tramite passkey del telefono (verifica fatta dal telefono, nulla viene inviato)
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function setupFaceId() {
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Note Vocali' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'Note Vocali', displayName: 'Note Vocali' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000,
    }});
    localStorage.credId = b64(cred.rawId);
    alert('Face ID attivato ✅');
  } catch (e) { alert('Face ID non attivato: ' + e.message); }
}
async function faceIdUnlock(silent) {
  try {
    await navigator.credentials.get({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: unb64(localStorage.credId) }],
      userVerification: 'required', timeout: 60000,
    }});
    unlock();
  } catch (e) { if (!silent) $('lockMsg').textContent = 'Face ID non riuscito, usa il PIN'; }
}
$('btnFaceId').onclick = () => faceIdUnlock(false);
$('btnFaceIdSetup').onclick = setupFaceId;
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
// Blocca solo se l'app resta in background più di 5 minuti
const LOCK_AFTER = 5 * 60 * 1000;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (!locked) localStorage.lastSeen = Date.now(); }
  else if (!locked && Date.now() - (+localStorage.lastSeen || 0) > LOCK_AFTER) lock();
});
window.addEventListener('pagehide', () => { if (!locked) localStorage.lastSeen = Date.now(); });


// ---------- Info privacy ----------
let liveLocalInfo = '';
checkLocalSR().then(ok => {
  liveLocalInfo = '🔐 ' + (Cloud.enabled ? 'Note e audio sono cifrati sul telefono prima di essere salvati nel tuo account: nessuno, nemmeno il server, può leggerli. ' : 'Note e audio restano solo su questo telefono. ') + (ok
    ? 'Trascrizione in diretta eseguita sul telefono.'
    : useApple() ? 'Trascrizione con la dettatura Apple: l\'audio può passare dai server Apple in forma anonima (mai Google).'
    : 'Trascrizione eseguita sul telefono con Whisper, dopo lo stop. Da internet si scarica solo il modello, una volta.');
});

// ---------- Avvio ----------
(async () => {
  if (navigator.storage?.persist) navigator.storage.persist();
  fillCats();
  const st = await Cloud.init();
  if (st === 'need-login') return showAuth();
  if (localStorage.pinHash && Date.now() - (+localStorage.lastSeen || 0) < LOCK_AFTER) unlock(); else lock();
  // Riprende trascrizioni rimaste a metà
  (await DB.all()).filter(n => n.pending && n.audio).forEach(transcribe);
})();
document.addEventListener('visibilitychange', () => { if (!document.hidden && !locked) Cloud.sync(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
