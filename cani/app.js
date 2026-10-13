// ---------- Diario Cani: crisi epilettiche, terapie, analisi, vaccini ----------
const DOGS = [
  { id: 'kafka', name: 'Kafka', eta: '5 anni', epi: true },
  { id: 'zoe', name: 'Zoe', eta: '10 anni', epi: false },
];

const SINTOMI = ['Perdita di coscienza', 'Pedalamento', 'Rigidità', 'Salivazione', 'Perdita urine', 'Perdita feci', 'Vocalizzi', 'Masticazione a vuoto', 'Tremori', 'Disorientamento dopo', 'Cecità temporanea', 'Fame/sete dopo'];
const TRIGGER = ['Durante il sonno', 'Al risveglio', 'Eccitazione', 'Stress', 'Caldo', 'Dopo il pasto', 'Dose saltata', 'Nessuno noto'];

// Ogni tipo di voce: icona, nome, campi del modulo e riga di riepilogo
const KINDS = {
  crisi: {
    ic: '⚡', name: 'Crisi', only: 'epi',
    fields: [
      { k: 'date', l: 'Giorno', t: 'date' }, { k: 'time', l: 'Ora', t: 'time' },
      { k: 'quante', l: 'Quante crisi (nello stesso episodio)', t: 'num', def: 1 },
      { k: 'dur', l: 'Durata (min e sec)', t: 'dur' },
      { k: 'tipo', l: 'Tipo', t: 'select', o: ['Generalizzata (tonico-clonica)', 'Focale', 'Focale → generalizzata', 'Assenza / lieve', 'Non so'] },
      { k: 'intensita', l: 'Intensità', t: 'stars' },
      { k: 'post', l: 'Fase post-crisi (minuti)', t: 'num' },
      { k: 'sintomi', l: 'Com\'è stata', t: 'chips', o: SINTOMI },
      { k: 'trigger', l: 'Possibile causa', t: 'chips', o: TRIGGER },
      { k: 'emergenza', l: 'Farmaco d\'emergenza dato', t: 'text', ph: 'es. diazepam rettale 10 mg' },
      { k: 'note', l: 'Note', t: 'area' },
    ],
    sum: d => [d.quante > 1 ? d.quante + ' crisi' : '', fmtDur(d.durSec), d.tipo].filter(Boolean).join(' · '),
  },
  terapia: {
    ic: '💊', name: 'Terapia / dose',
    fields: [
      { k: 'date', l: 'Dal giorno', t: 'date' },
      { k: 'farmaco', l: 'Farmaco', t: 'text', ph: 'es. Fenobarbital', list: 'farmaci' },
      { k: 'dose', l: 'Dose', t: 'text', ph: 'es. 30' },
      { k: 'unita', l: 'Unità', t: 'select', o: ['mg', 'ml', 'compresse', 'gocce', 'mg/kg'] },
      { k: 'freq', l: 'Quante volte', t: 'select', o: ['1 volta al giorno', '2 volte al giorno', '3 volte al giorno', 'Al bisogno', 'Altro'] },
      { k: 'orari', l: 'Orari', t: 'text', ph: 'es. 8:00 e 20:00' },
      { k: 'sospeso', l: 'Stato', t: 'select', o: ['In corso', 'Sospeso'] },
      { k: 'motivo', l: 'Motivo del cambio', t: 'text' },
      { k: 'note', l: 'Note', t: 'area' },
    ],
    title: d => d.farmaco || 'Terapia',
    sum: d => d.sospeso === 'Sospeso' ? 'Sospeso' : [d.dose && d.dose + ' ' + (d.unita || ''), d.freq].filter(Boolean).join(' · '),
  },
  analisi: {
    ic: '🩸', name: 'Analisi',
    fields: [
      { k: 'date', l: 'Giorno', t: 'date' },
      { k: 'tipo', l: 'Tipo', t: 'select', o: ['Emocromo + biochimico', 'Livello fenobarbital nel sangue', 'Livello bromuro', 'Funzionalità epatica', 'Urine', 'Tiroide', 'Ecografia', 'Altro'] },
      { k: 'valore', l: 'Valore principale', t: 'text', ph: 'es. 28 µg/ml' },
      { k: 'esito', l: 'Esito', t: 'select', o: ['Nella norma', 'Da controllare', 'Alterato'] },
      { k: 'risultati', l: 'Risultati / valori fuori norma', t: 'area' },
      { k: 'prossime', l: 'Prossime analisi', t: 'date' },
    ],
    title: d => d.tipo || 'Analisi',
    sum: d => [d.valore, d.esito].filter(Boolean).join(' · '),
  },
  vaccino: {
    ic: '💉', name: 'Vaccino / antiparassitario',
    fields: [
      { k: 'date', l: 'Giorno', t: 'date' },
      { k: 'nome', l: 'Cosa', t: 'text', ph: 'es. Polivalente, Rabbia, Leishmania', list: 'vaccini' },
      { k: 'richiamo', l: 'Prossimo richiamo', t: 'date' },
      { k: 'note', l: 'Note', t: 'area' },
    ],
    title: d => d.nome || 'Vaccino',
    sum: d => d.richiamo ? 'Richiamo ' + fmtDate(d.richiamo) : '',
  },
  salute: {
    ic: '🤒', name: 'Problema / sintomo',
    fields: [
      { k: 'date', l: 'Giorno', t: 'date' }, { k: 'time', l: 'Ora', t: 'time' },
      { k: 'titolo', l: 'Cosa è successo', t: 'text', ph: 'es. vomito, zoppia, non mangia' },
      { k: 'gravita', l: 'Gravità', t: 'stars' },
      { k: 'farmaco', l: 'Farmaco dato', t: 'text' },
      { k: 'risolto', l: 'Stato', t: 'select', o: ['In corso', 'Risolto'] },
      { k: 'note', l: 'Note', t: 'area' },
    ],
    title: d => d.titolo || 'Problema',
    sum: d => [d.farmaco, d.risolto].filter(Boolean).join(' · '),
  },
  visita: {
    ic: '🩺', name: 'Visita veterinaria',
    fields: [
      { k: 'date', l: 'Giorno', t: 'date' },
      { k: 'motivo', l: 'Motivo', t: 'text', ph: 'es. controllo epilessia' },
      { k: 'peso', l: 'Peso (kg)', t: 'num', step: '0.1' },
      { k: 'esito', l: 'Cosa ha detto il veterinario', t: 'area' },
      { k: 'prossima', l: 'Prossima visita', t: 'date' },
    ],
    title: d => d.motivo || 'Visita',
    sum: d => [d.peso && d.peso + ' kg', d.prossima && 'Prossima ' + fmtDate(d.prossima)].filter(Boolean).join(' · '),
  },
};

