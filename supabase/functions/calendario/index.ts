// Funzione "calendario" (Supabase Edge Function). Fa due cose:
//  1) GET  ?ics=...   → restituisce un evento come file calendario, così iPhone
//                       mostra la schermata nativa "Aggiungi al calendario".
//  2) POST {url}      → scarica il tuo calendario collegato (Google/iCloud/Outlook)
//                       per mostrarlo nell'app. Solo per utenti con account.
// Va pubblicata con "Verify JWT" DISATTIVATO (il controllo dell'account è fatto qui dentro).
const ALLOWED = [/(^|\.)calendar\.google\.com$/, /(^|\.)icloud\.com$/, /(^|\.)outlook\.(live|office365|office)\.com$/, /(^|\.)live\.com$/];
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const b64url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    // 1) evento singolo da aggiungere al calendario del telefono
    if (req.method === 'GET') {
      const raw = new URL(req.url).searchParams.get('ics') || '';
      if (!raw || raw.length > 6000) return new Response('Evento non valido', { status: 400, headers: cors });
      const ics = b64url(raw);
      if (!ics.startsWith('BEGIN:VCALENDAR') || !ics.includes('BEGIN:VEVENT')) return new Response('Evento non valido', { status: 400, headers: cors });
      return new Response(ics, { headers: { ...cors, 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="evento.ics"', 'Cache-Control': 'no-store' } });
    }
    // 2) calendario collegato: solo per chi ha un account
    const auth = req.headers.get('Authorization') || '';
    const who = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, { headers: { Authorization: auth, apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '' } });
    if (!who.ok) return new Response('Accesso richiesto', { status: 401, headers: cors });
    const { url } = await req.json();
    const u = new URL(String(url).trim().replace(/^webcal:\/\//i, 'https://'));
    if (u.protocol !== 'https:' || !ALLOWED.some((r) => r.test(u.hostname))) return new Response('Link non supportato', { status: 400, headers: cors });
    const r = await fetch(u, { headers: { 'User-Agent': 'NoteVocali/1.0' } });
    if (!r.ok) return new Response('Calendario non raggiungibile', { status: 502, headers: cors });
    const text = await r.text();
    if (!text.includes('BEGIN:VCALENDAR')) return new Response('Il link non è un calendario', { status: 400, headers: cors });
    return new Response(text, { headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
  } catch (_e) {
    return new Response('Richiesta non valida', { status: 400, headers: cors });
  }
});
