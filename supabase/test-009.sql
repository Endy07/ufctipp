-- test-009: ideiglenes meccsazonosító átkulcsolása; a tipp megmarad (sarokcserénél az oldala fordul).
-- Mindig visszagörget: az eredmény egy hibaüzenet, amelynek szövege „OK ...” kell legyen.
do $$
declare
  v_player bigint;
  v_fight int;
  v_side text;
  v_cnt int;
begin
  insert into players (nick, pin_hash) values ('teszt009', 'x') returning id into v_player;
  perform sync_event_apply(jsonb_build_object(
    'event', jsonb_build_object('slug', 'teszt-009', 'title', 'teszt', 'starts_at', now() + interval '1 day'),
    'fights', jsonb_build_array(jsonb_build_object('id', -777001, 'ord', 1, 'card', 'main', 'a_slug', 'aa', 'b_slug', 'bb'))));
  insert into picks (player_id, fight_id, side) values (v_player, -777001, 'A');
  -- a valódi azonosító megjön, a sarkok felcserélve
  perform sync_event_apply(jsonb_build_object(
    'event', jsonb_build_object('slug', 'teszt-009', 'title', 'teszt', 'starts_at', now() + interval '1 day'),
    'fights', jsonb_build_array(jsonb_build_object('id', 777001, 'ord', 1, 'card', 'main', 'a_slug', 'bb', 'b_slug', 'aa'))));
  select count(*) into v_cnt from fights where event = 'teszt-009';
  select fight_id, side into v_fight, v_side from picks where player_id = v_player;
  if v_cnt <> 1 or v_fight <> 777001 or v_side <> 'B' then
    raise exception 'HIBA: % sor, fight %, side %', v_cnt, v_fight, v_side;
  end if;
  raise exception 'OK — átkulcsolva, a tipp megmaradt (oldala fordult)';
end $$;
