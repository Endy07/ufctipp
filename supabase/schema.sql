-- UfcTipp — Supabase séma. A Supabase SQL Editorában egyszer kell lefuttatni (újrafuttatható).
-- Utána: seed-ufc-333.sql, végül az admin-PIN beállítása (lásd a README-t; a PIN a repóba NEM kerül).
--
-- Elv: a böngésző (anon kulcs) a táblákat közvetlenül nem írhatja és — a meccseken kívül — nem is olvashatja.
-- Minden művelet az alábbi SECURITY DEFINER függvényeken át megy, amelyek ellenőrzik a PIN-t és a zárást.
-- A hívható függvények hiba esetén {"error": "..."} JSON-t adnak vissza (nem kivételt), hogy a hibás
-- PIN-próbálkozás naplója megmaradjon (egy kivétel a naplózást is visszagörgetné).

create extension if not exists pgcrypto with schema extensions;

create table if not exists settings (
  key   text primary key,
  value text not null
);

create table if not exists fights (
  id         integer primary key,          -- a UFC.com fight-azonosítója (data-fmid)
  event      text    not null,
  ord        integer not null,             -- 1 = fő meccs
  card       text    not null check (card in ('main', 'prelims', 'early')),
  title_bout boolean not null default false,
  points     integer not null default 1,
  status     text    not null default 'open' check (status in ('open', 'locked', 'done')),
  lock_at    timestamptz,                  -- tartalék automatikus zárás; null = csak az admin zár
  winner     text    check (winner in ('A', 'B', 'draw', 'nc')),
  method     text,
  round      integer,
  time       text,
  updated_at timestamptz not null default now()
);