// ---------- utilità ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const toDate = (d, t) => new Date(`${d}T${t || '12:00'}`);
const fmtDate = d => d ? toDate(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const fmtDur = s => !s ? '' : s < 60 ? s + ' s' : Math.floor(s / 60) + ' min' + (s % 60 ? ' ' + (s % 60) + ' s' : '');
const DAY = 864e5;
const daysBetween = (a, b) => Math.round((b - a) / DAY);
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
const titleOf = r => (KINDS[r.kind].title || (() => KINDS[r.kind].name))(r.data);
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2200); }

// ---------- dati: locale + Supabase ----------
const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
let records = LS.get('cani.records', {});
let pending = new Set(LS.get('cani.pending', []));
const C = window.CONFIG || {};
const sb = C.supabaseUrl && window.supabase ? supabase.createClient(C.supabaseUrl, C.supabaseKey) : null;
let user = null;

function persist() { LS.set('cani.records', records); LS.set('cani.pending', [...pending]); }
function setSync(state) { const s = $('#sync'); s.className = 'sync ' + state; s.title = { '': 'Sincronizzato', busy: 'Sincronizzo…', off: 'Non sincronizzato: riprovo appena c\'è rete' }[state]; }

async function pull() {
  if (!sb || !user) return;
  const { data, error } = await sb.from('pet_records').select('*');
  if (error) throw error;
  for (const r of data) if (!records[r.id] || r.updated > records[r.id].updated) records[r.id] = { id: r.id, dog: r.dog, kind: r.kind, data: r.data, deleted: r.deleted, updated: r.updated };
  persist();
}
async function push() {
  if (!sb || !user || !pending.size) return;
  const rows = [...pending].map(id => records[id]).filter(Boolean).map(r => ({ id: r.id, dog: r.dog, kind: r.kind, data: r.data, deleted: !!r.deleted, updated: r.updated }));
  const { error } = await sb.from('pet_records').upsert(rows);
  if (error) throw error;
  rows.forEach(r => pending.delete(r.id)); persist();
}
async function sync() {
  setSync('busy');
  try { await push(); await pull(); setSync(''); render(); }
  catch (e) { console.warn(e); setSync('off'); }
}
function save(rec) {
  rec.updated = Date.now(); records[rec.id] = rec; pending.add(rec.id); persist(); render(); sync();
}
const list = (dog, kind) => Object.values(records)
  .filter(r => !r.deleted && r.dog === dog && (!kind || r.kind === kind))
  .sort((a, b) => toDate(b.data.date, b.data.time) - toDate(a.data.date, a.data.time));

