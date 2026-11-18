-- Animeteca: community (nome utente, amici, voti e liste visibili agli amici, consigli).
-- Da eseguire una volta in Supabase (SQL Editor -> New query -> Run), dopo setup.sql.
-- Si può rieseguire senza problemi.
--
-- Privacy: un utente vede di un altro solo
--   - nome utente e nome, se tra loro c'è una richiesta di amicizia o un'amicizia;
--   - stato, episodio, voto e recensione degli anime, solo se sono amici (accettati).
-- Le note personali NON stanno qui: restano solo nella tabella privata animeteca_data.
-- Non esiste un elenco degli utenti: si trova qualcuno solo con il nome utente esatto.

-- ---------------------------------------------------------------- tabelle

-- Profilo pubblico (per gli amici): nome utente unico, minuscolo
create table if not exists public.profiles (
  id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.]{3,20}$'),
  display_name text check (char_length(display_name) <= 40),
  created_at timestamptz not null default now()
);

-- Amicizie: chi la chiede (requester) e chi la riceve (addressee); 'pending' finché non viene accettata
create table if not exists public.friendships (
  id bigint generated always as identity primary key,
  requester uuid not null default auth.uid(),
  addressee uuid not null,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friendships_requester_fkey foreign key (requester) references public.profiles (id) on delete cascade,
  constraint friendships_addressee_fkey foreign key (addressee) references public.profiles (id) on delete cascade,
  constraint friendships_not_self check (requester <> addressee)
);
-- una sola amicizia per coppia, in qualunque direzione
create unique index if not exists friendships_pair_idx
  on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index if not exists friendships_requester_idx on public.friendships (requester);
create index if not exists friendships_addressee_idx on public.friendships (addressee);

-- Ciò che gli amici vedono della tua lista: stato, episodio, voto (da 0,5 a 5) e recensione
create table if not exists public.library (
  user_id uuid not null default auth.uid(),
  anime_id text not null check (char_length(anime_id) <= 40),
  al_id integer,
  title text not null check (char_length(title) <= 300),
  image text check (char_length(image) <= 500 and image ~ '^https://'),
  status text not null check (status in ('plan', 'watching', 'done')),
  ep integer not null default 0 check (ep >= 0),
  episodes integer check (episodes >= 0),
  rating numeric(2, 1) check (rating >= 0.5 and rating <= 5 and rating * 2 = floor(rating * 2)),
  review text check (char_length(review) <= 1000),
  updated_at timestamptz not null default now(),
  primary key (user_id, anime_id),
  constraint library_user_id_fkey foreign key (user_id) references public.profiles (id) on delete cascade
);
create index if not exists library_updated_idx on public.library (updated_at desc);
create index if not exists library_anime_idx on public.library (anime_id);

-- Consigli tra amici
create table if not exists public.recommendations (
  id bigint generated always as identity primary key,
  from_user uuid not null default auth.uid(),
  to_user uuid not null,
  anime_id text not null check (char_length(anime_id) <= 40),
  al_id integer,
  title text not null check (char_length(title) <= 300),
  image text check (char_length(image) <= 500 and image ~ '^https://'),
  message text check (char_length(message) <= 280),
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  constraint recommendations_from_user_fkey foreign key (from_user) references public.profiles (id) on delete cascade,
  constraint recommendations_to_user_fkey foreign key (to_user) references public.profiles (id) on delete cascade
);
create index if not exists recommendations_to_idx on public.recommendations (to_user, created_at desc);
create index if not exists recommendations_from_idx on public.recommendations (from_user);

-- ---------------------------------------------------------------- funzioni

-- Schema privato: non raggiungibile dalle API, usato solo dalle regole di sicurezza
create schema if not exists private;

-- Gli amici (accettati) di chi sta usando l'app
create or replace function private.friend_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select case when f.requester = (select auth.uid()) then f.addressee else f.requester end
  from public.friendships f
  where f.status = 'accepted'
    and (f.requester = (select auth.uid()) or f.addressee = (select auth.uid()));
$$;

-- Chi ha una richiesta o un'amicizia con chi sta usando l'app (per vederne il nome utente)
create or replace function private.connected_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select case when f.requester = (select auth.uid()) then f.addressee else f.requester end
  from public.friendships f
  where f.requester = (select auth.uid()) or f.addressee = (select auth.uid());
$$;