create table if not exists players (
  id         bigint generated always as identity primary key,
  nick       text not null,
  pin_hash   text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists players_nick_lower on players (lower(nick));

create table if not exists picks (
  player_id  bigint  not null references players (id) on delete cascade,
  fight_id   integer not null references fights (id) on delete cascade,
  side       text    not null check (side in ('A', 'B')),
  updated_at timestamptz not null default now(),
  primary key (player_id, fight_id)
);

-- Sikertelen PIN-próbálkozások (fékezés a 4 jegyű PIN találgatása ellen)
create table if not exists login_fails (
  nick text not null,
  at   timestamptz not null default now()
);

alter table settings    enable row level security;
alter table fights      enable row level security;
alter table players     enable row level security;
alter table picks       enable row level security;
alter table login_fails enable row level security;

drop policy if exists fights_read on fights;
create policy fights_read on fights for select to anon, authenticated using (true);
-- a többi táblán nincs policy → anon kulccsal közvetlenül elérhetetlen

-- ---------------------------------------------------------------- segédfüggvények

-- Nyitott-e még a meccs tippelésre (admin nem zárta, és a tartalék időpont sem járt le)
create or replace function fight_is_open(f fights) returns boolean
language sql stable set search_path = public as $$
  select f.status = 'open' and (f.lock_at is null or now() < f.lock_at);
$$;

-- Játékos azonosítása becenév + PIN alapján. Hibánál id = null és err = az üzenet.
create or replace function auth_player(p_nick text, p_pin text, out id bigint, out err text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
begin
  if (select count(*) from login_fails l where lower(l.nick) = lower(trim(p_nick)) and l.at > now() - interval '10 minutes') >= 8 then
    err := 'Túl sok hibás PIN. Próbáld újra 10 perc múlva.';
    return;
  end if;
  select p.id, p.pin_hash into id, v_hash from players p where lower(p.nick) = lower(trim(p_nick));
  if id is null then
    err := 'Nincs ilyen becenév.';
    return;
  end if;
  if v_hash <> crypt(coalesce(p_pin, ''), v_hash) then
    insert into login_fails (nick) values (trim(p_nick));
    id := null;
    err := 'Hibás PIN.';
  end if;
end $$;

-- Admin-PIN ellenőrzése. Null = rendben, különben a hibaüzenet.
create or replace function auth_admin(p_pin text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
begin
  if (select count(*) from login_fails where nick = '#admin' and at > now() - interval '10 minutes') >= 8 then
    return 'Túl sok hibás admin-PIN. Próbáld újra 10 perc múlva.';
  end if;
  select value into v_hash from settings where key = 'admin_pin_hash';
  if v_hash is null then
    return 'Az admin-PIN nincs beállítva (lásd README).';
  end if;
  if v_hash <> crypt(coalesce(p_pin, ''), v_hash) then
    insert into login_fails (nick) values ('#admin');
    return 'Hibás admin-PIN.';
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------- játékos-függvények

-- Csatlakozás: új becenév esetén létrehozza a játékost, létezőnél bejelentkeztet
create or replace function join_game(p_nick text, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_nick text := trim(p_nick);
  v_new boolean := false;
  a record;
begin
  if v_nick is null or v_nick !~ '^[[:alnum:] _.\-áéíóöőúüűÁÉÍÓÖŐÚÜŰ]{2,20}$' then
    return json_build_object('error', 'A becenév 2–20 karakter legyen (betű, szám, szóköz, _ . -).');
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return json_build_object('error', 'A PIN 4 számjegy legyen.');
  end if;
  if not exists (select 1 from players where lower(nick) = lower(v_nick)) then
    insert into players (nick, pin_hash) values (v_nick, crypt(p_pin, gen_salt('bf')));
    v_new := true;
  end if;
  select * into a from auth_player(v_nick, p_pin);
  if a.err is not null then
    if a.err = 'Hibás PIN.' then
      return json_build_object('error', 'Ez a becenév már foglalt, és a PIN nem egyezik. Ha a tiéd, írd be a régi PIN-edet.');
    end if;
    return json_build_object('error', a.err);
  end if;
  return json_build_object('nick', (select nick from players where id = a.id), 'created', v_new);
end $$;

create or replace function my_picks(p_nick text, p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  a record;
begin
  select * into a from auth_player(p_nick, p_pin);
  if a.err is not null then
    return json_build_object('error', a.err);
  end if;
  return json_build_object('picks',
    coalesce((select json_object_agg(fight_id, side) from picks where player_id = a.id), '{}'::json));
end $$;

create or replace function place_pick(p_nick text, p_pin text, p_fight integer, p_side text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  a record;
  f fights;
begin
  select * into a from auth_player(p_nick, p_pin);
  if a.err is not null then
    return json_build_object('error', a.err);
  end if;
  select * into f from fights where fights.id = p_fight;
  if f.id is null then
    return json_build_object('error', 'Nincs ilyen meccs.');
  end if;
  if not fight_is_open(f) then
    return json_build_object('error', 'Erre a meccsre már nem lehet tippelni — lezárták.');
  end if;
  if p_side is null then
    delete from picks where player_id = a.id and fight_id = p_fight;
  elsif p_side in ('A', 'B') then
    insert into picks (player_id, fight_id, side) values (a.id, p_fight, p_side)
    on conflict (player_id, fight_id) do update set side = excluded.side, updated_at = now();
  else
    return json_build_object('error', 'Érvénytelen oldal.');
  end if;
  return json_build_object('fight', p_fight, 'side', p_side);
end $$;

-- Nyilvános állapot: meccsenként a tippek száma; lezárt meccsnél a tippek névvel is; ranglista
create or replace function get_board(p_event text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'now', now(),
    'players', (select count(*) from players),
    'fights', coalesce((
      select json_agg(json_build_object(
        'id', f.id, 'status', f.status, 'open', fight_is_open(f), 'lock_at', f.lock_at,
        'winner', f.winner, 'method', f.method, 'round', f.round, 'time', f.time, 'points', f.points,
        'count_a', (select count(*) from picks p where p.fight_id = f.id and p.side = 'A'),
        'count_b', (select count(*) from picks p where p.fight_id = f.id and p.side = 'B'),
        'picks', case when fight_is_open(f) then null else (
          select coalesce(json_agg(json_build_object('nick', pl.nick, 'side', p.side) order by lower(pl.nick)), '[]'::json)
          from picks p join players pl on pl.id = p.player_id where p.fight_id = f.id) end
      ) order by f.ord)
      from fights f where f.event = p_event), '[]'::json),
    'leaderboard', coalesce((
      select json_agg(r order by r.points desc, r.correct desc, lower(r.nick))
      from (
        select pl.nick,
               coalesce(sum(case when f.status = 'done' and f.winner = p.side then f.points else 0 end), 0)::int as points,
               count(f.id) filter (where f.status = 'done' and f.winner = p.side)::int as correct,
               count(f.id) filter (where f.status = 'done' and f.winner in ('A', 'B'))::int as decided,
               count(f.id)::int as picks
        from players pl
        left join picks p on p.player_id = pl.id
        left join fights f on f.id = p.fight_id and f.event = p_event
        group by pl.id, pl.nick
      ) r), '[]'::json)
  );
$$;

-- ---------------------------------------------------------------- admin-függvények

create or replace function admin_check(p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_err text := auth_admin(p_pin);
begin
  if v_err is not null then
    return json_build_object('error', v_err);
  end if;
  return json_build_object('ok', true);
end $$;

-- Meccs állapotának módosítása. p_status: open | locked | done. Eredménynél p_winner: A | B | draw | nc.
create or replace function admin_set_fight(
  p_pin text, p_fight integer, p_status text, p_winner text default null,
  p_method text default null, p_round integer default null, p_time text default null
) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_err text := auth_admin(p_pin);
begin
  if v_err is not null then
    return json_build_object('error', v_err);
  end if;
  if p_status is null or p_status not in ('open', 'locked', 'done') then
    return json_build_object('error', 'Érvénytelen állapot.');
  end if;
  if p_status = 'done' and (p_winner is null or p_winner not in ('A', 'B', 'draw', 'nc')) then
    return json_build_object('error', 'Eredményhez győztes kell (A, B, döntetlen vagy no contest).');
  end if;
  update fights set
    status  = p_status,
    -- újranyitáskor a lejárt tartalék időpontot töröljük, különben azonnal visszazárna
    lock_at = case when p_status = 'open' and lock_at is not null and lock_at <= now() then null else lock_at end,
    winner  = case when p_status = 'done' then p_winner else null end,
    method  = case when p_status = 'done' then nullif(trim(p_method), '') else null end,
    round   = case when p_status = 'done' then p_round else null end,
    time    = case when p_status = 'done' then nullif(trim(p_time), '') else null end,
    updated_at = now()
  where id = p_fight;
  if not found then
    return json_build_object('error', 'Nincs ilyen meccs.');
  end if;
  return json_build_object('fight', p_fight, 'status', p_status);
end $$;

create or replace function admin_set_lock_at(p_pin text, p_fight integer, p_lock_at timestamptz) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_err text := auth_admin(p_pin);
begin
  if v_err is not null then
    return json_build_object('error', v_err);
  end if;
  update fights set lock_at = p_lock_at, updated_at = now() where id = p_fight;
  return json_build_object('fight', p_fight, 'lock_at', p_lock_at);
end $$;

create or replace function admin_players(p_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_err text := auth_admin(p_pin);
begin
  if v_err is not null then
    return json_build_object('error', v_err);
  end if;
  return json_build_object('players', coalesce((
    select json_agg(json_build_object('nick', nick, 'created_at', created_at,
                                      'picks', (select count(*) from picks where player_id = players.id))
                    order by lower(nick))
    from players), '[]'::json));
end $$;

create or replace function admin_delete_player(p_pin text, p_nick text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_err text := auth_admin(p_pin);
begin
  if v_err is not null then
    return json_build_object('error', v_err);
  end if;
  delete from players where lower(nick) = lower(trim(p_nick));
  return json_build_object('deleted', p_nick);
end $$;

create or replace function admin_reset_pin(p_pin text, p_nick text, p_new_pin text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_err text := auth_admin(p_pin);
begin
  if v_err is not null then
    return json_build_object('error', v_err);
  end if;
  if p_new_pin is null or p_new_pin !~ '^[0-9]{4}$' then
    return json_build_object('error', 'A PIN 4 számjegy legyen.');
  end if;
  update players set pin_hash = crypt(p_new_pin, gen_salt('bf')) where lower(nick) = lower(trim(p_nick));
  delete from login_fails where lower(nick) = lower(trim(p_nick));
  return json_build_object('reset', p_nick);
end $$;

-- ---------------------------------------------------------------- jogosultságok
-- A belső segédfüggvényeket a böngésző nem hívhatja közvetlenül.
revoke all on function auth_player(text, text) from public, anon, authenticated;
revoke all on function auth_admin(text) from public, anon, authenticated;

grant execute on function join_game(text, text)                 to anon, authenticated;
grant execute on function my_picks(text, text)                  to anon, authenticated;
grant execute on function place_pick(text, text, integer, text) to anon, authenticated;
grant execute on function get_board(text)                       to anon, authenticated;
grant execute on function admin_check(text)                     to anon, authenticated;
grant execute on function admin_set_fight(text, integer, text, text, text, integer, text) to anon, authenticated;
grant execute on function admin_set_lock_at(text, integer, timestamptz) to anon, authenticated;
grant execute on function admin_players(text)                   to anon, authenticated;
grant execute on function admin_delete_player(text, text)       to anon, authenticated;
grant execute on function admin_reset_pin(text, text, text)     to anon, authenticated;