// ---------- stato interfaccia ----------
let dog = LS.get('cani.dog', 'kafka'), tab = 'home', filter = '', range = 6;
const curDog = () => DOGS.find(d => d.id === dog);
const kindsFor = d => Object.entries(KINDS).filter(([, k]) => !k.only || d[k.only]);

function renderSeg() {
  $('#dogSeg').innerHTML = DOGS.map(d => `<button data-dog="${d.id}" class="${d.id === dog ? 'on' : ''}">${d.name}</button>`).join('');
  document.body.classList.toggle('zoe', dog === 'zoe');
}

function itemHTML(r) {
  const k = KINDS[r.kind];
  return `<div class="item" data-id="${r.id}"><div class="ic">${k.ic}</div>
    <div class="tx"><b>${esc(r.kind === 'crisi' ? 'Crisi' : titleOf(r))}</b><small>${esc(k.sum(r.data)) || '&nbsp;'}</small></div>
    <div class="dt">${esc(fmtDate(r.data.date))}${r.data.time ? '<br>' + esc(r.data.time) : ''}</div></div>`;
}
const listHTML = arr => `<div class="glass list">${arr.length ? arr.map(itemHTML).join('') : '<div class="empty">Ancora niente qui</div>'}</div>`;

// terapia attuale = ultima voce per ogni farmaco, se non sospesa
function currentTherapy(d) {
  const seen = {}, out = [];
  for (const r of list(d, 'terapia')) { const f = (r.data.farmaco || '').trim().toLowerCase(); if (seen[f]) continue; seen[f] = 1; if (r.data.sospeso !== 'Sospeso') out.push(r); }
  return out;
}
function upcoming(d) {
  const t = today(), out = [];
  for (const r of list(d)) {
    const due = r.data.richiamo || r.data.prossime || r.data.prossima;
    if (due && due >= t) out.push({ r, due });
  }
  // tieni solo la scadenza più recente per ogni voce con lo stesso nome
  const seen = {};
  return out.sort((a, b) => a.due.localeCompare(b.due)).filter(x => { const k = x.r.kind + titleOf(x.r); return seen[k] ? false : (seen[k] = 1); });
}

// ---------- statistiche crisi ----------
function seizureStats(d, months) {
  const all = list(d, 'crisi');
  const from = months ? new Date(new Date().getFullYear(), new Date().getMonth() - months + 1, 1) : (all.length ? toDate(all[all.length - 1].data.date) : new Date());
  const rs = all.filter(r => toDate(r.data.date) >= from);
  const n = r => +r.data.quante || 1;
  const total = rs.reduce((s, r) => s + n(r), 0);
  const days = {}; rs.forEach(r => days[r.data.date] = (days[r.data.date] || 0) + n(r));
  const durs = rs.map(r => r.data.durSec).filter(Boolean);
  const times = rs.map(r => toDate(r.data.date, r.data.time)).sort((a, b) => a - b);
  const gaps = times.slice(1).map((t, i) => (t - times[i]) / DAY);
  const spanMonths = Math.max(1, (Date.now() - from) / (30.44 * DAY));
  return {
    all, rs, from, total,
    giorni: Object.keys(days).length,
    cluster: Object.values(days).filter(v => v >= 2).length,
    durMedia: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0,
    durMax: durs.length ? Math.max(...durs) : 0,
    gapMedio: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0,
    alMese: total / spanMonths,
    last: all[0] ? toDate(all[0].data.date, all[0].data.time) : null,
  };
}
function monthsFrom(from) {
  const out = [], d = new Date(from.getFullYear(), from.getMonth(), 1), end = new Date();
  while (d <= end) { out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); d.setMonth(d.getMonth() + 1); }
  return out;
}

