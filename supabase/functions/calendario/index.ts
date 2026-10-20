// Funzione "calendario": scarica il tuo calendario (link privato iCal/ICS)
// e lo passa all'app. Serve perché i browser non possono leggerlo direttamente.
// Accetta solo utenti con account e solo link di Google, iCloud e Outlook.
const ALLOWED = [/(^|\.)calendar\.google\.com$/, /(^|\.)icloud\.com$/, /(^|\.)outlook\.(live|office365|office)\.com$/, /(^|\.)live\.com$/];
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { url } = await req.json();
    const u = new URL(String(url).trim().replace(/^webcal:\/\//i, 'https://'));
    if (u.protocol !== 'https:' || !ALLOWED.some((r) => r.test(u.hostname))) {
      return new Response('Link non supportato', { status: 400, headers: cors });
    }
    const r = await fetch(u, { headers: { 'User-Agent': 'NoteVocali/1.0' } });
    if (!r.ok) return new Response('Calendario non raggiungibile', { status: 502, headers: cors });
    const text = await r.text();
    if (!text.includes('BEGIN:VCALENDAR')) return new Response('Il link non è un calendario', { status: 400, headers: cors });
    return new Response(text, { headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
  } catch (_e) {
    return new Response('Richiesta non valida', { status: 400, headers: cors });
  }
});