-- Cerca un utente con il nome utente esatto (niente ricerche parziali né elenchi).
-- La ricerca vera sta nello schema privato; l'app chiama public.find_user, che la usa.
create or replace function private.find_user(p_username text)
returns table (id uuid, username text, display_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username, p.display_name
  from public.profiles p
  where (select auth.uid()) is not null
    and p.username = lower(trim(p_username))
    and p.id <> (select auth.uid());
$$;
create or replace function public.find_user(p_username text)
returns table (id uuid, username text, display_name text)
language sql stable security invoker set search_path = '' as $$
  select * from private.find_user(p_username);
$$;

revoke all on function private.friend_ids() from public, anon;
revoke all on function private.connected_ids() from public, anon;
revoke all on function private.find_user(text) from public, anon;
revoke all on function public.find_user(text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.friend_ids() to authenticated;
grant execute on function private.connected_ids() to authenticated;
grant execute on function private.find_user(text) to authenticated;
grant execute on function public.find_user(text) to authenticated;

-- ---------------------------------------------------------------- regole di sicurezza (RLS)

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.library enable row level security;
alter table public.recommendations enable row level security;

-- Profili: il mio e quelli delle persone con cui ho una richiesta o un'amicizia
drop policy if exists "Profili: vedo il mio e chi conosco" on public.profiles;
create policy "Profili: vedo il mio e chi conosco" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or id in (select private.connected_ids()));
drop policy if exists "Profili: creo il mio" on public.profiles;
create policy "Profili: creo il mio" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
drop policy if exists "Profili: modifico il mio" on public.profiles;
create policy "Profili: modifico il mio" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Amicizie: le vedono solo i due interessati
drop policy if exists "Amicizie: vedo le mie" on public.friendships;
create policy "Amicizie: vedo le mie" on public.friendships
  for select to authenticated
  using (requester = (select auth.uid()) or addressee = (select auth.uid()));
-- chiedo l'amicizia solo a mio nome, e parte sempre "in attesa"
drop policy if exists "Amicizie: chiedo" on public.friendships;
create policy "Amicizie: chiedo" on public.friendships
  for insert to authenticated
  with check (requester = (select auth.uid()) and status = 'pending');
-- solo chi riceve la richiesta può accettarla
drop policy if exists "Amicizie: accetto" on public.friendships;
create policy "Amicizie: accetto" on public.friendships
  for update to authenticated
  using (addressee = (select auth.uid()))
  with check (addressee = (select auth.uid()) and status = 'accepted');
-- rifiutare, annullare o togliere un amico: tutti e due possono cancellarla
drop policy if exists "Amicizie: cancello" on public.friendships;
create policy "Amicizie: cancello" on public.friendships
  for delete to authenticated
  using (requester = (select auth.uid()) or addressee = (select auth.uid()));

-- Lista condivisa: la mia la gestisco io; quella degli amici la posso solo leggere
drop policy if exists "Lista: vedo la mia e quella degli amici" on public.library;
create policy "Lista: vedo la mia e quella degli amici" on public.library
  for select to authenticated
  using (user_id = (select auth.uid()) or user_id in (select private.friend_ids()));
drop policy if exists "Lista: aggiungo alla mia" on public.library;
create policy "Lista: aggiungo alla mia" on public.library
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "Lista: modifico la mia" on public.library;
create policy "Lista: modifico la mia" on public.library
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Lista: tolgo dalla mia" on public.library;
create policy "Lista: tolgo dalla mia" on public.library
  for delete to authenticated using (user_id = (select auth.uid()));

-- Consigli: li vedono solo chi li manda e chi li riceve; si mandano solo agli amici
drop policy if exists "Consigli: vedo i miei" on public.recommendations;
create policy "Consigli: vedo i miei" on public.recommendations
  for select to authenticated
  using (from_user = (select auth.uid()) or to_user = (select auth.uid()));
drop policy if exists "Consigli: mando agli amici" on public.recommendations;
create policy "Consigli: mando agli amici" on public.recommendations
  for insert to authenticated
  with check (from_user = (select auth.uid()) and to_user in (select private.friend_ids()));
drop policy if exists "Consigli: segno come visti" on public.recommendations;
create policy "Consigli: segno come visti" on public.recommendations
  for update to authenticated
  using (to_user = (select auth.uid())) with check (to_user = (select auth.uid()));
drop policy if exists "Consigli: cancello" on public.recommendations;
create policy "Consigli: cancello" on public.recommendations
  for delete to authenticated
  using (from_user = (select auth.uid()) or to_user = (select auth.uid()));

-- ---------------------------------------------------------------- permessi
-- Supabase di base dà tutti i permessi su tutte le tabelle: qui si lascia solo il necessario.
revoke all on public.profiles, public.friendships, public.library, public.recommendations from anon, authenticated;
grant select, insert on public.profiles to authenticated;
grant update (username, display_name) on public.profiles to authenticated;
grant select, insert, delete on public.friendships to authenticated;
grant update (status, responded_at) on public.friendships to authenticated;
grant select, insert, update, delete on public.library to authenticated;
grant select, insert, delete on public.recommendations to authenticated;
grant update (seen_at) on public.recommendations to authenticated;
