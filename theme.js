// Applica subito tema e dimensione del testo salvati (prima che la pagina venga disegnata)
try {
  const r = document.documentElement;
  if (localStorage.theme) r.dataset.theme = localStorage.theme;
  if (localStorage.fontSize) r.style.setProperty('--fs', localStorage.fontSize);
} catch {}
