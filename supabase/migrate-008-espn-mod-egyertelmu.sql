-- UfcTipp — 008: kétértelmű ESPN-módnál az espn_apply nem ír módot (2026-11-01). Újrafuttatható.
-- Ok: a 005 a 'Unofficial Winner %' részletek közül limit 1-gyel választott; 2026-10-31-én egy meccsnél egyszerre jött
-- „Kotko” és „Decision”, és rossz mód lett belőle. Mostantól: az összes ilyen részlet kategóriáját gyűjtjük;
-- pontosan egy különböző kategória → az lesz a mód; több (kétértelmű) vagy nincs → a mód marad, ahogy volt (null), az admin pótolja.
-- A lezárt (done) meccsek eredményét nem érinti (az ág csak a még nem done meccsre fut). Ellenőrzés: test-008.sql (egy „OK” sor).
-- A függvény-jogosultságok a create or replace-szel megmaradnak (anon számára tiltott).

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
  v_cats text[];
  v_mode text;
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
        -- az összes „Unofficial Winner” részlet módkategóriája; csak az egyértelmű (pontosan 1 különböző) számít
        select coalesce(array_agg(distinct cat), '{}') into v_cats from (
          select case
            when t ilike '%ko%tko%' or t ilike '%kotko%' then 'KO/TKO'
            when t ilike '%submission%' then 'Feladás'
            when t ilike '%decision%' then 'Pontozás'
            end as cat
          from (select d->'type'->>'text' as t from jsonb_array_elements(coalesce(c->'details', '[]')) d) x
          where t like 'Unofficial Winner %'
        ) y where cat is not null;
        v_mode := case when array_length(v_cats, 1) = 1 then v_cats[1] else null end;
        update fights set
          status = 'done', winner = v_side, result_source = 'auto',
          method = coalesce(v_mode, method),
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
