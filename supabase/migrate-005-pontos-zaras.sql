-- UfcTipp — 005: pontos zárás a meccs tényleges kezdetekor (2026-10-24). Újrafuttatható.
-- Ok: a menetrendi tartalék lock_at és az ESPN „in / pre-fight” (period 0) állapota is a bevonulás alatt zárt.
--  - az espn_apply csak az 1. menet indulásakor (state 'in' ÉS period >= 1), vagy 'post' állapotban zár
--  - megszűnik az „előző meccs eredménye → a következő azonnal zár” szabály
--  - a jövőbeli (menetrendi) tartalék lock_at törlődik a nyitott meccsekről
--  - gála idején az espn_tick 10 másodpercenként kér az ESPN-től (pg_cron '10 seconds'), azon kívül 55 mp-enként
-- Ellenőrzés: test-005.sql (egy „OK” sor).

create or replace function espn_apply(p_json jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  c jsonb;
  f fights;
  v_state text;
  v_period int;
  v_done boolean;
  v_winners jsonb;
  v_win text;
  v_side text;
  v_det text;
  v_locked int[] := '{}';
  v_decided int[] := '{}';
begin
  for c in select comp from jsonb_array_elements(coalesce(p_json->'events', '[]')) e,
                         jsonb_array_elements(coalesce(e->'competitions', '[]')) comp loop
    select * into f from fights where espn_id = c->>'id';
    if f.id is null then
      continue;
    end if;
    v_state := c#>>'{status,type,state}';
    v_period := coalesce((c#>>'{status,period}')::int, 0);
    v_done := coalesce((c#>>'{status,type,completed}')::boolean, false);

    -- zárás: az 1. menet elindult (a pre-fight „in” állapot, period 0, még nem zár), vagy már vége van
    if (v_state = 'post' or (v_state = 'in' and v_period >= 1))
       and f.status = 'open' and f.lock_source is distinct from 'manual' then
      update fights set status = 'locked', lock_source = 'auto', updated_at = now() where id = f.id;
      v_locked := v_locked || f.id;
      f.status := 'locked';
    end if;

    if v_done and f.status <> 'done' and f.result_source is distinct from 'manual' then
      select coalesce(jsonb_agg(x), '[]') into v_winners from jsonb_array_elements(c->'competitors') x
      where (x->>'winner')::boolean;
      if jsonb_array_length(v_winners) = 1 and f.espn_a is not null
         and exists (select 1 from jsonb_array_elements(c->'competitors') x where x->>'id' = f.espn_a) then
        v_win := v_winners->0->>'id';
        v_side := case when v_win = f.espn_a then 'A' else 'B' end;
        select d->'type'->>'text' into v_det from jsonb_array_elements(coalesce(c->'details', '[]')) d
        where d->'type'->>'text' like 'Unofficial Winner %' limit 1;
        update fights set
          status = 'done', winner = v_side, result_source = 'auto',
          method = case
            when v_det ilike '%ko%tko%' or v_det ilike '%kotko%' then 'KO/TKO'
            when v_det ilike '%submission%' then 'Feladás'
            when v_det ilike '%decision%' then 'Pontozás'
            else method end,
          round = coalesce((c#>>'{status,period}')::int, round),
          time = coalesce(c#>>'{status,displayClock}', time),
          updated_at = now()
        where id = f.id;
        v_decided := v_decided || f.id;
      end if;
    end if;
  end loop;
  return json_build_object('locked', to_json(v_locked), 'decided', to_json(v_decided));
end $$;

-- A figyelő: a korábbi kérés válaszát feldolgozza, majd újat kér — élő gálánál 8 mp-nél, egyébként 55 mp-nél sűrűbben nem.
-- (a pg_net aszinkron: a válasz a következő tickben dolgozható fel, ezért a késés ≤ tick + ESPN-frissülés)
create or replace function espn_tick() returns void
language plpgsql security definer set search_path = public, net as $$
declare
  v_req bigint;
  v_body text;
  v_status int;
  v_last timestamptz;
  v_gap interval;
  ev events;
begin
  select value::bigint into v_req from settings where key = 'espn_req';
  if v_req is not null then
    select content, status_code into v_body, v_status from net._http_response where id = v_req;
    if v_status = 200 and v_body is not null then
      perform espn_process(v_body);
    end if;
    -- válasz nélkül (még úton, vagy eltűnt a sor) legfeljebb 60 mp-ig várunk, utána újat kérünk
    if v_status is not null or coalesce((select value::timestamptz from settings where key = 'espn_req_at'), now() - interval '1 day') < now() - interval '60 seconds' then
      delete from settings where key = 'espn_req';
    end if;
  end if;
  if exists (select 1 from settings where key = 'espn_req') then
    return;  -- még nem érkezett meg az előző válasz
  end if;

  select * into ev from events
  where espn_date is not null and starts_at between now() - interval '14 hours' and now() + interval '12 hours'
    and exists (select 1 from fights f where f.event = events.slug and f.status <> 'done')
  order by starts_at limit 1;
  if ev.slug is null then
    return;
  end if;

  v_gap := case when now() between ev.starts_at - interval '10 minutes' and ev.starts_at + interval '9 hours'
                then interval '8 seconds' else interval '55 seconds' end;
  select value::timestamptz into v_last from settings where key = 'espn_req_at';
  if v_last is not null and now() - v_last < v_gap then
    return;
  end if;

  v_req := net.http_get(
    url := 'https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=' || ev.espn_date,
    timeout_milliseconds := 20000);
  insert into settings (key, value) values ('espn_req', v_req::text)
  on conflict (key) do update set value = excluded.value;
  insert into settings (key, value) values ('espn_req_at', now()::text)
  on conflict (key) do update set value = excluded.value;
end $$;

revoke all on function espn_apply(jsonb) from public, anon, authenticated;
revoke all on function espn_tick() from public, anon, authenticated;

-- a menetrendi tartalék zárás törlése a még nyitott meccsekről
update fights set lock_at = null where status = 'open' and lock_at is not null and lock_at > now();

select cron.unschedule(jobid) from cron.job where jobname = 'ufctipp-espn';
select cron.schedule('ufctipp-espn', '10 seconds', 'select public.espn_tick()');
