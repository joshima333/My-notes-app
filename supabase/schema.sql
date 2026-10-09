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
