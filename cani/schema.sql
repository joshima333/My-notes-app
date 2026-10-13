-- Diario Cani (Kafka e Zoe): incolla nel "SQL Editor" di Supabase e premi Run.
create table if not exists public.pet_records (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  dog text not null,               -- 'kafka' | 'zoe'
  kind text not null,              -- crisi | terapia | analisi | vaccino | salute
  data jsonb not null,
  deleted boolean not null default false,
  updated bigint not null
);
alter table public.pet_records enable row level security;
create policy "solo i miei dati cani" on public.pet_records for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
