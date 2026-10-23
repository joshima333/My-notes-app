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
    // non aspettare la rete: se senza internet, usa la sessione salvata sul telefono
    const timeout = new Promise(r => setTimeout(() => r(null), 1200));
    const res = await Promise.race([sb.auth.getSession(), timeout]);
    user = res?.data?.session?.user || null;
    if (!res) {
      try {
        const k = Object.keys(localStorage).find(x => /^sb-.*-auth-token$/.test(x));
        user = JSON.parse(localStorage[k])?.user || null;
      } catch { user = null; }
      sb.auth.getSession().then(r => { if (r.data.session?.user) user = r.data.session.user; });
    }
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
    if (prev && prev !== user.id) { await DB.clear(); localStorage.removeItem('catsUpdated'); localStorage.removeItem('name'); }
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
    localStorage.removeItem('catsUpdated'); localStorage.removeItem('name');
    key = user = null;
  };

  api.markDeleted = async (id, photos) => {
    if (!key) return;
    const dead = (await DB.getMeta('dead')) || [];
    dead.push(id); await DB.setMeta('dead', dead);
    for (const p of photos || []) await api.removeFile(`${id}/${p.id}`);
    api.schedule();
  };
  api.removeFile = async path => {
    if (!key) return;
    const files = (await DB.getMeta('deadFiles')) || [];
    files.push(path); await DB.setMeta('deadFiles', files); api.schedule();
  };
  api.fetchPhoto = async (noteId, p) => {
    const { data, error } = await sb.storage.from('audio').download(`${user.id}/${noteId}/${p.id}`);
    if (error) fail(error);
    return new Blob([await decrypt(new Uint8Array(await data.arrayBuffer()))], { type: p.type || 'image/jpeg' });
  };
  api.schedule = () => { if (!key) return; clearTimeout(timer); timer = setTimeout(sync, 1500); };

  api.fetchAudio = async n => {
    const { data, error } = await sb.storage.from('audio').download(`${user.id}/${n.id}`);
    if (error) fail(error);
    return new Blob([await decrypt(new Uint8Array(await data.arrayBuffer()))], { type: n.mime || 'audio/mp4' });
  };

  const pick = n => ({ created: n.created, category: n.category, title: n.title, text: n.text,
    duration: n.duration, pending: !!n.pending, failed: !!n.failed, mime: n.audio?.type || n.mime || '', items: n.items || null, pinned: !!n.pinned, archived: !!n.archived, done: !!n.done, keepActive: !!n.keepActive,
    photos: (n.photos || []).map(p => ({ id: p.id, type: p.type, text: p.text || '' })), shared: n.shared || null, noEvent: !!n.noEvent });

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
      const files = (await DB.getMeta('deadFiles')) || [];
      if (files.length) {
        await sb.storage.from('audio').remove(files.map(f => `${user.id}/${f}`));
        await DB.setMeta('deadFiles', ((await DB.getMeta('deadFiles')) || []).filter(f => !files.includes(f)));
      }
      // 2. invio modifiche locali
      for (const n of await DB.all()) {
        if (!n.dirty) continue;
        if (n.audio && !n.audioSynced) {
          const blob = new Blob([await encrypt(new Uint8Array(await n.audio.arrayBuffer()))], { type: 'application/octet-stream' });
          const r = await sb.storage.from('audio').upload(`${user.id}/${n.id}`, blob, { upsert: true, contentType: 'application/octet-stream' });
          if (r.error) fail(r.error);
        }
        const sent = [];
        for (const p of n.photos || []) if (p.blob && !p.synced) {
          const blob = new Blob([await encrypt(new Uint8Array(await p.blob.arrayBuffer()))], { type: 'application/octet-stream' });
          const up = await sb.storage.from('audio').upload(`${user.id}/${n.id}/${p.id}`, blob, { upsert: true, contentType: 'application/octet-stream' });
          if (up.error) fail(up.error);
          sent.push(p.id);
        }
        const r = await sb.from('notes').upsert({ id: n.id, user_id: user.id, data: await encJSON(pick(n)),
          has_audio: !!(n.audio || n.hasAudio), deleted: false, updated: n.updated });
        if (r.error) fail(r.error);
        const cur = await DB.get(n.id);
        if (cur) {
          for (const p of cur.photos || []) if (sent.includes(p.id)) p.synced = true;
          if (cur.updated === n.updated) { cur.dirty = false; cur.audioSynced = !!cur.audio; }
          await DB.put(cur);
        }
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
        const photos = (d.photos || []).map(p => ({ ...p, blob: local?.photos?.find(x => x.id === p.id)?.blob || null, synced: true }));
        await DB.put({ ...d, photos, id: r.id, updated: r.updated, dirty: false, hasAudio: r.has_audio,
          audio: local?.audio || null, audioSynced: true });
        changed = true;
      }
      // 3b. liste condivise
      for (const n of await DB.all()) {
        if (!n.shared) continue;
        try {
          const merged = await api.syncShared(n);
          if (canon(merged) !== canon(n.items)) {
            const cur = await DB.get(n.id); cur.items = merged; cur.updated = Date.now(); cur.dirty = true; await DB.put(cur); changed = true; again = true;
          }
        } catch (e) { console.warn('lista condivisa', e); }
      }
      // 4. raccolte
      const { data: st } = await sb.from('user_settings').select('data,updated').eq('user_id', user.id).single();
      const localUpd = +localStorage.catsUpdated || 0;
      if (st?.data && st.updated > localUpd) {
        const prof = await decJSON(st.data);
        if (Array.isArray(prof)) localStorage.cats = JSON.stringify(prof);
        else { localStorage.cats = JSON.stringify(prof.cats || []); if (prof.name) localStorage.name = prof.name; if (prof.meta) localStorage.catMeta = JSON.stringify(prof.meta); if (prof.calendars) localStorage.calendars = JSON.stringify(prof.calendars); }
        localStorage.catsUpdated = st.updated; changed = true;
      } else if (localUpd > (st?.updated || 0)) {
        await sb.from('user_settings').update({ data: await encJSON({ cats: JSON.parse(localStorage.cats || '[]'), name: localStorage.name || '', meta: JSON.parse(localStorage.catMeta || '{}'), calendars: JSON.parse(localStorage.calendars || '[]') }), updated: localUpd }).eq('user_id', user.id);
      }
      api.onStatus('ok');
      if (changed) api.onChange();
    } catch (e) { console.warn(e); api.onStatus('error', e.message); }
    syncing = false;
    if (again) { again = false; sync(); }
  }
  api.sync = sync;
  // scarica un calendario esterno tramite la funzione "calendario" di Supabase
  api.fetchCalendar = async url => {
    const { data, error } = await sb.functions.invoke('calendario', { body: { url } });
    if (error) {
      let msg = error.message;
      try { msg = await error.context.text(); } catch {}
      if (/not found|404/i.test(msg)) msg = 'la funzione "calendario" non è ancora attiva su Supabase';
      throw new Error(msg);
    }
    return typeof data === 'string' ? data : await new Response(data).text();
  };

  // ---------- Liste condivise ----------
  // Ogni lista ha una sua chiave, che viaggia solo nel link (dopo il #): il server non la vede mai.
  const b64u = b => b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = s => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const listKey = k => crypto.subtle.importKey('raw', unb64u(k), 'AES-GCM', false, ['encrypt', 'decrypt']);
  async function encWith(k, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await listKey(k), te.encode(JSON.stringify(obj))));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return b64(out);
  }
  async function decWith(k, s) {
    const b = unb64(s);
    return JSON.parse(td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, await listKey(k), b.slice(12))));
  }
  // unione: per ogni voce vince la modifica più recente
  api.mergeItems = (a = [], b = []) => {
    const m = new Map();
    for (const it of [...a, ...b]) { const o = m.get(it.id); if (!o || (it.u || 0) > (o.u || 0)) m.set(it.id, it); }
    return [...m.values()];
  };
  const canon = items => JSON.stringify([...(items || [])].sort((a, b) => a.id < b.id ? -1 : 1));
  api.shareList = async n => {
    if (!key) throw new Error('Serve l\'accesso all\'account');
    const id = crypto.randomUUID(), k = b64u(crypto.getRandomValues(new Uint8Array(32)));
    const updated = Date.now();
    let r = await sb.from('shared_lists').insert({ id, data: await encWith(k, { title: n.title, items: n.items || [] }), updated });
    if (r.error) fail(r.error);
    r = await sb.from('shared_list_members').insert({ list_id: id });
    if (r.error) fail(r.error);
    n.shared = { id, key: k };
    return api.shareLink(n);
  };
  api.shareLink = n => `${location.origin}${location.pathname}#lista=${n.shared.id}.${n.shared.key}`;
  api.joinList = async (id, k) => {
    const r = await sb.from('shared_list_members').insert({ list_id: id });
    if (r.error && r.error.code !== '23505') fail(r.error);
    const { data, error } = await sb.from('shared_lists').select('data,updated').eq('id', id).single();
    if (error) fail(error);
    const d = await decWith(k, data.data);
    return { title: d.title, items: d.items, shared: { id, key: k, seen: data.updated } };
  };
  // scarica le modifiche degli altri e invia le proprie
  api.syncShared = async n => {
    const { data, error } = await sb.from('shared_lists').select('data,updated').eq('id', n.shared.id).single();
    if (error) fail(error);
    const remote = await decWith(n.shared.key, data.data);
    const merged = api.mergeItems(remote.items, n.items);
    const changedRemote = canon(merged) !== canon(remote.items);
    if (changedRemote) {
      const updated = Date.now();
      const up = await sb.from('shared_lists').update({ data: await encWith(n.shared.key, { title: remote.title || n.title, items: merged }), updated }).eq('id', n.shared.id);
      if (up.error) fail(up.error);
    }
    return merged;
  };
  let channel = null;
  api.watchShared = cb => {
    if (!sb || channel) return;
    channel = sb.channel('liste').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'shared_lists' }, p => cb(p.new.id)).subscribe();
  };
  if (enabled) {
    addEventListener('online', sync);
    setInterval(sync, 60000);
  }
  return api;
})();
