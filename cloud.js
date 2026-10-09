// ---------- Account + sincronizzazione cifrata (Supabase) ----------
// Tutto viene cifrato sul telefono (AES-GCM, chiave derivata dalla password):
// il server conserva solo dati illeggibili.
const Cloud = (() => {
  const C = window.CONFIG || {};
  const enabled = !!(C.supabaseUrl && C.supabaseKey && window.supabase);
  const sb = enabled ? supabase.createClient(C.supabaseUrl, C.supabaseKey) : null;
  const te = new TextEncoder(), td = new TextDecoder();
  let key = null, user = null, syncing = false, again = false, timer = null;
  const api = { enabled, onChange: () => {}, onStatus: () => {}, get email() { return user?.email || '' } };

  const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function deriveKey(password, salt) {
    const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(salt), iterations: 310000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encrypt(bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out;
  }
  const decrypt = async bytes => new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12)));
  const encJSON = async o => b64(await encrypt(te.encode(JSON.stringify(o))));
  const decJSON = async s => JSON.parse(td.decode(await decrypt(unb64(s))));
  const fail = e => { throw new Error(e.message || String(e)); };

  const it = msg => ({
    'Invalid login credentials': 'Email o password errati',
    'User already registered': 'Email già registrata: usa "Accedi"',
    'Email not confirmed': 'Conferma prima l\'email (controlla la posta)',
  })[msg] || (/at least 6/.test(msg) ? 'La password deve avere almeno 6 caratteri' : msg);

  // 'off' | 'need-login' | 'ready'
  api.init = async () => {
    if (!enabled) return 'off';
    const { data } = await sb.auth.getSession();
    user = data.session?.user || null;
    key = await DB.getMeta('key');
    if (!user || !key || (await DB.getMeta('keyUser')) !== user.id) { key = null; return 'need-login'; }
    return 'ready';
  };

  // ritorna 'ok' oppure 'confirm' (serve conferma email)
  api.login = async (email, password, signup) => {
    const r = signup
      ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } })
      : await sb.auth.signInWithPassword({ email, password });
    if (r.error) throw new Error(it(r.error.message));
    if (!r.data.session) return 'confirm';
    user = r.data.user;
    let { data: row, error } = await sb.from('user_settings').select('*').eq('user_id', user.id).maybeSingle();
    if (error) fail(error);
    if (!row) {
      const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      ({ data: row, error } = await sb.from('user_settings').insert({ user_id: user.id, salt }).select().single());
      if (error) fail(error);
    }
    key = await deriveKey(password, row.salt);
    if (row.verifier) {
      try { await decJSON(row.verifier); } catch { key = null; throw new Error('Questa password non apre le note cifrate'); }
    } else {
      await sb.from('user_settings').update({ verifier: await encJSON('ok') }).eq('user_id', user.id);
    }
    const prev = await DB.getMeta('keyUser');
    if (prev && prev !== user.id) { await DB.clear(); localStorage.removeItem('catsUpdated'); }
    await DB.setMeta('key', key);
    await DB.setMeta('keyUser', user.id);
    // Le note già presenti sul telefono vengono caricate sull'account
    for (const n of await DB.all()) if (n.dirty === undefined) { n.updated = n.updated || n.created; n.dirty = true; await DB.put(n); }
    sync();
    return 'ok';
  };

  api.logout = async () => {
    try { await sync(); } catch {}
    await sb.auth.signOut();
    await DB.clear();
    for (const k of ['key', 'keyUser', 'dead']) await DB.delMeta(k);
    localStorage.removeItem('catsUpdated');
    key = user = null;
  };

  api.markDeleted = async id => {
    if (!key) return;
    const dead = (await DB.getMeta('dead')) || [];
    dead.push(id); await DB.setMeta('dead', dead); api.schedule();
  };
  api.schedule = () => { if (!key) return; clearTimeout(timer); timer = setTimeout(sync, 1500); };

  api.fetchAudio = async n => {
    const { data, error } = await sb.storage.from('audio').download(`${user.id}/${n.id}`);
    if (error) fail(error);
    return new Blob([await decrypt(new Uint8Array(await data.arrayBuffer()))], { type: n.mime || 'audio/mp4' });
  };

  const pick = n => ({ created: n.created, category: n.category, title: n.title, text: n.text,
    duration: n.duration, pending: !!n.pending, failed: !!n.failed, mime: n.audio?.type || n.mime || '' });

  async function sync() {
    if (!key || !user || !navigator.onLine) return;
    if (syncing) { again = true; return; }
    syncing = true; api.onStatus('sync');
    try {
      // 1. eliminazioni
      const dead = (await DB.getMeta('dead')) || [];
      for (const id of dead) {
        await sb.storage.from('audio').remove([`${user.id}/${id}`]);
        const r = await sb.from('notes').upsert({ id, user_id: user.id, data: null, has_audio: false, deleted: true, updated: Date.now() });
        if (r.error) fail(r.error);
      }
      if (dead.length) await DB.setMeta('dead', ((await DB.getMeta('dead')) || []).filter(id => !dead.includes(id)));
      // 2. invio modifiche locali
      for (const n of await DB.all()) {
        if (!n.dirty) continue;
        if (n.audio && !n.audioSynced) {
          const blob = new Blob([await encrypt(new Uint8Array(await n.audio.arrayBuffer()))], { type: 'application/octet-stream' });
          const r = await sb.storage.from('audio').upload(`${user.id}/${n.id}`, blob, { upsert: true, contentType: 'application/octet-stream' });
          if (r.error) fail(r.error);
        }
        const r = await sb.from('notes').upsert({ id: n.id, user_id: user.id, data: await encJSON(pick(n)),
          has_audio: !!(n.audio || n.hasAudio), deleted: false, updated: n.updated });
        if (r.error) fail(r.error);
        const cur = await DB.get(n.id);
        if (cur && cur.updated === n.updated) { cur.dirty = false; cur.audioSynced = !!cur.audio; await DB.put(cur); }
      }
      // 3. ricezione dagli altri dispositivi
      const { data: rows, error } = await sb.from('notes').select('id,data,has_audio,deleted,updated');
      if (error) fail(error);
      let changed = false;
      for (const r of rows) {
        const local = await DB.get(r.id);
        if (r.deleted) { if (local) { await DB.del(r.id); changed = true; } continue; }
        if (local && (local.dirty || local.updated >= r.updated)) continue;
        const d = await decJSON(r.data);
        await DB.put({ ...d, id: r.id, updated: r.updated, dirty: false, hasAudio: r.has_audio,
          audio: local?.audio || null, audioSynced: true });
        changed = true;
      }
      // 4. raccolte
      const { data: st } = await sb.from('user_settings').select('data,updated').eq('user_id', user.id).single();
      const localUpd = +localStorage.catsUpdated || 0;
      if (st?.data && st.updated > localUpd) {
        localStorage.cats = JSON.stringify(await decJSON(st.data)); localStorage.catsUpdated = st.updated; changed = true;
      } else if (localUpd > (st?.updated || 0)) {
        await sb.from('user_settings').update({ data: await encJSON(JSON.parse(localStorage.cats || '[]')), updated: localUpd }).eq('user_id', user.id);
      }
      api.onStatus('ok');
      if (changed) api.onChange();
    } catch (e) { console.warn(e); api.onStatus('error', e.message); }
    syncing = false;
    if (again) { again = false; sync(); }
  }
  api.sync = sync;
  if (enabled) {
    addEventListener('online', sync);
    setInterval(sync, 60000);
  }
  return api;
})();
