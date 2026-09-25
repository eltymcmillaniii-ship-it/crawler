alter table public.encounter_displays
  add column if not exists d20_roll smallint
    check (d20_roll is null or d20_roll between 1 and 20),
  add column if not exists d20_roll_id uuid not null default gen_random_uuid();

create or replace function public.gm_roll_d20(p_game_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_roll integer;
begin
  if not public.is_game_gm(p_game_id) then
    raise exception 'GM access required';
  end if;

  v_roll := floor(random() * 20)::integer + 1;

  insert into public.encounter_displays(game_id, d20_roll, d20_roll_id)
  values (p_game_id, v_roll, gen_random_uuid())
  on conflict (game_id) do update
    set d20_roll = excluded.d20_roll,
        d20_roll_id = excluded.d20_roll_id;

  return v_roll;
end;
$$;

revoke all on function public.gm_roll_d20(uuid) from public, anon;
grant execute on function public.gm_roll_d20(uuid) to authenticated;
