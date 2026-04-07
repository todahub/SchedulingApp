insert into availability_levels (key, label, weight, sort_order)
values
  ('yes', '行ける', 1.0, 10),
  ('maybe', '微妙', 0.5, 20),
  ('no', '無理', 0.0, 30)
on conflict (key) do update
set
  label = excluded.label,
  weight = excluded.weight,
  sort_order = excluded.sort_order;

insert into time_slot_presets (key, label, starts_at, ends_at, sort_order)
values
  ('day', '昼', '12:00', '17:00', 10),
  ('night', '夜', '18:00', '22:00', 20),
  ('all_day', 'オール', null, null, 30)
on conflict (key) do update
set
  label = excluded.label,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  sort_order = excluded.sort_order;