// grafico a barre SVG; marks = indici dove disegnare un segno (cambio dose)
function barChart(items, { marks = [], color = 'var(--accent, #6c5cff)', h = 150 } = {}) {
  const W = 320, H = h, pl = 22, pb = 22, pt = 10, n = Math.max(items.length, 1);
  const max = Math.max(1, ...items.map(i => i.v)), bw = (W - pl) / n;
  const step = max <= 5 ? 1 : Math.ceil(max / 4);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let y = 0; y <= max; y += step) { const yy = H - pb - (H - pb - pt) * y / max; s += `<line x1="${pl}" x2="${W}" y1="${yy}" y2="${yy}" stroke="currentColor" stroke-opacity=".1"/><text x="${pl - 4}" y="${yy + 3}" text-anchor="end">${y}</text>`; }
  marks.forEach(i => { const x = pl + bw * i + bw / 2; s += `<line x1="${x}" x2="${x}" y1="${pt}" y2="${H - pb}" stroke="#ff7eb3" stroke-width="1.5" stroke-dasharray="3 3"/><path d="M${x - 4} ${pt - 2}h8l-4 6z" fill="#ff7eb3"/>`; });
  const every = Math.ceil(n / 12);
  items.forEach((it, i) => {
    const bh = (H - pb - pt) * it.v / max, x = pl + bw * i + bw * .18, w = bw * .64;
    if (it.v) s += `<rect x="${x}" y="${H - pb - bh}" width="${w}" height="${bh}" rx="${Math.min(4, w / 2)}" fill="${color}"><title>${esc(it.l)}: ${it.v}</title></rect>`;
    if (i % every === 0) s += `<text x="${x + w / 2}" y="${H - 7}" text-anchor="middle">${esc(it.l)}</text>`;
  });
  return s + '</svg>';
}
function seizureMonthChart(d, st) {
  const ms = monthsFrom(st.from), counts = Object.fromEntries(ms.map(m => [m, 0]));
  st.rs.forEach(r => { const m = r.data.date.slice(0, 7); if (m in counts) counts[m] += +r.data.quante || 1; });
  const marks = [...new Set(list(d, 'terapia').map(r => ms.indexOf(r.data.date.slice(0, 7))).filter(i => i >= 0))];
  const lbl = m => new Date(m + '-01T12:00').toLocaleDateString('it-IT', { month: 'short' }).replace('.', '');
  return barChart(ms.map(m => ({ l: lbl(m), v: counts[m] })), { marks });
}
function hourChart(st) {
  const b = Array(8).fill(0);
  st.rs.forEach(r => { if (r.data.time) b[Math.floor(+r.data.time.slice(0, 2) / 3)] += +r.data.quante || 1; });
  return barChart(b.map((v, i) => ({ l: `${i * 3}-${i * 3 + 3}`, v })), { color: '#7fbfff', h: 130 });
}
function hbars(counts) {
  const e = Object.entries(counts).sort((a, b) => b[1] - a[1]); if (!e.length) return '<p class="muted">Nessun dato</p>';
  const max = e[0][1];
  return e.map(([k, v]) => `<div style="margin:6px 0"><div style="display:flex;justify-content:space-between;font-size:.85rem"><span>${esc(k)}</span><b>${v}</b></div>
    <div style="height:8px;border-radius:4px;background:var(--line)"><div style="height:100%;width:${v / max * 100}%;border-radius:4px;background:var(--accent)"></div></div></div>`).join('');
}
const countBy = (rs, f) => rs.reduce((o, r) => { [].concat(f(r) || []).forEach(k => o[k] = (o[k] || 0) + 1); return o; }, {});

// ---------- viste ----------
function viewHome() {
  const d = curDog(); let h = '';
  if (d.epi) {
    const st = seizureStats(dog, 1), st3 = seizureStats(dog, 3);
    const senza = st.last ? Math.max(0, daysBetween(st.last, new Date())) : '—';
    h += `<div class="tiles">
      <div class="glass tile"><b>${senza}</b><small>giorni senza crisi</small></div>
      <div class="glass tile"><b>${st.total}</b><small>crisi questo mese</small></div>
      <div class="glass tile"><b>${st3.alMese.toFixed(1)}</b><small>crisi/mese (3 mesi)</small></div>
      <div class="glass tile"><b>${fmtDur(st3.durMedia) || '—'}</b><small>durata media</small></div>
    </div>`;
  } else {
    const probs = list(dog, 'salute').filter(r => r.data.risolto !== 'Risolto').length;
    const v = list(dog, 'visita')[0];
    h += `<div class="tiles">
      <div class="glass tile"><b>${probs}</b><small>problemi in corso</small></div>
      <div class="glass tile"><b>${v ? daysBetween(toDate(v.data.date), new Date()) : '—'}</b><small>giorni dall'ultima visita</small></div>
    </div>`;
  }
  const th = currentTherapy(dog);
  h += `<h3>Terapia attuale</h3>` + listHTML(th);
  const up = upcoming(dog).slice(0, 5);
  h += `<h3>In arrivo</h3><div class="glass list">${up.length ? up.map(({ r, due }) => `<div class="item" data-id="${r.id}"><div class="ic">${KINDS[r.kind].ic}</div><div class="tx"><b>${esc(titleOf(r))}</b><small>${daysBetween(new Date(), toDate(due))} giorni</small></div><div class="dt">${esc(fmtDate(due))}</div></div>`).join('') : '<div class="empty">Nessuna scadenza</div>'}</div>`;
  h += `<h3>Ultime voci</h3>` + listHTML(list(dog).slice(0, 6));
  return h;
}

