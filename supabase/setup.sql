-- Animeteca: tabella per sincronizzare la lista tra iPhone, iPad, ecc.
-- Da incollare una volta sola in Supabase: SQL Editor -> New query -> Run.
-- Si può rieseguire senza problemi.

-- Una riga per ogni account, con tutti i suoi dati (lista, episodi, tempi).
create table if not exists public.animeteca_data (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  rev bigint not null default 0,          -- versione: evita che due dispositivi si sovrascrivano
  updated_at timestamptz not null default now()
);

-- Sicurezza: ognuno può leggere e modificare solo la propria riga.
alter table public.animeteca_data enable row level security;

drop policy if exists "Leggo i miei dati" on public.animeteca_data;
create policy "Leggo i miei dati" on public.animeteca_data
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Creo i miei dati" on public.animeteca_data;
create policy "Creo i miei dati" on public.animeteca_data
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "Modifico i miei dati" on public.animeteca_data;
create policy "Modifico i miei dati" on public.animeteca_data
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Cancello i miei dati" on public.animeteca_data;
create policy "Cancello i miei dati" on public.animeteca_data
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Chi non ha fatto l'accesso non vede niente; chi l'ha fatto passa dalle regole qui sopra.
revoke all on public.animeteca_data from anon;
grant select, insert, update, delete on public.animeteca_data to authenticated;
