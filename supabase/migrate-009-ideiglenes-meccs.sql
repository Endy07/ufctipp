-- UfcTipp — 009: ideiglenes meccsazonosító (2026-11-07). Újrafuttatható.
-- Ha a UFC.com egy meccsnek még nem adott azonosítót (data-fmid), a szinkron negatív, a versenyzőpárból képzett
-- ideiglenes azonosítóval veszi fel, hogy lehessen tippelni. A valódi azonosító megérkezésekor a sor átkulcsolódik,
-- a tippek megmaradnak. (Az ideiglenes meccsre az ESPN-párosítás és a zárás a megszokott módon megy.)
alter table picks drop constraint if exists picks_fight_id_fkey;
alter table picks add constraint picks_fight_id_fkey
  foreign key (fight_id) references fights (id) on delete cascade on update cascade;

create or replace function sync_event_apply(p jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  ev jsonb := p->'event';
  v_slug text := ev->>'slug';
  inc jsonb;
  cur fights;
  v_added int[] := '{}';
  v_removed int[] := '{}';
  v_swapped int[] := '{}';
  v_moved int[] := '{}';
  v_kept int[] := '{}';     -- lezárt meccs, amelyen a kártya eltér: nem nyúlunk hozzá
  v_ids int[];
  v_title boolean;
  v_open boolean;
  v_pair_changed boolean;
  v_gone int;
begin
  select coalesce(array_agg((x->>'id')::int), '{}') into v_ids from jsonb_array_elements(p->'fights') x;

  -- Ideiglenes (negatív azonosítójú) meccs → valódi UFC.com-azonosító: a sort átkulcsoljuk, a tippek (on update cascade)
  -- vele mennek. A párosítás a két versenyző alapján történik (a sarkok felcserélődése a ciklusban fordítja a tippeket).
  for inc in select * from jsonb_array_elements(p->'fights') x where (x->>'id')::int > 0 loop
    if not exists (select 1 from fights where id = (inc->>'id')::int) then
      update fights set id = (inc->>'id')::int
      where id = (select ph.id from fights ph
                  where ph.event = v_slug and ph.id < 0
                    and ((ph.a_slug = inc->>'a_slug' and ph.b_slug = inc->>'b_slug')
                      or (ph.a_slug = inc->>'b_slug' and ph.b_slug = inc->>'a_slug'))
                  order by ph.id limit 1);
    end if;
  end loop;

  -- védőkorlát: ha egyszerre több mint 2 nyitott meccs tűnne el, az valószínűleg feldolgozási hiba, nem lemondás
  select count(*) into v_gone from fights f
  where f.event = v_slug and fight_is_open(f) and not (f.id = any (v_ids));
  if v_gone > 2 then
    update events set sync_note = format('%s: ELUTASÍTVA — %s nyitott meccs tűnt volna el egyszerre (ellenőrizd a UFC.com-ot)',
      to_char(now() at time zone 'Europe/Budapest', 'MM-DD HH24:MI'), v_gone) where slug = v_slug;
    return json_build_object('error', format('%s nyitott meccs tűnt volna el egyszerre — a szinkron nem módosított semmit', v_gone));
  end if;

  insert into events (slug, title, kind, starts_at, data, espn_event_id, espn_date, last_sync_at, updated_at)
  values (v_slug, ev->>'title', coalesce(ev->>'kind', 'fightnight'), (ev->>'starts_at')::timestamptz,
          p->'data', ev->>'espn_event_id', ev->>'espn_date', now(), now())
  on conflict (slug) do update set
    title = excluded.title, kind = excluded.kind, starts_at = excluded.starts_at,
    data = coalesce(excluded.data, events.data),
    espn_event_id = coalesce(excluded.espn_event_id, events.espn_event_id),
    espn_date = coalesce(excluded.espn_date, events.espn_date),
    last_sync_at = now(), updated_at = now();

  for inc in select * from jsonb_array_elements(p->'fights') loop
    v_title := coalesce((inc->>'title_bout')::boolean, false);
    select * into cur from fights where id = (inc->>'id')::int;
    if cur.id is null then
      insert into fights (id, event, ord, card, title_bout, points, lock_at, a_slug, b_slug, espn_id, espn_a)
      values ((inc->>'id')::int, v_slug, (inc->>'ord')::int, inc->>'card', v_title, case when v_title then 2 else 1 end,
              (inc->>'lock_at')::timestamptz, inc->>'a_slug', inc->>'b_slug', inc->>'espn_id', inc->>'espn_a');
      v_added := v_added || (inc->>'id')::int;
      continue;
    end if;

    v_open := fight_is_open(cur);
    v_pair_changed := cur.a_slug is not null and cur.b_slug is not null
      and (cur.a_slug is distinct from inc->>'a_slug' or cur.b_slug is distinct from inc->>'b_slug');

    if v_pair_changed and not v_open then
      -- lezárt / kész meccs: a tippek és a versenyzők maradnak (a kártya-eltérés csak a naplóba kerül)
      v_kept := v_kept || cur.id;
    elsif v_pair_changed then
      if cur.a_slug = inc->>'b_slug' and cur.b_slug = inc->>'a_slug' then
        -- csak a sarkok cseréltek helyet: a tippek oldala is fordul
        update picks set side = case side when 'A' then 'B' else 'A' end where fight_id = cur.id;
      else
        -- versenyzőcsere: a meccs tippjei érvénytelenek
        delete from picks where fight_id = cur.id;
        update fights set changed = true where id = cur.id;
        v_swapped := v_swapped || cur.id;
      end if;
    end if;

    if cur.ord is distinct from (inc->>'ord')::int or cur.card is distinct from inc->>'card' then
      v_moved := v_moved || cur.id;
    end if;

    update fights set
      event = v_slug,
      ord = (inc->>'ord')::int,
      card = inc->>'card',
      title_bout = v_title,
      points = case when v_title then 2 else 1 end,
      -- kézi lock_at-hoz nem nyúlunk; lejárt lock_at-ot nem tolunk későbbre (az újranyitná a meccset)
      lock_at = case
        when lock_source = 'manual' then lock_at
        when lock_at is not null and lock_at <= now() then lock_at
        else coalesce((inc->>'lock_at')::timestamptz, lock_at) end,
      a_slug = case when v_open or a_slug is null then inc->>'a_slug' else a_slug end,
      b_slug = case when v_open or b_slug is null then inc->>'b_slug' else b_slug end,
      -- a versenyzők változtak, de nincs új ESPN-párosítás: a régi elavult, töröljük (különben rossz oldalra írna)
      espn_id = case when v_open and v_pair_changed and inc->>'espn_id' is null then null else coalesce(inc->>'espn_id', espn_id) end,
      espn_a = case when v_open and v_pair_changed and inc->>'espn_a' is null then null else coalesce(inc->>'espn_a', espn_a) end,
      updated_at = now()
    where id = cur.id;
  end loop;

  -- elmaradt meccs: csak a még nyitottat töröljük (a tippek kaszkáddal mennek); lezártat / készet soha
  with del as (
    delete from fights f where f.event = v_slug and fight_is_open(f) and not (f.id = any (v_ids)) returning f.id
  ) select coalesce(array_agg(id), '{}') into v_removed from del;

  update events set sync_note = format('%s: +%s / -%s / csere %s / sorrend %s%s%s',
    to_char(now() at time zone 'Europe/Budapest', 'MM-DD HH24:MI'),
    coalesce(array_length(v_added, 1), 0), coalesce(array_length(v_removed, 1), 0),
    coalesce(array_length(v_swapped, 1), 0), coalesce(array_length(v_moved, 1), 0),
    case when ev ? 'espn_matched' then format(' / ESPN %s/%s', ev->>'espn_matched', ev->>'fight_count') else '' end,
    case when coalesce(array_length(v_kept, 1), 0) > 0 then format(' / lezárt meccsen eltérő kártya: %s', array_to_string(v_kept, ', ')) else '' end)
  where slug = v_slug;

  return json_build_object('added', to_json(v_added), 'removed', to_json(v_removed),
                           'swapped', to_json(v_swapped), 'moved', to_json(v_moved), 'kept', to_json(v_kept));
end $$;