function viewDiario() {
  const kinds = kindsFor(curDog());
  let h = `<div class="filters"><button class="pill ${!filter ? 'on' : ''}" data-filter="">Tutto</button>${kinds.map(([id, k]) => `<button class="pill ${filter === id ? 'on' : ''}" data-filter="${id}">${k.ic} ${k.name}</button>`).join('')}</div>`;
  const rs = list(dog, filter || undefined);
  if (!rs.length) return h + listHTML([]);
  const groups = {};
  rs.forEach(r => (groups[r.data.date.slice(0, 7)] ||= []).push(r));
  for (const [m, arr] of Object.entries(groups)) h += `<h3>${new Date(m + '-01T12:00').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}</h3>` + listHTML(arr);
  return h;
}

const RANGES = [[3, '3 mesi'], [6, '6 mesi'], [12, '1 anno'], [0, 'Tutto']];
const rangePills = () => `<div class="filters">${RANGES.map(([v, l]) => `<button class="pill ${range === v ? 'on' : ''}" data-range="${v}">${l}</button>`).join('')}</div>`;

function seizureStatsHTML(st) {
  return `<div class="tiles">
    <div class="glass tile"><b>${st.total}</b><small>crisi totali</small></div>
    <div class="glass tile"><b>${st.alMese.toFixed(1)}</b><small>media al mese</small></div>
    <div class="glass tile"><b>${st.giorni}</b><small>giorni con crisi</small></div>
    <div class="glass tile"><b>${st.cluster}</b><small>giorni con 2+ crisi (cluster)</small></div>
    <div class="glass tile"><b>${st.gapMedio ? st.gapMedio.toFixed(1) : '—'}</b><small>giorni medi tra crisi</small></div>
    <div class="glass tile"><b>${fmtDur(st.durMedia) || '—'}</b><small>durata media (max ${fmtDur(st.durMax) || '—'})</small></div>
  </div>`;
}

function viewStats() {
  const d = curDog(); let h = rangePills();
  if (d.epi) {
    const st = seizureStats(dog, range);
    h += seizureStatsHTML(st);
    h += `<div class="glass card chart"><h2>Crisi per mese</h2>${seizureMonthChart(dog, st)}
      <div class="legend"><span><i style="background:var(--accent)"></i>Crisi</span><span><i style="background:#ff7eb3"></i>Cambio terapia</span></div></div>`;
    h += `<div class="glass card chart"><h2>A che ora</h2>${hourChart(st)}</div>`;
    h += `<div class="glass card"><h2>Tipo di crisi</h2>${hbars(countBy(st.rs, r => r.data.tipo))}</div>`;
    h += `<div class="glass card"><h2>Possibili cause</h2>${hbars(countBy(st.rs, r => r.data.trigger))}</div>`;
    h += `<div class="glass card"><h2>Sintomi più frequenti</h2>${hbars(countBy(st.rs, r => r.data.sintomi))}</div>`;
  }
  // per tutti: problemi per mese e conteggi
  const from = range ? new Date(new Date().getFullYear(), new Date().getMonth() - range + 1, 1) : (list(dog).length ? toDate(list(dog).at(-1).data.date) : new Date());
  const rs = list(dog).filter(r => toDate(r.data.date) >= from);
  const ms = monthsFrom(from), c = Object.fromEntries(ms.map(m => [m, 0]));
  rs.filter(r => r.kind === 'salute').forEach(r => { const m = r.data.date.slice(0, 7); if (m in c) c[m]++; });
  h += `<div class="glass card chart"><h2>Problemi di salute per mese</h2>${barChart(ms.map(m => ({ l: new Date(m + '-01T12:00').toLocaleDateString('it-IT', { month: 'short' }).replace('.', ''), v: c[m] })), { color: '#ffb86b', h: 130 })}</div>`;
  h += `<div class="glass card"><h2>Voci nel periodo</h2>${hbars(countBy(rs, r => KINDS[r.kind].name))}</div>`;
  const pesi = list(dog, 'visita').filter(r => r.data.peso).slice(0, 6);
  if (pesi.length) h += `<div class="glass card"><h2>Peso</h2>${pesi.map(r => `<div style="display:flex;justify-content:space-between;padding:4px 0"><span class="muted">${esc(fmtDate(r.data.date))}</span><b>${esc(r.data.peso)} kg</b></div>`).join('')}</div>`;
  return h;
}

