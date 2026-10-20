// ---------- Statistiche e spunti (tutto calcolato sul telefono) ----------
const Insights = (() => {
  const STOP = new Set(`a ad al alla alle allo agli ai all anche ancora avere aveva avevo avrò ho hai ha abbiamo avete hanno c che chi ci cioè col come con contro cosa così cui da dal dalla dalle dallo dagli dai dei del della delle dello degli dentro di dove dopo due e è ed era ero essere fa fare fatto fino fra gli già ha i il in io la le lei li lo loro lui ma me mentre mi mia mie miei mio molto ne nei nel nella nelle nello negli noi non nostro nostra o oggi ogni oppure per perché però più poi poco proprio può qua qual quale quando quanto quella quelle quello quelli questa queste questo questi qui se sei sembra senza si sia siamo sono sopra sotto sta stai stato stata su sua sue suo suoi sul sulla sulle sullo sugli tanto te ti tra tre tu tua tue tuo tuoi tutto tutta tutti tutte un una uno uno vi voi volta sì no ok poi devo dobbiamo deve bisogna fare fatto cose cosa allora quindi tipo comunque magari invece sempre mai bene ecco adesso ora dire detto domani dopodomani ieri alle ore mezza lunedì martedì mercoledì giovedì venerdì sabato domenica gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre prossimo prossima settimana mese anno giorno`.split(/\s+/));

  function topWords(notes, limit = 30) {
    const count = new Map();
    for (const n of notes) {
      const words = ((n.title || '') + ' ' + (n.text || '')).toLowerCase().normalize('NFC').match(/[a-zà-ÿ']{3,}/g) || [];
      for (let w of words) {
        w = w.replace(/^[a-z]+'/, '');
        if (w.length < 3 || STOP.has(w)) continue;
        // raggruppa forme simili (veterinario/veterinaria, idea/idee)
        const root = w.length > 4 ? w.replace(/[aeiou]$/, '') : w;
        const g = count.get(root) || { n: 0, forms: new Map() };
        g.n++; g.forms.set(w, (g.forms.get(w) || 0) + 1);
        count.set(root, g);
      }
    }
    return [...count.values()].sort((a, b) => b.n - a.n).slice(0, limit)
      .map(g => [[...g.forms].sort((a, b) => b[1] - a[1])[0][0], g.n]);
  }

  // Domande e spunti originali (nessuna citazione attribuita)
  const PROMPTS = [
    'Qual è una piccola cosa che oggi ti ha fatto stare bene?',
    'Cosa faresti oggi se avessi un’ora tutta per te?',
    'Scegli una cosa sola da portare a termine oggi. Solo una.',
    'A chi potresti dire grazie questa settimana?',
    'Quale idea rimandi da tempo? Cosa ti serve per iniziare?',
    'Il tuo corpo oggi cosa ti sta chiedendo: movimento, riposo o nutrimento?',
    'Scrivi tre cose che sono andate bene ieri.',
    'Cosa vorresti ricordarti di questo mese tra un anno?',
    'Una cosa che puoi semplificare oggi, invece di aggiungere.',
    'Se un’amica fosse al tuo posto, che consiglio le daresti?',
    'Qual è il pasto che oggi ti farebbe sentire meglio?',
    'Cosa hai imparato di nuovo negli ultimi giorni?',
    'Dove puoi dire un “no” gentile per proteggere la tua energia?',
    'Qual è la parte della giornata in cui ti senti più creativa?',
    'Pensa a un problema come a una domanda: come potrebbe essere riformulato?',
    'Cosa ti rende orgogliosa di te, anche se è piccola?',
    'Fai una pausa: tre respiri lenti prima di continuare.',
    'Quale abitudine vorresti coltivare nei prossimi 7 giorni?',
    'C’è qualcosa che stai aspettando di “sentirti pronta” per fare?',
    'Che cosa ti ha incuriosito ultimamente?',
    'Riordina una piccola cosa: un cassetto, una lista, un pensiero.',
    'Il riposo è produttivo: quando ti concedi la prossima pausa vera?',
    'Quale persona ti ispira e perché?',
    'Immagina la tua domenica ideale: cosa ne puoi portare in questa settimana?',
    'Annota un’idea assurda: a volte le migliori partono così.',
    'Cosa ti fa sentire a casa?',
    'Di cosa hai bisogno per stare meglio questa settimana?',
    'Celebra un progresso, anche minimo, fatto questo mese.',
  ];
  const seedOf = d => d.getFullYear() * 1000 + Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
  const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];

  // Spunto del giorno: alterna domande e richiami alle tue note
  function spark(notes, date = new Date(), shift = 0) {
    const seed = seedOf(date) + shift;
    const ideas = notes.filter(n => /idee|brainstorm/i.test(n.category) && n.text && Date.now() - n.created > 3 * 864e5);
    const week = notes.filter(n => Date.now() - n.created < 7 * 864e5);
    const opts = [{ kind: 'prompt', text: pick(PROMPTS, seed) }];
    if (ideas.length) {
      const n = pick(ideas, seed);
      const days = Math.round((Date.now() - n.created) / 864e5);
      opts.push({ kind: 'idea', id: n.id, text: `${days} giorni fa hai avuto questa idea: «${n.title}». Che passo piccolo puoi fare oggi per svilupparla?` });
    }
    const w = topWords(week, 1)[0];
    if (w && w[1] >= 3) opts.push({ kind: 'word', text: `Questa settimana la parola che ripeti di più è «${w[0]}». Cosa ti dice?` });
    // lunedì: riepilogo della settimana; giorno 1: riepilogo del mese
    if (date.getDay() === 1 && week.length) opts.push({ kind: 'recap', text: `Nuova settimana! Negli ultimi 7 giorni hai creato ${week.length} ${week.length === 1 ? 'nota' : 'note'}. Su cosa vuoi concentrarti adesso?` });
    if (date.getDate() === 1) { const m = notes.filter(n => Date.now() - n.created < 31 * 864e5).length; opts.push({ kind: 'recap', text: `Inizia un nuovo mese. Il mese scorso: ${m} note. Qual è la tua intenzione per questo mese?` }); }
    return pick(opts, Math.floor(seed / 3) + shift);
  }
  return { topWords, spark };
})();
