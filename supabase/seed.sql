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
  ('all_day', '一日中', null, null, 10),
  ('morning', '朝', '09:00', '12:00', 20),
  ('day', '昼', '12:00', '17:00', 30),
  ('night', '夜', '18:00', '22:00', 40),
  ('unspecified', '指定なし', null, null, 50),
  ('custom', '固定時間', null, null, 90)
on conflict (key) do update
set
  label = excluded.label,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  sort_order = excluded.sort_order;