// ---------- report per il veterinario (in app e PDF) ----------
function table(rs, cols) {
  if (!rs.length) return '<p class="muted">Nessuna voce</p>';
  return `<table><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr>${rs.map(r => `<tr>${cols.map(c => `<td>${esc(c[1](r.data))}</td>`).join('')}</tr>`).join('')}</table>`;
}
const arr = v => [].concat(v || []).join(', ');
function reportHTML() {
  const d = curDog(), from = range ? new Date(new Date().getFullYear(), new Date().getMonth() - range + 1, 1) : new Date(0);
  const inR = rs => rs.filter(r => toDate(r.data.date) >= from);
  let h = `<section><h1>${esc(d.name)} — ${esc(d.eta)}</h1><p class="muted">Report dal ${range ? from.toLocaleDateString('it-IT') : 'primo dato'} al ${new Date().toLocaleDateString('it-IT')}</p></section>`;
  if (d.epi) {
    const st = seizureStats(dog, range);
    h += `<section><h2>Riepilogo crisi</h2><table>
      <tr><td>Crisi totali</td><td><b>${st.total}</b></td><td>Media al mese</td><td><b>${st.alMese.toFixed(1)}</b></td></tr>
      <tr><td>Giorni con crisi</td><td><b>${st.giorni}</b></td><td>Giorni con cluster (2+)</td><td><b>${st.cluster}</b></td></tr>
      <tr><td>Intervallo medio</td><td><b>${st.gapMedio ? st.gapMedio.toFixed(1) + ' gg' : '—'}</b></td><td>Durata media / max</td><td><b>${fmtDur(st.durMedia) || '—'} / ${fmtDur(st.durMax) || '—'}</b></td></tr>
      <tr><td>Ultima crisi</td><td colspan="3"><b>${st.last ? st.last.toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</b></td></tr></table></section>`;
    h += `<section class="chart"><h2>Crisi per mese</h2>${seizureMonthChart(dog, st)}<p class="muted" style="font-size:.8em">Linea rosa tratteggiata = cambio di terapia</p></section>`;
  }
  h += `<section><h2>Terapia attuale</h2>${table(currentTherapy(dog), [['Farmaco', x => x.farmaco], ['Dose', x => `${x.dose || ''} ${x.unita || ''}`], ['Frequenza', x => x.freq], ['Orari', x => x.orari], ['Dal', x => fmtDate(x.date)]])}</section>`;
  h += `<section><h2>Storico terapia e cambi di dose</h2>${table(list(dog, 'terapia'), [['Dal', x => fmtDate(x.date)], ['Farmaco', x => x.farmaco], ['Dose', x => `${x.dose || ''} ${x.unita || ''}`], ['Frequenza', x => x.freq], ['Stato', x => x.sospeso], ['Motivo', x => x.motivo]])}</section>`;
  if (d.epi) h += `<section><h2>Elenco crisi</h2>${table(inR(list(dog, 'crisi')), [['Giorno', x => fmtDate(x.date)], ['Ora', x => x.time], ['N.', x => x.quante || 1], ['Durata', x => fmtDur(x.durSec)], ['Tipo', x => x.tipo], ['Int.', x => x.intensita ? x.intensita + '/5' : ''], ['Post', x => x.post ? x.post + ' min' : ''], ['Sintomi', x => arr(x.sintomi)], ['Causa', x => arr(x.trigger)], ['Emerg.', x => x.emergenza], ['Note', x => x.note]])}</section>`;
  h += `<section><h2>Analisi</h2>${table(inR(list(dog, 'analisi')), [['Giorno', x => fmtDate(x.date)], ['Tipo', x => x.tipo], ['Valore', x => x.valore], ['Esito', x => x.esito], ['Risultati', x => x.risultati]])}</section>`;
  h += `<section><h2>Problemi di salute</h2>${table(inR(list(dog, 'salute')), [['Giorno', x => fmtDate(x.date)], ['Cosa', x => x.titolo], ['Gravità', x => x.gravita ? x.gravita + '/5' : ''], ['Farmaco', x => x.farmaco], ['Stato', x => x.risolto], ['Note', x => x.note]])}</section>`;
  h += `<section><h2>Visite</h2>${table(inR(list(dog, 'visita')), [['Giorno', x => fmtDate(x.date)], ['Motivo', x => x.motivo], ['Peso', x => x.peso ? x.peso + ' kg' : ''], ['Esito', x => x.esito]])}</section>`;
  h += `<section><h2>Vaccini e antiparassitari</h2>${table(list(dog, 'vaccino'), [['Giorno', x => fmtDate(x.date)], ['Cosa', x => x.nome], ['Richiamo', x => fmtDate(x.richiamo)], ['Note', x => x.note]])}</section>`;
  return h;
}
function viewVet() {
  return rangePills() + `<div class="row" style="margin:0 0 14px"><button class="btn primary" id="pdf">📄 Esporta PDF</button><button class="btn" id="csv">📊 Esporta CSV</button></div>
    <div class="glass card report">${reportHTML()}</div>`;
}

