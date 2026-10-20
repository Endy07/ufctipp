-- Generálta: tools/scrape-ufc.php (ufc-333) 2026-10-20 23:15 UTC. Újrafuttatható: a meglévő meccsek állapotát nem bántja.
insert into fights (id, event, ord, card, title_bout, points, lock_at) values
  (13063, 'ufc-333', 1, 'main', true, 2, null),
  (13064, 'ufc-333', 2, 'main', true, 2, null),
  (13066, 'ufc-333', 3, 'main', false, 1, null),
  (13125, 'ufc-333', 4, 'main', false, 1, null),
  (13215, 'ufc-333', 5, 'main', false, 1, '2026-10-24 18:00:00+00'),
  (13065, 'ufc-333', 6, 'prelims', false, 1, null),
  (13081, 'ufc-333', 7, 'prelims', false, 1, null),
  (13082, 'ufc-333', 8, 'prelims', false, 1, null),
  (13067, 'ufc-333', 9, 'prelims', false, 1, '2026-10-24 16:00:00+00'),
  (13221, 'ufc-333', 10, 'early', false, 1, null),
  (13220, 'ufc-333', 11, 'early', false, 1, null),
  (13224, 'ufc-333', 12, 'early', false, 1, null),
  (13225, 'ufc-333', 13, 'early', false, 1, null),
  (13226, 'ufc-333', 14, 'early', false, 1, '2026-10-24 14:00:00+00')
on conflict (id) do update set event = excluded.event, ord = excluded.ord, card = excluded.card,
  title_bout = excluded.title_bout, points = excluded.points;
