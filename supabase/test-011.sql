-- test-011: ikersor-védelem — ha a pár valódi azonosítóval már megvan, az azonosító nélkül (negatív id) újra érkező meccs
-- nem duplázódik, és a meglévő sor a tippjével együtt megmarad (nem törlődik).
-- Mindig visszagörget: az eredmény egy hibaüzenet, amelynek szövege „OK ...” kell legyen.
do $$
declare
  v_player bigint;
  v_cnt int;
  v_pick int;
begin
  insert into players (nick, pin_hash) values ('teszt011', 'x') returning id into v_player;
  perform sync_event_apply(jsonb_build_object(
    'event', jsonb_build_object('slug', 'teszt-011', 'title', 'teszt', 'starts_at', now() + interval '1 day'),
    'fights', jsonb_build_array(jsonb_build_object('id', 777011, 'ord', 1, 'card', 'main', 'a_slug', 'aa', 'b_slug', 'bb'))));
  insert into picks (player_id, fight_id, side) values (v_player, 777011, 'A');
  -- a UFC.com ugyanazt a párt újra azonosító nélkül adja (ideiglenes negatív id), sarkcserével
  perform sync_event_apply(jsonb_build_object(
    'event', jsonb_build_object('slug', 'teszt-011', 'title', 'teszt', 'starts_at', now() + interval '1 day'),
    'fights', jsonb_build_array(jsonb_build_object('id', -777011, 'ord', 1, 'card', 'main', 'a_slug', 'bb', 'b_slug', 'aa'))));
  select count(*) into v_cnt from fights where event = 'teszt-011';
  select count(*) into v_pick from picks where player_id = v_player and fight_id = 777011;
  if v_cnt <> 1 or v_pick <> 1 or exists (select 1 from fights where id = -777011) then
    raise exception 'HIBA: % sor, % tipp a valódi soron, negatív sor: %', v_cnt, v_pick, exists (select 1 from fights where id = -777011);
  end if;
  raise exception 'OK — nincs ikersor, a meglévő sor és a tipp megmaradt';
end $$;
