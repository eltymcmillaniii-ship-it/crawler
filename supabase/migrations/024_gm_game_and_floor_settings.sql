alter table public.games
add column if not exists floor_theme text not null default '';

create or replace function public.gm_update_game_settings(
  p_game_id uuid,
  p_name text,
  p_floor_number integer,
  p_floor_theme text
)
returns public.games
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_game public.games;
  v_name text := trim(coalesce(p_name,''));
  v_theme text := trim(coalesce(p_floor_theme,''));
begin
  if auth.uid() is null or not public.is_game_gm(p_game_id) then
    raise exception 'GM authorization required';
  end if;

  if length(v_name)<1 or length(v_name)>80 then
    raise exception 'Game name must be 1-80 characters';
  end if;

  if p_floor_number is null or p_floor_number<1 or p_floor_number>999 then
    raise exception 'Floor number must be between 1 and 999';
  end if;

  if length(v_theme)>120 then
    raise exception 'Floor theme must be 120 characters or fewer';
  end if;

  update public.games
  set name=v_name,
      floor_number=p_floor_number,
      floor_theme=v_theme
  where id=p_game_id
  returning * into v_game;

  return v_game;
end;
$function$;

revoke all on function public.gm_update_game_settings(uuid,text,integer,text) from public, anon;
grant execute on function public.gm_update_game_settings(uuid,text,integer,text) to authenticated;