function exportPDF() {
  $('#print').innerHTML = reportHTML();
  setTimeout(() => window.print(), 50);
}
function exportCSV() {
  const rs = list(dog), cols = [['tipo', 'Tipo'], ['date', 'Giorno'], ['time', 'Ora']];
  for (const [, k] of Object.entries(KINDS)) for (const f of k.fields) if (!cols.some(c => c[0] === (f.t === 'dur' ? 'durSec' : f.k))) cols.push(f.t === 'dur' ? ['durSec', 'Durata (sec)'] : [f.k, f.l]);
  const cell = v => { const s = Array.isArray(v) ? v.join(', ') : String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [cols.map(c => cell(c[1])).join(';'), ...rs.map(r => cols.map(c => cell(c[0] === 'tipo' ? KINDS[r.kind].name : r.data[c[0]])).join(';'))];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const name = `${curDog().name}-${today()}.csv`, file = new File([blob], name, { type: 'text/csv' });
  if (navigator.canShare?.({ files: [file] })) return navigator.share({ files: [file], title: name }).catch(() => {});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- render ----------
const TITLES = { home: d => d.name, diario: () => 'Diario', stats: () => 'Statistiche', vet: () => 'Per il veterinario' };
function render() {
  if ($('#app').hidden) return;
  renderSeg();
  $('#title').textContent = TITLES[tab](curDog());
  $('#view').innerHTML = { home: viewHome, diario: viewDiario, stats: viewStats, vet: viewVet }[tab]();
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
}

// ---------- modulo ----------
let editing = null;
function fieldHTML(f, d) {
  const v = d[f.k] ?? f.def ?? '';
  const lab = `<label>${esc(f.l)}</label>`;
  switch (f.t) {
    case 'date': case 'time': return lab + `<input type="${f.t}" name="${f.k}" value="${esc(v)}">`;
    case 'num': return lab + `<input type="number" inputmode="decimal" min="0" step="${f.step || 1}" name="${f.k}" value="${esc(v)}">`;
    case 'text': return lab + `<input type="text" name="${f.k}" value="${esc(v)}" placeholder="${esc(f.ph || '')}"${f.list ? ` list="dl-${f.list}"` : ''}>` + (f.list ? `<datalist id="dl-${f.list}">${suggestions(f.k).map(s => `<option value="${esc(s)}">`).join('')}</datalist>` : '');
    case 'area': return lab + `<textarea name="${f.k}">${esc(v)}</textarea>`;
    case 'select': return lab + `<select name="${f.k}"><option value=""></option>${f.o.map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    case 'chips': return lab + `<div class="chips">${f.o.map(o => `<label><input type="checkbox" name="${f.k}" value="${esc(o)}"${[].concat(v).includes(o) ? ' checked' : ''}><span>${esc(o)}</span></label>`).join('')}</div>`;
    case 'stars': return lab + `<div class="stars" data-k="${f.k}">${[1, 2, 3, 4, 5].map(i => `<button type="button" class="${+v === i ? 'on' : ''}" data-v="${i}">${i}</button>`).join('')}</div><input type="hidden" name="${f.k}" value="${esc(v)}">`;
    case 'dur': { const s = +d.durSec || 0; return lab + `<div class="two"><input type="number" inputmode="numeric" min="0" name="durMin" placeholder="min" value="${s ? Math.floor(s / 60) : ''}"><input type="number" inputmode="numeric" min="0" max="59" name="durS" placeholder="sec" value="${s ? s % 60 : ''}"></div>`; }
  }
}
function suggestions(k) {
  return [...new Set(Object.values(records).filter(r => !r.deleted).map(r => r.data[k]).filter(Boolean))].slice(0, 30);
}
function openForm(kind, rec) {
  editing = rec ? structuredClone(rec) : { id: uuid(), dog, kind, data: { date: today(), time: KINDS[kind].fields.some(f => f.k === 'time') ? nowTime() : undefined } };
  const k = KINDS[kind];
  $('#fTitle').textContent = `${k.ic} ${k.name} · ${curDog().name}`;
  $('#fBody').innerHTML = k.fields.map(f => fieldHTML(f, editing.data)).join('');
  $('#fDel').hidden = !rec;
  $('#form').showModal();
}
$('#fBody').addEventListener('click', e => {
  const b = e.target.closest('.stars button'); if (!b) return;
  const wrap = b.parentElement, inp = wrap.nextElementSibling, v = b.dataset.v === inp.value ? '' : b.dataset.v;
  inp.value = v; wrap.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.v === v));
});
$('#frm').addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target), data = {};
  for (const f of KINDS[editing.kind].fields) {
    if (f.t === 'dur') { const s = (+fd.get('durMin') || 0) * 60 + (+fd.get('durS') || 0); if (s) data.durSec = s; continue; }
    if (f.t === 'chips') { const a = fd.getAll(f.k); if (a.length) data[f.k] = a; continue; }
    const v = (fd.get(f.k) || '').trim();
    if (v) data[f.k] = f.t === 'num' || f.t === 'stars' ? +v : v;
  }
  if (!data.date) return toast('Inserisci il giorno');
  editing.data = data; save(editing); $('#form').close(); toast('Salvato');
});
$('#fDel').onclick = () => {
  if (!confirm('Eliminare questa voce?')) return;
  editing.deleted = true; save(editing); $('#form').close(); toast('Eliminato');
};
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

// ---------- eventi ----------
$('#fab').onclick = () => {
  $('#pickList').innerHTML = kindsFor(curDog()).map(([id, k]) => `<button data-kind="${id}"><span>${k.ic}</span>${k.name}</button>`).join('');
  $('#pick').showModal();
};
$('#pickList').addEventListener('click', e => { const b = e.target.closest('[data-kind]'); if (!b) return; $('#pick').close(); openForm(b.dataset.kind); });
$('#dogSeg').addEventListener('click', e => { const b = e.target.closest('[data-dog]'); if (!b) return; dog = b.dataset.dog; LS.set('cani.dog', dog); filter = ''; render(); });
$('#tabbar').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return; tab = b.dataset.tab; render(); scrollTo(0, 0); });
$('#view').addEventListener('click', e => {
  const it = e.target.closest('[data-id]'); if (it) { const r = records[it.dataset.id]; return openForm(r.kind, r); }
  const f = e.target.closest('[data-filter]'); if (f) { filter = f.dataset.filter; return render(); }
  const rg = e.target.closest('[data-range]'); if (rg) { range = +rg.dataset.range; return render(); }
  if (e.target.id === 'pdf') return exportPDF();
  if (e.target.id === 'csv') return exportCSV();
});
addEventListener('online', sync);
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });

// ---------- accesso ----------
function showApp() {
  $('#login').hidden = true;['#app', '#tabbar', '#fab'].forEach(s => $(s).hidden = false);
  render(); sync();
}
async function doLogin(signup) {
  const email = $('#lEmail').value.trim(), password = $('#lPass').value, msg = $('#lMsg');
  if (!email || !password) return msg.textContent = 'Inserisci email e password';
  msg.textContent = '…';
  const r = signup ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href } }) : await sb.auth.signInWithPassword({ email, password });
  if (r.error) return msg.textContent = r.error.message === 'Invalid login credentials' ? 'Email o password errati' : r.error.message;
  if (!r.data.session) return msg.textContent = 'Controlla la posta per confermare l\'email, poi accedi.';
  user = r.data.user; showApp();
}
$('#lGo').onclick = () => doLogin(false);
$('#lNew').onclick = () => doLogin(true);

(async () => {
  if (!sb) return showApp(); // senza Supabase: solo sul telefono
  const { data } = await sb.auth.getSession();
  user = data.session?.user || null;
  if (user) showApp(); else $('#login').hidden = false;
})();
