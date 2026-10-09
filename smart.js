// ---------- Riconoscimenti "intelligenti" senza AI (tutto sul telefono) ----------
const Smart = (() => {
  const DAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const NUM = { una: 1, uno: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, undici: 11, dodici: 12, tredici: 13, quattordici: 14, quindici: 15, sedici: 16, diciassette: 17, diciotto: 18, diciannove: 19, venti: 20, ventuno: 21, ventidue: 22, ventitré: 23, mezzogiorno: 12, mezzanotte: 0 };
  const norm = s => s.toLowerCase().replace(/lunedi\b/g, 'lunedì').replace(/martedi\b/g, 'martedì').replace(/mercoledi\b/g, 'mercoledì').replace(/giovedi\b/g, 'giovedì').replace(/venerdi\b/g, 'venerdì');
  const n = w => w == null ? null : /^\d+$/.test(w) ? +w : NUM[w] ?? null;
  const W = '(\\d{1,2}|' + Object.keys(NUM).join('|') + ')';

  // Trova data/ora in frasi tipo "mercoledì alle 10 visita veterinaria per Zoe"
  function parseEvent(text, now = new Date()) {
    if (!text) return null;
    const t = norm(text);
    let date = null, used = [];
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const add = d => new Date(today.getFullYear(), today.getMonth(), today.getDate() + d);
    let m;
    if ((m = t.match(/\bdopodomani\b/))) { date = add(2); used.push(m[0]); }
    else if ((m = t.match(/\bdomani\b/))) { date = add(1); used.push(m[0]); }
    else if ((m = t.match(/\boggi\b|\bstasera\b|\bstamattina\b/))) { date = add(0); used.push(m[0]); }
    if (!date && (m = t.match(new RegExp(`\\b(?:il |l'|lo )?${W}\\s+(${MONTHS.join('|')})(?:\\s+(\\d{4}))?`)))) {
      const d = n(m[1]), mo = MONTHS.indexOf(m[2]);
      let y = m[3] ? +m[3] : today.getFullYear();
      date = new Date(y, mo, d);
      if (!m[3] && date < today) date = new Date(y + 1, mo, d);
      used.push(m[0]);
    }
    if (!date && (m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
      let y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : today.getFullYear();
      date = new Date(y, +m[2] - 1, +m[1]);
      if (!m[3] && date < today) date.setFullYear(y + 1);
      used.push(m[0]);
    }
    if (!date && (m = t.match(new RegExp(`\\b(?:(?:il|la|di|questo|questa|prossimo|prossima)\\s+)?(${DAYS.join('|')})(\\s+prossim[oa])?(?![a-zà-ù])`)))) {
      const target = DAYS.indexOf(m[1]);
      let diff = (target - today.getDay() + 7) % 7 || 7;
      date = add(diff); used.push(m[0]);
    }
    if (!date && (m = t.match(new RegExp(`\\b(?:il|l')\\s*${W}\\b(?!\\s*(?:euro|kg|g|anni|minuti|ore))`)))) {
      const d = n(m[1]);
      if (d >= 1 && d <= 31) { date = new Date(today.getFullYear(), today.getMonth(), d); if (date < today) date.setMonth(date.getMonth() + 1); used.push(m[0]); }
    }
    if (!date) return null;

    let hh = null, mm = 0;
    if ((m = t.match(new RegExp(`\\b(?:alle|all'|verso le|per le|ore)\\s*(?:ore\\s*)?${W}(?:[:.,](\\d{2})|\\s+e\\s+(mezza|mezzo|un quarto|tre quarti|\\d{1,2}))?(?:\\s+(del pomeriggio|di pomeriggio|di sera|della sera|del mattino|di mattina|della mattina))?`)))) {
      hh = n(m[1]);
      if (m[2]) mm = +m[2];
      else if (m[3]) mm = { mezza: 30, mezzo: 30, 'un quarto': 15, 'tre quarti': 45 }[m[3]] ?? +m[3];
      if (m[4] && /pomeriggio|sera/.test(m[4]) && hh < 12) hh += 12;
      else if (!m[4] && hh >= 1 && hh <= 7) hh += 12; // "alle 3" = 15:00
      used.push(m[0]);
    } else if ((m = t.match(/\b(mezzogiorno|mezzanotte)\b/))) { hh = n(m[1]); used.push(m[0]); }
    if (hh != null && (hh > 23 || mm > 59)) hh = null;

    const start = new Date(date);
    if (hh != null) start.setHours(hh, mm);
    // Titolo = frase senza data/ora
    let title = text.replace(/\b(lun|mart|mercol|giov|vener)(edi|di)\b/gi, (w) => w + '̀').normalize('NFC');
    for (const u of used) title = title.replace(new RegExp(u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
    title = title.replace(/\b(ho|c'è|abbiamo|avrò)\b\s*(un[ao']?\s*)?/i, '').replace(/\s+/g, ' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '');
    title = title.replace(/^(la|il|lo|una|un|l')\s+/i, ''); title = title ? title[0].toUpperCase() + title.slice(1) : 'Evento';
    if (title.length > 80) title = title.slice(0, 77) + '…';
    return { title, start, allDay: hh == null };
  }

  const pad = x => String(x).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const ymdhms = d => `${ymd(d)}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  const endOf = ev => ev.allDay ? new Date(ev.start.getFullYear(), ev.start.getMonth(), ev.start.getDate() + 1) : new Date(ev.start.getTime() + 3600e3);

  function calendarLink(kind, ev, details = '') {
    const end = endOf(ev);
    if (kind === 'google') {
      const dates = ev.allDay ? `${ymd(ev.start)}/${ymd(end)}` : `${ymdhms(ev.start)}/${ymdhms(end)}`;
      return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(ev.title)}&dates=${dates}&ctz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}&details=${encodeURIComponent(details)}`;
    }
    if (kind === 'outlook') {
      const q = ev.allDay ? `startdt=${iso(ev.start).slice(0, 10)}&enddt=${iso(end).slice(0, 10)}&allday=true` : `startdt=${iso(ev.start)}&enddt=${iso(end)}`;
      return `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${encodeURIComponent(ev.title)}&${q}&body=${encodeURIComponent(details)}`;
    }
    // Apple / altri: file .ics
    const esc = s => s.replace(/[\\,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Note Vocali//IT', 'BEGIN:VEVENT',
      `UID:${crypto.randomUUID()}@notevocali`, `DTSTAMP:${ymdhms(new Date())}`,
      ev.allDay ? `DTSTART;VALUE=DATE:${ymd(ev.start)}` : `DTSTART:${ymdhms(ev.start)}`,
      ev.allDay ? `DTEND;VALUE=DATE:${ymd(end)}` : `DTEND:${ymdhms(end)}`,
      `SUMMARY:${esc(ev.title)}`, `DESCRIPTION:${esc(details)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
  }
  const fmtEvent = ev => ev.start.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }) +
    (ev.allDay ? ' · tutto il giorno' : ' · ' + ev.start.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }));

  // Lista della spesa: "devo comprare latte, uova e due zucchine" → [latte, uova, due zucchine]
  function parseList(text) {
    let t = (text || '').replace(/\b(lista della spesa|devo comprare|dobbiamo comprare|da comprare|comprare|prendere|devo prendere|mi serve|mi servono|servono|poi|anche|ancora)\b:?/gi, ',');
    return [...new Set(t.split(/[,;\n.]|\s+e\s+|\s+ed\s+/i).map(x => x.trim().replace(/^(il|lo|la|i|gli|le|l'|del|della|dei|delle|degli|un|una|uno|un')\s+/i, '')).filter(x => x.length > 1))]
      .map(x => x[0].toUpperCase() + x.slice(1));
  }
  const isShopping = cat => /spesa|lista|shopping|comprare/i.test(cat || '');

  // Anteprima breve: prima frase
  function preview(text, max = 110) {
    const t = (text || '').trim().replace(/\s+/g, ' ');
    const first = t.match(/^.+?[.!?](\s|$)/)?.[0] || t;
    return first.length > max ? first.slice(0, max - 1) + '…' : first;
  }
  return { parseEvent, calendarLink, fmtEvent, parseList, isShopping, preview };
})();

// ---------- Meteo (Open-Meteo, gratuito; posizione arrotondata ~1 km) ----------
const Weather = (() => {
  const ICON = c => c === 0 ? ['☀️', 'Sereno'] : c <= 2 ? ['🌤️', 'Poco nuvoloso'] : c === 3 ? ['☁️', 'Nuvoloso'] : c <= 48 ? ['🌫️', 'Nebbia']
    : c <= 57 ? ['🌦️', 'Pioviggine'] : c <= 67 ? ['🌧️', 'Pioggia'] : c <= 77 ? ['🌨️', 'Neve'] : c <= 82 ? ['🌦️', 'Rovesci'] : c <= 86 ? ['🌨️', 'Neve'] : ['⛈️', 'Temporale'];
  const get = k => { try { return JSON.parse(localStorage[k]); } catch { return null; } };
  async function position(force) {
    const p = get('pos');
    if (p && !force && Date.now() - p.t < 6 * 3600e3) return p;
    return new Promise(res => navigator.geolocation ? navigator.geolocation.getCurrentPosition(
      g => { const v = { lat: +g.coords.latitude.toFixed(2), lon: +g.coords.longitude.toFixed(2), t: Date.now() }; localStorage.pos = JSON.stringify(v); res(v); },
      () => res(p), { maximumAge: 3600e3, timeout: 10000 }) : res(p));
  }
  async function load(force) {
    const c = get('wx');
    if (c && !force && Date.now() - c.t < 30 * 60e3) return c;
    const p = await position(force);
    if (!p) return c;
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,weather_code,is_day`);
    const d = (await r.json()).current;
    const [icon, label] = ICON(d.weather_code);
    const v = { icon: !d.is_day && icon === '☀️' ? '🌙' : !d.is_day && icon === '🌤️' ? '☁️' : icon, label, temp: Math.round(d.temperature_2m), t: Date.now() };
    localStorage.wx = JSON.stringify(v);
    return v;
  }
  return { load };
})();
