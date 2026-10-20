-- Note Vocali: incolla tutto nel "SQL Editor" di Supabase e premi Run.
create table if not exists public.notes (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  data text,                       -- nota cifrata sul telefono
  has_audio boolean not null default false,
  deleted boolean not null default false,
  updated bigint not null
);
alter table public.notes enable row level security;
create policy "solo le mie note" on public.notes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  salt text not null,
  verifier text,
  data text,                       -- raccolte cifrate
  updated bigint not null default 0
);
alter table public.user_settings enable row level security;
create policy "solo le mie impostazioni" on public.user_settings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public) values ('audio', 'audio', false)
  on conflict (id) do nothing;
create policy "solo i miei audio" on storage.objects for all to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);

-- ===== Aggiornamento: liste della spesa condivise (eseguire anche questa parte) =====
create table if not exists public.shared_lists (
  id uuid primary key,
  data text,                       -- lista cifrata con una chiave che sta solo nel link
  updated bigint not null default 0,
  created_by uuid not null default auth.uid() references auth.users on delete cascade
);
create table if not exists public.shared_list_members (
  list_id uuid not null references public.shared_lists on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  primary key (list_id, user_id)
);
alter table public.shared_lists enable row level security;
alter table public.shared_list_members enable row level security;
create policy "crea lista" on public.shared_lists for insert to authenticated with check (created_by = auth.uid());
create policy "leggi lista se membro" on public.shared_lists for select to authenticated
  using (exists (select 1 from public.shared_list_members m where m.list_id = id and m.user_id = auth.uid()));
create policy "modifica lista se membro" on public.shared_lists for update to authenticated
  using (exists (select 1 from public.shared_list_members m where m.list_id = id and m.user_id = auth.uid()));
create policy "unisciti" on public.shared_list_members for insert to authenticated with check (user_id = auth.uid());
create policy "vedi le tue iscrizioni" on public.shared_list_members for select to authenticated using (user_id = auth.uid());
create policy "esci dalla lista" on public.shared_list_members for delete to authenticated using (user_id = auth.uid());
alter publication supabase_realtime add table public.shared_lists;
